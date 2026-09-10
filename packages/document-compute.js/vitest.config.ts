import { defineConfig } from "vitest/config";

// Two named projects in one config, filtered by --project in package.json's scripts: "unit" (src/**/*.test.ts) for pnpm test/test:watch, and "corpus" (test/corpus/**/*.test.ts) for the optional, gitignored at-scale worked-example layer generated into test/corpus/ by scripts/generate-corpus.mjs, run only by pnpm test:corpus and never part of pnpm test. Before this file existed the package ran configless vitest (whose default include sweeps every directory), which is exactly why the split is explicit now: the corpus layer must never leak into pnpm test the way a default include would let it.
export default defineConfig({
  test: {
    // Vitest resolves coverage once for the whole run from this root config, not per project, so it cannot live inside the 'unit' project's own test block; pnpm test:coverage scopes what actually gets measured by filtering to --project unit, which never imports the corpus suite.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "html", "cobertura"],
    },
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"] } },
      { test: { name: "corpus", include: ["test/corpus/**/*.test.ts"] } },
    ],
  },
});
