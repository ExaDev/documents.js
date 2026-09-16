import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // 45 minutes, not Stryker's default 5: the instrumented unit suite's heaviest tests are math-stretch.test.ts's whole-Unicode-range glyphId enumeration and several AES-256 key-derivation tests across document.test.ts/encrypt-write.test.ts/read.test.ts (see vitest.config.ts's UNIT_TEST_TIMEOUT_MS derivation for the measured costs), each exposed to the same shared-machine contention that can push any one of them past 600_000ms in the worst observed case. The whole-suite budget has to cover several of those worst cases landing in the same dry run, not just one.
  dryRunTimeoutMinutes: 45,
  // Lowered from the shared default of 4, per PackageStrykerOptions.concurrency: this package's own heaviest tests (see vitest.config.ts's UNIT_TEST_TIMEOUT_MS derivation) are already measured to blow past a generous per-test timeout under contention from just this machine's other sessions -- running several Stryker workers at once, each instrumenting and re-running that same expensive suite concurrently, multiplies exactly the contention the timeout increase above exists to absorb rather than avoiding it.
  concurrency: 1,
});
