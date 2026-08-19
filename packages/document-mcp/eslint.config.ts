import js from '@eslint/js';
import globals from 'globals';
import type { Rule } from 'eslint';
import tseslint from 'typescript-eslint';

// Forward guard: every package has a single public convenience barrel at src/index.ts, and no other module may share the index.* basename -- an orphan index.* file is a second entry point callers will reach for, silently fragmenting the public surface. Bans any file whose basename matches index.[cm]?[tj]s other than the one allowed src/index.ts barrel.
const noNonBarrelIndexRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      barrel:
        'Only src/index.ts may be named index.* (the public convenience barrel); give any other module a descriptive filename.',
    },
  },
  create(context) {
    // ESLint 9+ flat-config API: `context.filename` is always the absolute path of the file being linted (the legacy `context.getFilename()` was removed). Guaranteed non-optional in the RuleContext type, so no fallback is needed.
    const filename = context.filename;
    const lastSlash = filename.lastIndexOf('/');
    const basename = lastSlash === -1 ? filename : filename.substring(lastSlash + 1);
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
  {
    // test/smoke.test.mjs spawns the built dist/bin.js, deliberately outside tsconfig's "src" program (it tests build output) -- matches document-cli's own identical exclusion.
    ignores: ['dist', 'coverage', 'node_modules', 'test'],
  },
  {
    // Pin the TSConfig root so the parser isn't confused by stray tsconfig.json files elsewhere in the tree. Required because lint-staged runs eslint at commit time.
    //
    // `projectService` (global -- no `files` filter) powers the type-checked rules below; it must apply to every matched file or the type-checked configs crash on files outside the program.
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Type-checked tier: catches floating promises, misused async handlers, unsafe `any`, and invalid template expressions. Requires the `projectService` parser option set above.
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    // No inline eslint-disable / config comments anywhere -- an exception belongs in this file, scoped to the file or line it actually applies to, not hidden in the source it's disabling a rule for.
    linterOptions: { noInlineConfig: true },
  },
  {
    rules: {
      // No type assertions anywhere: narrow with a guard or parse with Zod instead.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    // A no-op arrow function is a standard, harmless way to stand in for a callback prop a given test case never exercises -- flagging every one of these as an error would just push authors toward padding each with a pointless comment body instead. Scoped to test files only: production code has no legitimate reason for an empty function body.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions', 'asyncFunctions'] }],
    },
  },
  {
    plugins: { local: { rules: { 'no-non-barrel-index': noNonBarrelIndexRule } } },
    rules: { 'local/no-non-barrel-index': 'error' },
  },
);
