import { defineConfig } from "tsdown";

// Two build passes: the library index ("." export -- the createServer factory and any programmatic surface, consumed by an embedder) and the bin script. Both are platform: 'node' -- like document-cli, this package is inherently stdio-bound, not a portable bytes-in/bytes-out library.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    platform: "node",
    clean: true,
    // platform: 'node' defaults fixedExtension to true (always .mjs/.cjs), which does not match package.json's own exports field (import: ./dist/index.js, require: ./dist/index.cjs). Disabling it lets the extension follow package.json's "type": "module" instead -- .js for ESM, .cjs for CJS -- so the build output actually matches what's published.
    fixedExtension: false,
  },
  {
    // ESM only -- a bin script is executed, never require()'d. The shebang (#!/usr/bin/env node, written as the literal first line of src/bin.ts) is preserved at the top of the output chunk by Rolldown, and tsdown's own ShebangPlugin chmods the resulting file automatically during writeBundle -- no postbuild chmod +x step needed.
    entry: ["src/bin.ts"],
    format: ["esm"],
    dts: false,
    platform: "node",
    clean: false,
    // Same reasoning as the index entry above: without this, the bin script would build as dist/bin.mjs, which does not match package.json's bin field (./dist/bin.js).
    fixedExtension: false,
  },
]);
