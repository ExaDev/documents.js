import { defineConfig } from "vitest/config";
import baseConfig from "./vite.config";

// Isolates the "unit" project out of vite.config.ts's multi-project test config for Stryker's vitest-runner, which loads one plain config file and has no equivalent of --project to select among several. test is replaced outright with the unit project's own include glob (an explicit key in an object literal always overrides whatever the earlier spread carried for that same key), so a stale projects/coverage key from the base config's own test block can't survive into this one -- Stryker never picks up the smoke/workers suites (which import from dist/ or need a different runtime and are not meaningful per-mutant) or fight over coverage instrumentation, which Stryker's own runner disables unconditionally anyway. vite.config.ts's default export is a config function (base needs vite's own real command/serve discriminator to stay off the GitHub Pages subpath outside a production build), not a plain object -- resolved here the same way vite itself would, with mode "test" since that's what this config is actually for.
const base = baseConfig({ command: "serve", mode: "test" });

export default defineConfig({
  ...base,
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
