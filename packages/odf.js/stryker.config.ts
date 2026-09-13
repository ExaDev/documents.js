import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Re-measured after killing every survivor and no-coverage mutant in typed/shared/forms.ts: 76.17% of 8451 valid mutants, timeout share 1.3% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. Still provisional: the bulk of this package (draw/shapes.ts, ooo1/transform.ts, shared/constructs.ts, shared/paragraph.ts, ods/write.ts, ods/conditional-format.ts, odb/report.ts, and the rest) still carries its own unkilled mutants -- raise this again once the next batch's own full run confirms the next real floor.
  breakThreshold: 74,
});
