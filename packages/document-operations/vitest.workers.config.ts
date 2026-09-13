import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the test/workers suite under the real Cloudflare Workers runtime (workerd), exercising only the operations whose bodies call isomorphic documents.js/document-outline.js/document-compute.js functions via inline base64 fixtures (no node:fs) -- the same restriction document-mcp's own vitest.workers.config.ts documents for the identical reason: resolveDocumentInput's 'path' branch is Node-only, but the 'bytesBase64' branch every one of these tests uses is not. Kept in a separate config from the default node `vitest run` so the existing node suite is unchanged; run explicitly via `pnpm test:workers`.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["test/workers/**/*.test.ts"] },
});
