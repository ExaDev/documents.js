import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // 45 minutes, not Stryker's default 5: the dry run has to execute the whole instrumented unit suite, whose cost is set by this machine's momentary contention rather than by any one test (see vitest.config.ts's UNIT_TEST_TIMEOUT_MS derivation for the measured gap between an idle uninstrumented run and an instrumented one). At a load average near fifty that dry run takes a little over four minutes, and the load average on this machine routinely runs into the hundreds, so the budget covers a run several multiples slower than the one actually measured rather than the measured one alone.
  dryRunTimeoutMinutes: 45,
  // Lowered from the shared default of 4, per PackageStrykerOptions.concurrency. This package's instrumented suite is already slowed several fold by contention alone (see vitest.config.ts's UNIT_TEST_TIMEOUT_MS derivation), and every additional Stryker worker instruments and re-runs that same suite concurrently, so raising the worker count multiplies exactly the contention the dry-run budget above exists to absorb rather than avoiding it.
  concurrency: 1,
});
