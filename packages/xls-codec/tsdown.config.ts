import { defineConfig } from "tsdown";

// One dist file per src module (root: 'src' makes dist/ mirror src/'s layout), matching archive-codec and ooxml.js -- package.json's `./*` exports wildcard advertises deep imports (xls-codec/biff/record, xls-codec/content, ...), which a single bundled barrel entry cannot serve. Tests and fixture support are excluded: they are not published surface, and src/test-support exists only for the unit suite.
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
