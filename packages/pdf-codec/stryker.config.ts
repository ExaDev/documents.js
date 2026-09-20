import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Well above Stryker's own default, because the dry run has to execute the whole instrumented unit suite, and that suite's cost is set by the machine's momentary contention rather than by any one test (vitest.config.ts's UNIT_TEST_TIMEOUT_MS explains why that is so for this package). The budget is therefore sized for a run several multiples slower than an unloaded one, not for the unloaded case.
  dryRunTimeoutMinutes: 45,
  // Lowered from the shared default of 4, per PackageStrykerOptions.concurrency. This package's instrumented suite is already slowed several fold by contention alone (see vitest.config.ts's UNIT_TEST_TIMEOUT_MS derivation), and every additional Stryker worker instruments and re-runs that same suite concurrently, so raising the worker count multiplies exactly the contention the dry-run budget above exists to absorb rather than avoiding it.
  concurrency: 1,
  // Derived by PackageStrykerOptions.breakThreshold's own rule, never picked: floor the score from a complete run over this package's whole mutate scope, then subtract that run's own Timeout-classified share, rounded up, with a floor of one point. The margin is what makes the number safe to gate on rather than merely descriptive, since Timeout is the one classification that flaps with runner load alone, so a run that times out more mutants than the one this was derived from still clears it.
  //
  // Issue #1306 holds the measurement this value came from, the per-file breakdown of what is still alive, and the method for raising it as files land. The rule prefers a score measured on CI, so re-derive from a completed shard whenever one is available; issue #1294 covers why one may not be.
  breakThreshold: 76,
});
