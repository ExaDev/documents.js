// npm's own trusted-publishing setup requires an OIDC trusted publisher to be configured on a package's npmjs.com settings page before OIDC publishing from CI can succeed — and that settings page only exists once the package has been published at least once (docs.npmjs.com/trusted-publishers; github.blog's OIDC-GA changelog describes the same one-time bootstrap). A package that has never been published therefore has no trusted publisher to configure, so its very first release-job publish attempt fails outright with a 404 OIDC token exchange error, then ENONPMTOKEN on the token fallback, since this workspace deliberately configures no NPM_TOKEN (see README.md's Releases section). This check catches that gap at PR time, before the package's first release attempt ever runs, rather than leaving it to surface as a red post-merge Release job (confirmed for pdf-raster-cpu, ExaDev/documents.js, 2026-09-11).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGES_DIR = "packages";
const ACK_FILE = ".github/npm-registration-pending.json";

export interface WorkspacePackage {
  name: string;
  private: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readWorkspacePackage(
  packageJsonText: string,
): WorkspacePackage {
  const parsed: unknown = JSON.parse(packageJsonText);
  if (!isRecord(parsed) || typeof parsed.name !== "string") {
    throw new Error("package.json has no string name");
  }
  return { name: parsed.name, private: parsed.private === true };
}

export function readAcknowledgedNames(
  ackJsonText: string,
): ReadonlySet<string> {
  const parsed: unknown = JSON.parse(ackJsonText);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((entry) => typeof entry === "string")
  ) {
    throw new Error(`${ACK_FILE} must be a JSON array of package names`);
  }
  return new Set(parsed);
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

function failCheck(message: string): never {
  console.log(`::error::${message}`);
  process.exit(1);
}

function failUnexpected(message: string): never {
  console.log(`::error::${message}`);
  process.exit(2);
}

// Wrapped in a main guard so the pure helpers above stay importable from the test suite: node executes this file directly for real runs, and the unit tests import the helpers without shelling out to pnpm or touching the real workspace.
function main(): void {
  try {
    const acknowledged = readAcknowledgedNames(readFileSync(ACK_FILE, "utf8"));

    const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readWorkspacePackage(
          readFileSync(join(PACKAGES_DIR, entry.name, "package.json"), "utf8"),
        ),
      )
      .filter((pkg) => !pkg.private);

    const unregistered = packages
      .filter((pkg) => !acknowledged.has(pkg.name))
      .filter((pkg) => !isRegisteredOnNpm(pkg.name));

    if (unregistered.length > 0) {
      for (const pkg of unregistered) {
        console.log(
          `${pkg.name} has never been published to npm, so no trusted publisher can be configured for it yet — its first Release-job publish will fail with an OIDC token exchange 404. Bootstrap it with a one-time manual \`npm publish\` from an authenticated maintainer account (or https://github.com/azu/setup-npm-trusted-publish), then configure trusted publishing on its new npmjs.com settings page per CONTRIBUTING.md's "Adding a package to the workspace" checklist. Until then, add "${pkg.name}" to ${ACK_FILE} to acknowledge the gap explicitly.`,
        );
      }
      failCheck(
        `${String(unregistered.length)} workspace package(s) have never been published to npm and are not acknowledged in ${ACK_FILE}.`,
      );
    }

    console.log(
      `All ${String(packages.length)} publishable workspace package(s) are already registered on npm or explicitly acknowledged in ${ACK_FILE}.`,
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
