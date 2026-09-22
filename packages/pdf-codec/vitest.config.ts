import { defineConfig } from "vitest/config";

// A single generous ceiling for the whole unit project, not a per-test guess. No test here is slow on its own; what makes one slow, unpredictably, is contention: v8 coverage instrumentation, Stryker's own mutant instrumentation (heavier still, since it wraps every statement a test executes), and whatever else is running on the same machine. Both a loaded development machine and a hosted CI runner are exposed to this, and the consequence is not merely a slower suite. Without a ceiling well above vitest's own default, Stryker's dry run fails outright when an ordinary test loses a race for the CPU, which is what the cff-bounds check of parseCffGlyphBounds against the vendored STIX Two Math program does; a failed dry run aborts the whole mutation run before a single mutant is tested. A per-test budget would be a guess, because nothing ties one test's duration to momentary contention and every test in the instrumented suite is equally exposed to it. The heaviest single test is math-stretch.test.ts's whole-Unicode-range glyphId enumeration.
// Exported so vitest.mutation.config.ts — which replaces this file's whole `test` block outright rather than merging into it, since Stryker's vitest-runner has no --project-equivalent selector — can apply the identical ceiling to Stryker's own dry run and mutant-testing runs, the exact runs this value was measured against in the first place.
export const UNIT_TEST_TIMEOUT_MS = 600_000;

// Three named projects in one config, filtered by --project in package.json's scripts: "unit" (src/**/*.test.ts) for pnpm test/test:watch; "smoke" (test/smoke.test.mjs, which imports from dist/) only ever run by pnpm test:smoke, right after tsdown rebuilds dist/; "corpus" (test/corpus/**/*.test.ts) for the optional, gitignored real-world PDF conformance layer, run only by pnpm test:corpus and never part of pnpm test.
export default defineConfig({
  test: {
    // Vitest resolves coverage once for the whole run from this root config, not per project, so it cannot live inside the 'unit' project's own test block; pnpm test:coverage scopes what actually gets measured by filtering to --project unit, which never imports the smoke/corpus suites.
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
      { test: { name: "smoke", include: ["test/smoke.test.mjs"] } },
      { test: { name: "corpus", include: ["test/corpus/**/*.test.ts"] } },
    ],
  },
});
