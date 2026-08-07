import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noNonBarrelIndex from './eslint-rules/no-non-barrel-index.js';
import noNonBarrelReexport from './eslint-rules/no-non-barrel-reexport.js';
import noPointlessReassignment from './eslint-rules/no-pointless-reassignment.js';
import noSideEffectsInIndex from './eslint-rules/no-side-effects-in-index.js';

export default tseslint.config(
  {
    // test/smoke.test.mjs imports from ../dist, deliberately outside tsconfig's "src" program (it tests built output) -- see its own top-of-file comment and README.md. The optional, gitignored real-world PDF conformance corpus (formerly test/corpus/, exercising src/pdf/'s standalone build) moved to pdf-codec alongside the codec it tested.
    ignores: ['dist', 'coverage', 'node_modules', 'test'],
  },
  {
    // Pin the TSConfig root so the parser isn't confused by stray tsconfig.json files elsewhere in the tree. Required because lint-staged runs eslint at commit time.
    //
    // `project` (explicit tsconfig list) powers the type-checked rules below; listing both the web-primary tsconfig.json (runtime src) and tsconfig.node.json (tests + config files) ensures every matched file is in a program.
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
      // No type assertions anywhere: narrow with a guard or parse with Zod instead. The hand-written PDF codec (now the external pdf-codec dependency, formerly src/pdf/) established this pattern by narrowing third-party-shaped values (raw bytes, loosely-typed parsed tokens) through PdfObject's own `kind` discriminant rather than a cast; every other module in this package follows the same convention.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    // Local custom rules (eslint-rules/*.ts) -- not published as a package, matching this family's own convention of keeping shared dev-tooling config as identical per-repo copies rather than a shared devDependency.
    plugins: { local: { rules: { 'no-non-barrel-index': noNonBarrelIndex, 'no-non-barrel-reexport': noNonBarrelReexport, 'no-pointless-reassignment': noPointlessReassignment, 'no-side-effects-in-index': noSideEffectsInIndex } } },
    rules: { 'local/no-non-barrel-index': 'error', 'local/no-pointless-reassignment': 'error' },
  },
  {
    // Re-exports belong only in src/index.ts, the public barrel -- a re-export anywhere else risks silently surfacing the wrong thing under a name a consumer expects to mean something else. Two rules, not one: the AST-selector ban below catches the single-statement forms (export * from / export {x} from); local/no-non-barrel-reexport catches the same coupling split across an import and a bare export instead, which neither selector can see since it needs to correlate two separate statements.
    files: ['src/**/*.ts'],
    ignores: [
      'src/index.ts',
      'src/odf-package/manifest.ts', // deliberate pure re-export of odf.js's own manifest read/build/write/sync/validate functions -- odf.js already owns META-INF/manifest.xml end to end (see this file's own top comment)
      'src/model/geometry.ts', // deliberate re-export of document-schema.js's Box/Margins/PageSize under documents.js's own established names, so every existing local caller keeps resolving them unchanged
      'src/model/style.ts', // deliberate re-export of document-schema.js's Alignment/LayoutFont under documents.js's own established names, for the same reason as geometry.ts above
      'src/model/color.ts', // deliberate re-export/alias of document-schema.js's Color as documents.js's own established LayoutColor name, for the same reason as geometry.ts above
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportAllDeclaration', message: 'Re-exports belong only in src/index.ts (the public barrel). Define or import this locally instead.' },
        { selector: 'ExportNamedDeclaration[source]', message: 'Re-exports belong only in src/index.ts (the public barrel). Define or import this locally instead.' },
      ],
      'local/no-non-barrel-reexport': 'error',
    },
  },
  {
    // The structural counterpart to the re-export ban above: that rule says re-exports belong only in src/index.ts, this one says src/index.ts may contain only re-exports -- together pinning the barrel to exactly one shape, one that can never have a side effect at import time.
    files: ['src/index.ts'],
    rules: { 'local/no-side-effects-in-index': 'error' },
  },
  {
    // Static Worker-isomorphism guard for runtime src: this package's runtime code must run unchanged in a Cloudflare Worker (no Node-only builtins or globals), mirroring the runtime enforcement the vitest workers pool already applies at test time. Test files and src/test-support/** legitimately use node:fs etc for fixtures and are not published, so they are exempt here -- the runtime surface alone is what matters.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/test-support/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'node:*/**'], message: 'This is a Worker-isomorphic library: node:* imports are banned in runtime src. Use a Web API or an isomorphic helper.' },
            // `regex` (not `group`) for the bare-builtins list: the `group` matcher uses gitignore semantics and normalises `./util` to `util`, which would false-positive on this package's own relative `./util` imports (src/edit/pdf/util.ts, src/edit/pdf/page.ts). An anchored regex matches only the exact bare specifier, which is the actual Node-builtin surface.
            { regex: '^(fs|path|crypto|child_process|os|net|http|https|stream|util|buffer|url|zlib|readline|worker_threads|timers|events|assert)$', message: 'This is a Worker-isomorphic library: bare Node builtin imports are banned in runtime src. Use a Web API or an isomorphic helper.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'Buffer', message: 'Buffer is Node-only; this Worker-isomorphic library uses Uint8Array.' }],
    },
  },
);
