import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Isolates the "unit" project out of vitest.config.ts's multi-project test config for Stryker's vitest-runner, which loads one plain config file and has no equivalent of --project to select among several. test is replaced outright with the unit project's own include glob (an explicit key in an object literal always overrides whatever the earlier spread carried for that same key), so a stale projects/coverage key from the base config's own test block can't survive into this one -- Stryker never picks up the smoke/workers suites (which import from dist/ or need a different runtime and are not meaningful per-mutant) or fight over coverage instrumentation, which Stryker's own runner disables unconditionally anyway.
export default defineConfig({
  ...base,
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
