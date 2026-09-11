import { defineConfig } from "tsdown";

// The single barrel is the whole entry surface: everything a consumer needs is index.ts's factory and the types it carries (the port's own types arrive through pdf-codec's declarations, which this package's dist references).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  platform: "neutral",
  clean: true,
});
