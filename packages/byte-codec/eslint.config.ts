import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import type { Rule } from 'eslint';

// Forward guard: only src/index.ts may use an index.* basename. Any future module named index.ts/cts/mts/js/cjs/mjs outside the public convenience barrel is a mistake (a hidden entry point the exports map does not advertise). ESLint 9+ guarantees context.filename; the optional getFilename fallback covers an older runtime only.
const noNonBarrelIndex: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      barrel:
        'Only src/index.ts may be named index.* (the public convenience barrel); give any other module a descriptive filename.',
    },
  },
  create(context: Rule.RuleContext & { getFilename?: () => string }) {
    const filename = context.filename ?? context.getFilename?.() ?? '';
    const lastSlash = filename.lastIndexOf('/');
    const basename = lastSlash === -1 ? filename : filename.slice(lastSlash + 1);
    if (!/^index\.[cm]?[tj]s$/.test(basename)) return {};
    if (filename.endsWith('/src/index.ts')) return {};
    return {
      Program(node) {
        context.report({ node, messageId: 'barrel' });
      },
    };
  },
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    plugins: { local: { rules: { 'no-non-barrel-index': noNonBarrelIndex } } },
    rules: { 'local/no-non-barrel-index': 'error' },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
