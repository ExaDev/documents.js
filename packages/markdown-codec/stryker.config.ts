import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // First CI-measured baseline: 76.32% of 4529 valid mutants, timeout share 4.9% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 71,
});
