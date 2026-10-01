import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Derived by the rule documented on PackageStrykerOptions.breakThreshold, from a complete run over this package's whole mutate scope that fell short of 100: the measured score floored to whole points, less a margin of that run's own Timeout-classified share rounded up. The package is not at a genuine 100, so the gate holds it at its measured baseline and fails only on a real regression below it, rather than on every run. Raise it by re-deriving it from a fresh complete run once survivors are killed, never by picking a number; the mutation workflow's score table prints the derived value whenever the recorded one falls behind.
  breakThreshold: 98,
});
