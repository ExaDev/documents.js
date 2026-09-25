import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Re-measured by a full local run over this package's whole mutate scope (a cold run, no incremental cache present): 81.20% of 20708 valid mutants (16561 killed, 253 timeout, 2938 survived, 956 no coverage), timeout share 1.22%, so break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. Raised from the previous 66 (68.77% baseline) after closing gaps in src/edit/docx/image.ts, src/edit/ods/column-row.ts, and src/omml/write.ts (documents.js#1295); the issue tracks the remaining per-file survivor/no-coverage breakdown and the method for closing the rest.
  breakThreshold: 79,
});
