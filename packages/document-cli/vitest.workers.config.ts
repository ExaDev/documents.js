import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Runs the test/workers suite under the real Cloudflare Workers runtime (workerd) via @cloudflare/vitest-pool-workers' cloudflareTest plugin (the current vitest-4 API -- a plugin, not the older defineWorkersProject/config helper). document-cli is a Node application (an Ink/React terminal TUI plus a commander CLI), so a full workerd run of its ENTRY -- src/cli.ts, which dispatches commander programs and lazy-loads the Ink TUI -- is not possible: commander, Ink, process.stdin/stdio, and node:fs are all Node-only. This suite therefore deliberately exercises only the thin isomorphic wrapper slice that does NOT touch any of those: src/sql-result-format.ts (a pure formatter that calls documents.js's hsqldbCellDisplayText per cell over a SqlResultSet) and src/runtime/exit-codes.ts (mapErrorToExit, whose instanceof branches load documents.js's error classes), proving the wrapped documents.js paths execute inside a workerd isolate with no Node-only API usage, without pulling commander/Ink/node:fs into the actual test calls. Kept in a separate config from the default node `vitest run` so the existing node suite is unchanged; run explicitly via `pnpm test:workers`.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: { include: ['test/workers/**/*.test.ts'] },
});
