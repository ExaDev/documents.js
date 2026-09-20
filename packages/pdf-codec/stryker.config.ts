import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // 45 minutes, not Stryker's default 5: the dry run has to execute the whole instrumented unit suite, whose cost is set by this machine's momentary contention rather than by any one test (see vitest.config.ts's UNIT_TEST_TIMEOUT_MS derivation for the measured gap between an idle uninstrumented run and an instrumented one). At a load average near fifty that dry run takes a little over four minutes, and the load average on this machine routinely runs into the hundreds, so the budget covers a run several multiples slower than the one actually measured rather than the measured one alone.
  dryRunTimeoutMinutes: 45,
  // Lowered from the shared default of 4, per PackageStrykerOptions.concurrency. This package's instrumented suite is already slowed several fold by contention alone (see vitest.config.ts's UNIT_TEST_TIMEOUT_MS derivation), and every additional Stryker worker instruments and re-runs that same suite concurrently, so raising the worker count multiplies exactly the contention the dry-run budget above exists to absorb rather than avoiding it.
  concurrency: 1,
  // Derived by PackageStrykerOptions.breakThreshold's own rule from a completed run over every one of this package's valid mutants: floor the measured score, then subtract the run's own Timeout-classified share rounded up, with a floor of one point. The measured score was a little over eighty, against a timeout share of just over three points, which rounds the margin to four. The margin is what makes the number safe to gate on rather than merely descriptive: Timeout is the one classification that flaps with runner load alone, and even if every mutant this run classified Timeout were to come back Survived on a quieter machine, the resulting score still clears this threshold.
  //
  // Measured locally rather than from a CI shard, which the rule asks for, because no CI run of this package has ever completed: on a pull request the mutation workflow's concurrency group cancels the run before it starts a job, and on main the dry run itself fails on a test that misses vitest's own default timeout under instrumentation (the ceiling in vitest.config.ts is what fixes that). Once a shard completes on main, re-derive this from that run in preference to this one.
  breakThreshold: 76,
});
