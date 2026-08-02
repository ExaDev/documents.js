import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

function isPackageJsonWithVersion(value: unknown): value is { version: string } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('version' in value)) return false;
  return typeof value.version === 'string';
}

// Mirrors tsdown.config.ts's own `define` exactly -- this project runs vitest directly against src/**/*.test.ts (never through tsdown), so __PACKAGE_VERSION__ needs the identical injection here or src/schema-io.ts's schemaUriFor() would hit a bare, undefined identifier under `pnpm test`. Needs its own real config file (not an inline entry in vitest.config.ts's `projects` array) -- see that file's own comment for why.
const packageJson: unknown = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
if (!isPackageJsonWithVersion(packageJson)) {
  throw new Error('package.json is missing a string "version" field');
}
const { version } = packageJson;

export default defineConfig({
  define: {
    __PACKAGE_VERSION__: JSON.stringify(version),
  },
  test: {
    name: 'unit',
    include: ['src/**/*.test.ts'],
  },
});
