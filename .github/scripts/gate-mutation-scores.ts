// Gates a mutation run on each package's merged score. The slice jobs (plan-mutation-slices.ts) each mutate part of a package and leave the break threshold to this step, because only the union of a package's slices has a score that means anything against the package's recorded threshold. Reads every slice's json report from the directory the workflow downloaded them into, merges each package's files, computes the score with Stryker's own metrics library, and fails when a package's score is under its recorded break threshold or when a planned slice produced no report.
//
// The same table reports the threshold the documented derivation rule (stryker.shared.ts, on `thresholds.break`) would give from this run, so a package whose recorded threshold has fallen behind its measured score shows up on every full run rather than waiting for someone to look.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { calculateMetrics, type Metrics } from "mutation-testing-metrics";
import type { FileResult } from "mutation-testing-report-schema";
import type { SliceMatrixEntry } from "./plan-mutation-slices";

const PERCENT = 100;

/** Below this many whole points of margin the derivation rule never goes: the timeout share rounds up to at least one point. */
const MINIMUM_TIMEOUT_MARGIN_POINTS = 1;

/** The artifact directory one slice's reports are uploaded under, which the workflow names from the matrix entry's cache key. */
export function sliceArtifactName(entry: SliceMatrixEntry): string {
  return `mutation-report-${entry.cacheKey}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileResult(value: unknown): value is FileResult {
  return isRecord(value) && Array.isArray(value.mutants);
}

/** Extracts the per-file results of a Stryker json report, or throws naming what is wrong with it. */
export function reportFiles(
  report: unknown,
  origin: string,
): Record<string, FileResult> {
  if (!isRecord(report) || !isRecord(report.files)) {
    throw new Error(`${origin} is not a mutation report: no files object`);
  }
  const files: Record<string, FileResult> = {};
  for (const [path, file] of Object.entries(report.files)) {
    if (!isFileResult(file)) {
      throw new Error(`${origin} has a malformed entry for ${path}`);
    }
    files[path] = file;
  }
  return files;
}

/** Unions the files of a package's slice reports. A file in two slices would be counted twice, so it is an error rather than a silent overwrite. */
export function mergeSliceFiles(
  slices: readonly Record<string, FileResult>[],
): Record<string, FileResult> {
  const merged: Record<string, FileResult> = {};
  for (const files of slices) {
    for (const [path, file] of Object.entries(files)) {
      if (path in merged) {
        throw new Error(`${path} appears in more than one slice`);
      }
      merged[path] = file;
    }
  }
  return merged;
}

/** The break threshold the documented derivation rule gives for a measured run: the score floored to whole points, less a margin of the package's own timeout-classified share of its valid mutants rounded up to whole points (at least one), and exactly 100 for a package that has reached it. Timeout is the classification that flaps with runner load, which is why the margin exists. */
export function derivedBreakThreshold(metrics: Readonly<Metrics>): number {
  const floored = Math.floor(metrics.mutationScore);
  if (floored >= PERCENT) return PERCENT;
  const timeoutShare =
    metrics.totalValid === 0
      ? 0
      : (metrics.timeout / metrics.totalValid) * PERCENT;
  const margin = Math.max(
    MINIMUM_TIMEOUT_MARGIN_POINTS,
    Math.ceil(timeoutShare),
  );
  return Math.max(0, floored - margin);
}

export type PackageVerdict =
  | { readonly kind: "missing-reports"; readonly slices: readonly number[] }
  | {
      readonly kind: "scored";
      readonly score: number;
      readonly recorded: number | undefined;
      readonly derived: number;
      readonly totalValid: number;
    };

export interface PackageOutcome {
  readonly package: string;
  readonly verdict: PackageVerdict;
}

/** Whether a package fails the gate: a planned slice with no report, or a score under a recorded threshold. A package with no recorded threshold has never had a completed measurement to derive one from, so it is reported but not gated. */
export function packageFails(outcome: PackageOutcome): boolean {
  const verdict = outcome.verdict;
  if (verdict.kind === "missing-reports") return true;
  return verdict.recorded !== undefined && verdict.score < verdict.recorded;
}

/** Whether the recorded threshold has fallen behind what the rule would derive from this run. */
export function thresholdBehind(verdict: PackageVerdict): boolean {
  if (verdict.kind === "missing-reports") return false;
  return verdict.recorded === undefined || verdict.derived > verdict.recorded;
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

/** The markdown table written to the job summary and the console: one row per package, with the verdict, the recorded threshold, and the one the rule would derive. */
export function renderSummary(outcomes: readonly PackageOutcome[]): string {
  const rows = outcomes.map((outcome) => {
    const verdict = outcome.verdict;
    if (verdict.kind === "missing-reports") {
      return `| ${outcome.package} | no report for slice ${verdict.slices.join(", ")} | | | FAIL |`;
    }
    const recorded =
      verdict.recorded === undefined ? "none" : String(verdict.recorded);
    const state = packageFails(outcome)
      ? "FAIL"
      : verdict.recorded === undefined
        ? "ungated"
        : "pass";
    const drift = thresholdBehind(verdict)
      ? ` (rule derives ${String(verdict.derived)})`
      : "";
    return `| ${outcome.package} | ${formatScore(verdict.score)} | ${recorded}${drift} | ${String(verdict.totalValid)} | ${state} |`;
  });
  return [
    "| Package | Score | Recorded break threshold | Valid mutants | Result |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** The `thresholds.break` a package's stryker.config.ts records, or undefined when it records none. */
export function recordedBreak(config: unknown): number | undefined {
  if (!isRecord(config) || !isRecord(config.thresholds)) return undefined;
  const value = config.thresholds.break;
  return typeof value === "number" ? value : undefined;
}

async function loadRecordedBreak(
  directory: string,
): Promise<number | undefined> {
  const module: unknown = await import(
    pathToFileURL(resolve(directory, "stryker.config.ts")).href
  );
  return isRecord(module) ? recordedBreak(module.default) : undefined;
}

function groupByPackage(
  matrix: readonly SliceMatrixEntry[],
): ReadonlyMap<string, readonly SliceMatrixEntry[]> {
  const grouped = new Map<string, SliceMatrixEntry[]>();
  for (const entry of matrix) {
    const siblings = grouped.get(entry.package);
    if (siblings === undefined) {
      grouped.set(entry.package, [entry]);
    } else {
      siblings.push(entry);
    }
  }
  return grouped;
}

async function evaluate(
  reportsDirectory: string,
  matrix: readonly SliceMatrixEntry[],
): Promise<readonly PackageOutcome[]> {
  const outcomes: PackageOutcome[] = [];
  for (const [name, entries] of groupByPackage(matrix)) {
    const reportPaths = entries.map((entry) => ({
      entry,
      file: join(reportsDirectory, sliceArtifactName(entry), "mutation.json"),
    }));
    const missing = reportPaths
      .filter(({ file }) => !existsSync(file))
      .map(({ entry }) => entry.slice);
    if (missing.length > 0) {
      outcomes.push({
        package: name,
        verdict: { kind: "missing-reports", slices: missing },
      });
      continue;
    }
    const slices = reportPaths.map(({ file }) => {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      return reportFiles(parsed, file);
    });
    const metrics = calculateMetrics(mergeSliceFiles(slices)).metrics;
    const directory = entries[0]?.directory;
    if (directory === undefined) {
      throw new Error(`${name} has no planned slices`);
    }
    outcomes.push({
      package: name,
      verdict: {
        kind: "scored",
        score: metrics.mutationScore,
        recorded: await loadRecordedBreak(directory),
        derived: derivedBreakThreshold(metrics),
        totalValid: metrics.totalValid,
      },
    });
  }
  return outcomes;
}

function isMatrix(value: unknown): value is { include: SliceMatrixEntry[] } {
  return isRecord(value) && Array.isArray(value.include);
}

async function main(): Promise<void> {
  const [reportsDirectory, matrixJson] = process.argv.slice(2);
  if (reportsDirectory === undefined || matrixJson === undefined) {
    throw new Error(
      "usage: gate-mutation-scores.ts <reports-dir> <matrix-json>",
    );
  }
  const matrix: unknown = JSON.parse(matrixJson);
  if (!isMatrix(matrix)) {
    throw new Error("the matrix JSON has no include list");
  }
  const outcomes = await evaluate(reportsDirectory, matrix.include);
  const summary = renderSummary(outcomes);
  console.log(summary);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, `${summary}\n`);
  const failed = outcomes.filter(packageFails);
  if (failed.length > 0) {
    console.error(
      `::error::Mutation gate failed for: ${failed.map((outcome) => outcome.package).join(", ")}`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
