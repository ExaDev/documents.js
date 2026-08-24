import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the test/workers suite under the real Cloudflare Workers runtime (workerd) via @cloudflare/vitest-pool-workers' cloudflareTest plugin (the current vitest-4 API -- a plugin, not the older defineWorkersProject/config helper). document-outline.js's surface (per-kind outline building, flatten, leaf text, content hashing) is designed to carry zero Node-API usage -- the SHA-256 in the hash helper is hand-rolled over Uint8Array precisely so no node:crypto is ever needed; this config turns that design property into a runtime-checked fact rather than an assertion -- if any code path (or its zod / document-schema.js dependencies) touched a Node-only API, the workerd isolate would throw instead of the test passing. Kept in a separate config from the default node `vitest run` so the existing node suite is unchanged; run explicitly via `pnpm test:workers`.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["test/workers/**/*.test.ts"] },
});
