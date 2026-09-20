import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  mutate: [
    "src/**/*.ts",
    "src/**/*.tsx",
    "!src/**/*.test.ts",
    "!src/**/*.test.tsx",
  ],
  vitestConfigFile: "vitest.mutation.config.ts",
  // Derived by the rule documented on PackageStrykerOptions.breakThreshold, from a cold run (no incremental report present, so every valid mutant gets its own result) over this package's whole mutate scope: floor the measured score, then subtract the run's own Timeout-classified share rounded up, with a floor of one point. That margin is what makes the number safe to gate on rather than merely descriptive, since Timeout is the one classification that flaps with runner load alone. The package is not yet at a genuine 100, and https://github.com/ExaDev/documents.js/issues/1300 tracks closing the gap and carries the measurements behind this number, including the per-file survivor and no-coverage counts. Raise this by re-deriving it from a fresh complete run whenever a batch of those lands; never by picking a number.
  breakThreshold: 57,
  // Lowered from the shared default of 4, per PackageStrykerOptions.concurrency. This package's suite is Ink component tests driven through a real reconciler, whose settling this suite waits on in real time, so several Stryker workers re-running it at once contend for the same cores and push those waits past their own budgets, reclassifying ordinary survivors as timeouts and making the measured score depend on machine load.
  concurrency: 1,
  // Raised from Stryker's default of 5, per PackageStrykerOptions.dryRunTimeoutMinutes, and set only after measuring rather than speculatively. The dry run executes the whole instrumented unit suite in one go, and instrumentation multiplies the per-call cost of a suite this size well beyond what its ordinary uninstrumented run costs; the budget covers a run several multiples slower than the measured one, because the machines this runs on are routinely under heavy concurrent load.
  dryRunTimeoutMinutes: 20,
});
