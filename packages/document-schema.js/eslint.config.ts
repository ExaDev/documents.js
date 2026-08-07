import js from '@eslint/js';
import exadev from '@exadev/eslint-config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // test/smoke.test.mjs imports from ../dist, a build artefact that may not exist at lint time and is deliberately outside tsconfig's "src" program (it tests the built output, not the source) -- see its own top-of-file comment and CLAUDE.md. scripts/generate-json-schemas.mjs is the same kind of standalone build step, also importing from ../dist -- matching pdf-codec's own eslint.config.ts precedent for its scripts/ directory.
    ignores: ['dist', 'coverage', 'node_modules', 'test', 'scripts'],
  },
  {
    // Pin the TSConfig root so the parser isn't confused by stray tsconfig.json files elsewhere in the tree. Required because lint-staged runs eslint at commit time.
    //
    // The type-checked rules need a TypeScript program per file. `project` (not `projectService`) is used because the runtime-vs-test split means no single nearest `tsconfig.json` covers every file: `src` runtime is in the web-only `tsconfig.json` (the isomorphism gate, no `@types/node`), and the test/config/eslint-rules files live only in `tsconfig.node.json` (under Node types). `projectService` only ever assigns a file to its nearest `tsconfig.json`, so those node-only files would be "not found by the project service"; listing both tsconfigs explicitly in `project` resolves each file to the program that contains it.
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json', './tsconfig.node.json'], tsconfigRootDir: import.meta.dirname },
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
    // These four rules are sourced from the published @exadev/eslint-config package rather than kept as local per-repo copies.
    plugins: { exadev },
    rules: { 'exadev/no-pointless-reassignment': 'error', 'exadev/no-non-barrel-index': 'error' },
  },
  {
    // The structural counterpart to the re-export ban below: that rule says re-exports belong only in src/index.ts, this one says src/index.ts may contain only re-exports -- together pinning the barrel to exactly one shape, one that can never have a side effect at import time.
    files: ['src/index.ts'],
    rules: { 'exadev/no-side-effects-in-index': 'error' },
  },
  {
    // Re-exports belong only in src/index.ts, the public barrel -- a re-export anywhere else risks silently surfacing the wrong thing under a name a consumer expects to mean something else (e.g. this package's own ContentDocumentSchema colliding conceptually with documents.js's differently-shaped, same-named local schema).
    files: ['src/**/*.ts'],
    ignores: ['src/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportAllDeclaration', message: 'Re-exports belong only in src/index.ts (the public barrel). Define or import this locally instead.' },
        { selector: 'ExportNamedDeclaration[source]', message: 'Re-exports belong only in src/index.ts (the public barrel). Define or import this locally instead.' },
      ],
      'exadev/no-non-barrel-reexport': 'error',
    },
  },
  {
    // Static Worker-isomorphism guard for runtime src: this package runs inside Cloudflare Workers (workerd) and browser environments, so Node-only builtins and the Buffer global are banned from published code. Test files and src/test-support/** legitimately use node:fs for fixtures -- they are not published and are exempt here.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/test-support/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['node:*', 'node:*/**'], message: 'This is a Worker-isomorphic library: node:* imports are banned in runtime src. Use a Web API or an isomorphic helper.' },
          { group: ['fs', 'path', 'crypto', 'child_process', 'os', 'net', 'http', 'https', 'stream', 'util', 'buffer', 'url', 'zlib', 'readline', 'worker_threads', 'timers', 'events', 'assert'], message: 'This is a Worker-isomorphic library: bare Node builtin imports are banned in runtime src. Use a Web API or an isomorphic helper.' },
        ],
      }],
      'no-restricted-globals': ['error', { name: 'Buffer', message: 'Buffer is Node-only; this Worker-isomorphic library uses Uint8Array.' }],
    },
  },
);
