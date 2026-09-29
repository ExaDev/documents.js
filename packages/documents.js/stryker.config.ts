import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Re-measured by a full local run over this package's whole mutate scope (a cold run, no incremental cache present): 82.20% of 20761 valid mutants (16809 killed, 256 timeout, 2804 survived, 892 no coverage), timeout share 1.23%, so break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. The raise from 79 follows the skip-set, degradation-span, engine-geometry, OMML-default, reconstruct link/form, and tagged-structure pin batches (documents.js#1295); the issue tracks the remaining per-file survivor/no-coverage breakdown and the method for closing the rest.
  breakThreshold: 80,
});
