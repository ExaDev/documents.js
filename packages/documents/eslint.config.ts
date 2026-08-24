import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";
import { packageLintConfig } from "../../eslint.shared.ts";

export default tseslint.config(
  ...packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    // Off: with noUncheckedIndexedAccess on, every indexed read is typed as possibly-undefined, so this rule fires on array and byte-buffer indexing whose bound the surrounding code has already established -- a loop condition, a prior length check, or a fixture the test itself just built. None of the sites here is a value that can actually be absent. Tracked for a per-package decision on whether any of them is genuine; see the burn-down epic.
    nonNullAssertion: "off",
    // Three programs, not the usual two: the app, the browser Web Worker, and the Node-side config files.
    projects: [
      "./tsconfig.json",
      "./tsconfig.worker.json",
      "./tsconfig.node.json",
    ],
    additionalIgnores: [
      "playwright-report",
      "test-results",
      "src/routeTree.gen.ts",
    ],
    // Not Worker-isomorphic: this is a browser app, and its own RPC import boundary below is what keeps the conversion engine out of the main bundle.
    isomorphic: false,
    // No npm exports map and no public entry point, so the rule's default stays right rather than being relaxed to 'single'.
    barrelPolicy: "banned",
    // Globals are scoped per layer below instead. Node globals everywhere would let a `process.env` read in browser code lint clean.
    nodeGlobals: false,
  }),
  {
    // React UI layer only -- the worker/rpc/db/ports/adapters layers stay plain TS with no JSX/browser-global rules.
    files: ["src/**/*.tsx", "src/ui/**/*.ts", "src/routes/**/*.ts"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Three exceptions imposed by TanStack Router's own conventions, not by an avoidable authoring choice in this codebase:
    // - barrel-policy: index routes require literal "index.tsx" / "<segment>.index.tsx" filenames (the router's own file-based generator resolves them, never a bare directory import), which collides with barrel-policy's unrelated "no index.* files" concern.
    // - react-refresh/only-export-components: every route file's exported `Route` (createFileRoute/createRootRoute) references its component via a `component:` property, which the rule's fast-refresh-boundary heuristic flags regardless of allowExportNames -- allowlisting the export name doesn't cover a component being referenced from within another exported value.
    // - only-throw-error: `redirect()`/`notFound()` are TanStack Router's documented control-flow mechanism -- both deliberately return a plain object, not an Error instance, that `beforeLoad`/`loader` are meant to `throw`. The router itself catches and interprets these; they are never an actual error propagating to a boundary.
    files: ["src/routes/**/*.tsx"],
    rules: {
      "exadev/barrel-policy": "off",
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/only-throw-error": "off",
    },
  },
  {
    files: ["src/workers/**/*.ts"],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: [
      "vite.config.ts",
      "vitest.config.ts",
      "playwright.config.ts",
      "eslint.config.ts",
      "commitlint.config.ts",
      "release.config.ts",
      "lint-staged.config.ts",
      "scripts/**/*",
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Import-boundary enforcement: UI/route code must go through the RPC client for anything that touches real document bytes -- only src/workers/** may call documents.js's conversion/editor functions directly. Uses the typescript-eslint variant of no-restricted-imports (the base rule is turned off below to avoid double-reporting the same import) specifically for its `allowTypeImports` option: a type-only import is erased at compile time regardless of which name it is, so it can never pull the conversion engine into the main bundle -- allowImportNames only needs to name genuine runtime values (DocumentFormatSchema/DOCUMENT_FORMATS/columnIndexToLetters), not every type re-exported alongside them.
    files: [
      "src/routes/**/*.{ts,tsx}",
      "src/features/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/ui/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["documents.js", "documents.js/**"],
              allowTypeImports: true,
              allowImportNames: [
                "DocumentFormatSchema",
                "DOCUMENT_FORMATS",
                "columnIndexToLetters",
              ],
              message:
                "UI code may not import documents.js's conversion/editor functions directly -- go through the RPC client (src/rpc/client.ts). Only src/workers/** may call them.",
            },
            {
              group: [
                "odf.js",
                "odf.js/**",
                "ooxml.js",
                "ooxml.js/**",
                "pdf-codec",
                "pdf-codec/**",
                "markdown-codec",
                "markdown-codec/**",
              ],
              allowTypeImports: true,
              message:
                "UI code may not import documents.js's sibling libraries directly -- go through the RPC client. Only src/workers/** may import these.",
            },
          ],
        },
      ],
    },
  },
);
