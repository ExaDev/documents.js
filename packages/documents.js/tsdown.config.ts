import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/*.d.ts",
    "!src/test-support/**",
  ],
  root: "src",
  format: ["esm", "cjs"],
  dts: true,
  platform: "neutral",
  // The launcher bin (src/bin.ts) is Node-only and imports node:child_process; the library proper is worker-isomorphic and has zero node:* imports, so this matches nothing there. Declaring node:* external lets the bin's one builtin resolve cleanly as an external import rather than warning "module not found" under the neutral platform (which disables tsdown's automatic node-builtin detection).
  external: [/^node:/],
  clean: true,
});
