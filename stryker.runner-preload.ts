/**
 * Loaded into every Stryker test-runner child process through `testRunnerNodeArgs` (see stryker.shared.ts) before that process runs any code of its own, so it applies to vitest's config resolution without a change to any package's vitest config.
 *
 * Vitest adds its `github-actions` reporter to a run's default reporters whenever `GITHUB_ACTIONS` is `"true"`, and that reporter appends a job summary to `GITHUB_STEP_SUMMARY` after every test run. Stryker's vitest-runner re-runs the covering tests once per mutant, so one mutation shard appends a summary per mutant to a single step's summary until it passes GitHub's 1 MiB per-step limit, which GitHub reports as an error annotation on the job. A mutation run reports through Stryker's own reporters, so vitest's is never wanted in these processes.
 *
 * Removing the variable only affects the runner child processes this file is loaded into: the Stryker process itself, and every other step of the job, keep it.
 */
delete process.env.GITHUB_ACTIONS;
