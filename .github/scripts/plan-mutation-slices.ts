// Turns the set of packages `_test:mutation` is affected for into the GitHub Actions matrix of mutation jobs, one entry per package slice. A package whose estimated cold cost fits the slice budget is one slice covering the whole package; a larger one is split by file into as many slices as the budget needs, each run with its own `--mutate` list. The workflow gates the merged per-package score (see gate-mutation-scores.ts), so a slice's own score is never compared against a threshold.
//
// The cost estimate is a linear upper envelope over source lines: a fixed cost that does not depend on size (build, dry run, checker start-up) plus a per-line cost, both chosen so that every measured cold run of a real package lies at or below the line (plan-mutation-slices.test.ts holds the samples and fails when one rises above it). Source lines are free to compute, whereas the only direct measure of a package's mutant count is Stryker's own dry run, which would cost as much as the planning is meant to save. An envelope rather than a fit is deliberate: an underestimate produces a slice that hits its job timeout, an overestimate only produces an extra slice that starts warm from its cache.
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** The most a GitHub-hosted runner job may run for, from GitHub's workflow syntax reference for `jobs.<job_id>.timeout-minutes`. */
export const GITHUB_JOB_LIMIT_MINUTES = 360;

/** The share of the job limit a slice's cold estimate may consume. A slice planned at this share still leaves the rest of the limit as headroom for the estimate being wrong, which is what keeps a slice from ever being the job that hits the limit. */
export const SLICE_SHARE_OF_JOB_LIMIT = 1 / 6;

/** Cold-run cost that does not depend on package size, in seconds: the build, Stryker's dry run and the checker's start-up. Taken from the smallest measured packages, rounded up. */
export const COLD_FIXED_SECONDS = 240;

/** Cold-run cost per mutable source line, in seconds. The smallest value for which the envelope through COLD_FIXED_SECONDS clears every measured cold sample. */
export const COLD_SECONDS_PER_LINE = 0.55;

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
  }));
}

function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  appendFileSync(outputFile, `${name}=${value}\n`);
}

function main(): void {
  const turboArgs = process.argv.slice(2);
  const dryRunOutput = execFileSync(
    "pnpm",
    ["exec", "turbo", "run", "_test:mutation", "--dry-run=json", ...turboArgs],
    { encoding: "utf8" },
  );
  const affected = affectedMutationPackages(dryRunOutput);
  const include = affected.flatMap((pkg) =>
    packageMatrixEntries(pkg, packageSourceFiles(pkg.directory)),
  );
  console.log(
    `${String(affected.length)} affected package(s) planned into ${String(include.length)} slice(s)`,
  );
  setOutput("matrix", JSON.stringify({ include }));
  setOutput("has-packages", affected.length > 0 ? "true" : "false");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
