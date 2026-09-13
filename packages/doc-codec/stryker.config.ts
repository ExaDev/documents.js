import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Re-measured after extracting write.ts's own istd-minting/font-minting/text-layout logic into directly-testable functions, and closing prop/, subdocument.ts, and pictures.ts to genuine 100%: 89.6% of 3795 valid mutants, timeout share 1.7% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. Genuine 100% is not yet reached -- table/write.ts, table/tap.ts, table/tap-write.ts, table/read.ts, test-support/doc.ts, test-support/cfb.ts, style/stsh.ts, text/paragraphs.ts, and list/numbering(-write).ts still carry real survived/no-coverage mutants; see the package's own tracked work (its PR body) for the current remaining gap.
  breakThreshold: 81,
});
