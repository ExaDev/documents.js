import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the test/workers suite under the real Cloudflare Workers runtime (workerd) via @cloudflare/vitest-pool-workers' cloudflareTest plugin (the current vitest-4 API -- a plugin, not the older defineWorkersProject/config helper). document-mcp is a stdio MCP server, not a library, so this suite does not attempt a full workerd run of the server's own entry point; instead it drives createServer() (the same constructor src/bin.ts wires to stdio) through an in-memory client/server JSON-RPC pair (InMemoryTransport -- no stdio transport, no node:fs), exercising only the tool handlers whose bodies call isomorphic documents.js/pdf-codec functions via inline base64 fixtures. Kept in a separate config from the default node `vitest run` so the existing node suite is unchanged; run explicitly via `pnpm test:workers`.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["test/workers/**/*.test.ts"] },
});
