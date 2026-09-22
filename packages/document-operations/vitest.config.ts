import { defineConfig } from "vitest/config";

// document-output.test.ts's threshold-boundary tests each base64-encode a 5 MB buffer through documents.js's own bytesToBase64 — real work that finishes in well under a second uninstrumented and idle (confirmed directly: ~200ms). What pushes them over vitest's 5000ms default is CI-runner scheduling contention rather than the encode itself: this workspace's CI shares its runner pool across every package's own test job in the same run, and both threshold tests landed at 5.5-5.8s wall time on two separate, otherwise-unremarkable CI runs. UNIT_TEST_TIMEOUT_MS is raised with a wide margin above both observed runs, matching the same contention-driven pattern already addressed this way in document-outline.js and pdf-codec's own vitest.config.ts, rather than tuned to the bare minimum that happened to pass once.
const UNIT_TEST_TIMEOUT_MS = 60_000;

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: UNIT_TEST_TIMEOUT_MS,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "html", "cobertura"],
    },
  },
});
