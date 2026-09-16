import { defineConfig } from "vitest/config";

// The unit suite's own cost is dominated by CPU-bound cryptography (AES-256's ISO 32000-2 Algorithm 2.B key derivation) and a whole-Unicode-range glyphId enumeration (math-stretch.test.ts), neither of which is slow on its own -- both finish in well under a second uninstrumented and idle. What makes them slow, unpredictably, is contention: v8 coverage instrumentation, Stryker's own mutant instrumentation (heavier still, since it wraps every statement these tests execute), and this shared development machine's other concurrent sessions, whose reported load average routinely runs into the hundreds. Measured directly: the AES-256 fixtures table in read.test.ts took 10.5-13.3s inside an isolated Stryker sandbox at a load average of ~120, then exceeded 300s for the same test inside a real dry run (contending with every other instrumented file, plus everything else this machine was running) at a load average of ~216 -- and in a separate run, an unrelated CFF font-parsing test missed vitest's own 5000ms default under the same conditions, proving the slowdown is general contention, not a property of any one test. UNIT_TEST_TIMEOUT_MS is a single generous ceiling for the whole unit project rather than a per-test guess, because no formula ties any one test's duration to this machine's momentary contention, and every test in this instrumented suite is equally exposed to it.
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
