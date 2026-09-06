// Turns the set of packages `_test:mutation` is affected for into a GitHub Actions matrix of weighted shards. Greedy longest-processing-time-first (LPT) bin-packing, not round-robin: a naive `package N -> shard N mod shardCount` assignment can strand the single largest affected package alone on one shard while every other shard finishes and idles waiting on it, since per-package mutation-test cost varies enormously by package size. LPT is a well-known constant-factor approximation of optimal balanced partitioning -- the same class of algorithm behind most real-world "spread N differently-sized jobs across K workers evenly" schedulers.
//
// The weight proxy is each package's own `src/**/*.ts` line count (excluding `*.test.ts`/ `*.test.tsx`, mirroring stryker.shared.ts's own default `mutate` exclusions exactly, so the weight actually reflects what Stryker will mutate). This is a proxy for likely mutant count and related-test runtime, not a direct measurement -- the only way to know a package's real mutant count ahead of time is Stryker's own dry run, and running that dry run for every affected package just to decide how to shard them would cost as much as the sharding is meant to save. Line count is free and correlates well enough with both to beat round-robin.
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// GitHub-hosted runners pay a real, largely fixed ~1-2 minute cost per job before any work starts (checkout, toolchain setup, install, cache restore). Sharding arbitrarily wide against a very large affected set (a change to stryker.shared.ts or turbo.json marks every in-scope package affected at once) would let that fixed per-job tax dominate the run's wall-clock time instead of the mutation testing it exists to speed up.
export const MAX_SHARDS = 8;

const TEST_FILE_PATTERN = /\.test\.tsx?$/;

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

/** Extracts the `_test:mutation` task's own package list from a `turbo run ... --dry-run=json` plan, rather than re-deriving affectedness independently -- this is the exact same computation the real run will use, so the shard plan and the run it plans for can never disagree about which packages are in scope. */
export function affectedMutationPackages(
  dryRunOutput: string,
): readonly AffectedPackage[] {
  const plan = JSON.parse(dryRunOutput) as TurboDryRunPlan;
  return plan.tasks
    .filter((task) => task.task === "_test:mutation")
    .map((task) => ({ name: task.package, directory: task.directory }));
}

/** Every `.ts`/`.tsx` file under a package's own `src/`, minus its own unit test files -- the same scope stryker.shared.ts's default `mutate` glob covers. A package listed by turbo's own dry-run plan is a real workspace package with a real `src/` directory by construction, so a missing `src/` here would be a genuine bug in the affected-package list, not an input this function should tolerate silently. */
function packageSourceFiles(directory: string): readonly string[] {
  const sourceRoot = join(directory, "src");
  return readdirSync(sourceRoot, { recursive: true })
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => /\.tsx?$/.test(entry) && !TEST_FILE_PATTERN.test(entry))
    .map((entry) => join(sourceRoot, entry));
}

/** A package's sharding weight: its own mutatable source line count. Free to compute (no Stryker dry run needed) and correlates well enough with mutant count and related-test runtime to beat round-robin sharding materially -- see this file's own top-of-file note. */
export function packageWeight(directory: string): number {
  return packageSourceFiles(directory).reduce(
    (total, file) => total + readFileSync(file, "utf8").split("\n").length,
    0,
  );
}

/** Pure greedy LPT bin-packing: sort every package by weight descending, then repeatedly assign the next-heaviest package to whichever shard currently carries the least total weight. Shard count is bounded by both `maxShards` and the number of packages actually being sharded, so a run with fewer affected packages than `maxShards` never produces empty shards. */
export function planShards(
  weights: ReadonlyMap<string, number>,
  maxShards: number,
): readonly (readonly string[])[] {
  if (weights.size === 0) return [];
  const shardCount = Math.min(maxShards, weights.size);
  const shards: { packages: string[]; totalWeight: number }[] = Array.from(
    { length: shardCount },
    () => ({ packages: [], totalWeight: 0 }),
  );
  const sortedByWeightDescending = [...weights.entries()].sort(
    (a, b) => b[1] - a[1],
  );
  for (const [name, weight] of sortedByWeightDescending) {
    const lightestShard = shards.reduce((lightest, shard) =>
      shard.totalWeight < lightest.totalWeight ? shard : lightest,
    );
    lightestShard.packages.push(name);
    lightestShard.totalWeight += weight;
  }
  return shards.map((shard) => shard.packages);
}

export interface ShardMatrixEntry {
  readonly index: number;
  readonly packages: string;
}

/** The GitHub Actions `strategy.matrix.include` shape: one entry per shard, `packages` pre-joined into the space-separated package-name list the workflow's own `turbo run _test:mutation --filter=<name>...` step splits back apart. Joining here, once, keeps that splitting logic out of the workflow YAML. */
export function shardMatrix(
  shards: readonly (readonly string[])[],
): readonly ShardMatrixEntry[] {
  return shards.map((packages, index) => ({
    index,
    packages: packages.join(" "),
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
  const weights = new Map(
    affected.map((pkg) => [pkg.name, packageWeight(pkg.directory)]),
  );
  const matrix = { include: shardMatrix(planShards(weights, MAX_SHARDS)) };
  console.log(
    `${String(affected.length)} affected package(s) planned into ${String(matrix.include.length)} shard(s): ${JSON.stringify(matrix.include.map((entry) => entry.packages))}`,
  );
  setOutput("matrix", JSON.stringify(matrix));
  setOutput("has-packages", affected.length > 0 ? "true" : "false");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
