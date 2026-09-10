import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // First CI-measured baseline: 78.15% of 302 valid mutants, timeout share 7.9% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 70,
});
