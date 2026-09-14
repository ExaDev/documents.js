import { defineConfig } from "vitest/config";
import base, { UNIT_TEST_TIMEOUT_MS } from "./vitest.config";

// Isolates the "unit" project out of vitest.config.ts's multi-project test config for Stryker's vitest-runner, which loads one plain config file and has no equivalent of --project to select among several. test is replaced outright with the unit project's own include glob (an explicit key in an object literal always overrides whatever the earlier spread carried for that same key), so a stale projects/coverage key from the base config's own test block can't survive into this one -- Stryker never picks up the smoke/workers suites (which import from dist/ or need a different runtime and are not meaningful per-mutant) or fight over coverage instrumentation, which Stryker's own runner disables unconditionally anyway. testTimeout is re-declared explicitly rather than inherited by the spread, for exactly the same reason: replacing the whole `test` key means the base config's own projects[].test.testTimeout goes with it, and vitest's own bare default (5000ms) is too tight for this suite's own settle()-heavy Ink component tests once Stryker's dry run -- not this project's own normal `pnpm test`, which already sets this timeout via the "unit" project above -- is what's actually running them.
export default defineConfig({
  ...base,
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    testTimeout: UNIT_TEST_TIMEOUT_MS,
  },
});
