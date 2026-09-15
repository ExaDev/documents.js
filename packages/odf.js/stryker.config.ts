import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Re-measured from a genuine cold full-package run (incremental cache deleted first): 91.10% of 8201 valid mutants (612 survived, 127 no-coverage, 110 timeout, 7452 killed), timeout share 1.34% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. Still provisional: 612 survivors and 127 no-coverage mutants remain across many files (see PR #1260 for the full file-by-file breakdown), concentrated in typed/shared/paragraph.ts, typed/ods/write.ts, typed/ods/read.ts, typed/odt/write.ts, typed/odt/read.ts, and typed/draw/shapes.ts -- raise this again once the next batch's own full run confirms the next real floor.
  breakThreshold: 89,
});
