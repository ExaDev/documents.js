import { defineConfig } from "vitest/config";

// graph.test.ts's exhaustive LCS-reconciliation proof (reconcileChildren's own genuine-subsequence enumeration, ~14,790 cases across a 2-id and a 3-id pool) runs comfortably under vitest's 5000ms default per-test timeout uninstrumented, but v8 coverage instrumentation (`pnpm test:coverage`) slows it enough on a CI runner to trip that default -- confirmed directly (ExaDev/documents.js#997): the 3-id-pool case alone timed out at exactly 5000ms in CI while the whole file's 79 tests took 9512ms total under coverage, having had no vitest.config.ts of its own to override vitest's built-in default. UNIT_TEST_TIMEOUT_MS follows document-cli's own vitest.config.ts precedent -- a named constant with generous headroom above the slowest instrumented run observed, not the bare minimum that happened to pass once.
const UNIT_TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
  test: {
    testTimeout: UNIT_TEST_TIMEOUT_MS,
  },
});
