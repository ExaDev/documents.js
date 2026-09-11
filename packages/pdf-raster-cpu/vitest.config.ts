import { defineConfig } from "vitest/config";

// The node suite is the co-located src/**/*.test.ts files alone; the workerd suite under test/workers has its own config (vitest.workers.config.ts) and runs only through pnpm test:workers, so a plain `vitest run` never double-runs it under node where it would prove nothing.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "html", "cobertura"],
    },
  },
});
