import { readFileSync } from 'node:fs';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

function isPackageJsonWithVersion(value: unknown): value is { version: string } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('version' in value)) return false;
  return typeof value.version === 'string';
}

// Runs the test/workers suite under the real Cloudflare Workers runtime (workerd) via @cloudflare/vitest-pool-workers' cloudflareTest plugin (the current vitest-4 API -- a plugin, not the older defineWorkersProject/config helper). document-schema.js is pure Zod schemas with no Node-API usage by design; this config turns that design property into a runtime-checked fact rather than an assertion -- if any schema (or its zod dependency) touched a Node-only API, the workerd isolate would throw instead of the test passing. Kept in a separate config from the default node `vitest run` so the existing node suite is unchanged; run explicitly via `pnpm test:workers`.
//
// Mirrors vitest.unit.config.ts / tsdown.config.ts's `define` exactly: src/schema-io.ts's schemaUriFor() references the compile-time __PACKAGE_VERSION__ identifier (declared in src/global.d.ts, never a runtime read), so without the identical injection here the workerd transform would leave a bare, undefined identifier and the isolate would throw ReferenceError before any schema parsed. The define replaces it with a literal string at transform time, so workerd never sees the identifier at all.
const packageJson: unknown = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
if (!isPackageJsonWithVersion(packageJson)) {
  throw new Error('package.json is missing a string "version" field');
}
const { version } = packageJson;

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  define: {
    __PACKAGE_VERSION__: JSON.stringify(version),
  },
  test: { include: ['test/workers/**/*.test.ts'] },
});
