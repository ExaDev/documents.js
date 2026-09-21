// Turns the set of packages `_test:mutation` is affected for into the GitHub Actions matrix of mutation jobs, one entry per package slice. A package whose estimated cold cost fits the slice budget is one slice covering the whole package; a larger one is split by file into as many slices as the budget needs, each run with its own `--mutate` list. The workflow gates the merged per-package score (see gate-mutation-scores.ts), so a slice's own score is never compared against a threshold.
//
// The cost estimate is a linear upper envelope over source lines: a fixed cost that does not depend on size (build, dry run, checker start-up) plus a per-line cost, both chosen so that every measured cold run of a real package lies at or below the line (plan-mutation-slices.test.ts holds the samples and fails when one rises above it). Source lines are free to compute, whereas the only direct measure of a package's mutant count is Stryker's own dry run, which would cost as much as the planning is meant to save. An envelope rather than a fit is deliberate: an underestimate produces a slice that hits its job timeout, an overestimate only produces an extra slice that starts warm from its cache.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LOCKFILE_PATH,
  changedFilesSince,
  changedImporters,
  fileAtRef,
  mutationInputs,
  packagesAffectedByChanges,
  readScopedPackage,
  type ScopedPackage,
} from "./mutation-scope.ts";

/** The most a GitHub-hosted runner job may run for, from GitHub's workflow syntax reference for `jobs.<job_id>.timeout-minutes`. */
export const GITHUB_JOB_LIMIT_MINUTES = 360;

/** The share of the job limit a slice's cold estimate may consume. A slice planned at this share still leaves the rest of the limit as headroom for the estimate being wrong, which is what keeps a slice from ever being the job that hits the limit. */
export const SLICE_SHARE_OF_JOB_LIMIT = 1 / 4;

/** Cold-run cost that does not depend on package size, in seconds: the build, Stryker's dry run and the checker's start-up. Taken from the smallest measured packages, rounded up. */
export const COLD_FIXED_SECONDS = 240;

/** Cold-run cost per mutable source line, in seconds. A round value at or just above the smallest one for which the envelope through COLD_FIXED_SECONDS clears every measured sample; the slowest sample per line, a package whose tests are heavy, sets it. */
export const COLD_SECONDS_PER_LINE = 1;

/** How many standard GitHub-hosted Linux jobs one account may run at once, from GitHub's "Actions limits" reference (job concurrency limits, by plan). The account this repository belongs to is on the plan this figure is for, and every workflow of every repository in it draws on the same pool, including the required checks a merge waits on. */
export const ACCOUNT_RUNNER_LIMIT = 20;

/** The most of that pool mutation jobs may hold at once, all runs together. Kept well under half so the required checks always find runners: a mutation job is long and a check is short, so a pool that mutation could fill turns every queued check into a wait as long as a mutation job. */
export const MUTATION_SHARE_OF_RUNNER_LIMIT = 0.4;

/** How many pull-request mutation runs the pull-request half of the budget is divided between. Each pull request has a group of its own, so nothing enforces this: it is the number of pull requests expected to be running mutation at once, and the per-run ceiling follows from it. */
export const EXPECTED_CONCURRENT_PULL_REQUEST_RUNS = 2;

/** Runner set-up outside Stryker (checkout, install, cache restore), added to a job's timeout on top of its scaled estimate. */
export const JOB_SETUP_MINUTES = 10;

/** How many times over a slice's own cold estimate its job may run before the timeout kills it. */
export const TIMEOUT_MARGIN = 2;

const TEST_FILE_PATTERN = /\.test\.tsx?$/;

/** Characters that would change what a `--mutate` entry means: the comma separates entries, and the rest are glob syntax, so a path containing one would select something other than its own file. */
const UNSAFE_MUTATE_PATH_CHARACTERS = /[,*?[\]{}()!]/;

const SECONDS_PER_MINUTE = 60;

interface TurboDryRunTask {
  readonly task: string;
  readonly package: string;
  readonly directory: string;
}

interface TurboDryRunPlan {
  readonly tasks: readonly TurboDryRunTask[];
}

export interface AffectedPackage {
  readonly name: string;
  readonly directory: string;
}

export interface SourceFile {
  /** The path relative to the package directory, in the form Stryker's `--mutate` takes. */
  readonly path: string;
  readonly lines: number;
}

export interface SliceMatrixEntry {
  readonly package: string;
  /** The package directory relative to the repository root. */
  readonly directory: string;
  readonly slice: number;
  readonly sliceCount: number;
  /** Comma-separated `--mutate` list, empty for a package run whole. */
  readonly mutate: string;
  readonly timeoutMinutes: number;
  /** Stable across runs for the same package and slice layout, so a slice restores its own previous incremental report. */
  readonly cacheKey: string;
  /** Stable across runs for the same effective Stryker configuration (see strykerConfigHash), and folded into the incremental cache key alongside cacheKey so a config change invalidates a slice's cache rather than silently reusing mutant results computed under the old configuration. */
  readonly configHash: string;
}

/**
 * A short, stable fingerprint of a package's effective Stryker configuration: its own `stryker.config.ts` plus the shared derivation every package's config is built through. Included in the incremental cache key precisely because Stryker's own incremental mode has no idea the configuration changed: it decides what to reuse purely from whether a mutated file's content changed since the cached report was written. A change to a mutate glob, an excluded pattern, or the shared option-merging logic in stryker.shared.ts alters which mutants should exist or which files should be instrumented at all, without changing the mutated files themselves, so without this fingerprint a stale incremental report can silently carry forward mutants a fresh run would never generate (or drop ones a fresh run would).
 *
 * Confirmed empirically: packages/web's stryker.config.ts excluded `*.css.ts` from its mutate glob on 2026-09-14, and a full run on 2026-09-20 still reported NoCoverage mutants inside excluded `*.css.ts` files, dragging a package pinned at breakThreshold: 100 down to 92.43, not from a real regression but from a six-day-old incremental report the mutate-glob change never invalidated.
 */
export function strykerConfigHash(
  packageConfigText: string,
  sharedConfigText: string,
): string {
  return createHash("sha256")
    .update(packageConfigText)
    .update("\0")
    .update(sharedConfigText)
    .digest("hex")
    .slice(0, 12);
}

/** Extracts the `_test:mutation` task's own package list from a `turbo run ... --dry-run=json` plan, rather than re-deriving affectedness independently, since this is the exact computation the real run uses and the slice plan cannot disagree with the run it plans for. */
export function affectedMutationPackages(
  dryRunOutput: string,
): readonly AffectedPackage[] {
  const plan = JSON.parse(dryRunOutput) as TurboDryRunPlan;
  return plan.tasks
    .filter((task) => task.task === "_test:mutation")
    .map((task) => ({ name: task.package, directory: task.directory }));
}

/** Every `.ts`/`.tsx` file under a package's `src/` minus its unit tests, with its line count: the same scope stryker.shared.ts's default `mutate` glob covers. A package the turbo plan lists is a real workspace package with a `src/` directory. */
export function packageSourceFiles(directory: string): readonly SourceFile[] {
  return readdirSync(join(directory, "src"), { recursive: true })
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => /\.tsx?$/.test(entry) && !TEST_FILE_PATTERN.test(entry))
    .sort()
    .map((entry) => {
      const file = join(directory, "src", entry);
      return {
        path: relative(directory, file),
        lines: readFileSync(file, "utf8").split("\n").length,
      };
    });
}

/** The cold-run estimate in seconds for mutating `lines` source lines in one job: the linear upper envelope described at the top of this file. */
export function estimateColdSeconds(lines: number): number {
  return COLD_FIXED_SECONDS + COLD_SECONDS_PER_LINE * lines;
}

/** The cold estimate in seconds a single slice may not exceed. */
export function sliceBudgetSeconds(): number {
  return (
    GITHUB_JOB_LIMIT_MINUTES * SECONDS_PER_MINUTE * SLICE_SHARE_OF_JOB_LIMIT
  );
}

/** The job timeout for a slice of `lines` source lines: its scaled cold estimate plus runner set-up, never more than GitHub allows. */
export function timeoutMinutesFor(lines: number): number {
  const scaled = Math.ceil(
    (estimateColdSeconds(lines) * TIMEOUT_MARGIN) / SECONDS_PER_MINUTE,
  );
  return Math.min(GITHUB_JOB_LIMIT_MINUTES, scaled + JOB_SETUP_MINUTES);
}

/** Splits a package's files into the fewest slices whose cold estimates all fit the budget: longest-processing-time-first assignment, so each file goes to whichever slice is currently smallest, which keeps the slices close to equal. A package that fits whole is a single slice. Throws when one file alone is over the budget, since a file is the smallest unit `--mutate` can select and no slice count would help; with every file under the budget the loop always ends, at the latest with one file per slice. */
export function planSlices(
  files: readonly SourceFile[],
): readonly (readonly SourceFile[])[] {
  const budgetSeconds = sliceBudgetSeconds();
  const largest = files.reduce(
    (max, file) => (file.lines > max.lines ? file : max),
    { path: "", lines: 0 },
  );
  if (estimateColdSeconds(largest.lines) > budgetSeconds) {
    throw new Error(
      `${largest.path} alone is estimated over the slice budget, and a file cannot be split across slices`,
    );
  }
  const bySizeDescending = [...files].sort((a, b) => b.lines - a.lines);
  for (let sliceCount = 1; ; sliceCount++) {
    const slices: { files: SourceFile[]; lines: number }[] = Array.from(
      { length: sliceCount },
      () => ({ files: [], lines: 0 }),
    );
    for (const file of bySizeDescending) {
      const smallest = slices.reduce((least, slice) =>
        slice.lines < least.lines ? slice : least,
      );
      smallest.files.push(file);
      smallest.lines += file.lines;
    }
    const fits = slices.every(
      (slice) => estimateColdSeconds(slice.lines) <= budgetSeconds,
    );
    if (fits) return slices.map((slice) => slice.files);
  }
}

/** The `strategy.matrix.include` entries for one package: `mutate` is empty when the package runs whole, so the package's own `mutate` globs apply. */
export function packageMatrixEntries(
  pkg: AffectedPackage,
  files: readonly SourceFile[],
  configHash: string,
): readonly SliceMatrixEntry[] {
  const name = pkg.name;
  for (const file of files) {
    if (UNSAFE_MUTATE_PATH_CHARACTERS.test(file.path)) {
      throw new Error(
        `${file.path} contains a character that --mutate would read as syntax`,
      );
    }
  }
  const slices = planSlices(files);
  return slices.map((sliceFiles, index) => ({
    package: name,
    directory: pkg.directory,
    slice: index + 1,
    sliceCount: slices.length,
    mutate:
      slices.length === 1 ? "" : sliceFiles.map((file) => file.path).join(","),
    timeoutMinutes: timeoutMinutesFor(
      sliceFiles.reduce((total, file) => total + file.lines, 0),
    ),
    cacheKey: `${name}-${String(index + 1)}of${String(slices.length)}`,
    configHash,
  }));
}

export type MutationEvent = "pull_request" | "schedule" | "workflow_dispatch";

/** The `strategy.max-parallel` for one run. The mutation budget is split in half between pull-request runs and full-workspace runs; a scheduled run holds the whole full-run half (it runs when few other jobs do), a dispatched run, which someone starts during the working day, holds half of that, and a pull-request run holds its share of the pull-request half. Across all of them the total stays inside the mutation budget as long as the expected number of concurrent pull-request runs is not exceeded. */
export function maxParallelFor(event: MutationEvent): number {
  const budget = Math.floor(
    ACCOUNT_RUNNER_LIMIT * MUTATION_SHARE_OF_RUNNER_LIMIT,
  );
  const half = Math.floor(budget / 2);
  const byEvent: Record<MutationEvent, number> = {
    schedule: half,
    workflow_dispatch: Math.floor(half / 2),
    pull_request: Math.floor(half / EXPECTED_CONCURRENT_PULL_REQUEST_RUNS),
  };
  return Math.max(1, byEvent[event]);
}

export interface PackagePlan {
  readonly package: string;
  readonly entries: readonly SliceMatrixEntry[];
}

/** Splits the planned packages into those a pull request runs automatically and those it leaves to a dispatched or scheduled run. A package planned as several slices costs hours cold, so it is not started by every pull request that touches it; the scheduled run gates it, and a dispatch names it on demand. Any other event runs every planned package. */
export function partitionForEvent(
  plans: readonly PackagePlan[],
  event: MutationEvent,
): {
  readonly run: readonly PackagePlan[];
  readonly deferred: readonly string[];
} {
  if (event !== "pull_request") return { run: plans, deferred: [] };
  return {
    run: plans.filter((plan) => plan.entries.length === 1),
    deferred: plans
      .filter((plan) => plan.entries.length > 1)
      .map((plan) => plan.package),
  };
}

/** The packages a dispatch named, or every package when it named none. Throws on a name that is not a workspace package, so a typo cannot quietly plan nothing. */
export function selectRequested<T extends { readonly name: string }>(
  packages: readonly T[],
  requested: readonly string[],
): readonly T[] {
  if (requested.length === 0) return packages;
  const known = new Set(packages.map((pkg) => pkg.name));
  const unknown = requested.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `not a workspace package with a mutation task: ${unknown.join(", ")}`,
    );
  }
  return packages.filter((pkg) => requested.includes(pkg.name));
}

function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  appendFileSync(outputFile, `${name}=${value}\n`);
}

function isMutationEvent(value: string | undefined): value is MutationEvent {
  return (
    value === "pull_request" ||
    value === "schedule" ||
    value === "workflow_dispatch"
  );
}

/** The workspace's packages with their direct workspace dependencies, for judging which a change can reach. */
function workspaceScopedPackages(): readonly ScopedPackage[] {
  const named = readdirSync("packages", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("packages", entry.name))
    .map((directory) => {
      const manifest: unknown = JSON.parse(
        readFileSync(join(directory, "package.json"), "utf8"),
      );
      const name =
        typeof manifest === "object" && manifest !== null && "name" in manifest
          ? manifest.name
          : undefined;
      if (typeof name !== "string") {
        throw new Error(`${directory}/package.json has no name`);
      }
      return { name, directory };
    });
  const names = new Set(named.map((pkg) => pkg.name));
  return named.map((pkg) => readScopedPackage(pkg.name, pkg.directory, names));
}

/** The packages a pull request's changes can move a mutation result for, out of those turbo reports as affected. */
function pullRequestPackages(
  affected: readonly AffectedPackage[],
): readonly AffectedPackage[] {
  const base = process.env.TURBO_SCM_BASE;
  if (!base) throw new Error("a pull request plan needs TURBO_SCM_BASE");
  const changedFiles = changedFilesSince(base);
  const importers = changedFiles.includes(LOCKFILE_PATH)
    ? changedImporters(
        fileAtRef(base, LOCKFILE_PATH),
        readFileSync(LOCKFILE_PATH, "utf8"),
      )
    : new Set<string>();
  const inScope = new Set(
    packagesAffectedByChanges({
      packages: workspaceScopedPackages(),
      changedFiles,
      inputs: mutationInputs(readFileSync("turbo.json", "utf8")),
      changedImporters: importers,
    }).map((pkg) => pkg.name),
  );
  return affected.filter((pkg) => inScope.has(pkg.name));
}

function main(): void {
  const event = process.env.MUTATION_EVENT;
  if (!isMutationEvent(event)) {
    throw new Error(`unsupported MUTATION_EVENT: ${String(event)}`);
  }
  const requested = (process.env.MUTATION_PACKAGES ?? "")
    .split(/\s+/)
    .filter((name) => name !== "");
  const dryRunOutput = execFileSync(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "_test:mutation",
      "--dry-run=json",
      ...process.argv.slice(2),
    ],
    { encoding: "utf8" },
  );
  const affected = affectedMutationPackages(dryRunOutput);
  const candidates =
    event === "pull_request"
      ? pullRequestPackages(affected)
      : selectRequested(affected, requested);
  const sharedConfigText = readFileSync("stryker.shared.ts", "utf8");
  const plans = candidates.map((pkg) => ({
    package: pkg.name,
    entries: packageMatrixEntries(
      pkg,
      packageSourceFiles(pkg.directory),
      strykerConfigHash(
        readFileSync(`${pkg.directory}/stryker.config.ts`, "utf8"),
        sharedConfigText,
      ),
    ),
  }));
  const { run, deferred } = partitionForEvent(plans, event);
  const include = run.flatMap((plan) => plan.entries);
  console.log(
    `${String(run.length)} package(s) planned into ${String(include.length)} slice(s), at most ${String(maxParallelFor(event))} at once`,
  );
  if (deferred.length > 0) {
    const notice = `Not started by this pull request because each is several slices and costs hours from a cold cache: ${deferred.join(", ")}. The scheduled run covers them, or start them for this branch with: gh workflow run mutation.yml --ref <branch> -f packages="${deferred.join(" ")}"`;
    console.log(notice);
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) appendFileSync(summaryFile, `${notice}\n`);
  }
  setOutput("matrix", JSON.stringify({ include }));
  setOutput("has-packages", include.length > 0 ? "true" : "false");
  setOutput("max-parallel", String(maxParallelFor(event)));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
