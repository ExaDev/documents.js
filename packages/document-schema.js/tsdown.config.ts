import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

function isPackageJsonWithVersion(
  value: unknown,
): value is { version: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("version" in value)) return false;
  return typeof value.version === "string";
}

// Bakes this package's own published version into dist/index.js/dist/index.cjs as a literal string constant (via tsdown/rolldown's esbuild-style `define`, plain text replacement at bundle time) -- so src/schema-io.ts's schemaUriFor() needs no runtime fs read to know its own version. vitest.config.ts's own `define` must stay in sync with this so `pnpm test` (which runs directly against src/, not dist/) sees the identical literal.
const packageJson: unknown = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
if (!isPackageJsonWithVersion(packageJson)) {
  throw new Error('package.json is missing a string "version" field');
}
const { version } = packageJson;

export default defineConfig({
  // Glob-expanded by tsdown/tinyglobby (not just typed as a string, genuinely resolved via glob() at build time) into one entry per matched file, keyed by its path relative to `root` -- so e.g. src/schema-io.ts becomes dist/schema-io.js, and src/index.ts keeps producing dist/index.js exactly as it always has, since it's just another file this same glob matches. `root: 'src'` pins the relative-path base explicitly: left to its default, it's computed as the common ancestor of whatever the glob currently matches, which can silently shift if the matched file set ever changes.
  entry: ["src/**/*.ts", "!src/**/*.test.ts", "!src/**/*.d.ts"],
  root: "src",
  format: ["esm", "cjs"],
  dts: true,
  platform: "neutral",
  clean: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(version),
  },
});
