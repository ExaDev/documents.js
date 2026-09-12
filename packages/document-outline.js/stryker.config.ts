import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // First CI-measured baseline: 63.87% of 1885 valid mutants, timeout share 1.9% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 61,
  // graph.test.ts's exhaustive LCS-reconciliation sweep (see its own vitest.config.ts UNIT_TEST_TIMEOUT_MS comment) is expensive enough that several concurrent Stryker workers each running it at once creates contention pushing it past even a generous per-test timeout -- lowered from the shared default of 4 for this package alone, per PackageStrykerOptions.concurrency.
  concurrency: 1,
});
