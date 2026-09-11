import { defineConfig } from "vitest/config";

// The smoke project spawns the real built dist/bin.js as a child process (a genuine HTTP round trip, not just an in-process createRestServer() call), so it needs more headroom than an in-process unit test -- process spawn + waiting for the listening line on stderr.
const UNIT_TEST_TIMEOUT_MS = 10_000;
const SMOKE_TEST_TIMEOUT_MS = 15_000;

// Two named projects, filtered by --project in package.json's scripts: "unit" (src/**/*.test.ts) for pnpm test/test:watch; "smoke" (test/smoke.test.mjs, which spawns dist/bin.js) only ever run by pnpm test:smoke, right after tsdown rebuilds dist/. Mirrors document-mcp's own vitest.config.ts convention exactly.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "html", "cobertura"],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          testTimeout: UNIT_TEST_TIMEOUT_MS,
        },
      },
      {
        test: {
          name: "smoke",
          include: ["test/smoke.test.mjs"],
          testTimeout: SMOKE_TEST_TIMEOUT_MS,
        },
      },
    ],
  },
});
