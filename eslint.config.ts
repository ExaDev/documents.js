import js from '@eslint/js';
import exadevRecommendedTypeChecked from '@exadev/eslint-config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lints the workspace root's own tooling files only -- this config, commitlint.config.ts, and lint-staged.config.ts.
 *
 * packages/** is ignored here on purpose. Every package keeps its own eslint.config.ts, because file scoping, tsconfig wiring, and the Worker-isomorphism import bans the foundation and codec packages enforce are genuinely per-package -- which is also why @exadev/eslint-config ships as a rules plugin rather than a whole shared config. `turbo run _lint` runs each package's own `_lint` script in its own directory; this config never sees those files.
 */
export default tseslint.config(
  {
    ignores: ['packages/**', 'node_modules'],
  },
  {
    // Pin the TSConfig root so the parser isn't confused by the package tsconfigs below this directory. Required because lint-staged runs eslint at commit time. `project` rather than `projectService`: the root's tsconfig.json lists its files explicitly, and every file this config lints is in it.
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
  },
  js.configs.recommended,
  ...exadevRecommendedTypeChecked,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
);
