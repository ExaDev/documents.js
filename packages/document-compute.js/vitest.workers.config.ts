import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the test/workers suite under the real Cloudflare Workers runtime (workerd) via @cloudflare/vitest-pool-workers' cloudflareTest plugin (the current vitest-4 API -- a plugin, not the older defineWorkersProject/config helper). document-compute.js's surface (evaluate, unit/dimension arithmetic, interval arithmetic, solveFor) is designed to carry zero Node-API usage -- the exact-rational arithmetic behind unit conversion is plain BigInt, never node:crypto or any other Node-only primitive -- this config turns that design property into a runtime-checked fact rather than an assertion: if any code path (or its document-schema.js dependency, zod included) touched a Node-only API, the workerd isolate would throw instead of the test passing. Kept in a separate config from the default node `vitest run` so the existing node suite is unchanged; run explicitly via `pnpm test:workers`.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["test/workers/**/*.test.ts"] },
});
