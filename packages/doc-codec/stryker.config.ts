import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Re-measured after a substantial round of direct unit tests across prop/, style/, subdocument.ts, subdocument-write.ts, pictures.ts/pictures-write.ts, encryption.ts, list/numbering-write.ts, list/numbering.ts, table/tap-write.ts, and text/paragraphs.ts: 83.67% of 3882 valid mutants, timeout share 1.67% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. Genuine 100% is not yet reached -- table/write.ts, table/tap.ts, table/read.ts, test-support/doc.ts, and several smaller files still carry real survived/no-coverage mutants; see the package's own tracked work for the remaining gap.
  breakThreshold: 81,
});
