import { defineConfig } from "vitest/config";

// This suite's own cost is dominated by real scanline rasterisation (drawing filled glyph outlines and PDF page content pixel by pixel), which finishes in well under a second uninstrumented and idle, but is exposed to the same shared-development-machine contention documented at length in pdf-codec/vitest.config.ts (v8 coverage instrumentation, other concurrent sessions, load averages running into the hundreds) since this package always runs downstream of a pdf-codec change. A ceiling well past vitest's own 5000ms default absorbs that contention without masking a genuine hang, the same trade-off pdf-codec's own UNIT_TEST_TIMEOUT_MS already makes.
const UNIT_TEST_TIMEOUT_MS = 600_000;

// The node suite is the co-located src/**/*.test.ts files alone; the workerd suite under test/workers has its own config (vitest.workers.config.ts) and runs only through pnpm test:workers, so a plain `vitest run` never double-runs it under node where it would prove nothing.
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
