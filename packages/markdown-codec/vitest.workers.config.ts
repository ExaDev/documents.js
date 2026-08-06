import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Runs the test/workers suite under the real Cloudflare Workers runtime (workerd) via @cloudflare/vitest-pool-workers' cloudflareTest plugin (the current vitest-4 API -- a plugin, not the older defineWorkersProject/config helper). markdown-codec's readMarkdown/writeMarkdown (CommonMark+GFM scan/parse/lower/emit, all hand-written with only zod as a runtime sibling) is designed to be isomorphic -- no node:fs, no Buffer, no path -- so this config turns that design property into a runtime-checked fact rather than an assertion: if either direction touched a Node-only API, the workerd isolate would throw instead of the test passing. Kept in a separate config from the default node `vitest run --project unit` so the existing node suite is unchanged; run explicitly via `pnpm test:workers`.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: { include: ['test/workers/**/*.test.ts'] },
});
