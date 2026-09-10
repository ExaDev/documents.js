import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // First CI-measured baseline: 66.07% of 2013 valid mutants, timeout share 1.2% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 64,
});
