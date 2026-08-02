import { defineConfig } from 'tsdown';

// Two build passes: the library index ("." export -- CLI action functions and format helpers, consumed by the TUI and any external programmatic caller) and the bin script. Both are platform: 'node' -- unlike documents.js's own platform: 'neutral', this package is inherently file-system/stdio-bound, not a portable bytes-in/bytes-out library.
export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    platform: 'node',
    clean: true,
    // platform: 'node' defaults fixedExtension to true (always .mjs/.cjs), which does not match package.json's own exports field (import: ./dist/index.js, require: ./dist/index.cjs). Disabling it lets the extension follow package.json's "type": "module" instead -- .js for ESM, .cjs for CJS -- so the build output actually matches what's published.
    fixedExtension: false,
  },
  {
    // ESM only -- a bin script is executed, never require()'d. The shebang (#!/usr/bin/env node, written as the literal first line of src/cli.ts) is preserved at the top of the output chunk by Rolldown, and tsdown's own ShebangPlugin chmods the resulting file automatically during writeBundle -- no postbuild chmod +x step needed.
    entry: ['src/cli.ts'],
    format: ['esm'],
    dts: false,
    platform: 'node',
    clean: false,
    // Same reasoning as the index entry above: without this, the bin script would build as dist/cli.mjs, which does not match package.json's bin field (./dist/cli.js).
    fixedExtension: false,
  },
]);
