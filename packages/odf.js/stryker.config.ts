import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // CI-confirmed (Mutation testing / shard 2, PR #1260): 91.40% of 8302 valid mutants (587 survived, 127 no-coverage, 112 timeout, 7476 killed), timeout share 1.35% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. Still provisional: 587 survivors and 127 no-coverage mutants remain across many files (see PR #1260 for the full file-by-file breakdown), concentrated in typed/shared/paragraph.ts, typed/ods/write.ts, typed/odt/write.ts, typed/ods/read.ts, typed/draw/shapes.ts, and typed/odt/read.ts -- raise this again once the next batch's own full run confirms the next real floor.
  breakThreshold: 89,
});
