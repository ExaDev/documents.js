import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // First CI-measured baseline: 63.87% of 1885 valid mutants, timeout share 1.9% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 61,
});
