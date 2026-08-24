import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const WORKSPACE_FILE = "pnpm-workspace.yaml";
const MS_PER_MINUTE = 60 * 1000;

export interface PackageVersion {
  name: string;
  version: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// pnpm's minimumReleaseAge is a number of MINUTES, not days: pnpm types the setting "number (minutes)" in its own settings reference (https://pnpm.io/settings#minimumreleaseage). This workspace configures 60 -- one hour -- where the repository this script was ported from configures 10080, seven days and the source of its hardcoded 7. Reading the live value is what keeps this gate and pnpm's own resolution gate describing the same window: a hardcoded number here would silently pass PRs pnpm refuses to install, or hold PRs it would have installed. Nothing converts to days, so the unit cannot drift from the setting.
//
// An absent key is a real error rather than a case to default. This check is the whole reason a dependency bump is allowed to merge unattended, and a default would mean choosing a window nobody configured -- either stricter than the workspace's own policy (blocking merges the policy permits) or looser (merging what it forbids).
export function minimumReleaseAgeMinutes(workspaceYamlText: string): number {
  const parsed: unknown = parse(workspaceYamlText);
  if (!isRecord(parsed) || typeof parsed.minimumReleaseAge !== "number") {
    throw new Error(
      `${WORKSPACE_FILE} has no numeric minimumReleaseAge; refusing to age-check against a window this workspace has not configured`,
    );
  }
  return parsed.minimumReleaseAge;
}

// Pure, and exported for the unit tests, because the minutes-vs-days unit is the one thing here a test can actually pin down: at a 60-minute window a package published two days ago is old enough, and would be far too new if the same 60 were read as days.
export function isTooNew(
  publishedAt: Date,
  now: number,
  minimumAgeMinutes: number,
): boolean {
  return now - publishedAt.getTime() < minimumAgeMinutes * MS_PER_MINUTE;
}

// This workspace's pnpm-lock.yaml is a single YAML document. The reference this was ported from reads a multi-document stream, which is what pnpm writes when a project pins its own pnpm binary through packageManagerDependencies: one document for that self-management lockfile, one for the project's own dependencies, both carrying their own `packages:` map -- hence its search for the document with a project `importers['.']` entry. This workspace pins pnpm through package.json's packageManager field alone, so there is one document and nothing to disambiguate. `parse` rather than parseAllDocuments keeps that assumption honest: it throws on a multi-document source, so the day a lockfile here does grow a second document this fails loudly rather than silently reading whichever document came first.
export function projectDocument(yamlText: string): Record<string, unknown> {
  const parsed: unknown = parse(yamlText);
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.importers) ||
    !isRecord(parsed.importers["."])
  ) {
    throw new Error("pnpm-lock.yaml had no project importers['.'] entry");
  }
  return parsed;
}

export function packageVersionsFromLockfile(yamlText: string): Set<string> {
  const doc = projectDocument(yamlText);
  if (!isRecord(doc.packages)) {
    throw new Error("pnpm-lock.yaml did not have a `packages` map");
  }
  const entries = new Set<string>();
  for (const key of Object.keys(doc.packages)) {
    entries.add(key.replace(/(\([^)]*\))+$/, ""));
  }
  return entries;
}

export function splitNameAndVersion(nameAtVersion: string): PackageVersion {
  const at = nameAtVersion.lastIndexOf("@");
  return {
    name: nameAtVersion.slice(0, at),
    version: nameAtVersion.slice(at + 1),
  };
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

function publishedAt(name: string, version: string): Date {
  let raw: string;
  try {
    raw = execFileSync("pnpm", ["info", name, "time", "--json"], {
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(`pnpm info ${name} time --json failed: ${String(error)}`, {
      cause: error,
    });
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || typeof parsed[version] !== "string") {
    throw new Error(
      `pnpm info ${name} time --json had no timestamp for version ${version}`,
    );
  }
  return new Date(parsed[version]);
}

// Exit codes are load-bearing for the caller (dependabot-auto-merge.yml): 1 means "a genuinely too-new package, skip this PR until it ages out" (routine, expected); 2 means "this script itself failed for an unrelated reason" (git/registry error, bad data) and must surface distinctly so a real problem doesn't get silently misreported as a grace period wait forever.
function failUnexpected(message: string): never {
  console.log(`::error::${message}`);
  process.exit(2);
}

// Wrapped in a main guard so the pure helpers above stay importable from the test suite: node executes this file directly for real runs, and the unit tests import the helpers without triggering any git or registry activity.
function main(): void {
  const prNumber = process.argv[2];
  if (!prNumber) {
    failUnexpected("usage: check-dependency-age.ts <PR_NUMBER>");
  }

  try {
    // Read inside the try, not at module scope: a missing or malformed minimumReleaseAge is a script failure, and an uncaught throw at module scope exits 1 -- the code that tells the caller "this PR is merely too new, come back later", which would leave a real misconfiguration looking like a grace period that never ends.
    const minimumAgeMinutes = minimumReleaseAgeMinutes(
      readFileSync(WORKSPACE_FILE, "utf8"),
    );

    // Fetch main and the PR head explicitly rather than trusting the ambient checkout's HEAD/origin state — what HEAD points at differs by trigger (schedule/workflow_dispatch check out main directly; a pull_request trigger checks out a merge-preview ref instead). Forced (`+`) because a shallow `--depth 1` fetch grafts the new commit with no recorded parent, so a later re-fetch into the same local ref name is rejected as non-fast-forward even when main has only moved forward — this script runs once per PR in a loop that shares one checkout, and an earlier PR merging mid-loop advances main between invocations.
    const mainRef = "refs/remotes/origin/base-main";
    const prRef = `refs/remotes/origin/pr-${prNumber}`;
    git(["fetch", "--depth", "1", "origin", `+main:${mainRef}`]);
    git(["fetch", "--depth", "1", "origin", `+pull/${prNumber}/head:${prRef}`]);

    const baseLockfile = git(["show", `${mainRef}:pnpm-lock.yaml`]);
    const headLockfile = git(["show", `${prRef}:pnpm-lock.yaml`]);

    const basePackages = packageVersionsFromLockfile(baseLockfile);
    const headPackages = packageVersionsFromLockfile(headLockfile);

    const introduced = [...headPackages]
      .filter((entry) => !basePackages.has(entry))
      .map(splitNameAndVersion);

    if (introduced.length === 0) {
      console.log(
        `PR #${prNumber} introduces no new package versions in pnpm-lock.yaml — nothing to age-check.`,
      );
      process.exit(0);
    }

    const now = Date.now();
    const tooNew = introduced
      .map((pkg) => ({ pkg, publishedAt: publishedAt(pkg.name, pkg.version) }))
      .filter(({ publishedAt }) =>
        isTooNew(publishedAt, now, minimumAgeMinutes),
      );

    if (tooNew.length > 0) {
      for (const { pkg, publishedAt } of tooNew) {
        const ageMinutes = (
          (now - publishedAt.getTime()) /
          MS_PER_MINUTE
        ).toFixed(1);
        console.log(
          `PR #${prNumber}: ${pkg.name}@${pkg.version} was published ${ageMinutes} minutes ago — waiting for the ${String(minimumAgeMinutes)}-minute grace period.`,
        );
      }
      process.exit(1);
    }

    console.log(
      `PR #${prNumber}: all ${String(introduced.length)} newly introduced package version(s) are at least ${String(minimumAgeMinutes)} minutes old.`,
    );
  } catch (error) {
    failUnexpected(
      `dependency age check crashed for PR #${prNumber}: ${String(error)}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
