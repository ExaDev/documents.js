import { defineConfig } from "tsdown";

// One dist file per src module (root: 'src' makes dist/ mirror src/'s layout), matching every sibling codec here -- package.json's `./*` exports wildcard advertises deep imports (ppt-codec/record/header, ppt-codec/text/text-runs, ...) that a single bundled barrel entry cannot serve. Tests and fixture support are excluded: they are not published surface.
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
  clean: true,
});
