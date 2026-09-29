import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Re-measured by a full local run over this package's whole mutate scope (a cold run, no incremental cache present): 82.88% of 20761 valid mutants (16954 killed, 252 timeout, 2690 survived, 865 no coverage), timeout share 1.21%, so break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. The raise from 80 follows the reconstruct-tables, pdf read-back, reconstruct-lines boundary, report-formula scanner, hsqldb cache, print-settings, docx run, odt table border, and SQL parser diagnostic batches (documents.js#1295); the issue tracks the remaining per-file survivor/no-coverage breakdown and the method for closing the rest.
  breakThreshold: 81,
});
