import { defineConfig } from 'vitest/config';

// Three named projects in one config, filtered by --project in package.json's scripts: "unit" (src/**/*.test.ts) for pnpm test/test:watch; "smoke" (test/smoke.test.mjs, which imports from dist/) only ever run by pnpm test:smoke, right after tsdown rebuilds dist/; "corpus" (test/corpus/**/*.test.ts) for the optional, gitignored real-world CommonMark/GFM conformance layer, run only by pnpm test:corpus and never part of pnpm test.
export default defineConfig({
  test: {
    // Vitest resolves coverage once for the whole run from this root config, not per project, so it cannot live inside the 'unit' project's own test block; pnpm test:coverage scopes what actually gets measured by filtering to --project unit, which never imports the smoke/corpus suites.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'html', 'cobertura'],
    },
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      { test: { name: 'smoke', include: ['test/smoke.test.mjs'] } },
      { test: { name: 'corpus', include: ['test/corpus/**/*.test.ts'] } },
    ],
  },
});
