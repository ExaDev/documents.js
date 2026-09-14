import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Re-measured after killing every survivor and no-coverage mutant in typed/shared/forms.ts: 76.17% of 8451 valid mutants, timeout share 1.3% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. Still provisional: a full-package run still finds several hundred survivors outside ooo1/transform.ts -- raise this again once the next batch's own full run confirms the next real floor. shared/constructs.ts and ooo1/transform.ts have each since reached zero survivors and zero no-coverage mutants of their own.
  breakThreshold: 74,
});
