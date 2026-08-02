import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noPointlessReassignment from './eslint-rules/no-pointless-reassignment.js';

export default tseslint.config(
  {
    // test/smoke.test.mjs imports from ../dist, a build artefact that may not exist at lint time and is deliberately outside tsconfig's "src" program (it tests the built output, not the source) -- see its own top-of-file comment and CLAUDE.md.
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
    // Local custom rule (eslint-rules/no-pointless-reassignment.ts) -- not published as a package, matching this family's own convention of keeping shared dev-tooling config as identical per-repo copies rather than a shared devDependency.
    plugins: { local: { rules: { 'no-pointless-reassignment': noPointlessReassignment } } },
    rules: { 'local/no-pointless-reassignment': 'error' },
  },
  {
    // Genuine bailout the rule's own mutation-check can't detect: it only checks whether the ALIAS itself (startIndex) is ever reassigned, not whether the origin variable (columnCursor) is mutated between the const's declaration and a later read of the alias. readTable's own table:table-header-columns branch declares `const startIndex = columnCursor` specifically to snapshot the cursor's value BEFORE the header-column loop mutates it via processColumn's own `columnCursor += ...`, then compares the two afterwards (`if (columnCursor > startIndex)`). Auto-fixing this the way the rule normally would -- rewriting every read of startIndex to columnCursor -- silently turns that comparison into `columnCursor > columnCursor`, always false. Scoped to this one file rather than disabled globally, since this file's other pointless-reassignment case (a since-removed DEFAULT_PAGE_SIZE alias) was a genuine, correctly auto-fixed hit.
    files: ['src/typed/ods/read.ts'],
    rules: { 'local/no-pointless-reassignment': 'off' },
  },
  {
    // Re-exports belong only in src/index.ts, the public barrel -- a re-export anywhere else risks silently surfacing the wrong thing under a name a consumer expects to mean something else.
    files: ['src/**/*.ts'],
    ignores: [
      'src/index.ts',
      // A deliberate, pre-existing canonical re-export point: document-schema.js's Alignment/AlignmentSchema already IS ODF's paragraph-alignment vocabulary one-for-one, so this file re-exports it as the one place a reader looks for "ODF alignment" rather than duplicating it.
      'src/typed/shared/style.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportAllDeclaration', message: 'Re-exports belong only in src/index.ts (the public barrel). Define or import this locally instead.' },
        { selector: 'ExportNamedDeclaration[source]', message: 'Re-exports belong only in src/index.ts (the public barrel). Define or import this locally instead.' },
      ],
    },
  },
);
