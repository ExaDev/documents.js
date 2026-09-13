import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  mutate: [
    "src/**/*.ts",
    "src/**/*.tsx",
    "!src/**/*.test.ts",
    "!src/**/*.test.tsx",
  ],
  vitestConfigFile: "vitest.mutation.config.ts",
  // First CI-measured baseline: 33.33% of 6241 valid mutants, timeout share 0.02% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 32,
});
