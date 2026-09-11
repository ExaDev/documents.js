import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    platform: "node",
    clean: true,
    fixedExtension: false,
  },
  {
    // ESM only -- a bin script is executed, never require()'d. Mirrors document-mcp's own tsdown.config.ts bin entry.
    entry: ["src/bin.ts"],
    format: ["esm"],
    dts: false,
    platform: "node",
    clean: false,
    fixedExtension: false,
  },
]);
