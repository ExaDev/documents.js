import { defineConfig } from "vitest/config";

// Two named projects in one config, filtered by --project in package.json's scripts: "unit" (src/**/*.test.ts) for pnpm test/test:watch, and "smoke" (test/smoke.test.mjs, which imports from dist/) only ever run by pnpm test:smoke, right after tsdown rebuilds dist/. There is deliberately no "corpus" project yet, unlike markdown-codec's and pdf-codec's: this package has no gitignored real-world RTF conformance corpus to point one at, and declaring an empty project would report a passing suite that checks nothing.
export default defineConfig({
  test: {
    // Vitest resolves coverage once for the whole run from this root config, not per project, so it cannot live inside the 'unit' project's own test block; pnpm test:coverage scopes what actually gets measured by filtering to --project unit, which never imports the smoke suite.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "html", "cobertura"],
    },
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"] } },
      { test: { name: "smoke", include: ["test/smoke.test.mjs"] } },
    ],
  },
});
