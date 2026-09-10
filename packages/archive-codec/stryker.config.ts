import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // First CI-measured baseline: 76.26% of 1954 valid mutants, timeout share 2.5% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 73,
});
