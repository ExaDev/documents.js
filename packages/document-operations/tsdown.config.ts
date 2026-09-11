import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  platform: "node",
  clean: true,
  // platform: 'node' defaults fixedExtension to true (always .mjs/.cjs), which does not match package.json's own exports field (import: ./dist/index.js, require: ./dist/index.cjs). Disabling it lets the extension follow package.json's "type": "module" instead -- .js for ESM, .cjs for CJS -- so the build output actually matches what's published. Mirrors document-mcp's own tsdown.config.ts.
  fixedExtension: false,
});
