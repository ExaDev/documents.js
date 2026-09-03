import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/*.d.ts",
    // Fixture builders for this package's own unit suite, never published surface -- the same exclusion every sibling makes.
    "!src/test-support/**",
  ],
  root: "src",
  format: ["esm", "cjs"],
  dts: true,
  platform: "neutral",
  clean: true,
});
