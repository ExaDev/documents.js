import { defineConfig } from "vitest/config";

// A single generous ceiling for the whole unit project, not a per-test guess. No test here is slow on its own: uninstrumented and idle every one finishes in well under a second and the whole project in a few seconds. What makes a test slow, unpredictably, is contention: v8 coverage instrumentation, Stryker's own mutant instrumentation (heavier still, since it wraps every statement a test executes), and this shared development machine's other concurrent sessions, whose reported load average routinely runs into the hundreds. A hosted CI runner is exposed to exactly the same effect, and without this ceiling Stryker's dry run there fails outright rather than merely running slowly: the cff-bounds test that checks parseCffGlyphBounds against the vendored STIX Two Math program misses vitest's 5000ms default, which is an ordinary test losing a race for the CPU rather than a slow one. The multiplier the ceiling has to absorb is the measured gap between those conditions: the same project that runs in a few seconds uninstrumented and idle takes a little over four minutes under Stryker's own instrumented dry run at a load average near fifty, and that gap grows with load rather than with any property of a given test. A per-test budget would therefore be a guess, since no formula ties one test's duration to momentary contention and every test in the instrumented suite is equally exposed to it. The heaviest single test is math-stretch.test.ts's whole-Unicode-range glyphId enumeration; the AES-256 key derivation of ISO 32000-2 Algorithm 2.B that once sat alongside it is no longer a factor, since the cipher runs from lookup tables and SHA-384/512 on pairs of 32-bit words rather than BigInt.
// Exported so vitest.mutation.config.ts -- which replaces this file's whole `test` block outright rather than merging into it, since Stryker's vitest-runner has no --project-equivalent selector -- can apply the identical ceiling to Stryker's own dry run and mutant-testing runs, the exact runs this value was measured against in the first place.
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
