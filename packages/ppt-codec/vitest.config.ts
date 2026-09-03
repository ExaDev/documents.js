import { defineConfig } from "vitest/config";

// Two named projects in one config, filtered by --project in package.json's scripts: "unit" (src/**/*.test.ts) for pnpm test/test:watch, and "smoke" (test/smoke.test.mjs, which imports from dist/) only ever run by pnpm test:smoke, after turbo's _build task has produced the dist/ it loads -- matching every sibling codec's own arrangement. Without this split a bare `vitest run` would pick up the smoke file too, which must mean nothing on an unbuilt or stale dist.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"] } },
      { test: { name: "smoke", include: ["test/smoke.test.mjs"] } },
    ],
  },
});
