import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Runs the test/workers suite under the real Cloudflare Workers runtime (workerd) via @cloudflare/vitest-pool-workers' cloudflareTest plugin (the current vitest-4 API -- a plugin, not the older defineWorkersProject/config helper). pdf-codec's read path (object model, cross-reference resolution, content-stream interpreter, standard-14 font metrics) is designed to carry zero Node-API usage -- every node:fs/Buffer/process reference in the repo lives in .test.ts oracles, never in production src/. This config turns that design property into a runtime-checked fact rather than an assertion: if readPdf (or any of its byte-codec/document-schema.js/fflate/zod dependencies) touched a Node-only API, the workerd isolate would throw instead of the test passing. Kept in a separate config from the default node `vitest run` so the existing node suite is unchanged; run explicitly via `pnpm test:workers`.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: { include: ['test/workers/**/*.test.ts'] },
});
