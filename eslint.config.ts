import js from "@eslint/js";
import exadevRecommendedTypeChecked from "@exadev/eslint-config";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";
import { dataFileLintConfig } from "./eslint.shared.ts";

/**
 * Lints the workspace root's own files: its TypeScript tooling (this config, eslint.shared.ts, prettier.config.ts, commitlint.config.ts, lint-staged.config.ts) and its data and prose (turbo.json, pnpm-workspace.yaml, the CI workflows, README.md).
 *
 * packages/** stays ignored here. Every package keeps its own eslint.config.ts, because file scoping, tsconfig wiring, and the Worker-isomorphism import bans are genuinely per-package. The JSON, Markdown, and YAML rules are shared rather than duplicated -- eslint.shared.ts exports one definition that both this config and every package's config call -- so a package's data files are linted by that package's own run, from inside its own directory, rather than by a root run that would have to walk the whole tree to find them.
 */
export default tseslint.config(
  {
    // pnpm-lock.yaml is generated and enormous; nothing about its formatting is a human decision.
    ignores: [
      "packages/**",
      "node_modules",
      ".turbo",
      "CHANGELOG.md",
      "AGENTS.md",
      "CLAUDE.md",
      "pnpm-lock.yaml",
      // Local scratch output from the Playwright MCP server, untracked and now gitignored.
      ".playwright-mcp",
    ],
  },
  {
    // Scoped to TypeScript so the parser project is never applied to the JSON and YAML files below, which it cannot parse. Pinning the TSConfig root keeps the parser from being confused by the package tsconfigs beneath this directory, which matters because lint-staged runs eslint at commit time. `project` rather than `projectService`: the root's tsconfig.json lists its files explicitly, and every file this config lints as TypeScript is in it.
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...exadevRecommendedTypeChecked],
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
    },
  },

  ...dataFileLintConfig,

  // LAST, for the same reason as in eslint.shared.ts: this bundles eslint-config-prettier, which switches off the stylistic rules that would otherwise fight the formatter.
  //
  // The `files` list is not cosmetic. eslint-plugin-prettier's recommended config sets no `files` of its own, which makes every path in scope a lint target -- including, in a workspace like this one, binary document fixtures and megabyte base64 font modules that ESLint would then read as text. Naming the extensions actually formatted keeps it to files a formatter has an opinion about.
  {
    ...prettierRecommended,
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs,json,jsonc,md,yml,yaml}"],
  },
);
