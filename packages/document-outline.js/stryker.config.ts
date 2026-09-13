import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // Every mutant is genuinely killed by a real test, or the code was restructured so that specific mutation opportunity no longer exists at all (a redundant guard removed, a manual bounds-checked loop replaced with a library call, an unobservable optimisation deleted) -- never suppressed by name, so the gate is the literal maximum rather than a derived-with-slack figure.
  breakThreshold: 100,
  // graph.test.ts's exhaustive LCS-reconciliation sweep (see its own vitest.config.ts UNIT_TEST_TIMEOUT_MS comment) is expensive enough that several concurrent Stryker workers each running it at once creates contention pushing it past even a generous per-test timeout -- lowered from the shared default of 4 for this package alone, per PackageStrykerOptions.concurrency.
  concurrency: 1,
});
