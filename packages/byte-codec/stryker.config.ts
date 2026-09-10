import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // First CI-measured baseline: 63.99% of 636 valid mutants, timeout share 2.0% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 60,
});
