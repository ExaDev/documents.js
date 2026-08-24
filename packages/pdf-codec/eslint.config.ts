import tseslint from "typescript-eslint";
import { packageLintConfig } from "../../eslint.shared.ts";

export default tseslint.config(
  ...packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    // Off: with noUncheckedIndexedAccess on, every indexed read is typed as possibly-undefined, so this rule fires on array and byte-buffer indexing whose bound the surrounding code has already established -- a loop condition, a prior length check, or a fixture the test itself just built. None of the sites here is a value that can actually be absent. Tracked for a per-package decision on whether any of them is genuine; see the burn-down epic.
    nonNullAssertion: "off",
    isomorphic: true,
    // scripts/ holds a standalone build step importing from ../dist, the same reason test/ is ignored.
    additionalIgnores: ["scripts"],
  }),
  {
    // src/assets/ holds the vendored font binaries as generated TypeScript modules: nine files whose payload is one base64 string literal per face, the largest a single line of 1,077,633 characters. Prettier has nothing useful to do with a line like that and would spend real time deciding so, and no human edits these -- they are regenerated from the font files.
    //
    // Turned off through a scoped override rather than a .prettierignore, deliberately. turbo runs `eslint .` from inside each package directory, and eslint-plugin-prettier resolves an ignore path relative to that working directory, so a .prettierignore at the workspace root would simply never be consulted here.
    files: ["src/assets/**"],
    // The suite checking those modules load and declare the faces they claim is hand-written, so it stays formatted like any other source.
    ignores: ["src/assets/**/*.test.ts"],
    rules: { "prettier/prettier": "off" },
  },
);
