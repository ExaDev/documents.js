import js from '@eslint/js';
import exadevRecommendedTypeChecked from '@exadev/eslint-config';
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
  // Bundles typescript-eslint's own recommendedTypeChecked + stylisticTypeChecked (recommendedTypeChecked already subsumes plain tseslint.configs.recommended outright -- every one of its 46 rules is a strict subset of recommendedTypeChecked's 73), this package's own four exadev/* rules (self-scoped internally to the barrel, so no files/ignores wiring is needed here), linterOptions.noInlineConfig, consistent-type-assertions banning all type assertions, and ban-ts-comment banning @ts-expect-error outright alongside the preset's own existing @ts-ignore/@ts-nocheck bans -- both relaxed automatically in *.test.ts/*.spec.ts files. See @exadev/eslint-config's own README for the full rule set and rationale.
  ...exadevRecommendedTypeChecked,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // This package's src/index.ts is its public entry point (package.json exports), so it keeps one barrel: override the default 'banned' barrel-policy to 'single'. The umbrella catches both single- and split-statement re-exports outside src/index.ts, replacing the hand-rolled no-restricted-syntax block this config used to carry.
      'exadev/barrel-policy': ['error', { mode: 'single' }],
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
