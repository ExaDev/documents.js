import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Re-measured after closing the gaps in content.ts, styles.ts, drawings-write.ts (now 100%), conditional-format.ts, and pptx/read.ts: 84.44% of 6891 valid mutants, timeout share 0.4% -- break = floor(score) minus the timeout share rounded up to whole points (minimum one), per the derivation rule on PackageStrykerOptions.breakThreshold. The package's three largest modules (xlsx/build.ts, docx/write.ts, docx/read.ts) remain well short of 100% and are the next real targets for closing this gap further; this threshold reflects the genuinely measured floor today, not a ceiling to stop at.
  breakThreshold: 83,
});
