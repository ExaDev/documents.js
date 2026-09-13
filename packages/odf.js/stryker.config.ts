import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Re-measured after a real batch of survivor kills (typed/shared/canonicalise.ts, units.ts, metadata.ts, list.ts, expression.ts): 75.72% of 8444 valid mutants, timeout share 1.3% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. Still provisional: the bulk of this package (draw/shapes.ts, ooo1/transform.ts, shared/constructs.ts, shared/paragraph.ts, ods/write.ts, ods/conditional-format.ts, odb/report.ts, and the rest) still carries its own unkilled mutants -- raise this again once the next batch's own full run confirms the next real floor.
  breakThreshold: 73,
});
