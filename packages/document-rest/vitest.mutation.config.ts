import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Isolates the "unit" project out of vitest.config.ts's multi-project test config for Stryker's vitest-runner, which loads one plain config file and has no equivalent of --project to select among several. Mirrors document-mcp's own vitest.mutation.config.ts exactly, for the identical reason: Stryker must never pick up the smoke project (it spawns dist/bin.js, not meaningful per-mutant).
export default defineConfig({
  ...base,
  test: {
    include: ["src/**/*.test.ts"],
  },
});
