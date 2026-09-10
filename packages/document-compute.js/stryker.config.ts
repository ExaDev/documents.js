import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // First CI-measured baseline: 64.48% of 518 valid mutants, timeout share 0.4% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 63,
});
