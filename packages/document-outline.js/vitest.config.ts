import { defineConfig } from "vitest/config";

// graph.test.ts's exhaustive LCS-reconciliation proof (reconcileChildren's own genuine-subsequence enumeration, ~14,790 cases across a 2-id and a 3-id pool) runs in well under a second uninstrumented and with the runner otherwise idle, but its cost is dominated entirely by wall-clock scheduling rather than CPU work of its own, so anything that delays this process getting scheduled -- v8 coverage instrumentation, or simply a CI runner shared with many other concurrent jobs -- inflates its wall-clock duration by a large, load-dependent factor with no bound tied to the test's own work. Confirmed directly twice: coverage instrumentation alone took it to 9512ms (ExaDev/documents.js#997, when the timeout was raised from vitest's 5000ms default to 30_000), and later, plain CI-runner contention alone (dozens of concurrent workspace CI runs sharing GitHub's shared runners, no coverage involved) took it past 30_000ms outright (ExaDev/documents.js#1030). UNIT_TEST_TIMEOUT_MS is raised again here with a wide margin above every observed run rather than the bare minimum that happened to pass once, precisely because the dominant cost is contention this test cannot predict or bound.
const UNIT_TEST_TIMEOUT_MS = 120_000;

export default defineConfig({
  test: {
    testTimeout: UNIT_TEST_TIMEOUT_MS,
  },
});
