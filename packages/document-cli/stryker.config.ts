import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  mutate: [
    "src/**/*.ts",
    "src/**/*.tsx",
    "!src/**/*.test.ts",
    "!src/**/*.test.tsx",
  ],
  vitestConfigFile: "vitest.mutation.config.ts",
  // Measured by a cold run (no incremental report present) of the whole mutate scope: 58.02% of 6246 valid mutants, timeout share 0.08% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. The package is not yet at the workspace's eventual 100% target; the remaining survived and no-coverage mutants are tracked separately, and this number rises as they are closed.
  breakThreshold: 57,
  concurrency: 1,
  dryRunTimeoutMinutes: 20,
});
