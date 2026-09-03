import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the test/workers suite under the real Cloudflare Workers runtime (workerd) via @cloudflare/vitest-pool-workers' cloudflareTest plugin. doc-codec's whole surface is byte arithmetic over Uint8Array/DataView with no I/O of its own, so it is isomorphic by construction -- this config turns that design property into a runtime-checked fact rather than an assertion: a stray node:* import or Buffer use would throw inside the workerd isolate instead of these passing. Kept in a separate config from the default node `vitest run --project unit` so the node suite is unchanged; run explicitly via `pnpm test:workers`.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["test/workers/**/*.test.ts"] },
});
