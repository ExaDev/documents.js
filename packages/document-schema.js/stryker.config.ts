import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.unit.config.ts",
  // First CI-measured baseline: 23.03% of 3822 valid mutants, timeout share 0.2% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 22,
});
