import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noNonBarrelIndex from './eslint-rules/no-non-barrel-index.js';
import noPointlessReassignment from './eslint-rules/no-pointless-reassignment.js';
import noSideEffectsInIndex from './eslint-rules/no-side-effects-in-index.js';

export default tseslint.config(
  {
    // test/smoke.test.mjs imports from ../dist, a build artefact that may not exist at lint time and is deliberately outside tsconfig's "src" program (it tests the built output, not the source) -- see its own top-of-file comment and CLAUDE.md.
    ignores: ['dist', 'coverage', 'node_modules', 'test', 'scripts'],
  },
  {
    // Pin the TSConfig root so the parser isn't confused by stray tsconfig.json files elsewhere in the tree. Required because lint-staged runs eslint at commit time.
    //
    // `projectService` (global -- no `files` filter) powers the type-checked rules below; it must apply to every matched file or the type-checked configs crash on files outside the program.
    //
    // Two tsconfigs now exist: tsconfig.json is the vendor-neutral WEB gate (lib ES2024+WebWorker, types []), covering runtime src only; tsconfig.node.json covers the test files, test-support, the custom eslint rules, and the root config files under Node types. The TS project service discovers only tsconfig.json (the default-name config) by walking up from each file, so it resolves every runtime-src file to the web program automatically -- but a file tsconfig.json excludes (every test/config/eslint-rules file) is "not found" unless it is explicitly routed to the node program. `defaultProject` + `allowDefaultProject` is that routing: each non-src file falls back to tsconfig.node.json, so it still gets full type-checked lint under Node types (matching the model "runtime src -> web program, test/config files -> node program"). allowDefaultProject forbids `**`, so test files are matched by depth (src/*.test.ts for the top-level ones, src/*/*.test.ts for the per-module ones); the threshold is raised past its default of 8 because this repo legitimately routes its whole non-src surface through the node default project.
    languageOptions: {
      parserOptions: {
        projectService: {
          defaultProject: 'tsconfig.node.json',
          allowDefaultProject: ['src/*.test.ts', 'src/*/*.test.ts', 'src/test-support/*.ts', '*.config.ts', 'eslint-rules/*.ts'],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 64,
        },
        tsconfigRootDir: import.meta.dirname,
      },
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
      // No type assertions anywhere: this codec narrows a raw markdown scan/parse result through its own AST node `kind` discriminant (or a type guard) instead -- never `as`. Use a guard or a Zod parse at the boundary rather than asserting.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    // Runtime src is Worker-isomorphic (this codec runs unchanged in Cloudflare Workers -- see vitest.workers.config.ts and the Workers-runtime test job in CI), so it must not import node:* / bare Node builtins or use the Node-only Buffer global. Test files and test-support legitimately use node:fs for fixtures and are not published, so they are exempt. The markdown-library import ban below lives in this same src-scoped object (rather than a global one) because flat config replaces -- not merges -- a same-key rule: a separate node-only no-restricted-imports here would silently clobber the markdown ban for runtime src.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/test-support/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // This package hand-writes its own CommonMark+GFM scanner/parser/renderer, the same way pdf-codec hand-writes its own PDF codec instead of wrapping pdf-lib/pdfjs-dist/mupdf -- pulling in any existing markdown library here would defeat the entire reason this package exists (a dependency-free, fully auditable implementation). Banned by name, not by guessing at import specifiers: every module of every one of these libraries is blocked, not just their main entry point.
            { group: ['micromark*', 'micromark*/**'], message: 'Hand-write the scanner/parser instead of depending on micromark -- see README Architecture.' },
            { group: ['remark*', 'remark*/**'], message: 'Hand-write the AST/transform instead of depending on remark -- see README Architecture.' },
            { group: ['marked', 'marked/**'], message: 'Hand-write the parser/renderer instead of depending on marked -- see README Architecture.' },
            { group: ['markdown-it*', 'markdown-it*/**'], message: 'Hand-write the parser/renderer instead of depending on markdown-it -- see README Architecture.' },
            { group: ['commonmark', 'commonmark/**'], message: 'Hand-write the CommonMark parser instead of depending on the commonmark.js reference implementation -- see README Architecture.' },
            { group: ['mdast*', 'mdast*/**'], message: 'Define this package\'s own AST types instead of depending on mdast -- see README Architecture.' },
            { group: ['unified', 'unified/**'], message: 'Hand-write the pipeline instead of depending on unified -- see README Architecture.' },
            { group: ['turndown', 'turndown/**'], message: 'Hand-write the HTML-to-markdown conversion instead of depending on turndown -- see README Architecture.' },
            { group: ['showdown', 'showdown/**'], message: 'Hand-write the parser/renderer instead of depending on showdown -- see README Architecture.' },
            { group: ['node:*', 'node:*/**'], message: 'This is a Worker-isomorphic library: node:* imports are banned in runtime src. Use a Web API or an isomorphic helper.' },
            { group: ['fs', 'path', 'crypto', 'child_process', 'os', 'net', 'http', 'https', 'stream', 'util', 'buffer', 'url', 'zlib', 'readline', 'worker_threads', 'timers', 'events', 'assert'], message: 'This is a Worker-isomorphic library: bare Node builtin imports are banned in runtime src. Use a Web API or an isomorphic helper.' },
          ],
        },
      ],
      // no-restricted-globals takes each restriction as a separate option element after the severity (not wrapped in an inner array) -- see the rule's arrayOfGlobals schema. Only Buffer is banned; typeof-process checks remain legitimate (the import ban above catches the real node: surface).
      'no-restricted-globals': ['error', { name: 'Buffer', message: 'Buffer is Node-only; this Worker-isomorphic library uses Uint8Array.' }],
    },
  },
  {
    // Local custom rule (eslint-rules/no-pointless-reassignment.ts) -- not published as a package, matching this family's own convention of keeping shared dev-tooling config as identical per-repo copies rather than a shared devDependency.
    plugins: { local: { rules: { 'no-non-barrel-index': noNonBarrelIndex, 'no-pointless-reassignment': noPointlessReassignment, 'no-side-effects-in-index': noSideEffectsInIndex } } },
    rules: { 'local/no-non-barrel-index': 'error', 'local/no-pointless-reassignment': 'error' },
  },
  {
    // Re-exports belong only in src/index.ts, the public barrel -- a re-export anywhere else risks silently surfacing the wrong thing under a name a consumer expects to mean something else.
    files: ['src/**/*.ts'],
    ignores: ['src/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportAllDeclaration', message: 'Re-exports belong only in src/index.ts (the public barrel). Define or import this locally instead.' },
        { selector: 'ExportNamedDeclaration[source]', message: 'Re-exports belong only in src/index.ts (the public barrel). Define or import this locally instead.' },
      ],
    },
  },
  {
    // The structural counterpart to the re-export ban above: that rule says re-exports belong only in src/index.ts, this one says src/index.ts may contain only re-exports -- together pinning the barrel to exactly one shape, one that can never have a side effect at import time.
    files: ['src/index.ts'],
    rules: { 'local/no-side-effects-in-index': 'error' },
  },
);
