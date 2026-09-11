// npm's own trusted-publishing setup requires an OIDC trusted publisher to be configured on a package's npmjs.com settings page before OIDC publishing from CI can succeed — and that settings page only exists once the package has been published at least once (docs.npmjs.com/trusted-publishers; github.blog's OIDC-GA changelog describes the same one-time bootstrap). A package that has never been published therefore has no trusted publisher to configure, so its very first release-job publish attempt fails outright with a 404 OIDC token exchange error, then ENONPMTOKEN on the token fallback, since this workspace deliberately configures no NPM_TOKEN (see README.md's Releases section). This check catches that gap before it reaches the release job at all (confirmed for pdf-raster-cpu, ExaDev/documents.js, 2026-09-11).
//
// Scoped to the packages a pull request actually touches, the same way most other tasks here scope to `--affected`: this is required on every pull request, and an unscoped whole-workspace check would mean one still-unregistered package blocks every unrelated pull request until someone bootstraps it, not just the pull requests that touch it. `GITHUB_BASE_REF` is set automatically by GitHub Actions on a pull_request event and absent on a push (main) or workflow_dispatch run, which is what this reads to decide between the two: a push to main runs the full, unscoped check, matching how the whole workspace is what actually gates the release job that runs immediately after.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGES_DIR = "packages";

export interface WorkspacePackage {
  name: string;
  directory: string;
  private: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readWorkspacePackage(
  packageJsonText: string,
  directory: string,
): WorkspacePackage {
  const parsed: unknown = JSON.parse(packageJsonText);
  if (!isRecord(parsed) || typeof parsed.name !== "string") {
    throw new Error("package.json has no string name");
  }
  return { name: parsed.name, directory, private: parsed.private === true };
}

// Derives the set of workspace package directories a diff touches from the changed file paths alone -- a package is in scope if any file under its own packages/<directory>/ changed, not only when its package.json did, since a pull request adding source files to an already-registered-but-still-new package is exactly the case someone is already looking at it and could bootstrap it.
export function touchedPackageDirectories(
  changedPaths: readonly string[],
): ReadonlySet<string> {
  const directories = new Set<string>();
  for (const path of changedPaths) {
    const match = /^packages\/([^/]+)\//.exec(path);
    if (match?.[1] !== undefined) {
      directories.add(match[1]);
    }
  }
  return directories;
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

// pnpm info shells out to the configured registry the same way the release job's own publish step resolves it, so this reports the exact registry state the release job will actually meet — rather than duplicating that resolution with a raw fetch against a hardcoded registry URL. `pnpm info <name> version` prints nothing useful on success (the field this check cares about is only "does the package exist at all", not any particular version), so only the exit status and stderr matter.
export function isRegisteredOnNpm(name: string): boolean {
  try {
    execFileSync("pnpm", ["info", name, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
    });
    return true;
  } catch (error) {
    const stderr =
      isRecord(error) && typeof error.stderr === "string" ? error.stderr : "";
    if (stderr.includes("E404")) {
      return false;
    }
    throw new Error(`pnpm info ${name} version failed: ${String(error)}`, {
      cause: error,
    });
  }
}

function readWorkspacePackages(): readonly WorkspacePackage[] {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      readWorkspacePackage(
        readFileSync(join(PACKAGES_DIR, entry.name, "package.json"), "utf8"),
        entry.name,
      ),
    )
    .filter((pkg) => !pkg.private);
}

function failCheck(message: string): never {
  console.log(`::error::${message}`);
  process.exit(1);
}

function failUnexpected(message: string): never {
  console.log(`::error::${message}`);
  process.exit(2);
}

// Wrapped in a main guard so the pure helpers above stay importable from the test suite: node executes this file directly for real runs, and the unit tests import the helpers without shelling out to git, pnpm, or touching the real workspace.
function main(): void {
  try {
    const packages = readWorkspacePackages();

    const baseRef = process.env.GITHUB_BASE_REF;
    let inScope = packages;
    if (baseRef !== undefined && baseRef !== "") {
      git(["fetch", "origin", baseRef]);
      const changed = git(["diff", "--name-only", `origin/${baseRef}...HEAD`])
        .split("\n")
        .filter((line) => line !== "");
      const touched = touchedPackageDirectories(changed);
      inScope = packages.filter((pkg) => touched.has(pkg.directory));
      if (inScope.length === 0) {
        console.log(
          "No workspace package's files changed in this pull request; nothing to check.",
        );
        return;
      }
    }

    const unregistered = inScope.filter((pkg) => !isRegisteredOnNpm(pkg.name));

    if (unregistered.length > 0) {
      for (const pkg of unregistered) {
        console.log(
          `${pkg.name} has never been published to npm, so no trusted publisher can be configured for it yet — its first Release-job publish will fail with an OIDC token exchange 404. Bootstrap it with a one-time manual \`npm publish\` from an authenticated maintainer account (or https://github.com/azu/setup-npm-trusted-publish), then configure trusted publishing on its new npmjs.com settings page per CONTRIBUTING.md's "Adding a package to the workspace" checklist.`,
        );
      }
      failCheck(
        `${String(unregistered.length)} workspace package(s) have never been published to npm.`,
      );
    }

    console.log(
      `All ${String(inScope.length)} publishable workspace package(s) checked are already registered on npm.`,
    );
  } catch (error) {
    failUnexpected(`npm registration check crashed: ${String(error)}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
