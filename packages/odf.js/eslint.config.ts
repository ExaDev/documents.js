import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noNonBarrelIndex from './eslint-rules/no-non-barrel-index.js';
import noPointlessReassignment from './eslint-rules/no-pointless-reassignment.js';
import noSideEffectsInIndex from './eslint-rules/no-side-effects-in-index.js';

export default tseslint.config(
  {
    // test/smoke.test.mjs imports from ../dist, a build artefact that may not exist at lint time and is deliberately outside tsconfig's "src" program (it tests the built output, not the source) -- see its own top-of-file comment and CLAUDE.md.
    ignores: ['dist', 'coverage', 'node_modules', 'test'],
  },
  {
    // Pin the TSConfig root so the parser isn't confused by stray tsconfig.json files elsewhere in the tree. Required because lint-staged runs eslint at commit time.
    //
    // `project` (global -- no `files` filter) powers the type-checked rules below; it must apply to every matched file or the type-checked configs crash on files outside the program. Two TSConfig programs are listed: tsconfig.json is the runtime-src web-only gate (lib ES2024+WebWorker, types [], no @types/node -- the isomorphism check), and tsconfig.node.json (lib ES2024, @types/node) covers test files, test-support, eslint-rules, and the root config files. `project` (not `projectService`) is required here: the TS project service auto-discovers only tsconfig.json by name and cannot route the nested test files that live solely in tsconfig.node.json (its `allowDefaultProject` deliberately blocks `**` globs), whereas listing both tsconfigs lets each file resolve to the program that includes it -- runtime src to the web program, tests/config/eslint-rules to the node program.
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json', './tsconfig.node.json'], tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Type-checked tier: catches floating promises, misused async handlers, unsafe `any`, and invalid template expressions. Requires the `project` parser option set above.
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
    // Local custom rules (eslint-rules/*.ts) -- not published as a package, matching this family's own convention of keeping shared dev-tooling config as identical per-repo copies rather than a shared devDependency.
    plugins: { local: { rules: { 'no-pointless-reassignment': noPointlessReassignment, 'no-side-effects-in-index': noSideEffectsInIndex, 'no-non-barrel-index': noNonBarrelIndex } } },
    rules: { 'local/no-pointless-reassignment': 'error', 'local/no-non-barrel-index': 'error' },
  },
  {
    // The structural counterpart to the re-export ban below: that rule says re-exports belong only in src/index.ts, this one says src/index.ts may contain only re-exports -- together pinning the barrel to exactly one shape, one that can never have a side effect at import time.
    files: ['src/index.ts'],
    rules: { 'local/no-side-effects-in-index': 'error' },
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
  {
    // Static Worker-isomorphism guard: this is a runtime-published library that must run in a Cloudflare Worker (workerd) as well as Node, so node: imports and the Node-only Buffer global are banned in runtime src. Test files and test-support legitimately use node:fs for fixtures -- they are not published, so they are exempt here. typeof-process isomorphic checks remain legitimate, so `process` is deliberately not banned as a global; the import ban catches the real surface. The patterns use `regex` (tested against the import specifier) rather than `group`: `group` is gitignore-matched via the `ignore` package with allowRelativePaths, so a bare name like `util` or `path` matches ANY path segment and false-positives on relative imports such as `./util/base64` or `./typed/shared/path`; the anchored `regex` matches only exact builtin specifiers.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/test-support/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^node:', message: 'This is a Worker-isomorphic library: node:* imports are banned in runtime src. Use a Web API or an isomorphic helper.' },
            { regex: '^(fs|path|crypto|child_process|os|net|http|https|stream|util|buffer|url|zlib|readline|worker_threads|timers|events|assert)$', message: 'This is a Worker-isomorphic library: bare Node builtin imports are banned in runtime src. Use a Web API or an isomorphic helper.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'Buffer', message: 'Buffer is Node-only; this Worker-isomorphic library uses Uint8Array.' }],
    },
  },
);
