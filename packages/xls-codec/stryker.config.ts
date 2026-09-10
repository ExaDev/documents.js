import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // First CI-measured baseline: 68.92% of 4166 valid mutants, timeout share 1.6% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 66,
});
