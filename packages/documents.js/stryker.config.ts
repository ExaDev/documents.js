import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Baseline measured by a full local run over this package's whole mutate scope rather than from a CI report: 68.77% of 20412 valid mutants, timeout share 1.19%, so break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold.
  breakThreshold: 66,
});
