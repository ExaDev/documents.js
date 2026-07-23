import { defineConfig } from 'vitest/config';

// Two named projects in one config, filtered by --project in package.json's scripts rather than a separate config file: "unit" (src/**/*.test.ts) for pnpm test/test:watch, and "smoke" (test/smoke.test.mjs, which imports from dist/) only ever run by pnpm test:smoke, right after tsdown rebuilds dist/.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      { test: { name: 'smoke', include: ['test/smoke.test.mjs'] } },
    ],
  },
});
