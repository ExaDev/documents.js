import { defineConfig } from "vitest/config";

// The smoke project spawns the real built dist/cli.js as a child process (argv/stdio round trips, not just an in-process import), so it needs more headroom than an in-process unit test -- process spawn + a real conversion. Exported rather than module-private: vitest.mutation.config.ts (Stryker's own vitest-runner config) replaces this file's entire `test` block outright rather than merging into it, so it re-imports this constant explicitly instead of silently falling back to vitest's own default testTimeout (5000ms) -- a real regression once caught: several Ink TUI tests drive dozens of settle() calls in one test (a keypress-per-iteration loop), and at EFFECT_SETTLE_MS's own real-timer wait, that total already exceeds vitest's bare default under Stryker's dry run specifically, even though it comfortably clears this project's own configured timeout below.
export const UNIT_TEST_TIMEOUT_MS = 10_000;
const SMOKE_TEST_TIMEOUT_MS = 15_000;

// Two named projects, filtered by --project in package.json's scripts: "unit" (src/**/*.test.ts and src/**/*.test.tsx, the latter for the Ink TUI's own ink-testing-library suites) for pnpm test/test:watch; "smoke" (test/smoke.test.mjs, which spawns dist/cli.js) only ever run by pnpm test:smoke, right after tsdown rebuilds dist/.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      reporter: ["text", "html", "cobertura"],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
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
