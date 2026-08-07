import js from '@eslint/js';
import exadevRecommendedTypeChecked from '@exadev/eslint-config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // test/smoke.test.mjs imports from ../dist, a build artefact that may not exist at lint time and is deliberately outside tsconfig's "src" program (it tests the built output, not the source) -- see its own top-of-file comment and CLAUDE.md.
    ignores: ['dist', 'coverage', 'node_modules', 'test', 'scripts'],
  },
  {
    // Pin the TSConfig root so the parser isn't confused by stray tsconfig.json files elsewhere in the tree. Required because lint-staged runs eslint at commit time.
    //
    // The type-checked rules below need each linted file assigned to a TS program. This repo runs two disjoint programs: `tsconfig.json` is the vendor-neutral web-only gate (lib ES2024+WebWorker, no @types/node) covering runtime src, and `tsconfig.node.json` covers tests, test-support, and root config files under Node types. The TS language service's projectService only auto-discovers `tsconfig.json`, so files exclusive to `tsconfig.node.json` would be unaffiliated; `project` lists both programs explicitly and matches each file to the one that includes it -- which also means eslint's type-checked tier enforces the web gate on runtime src itself.
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
    // Worker-isomorphism guard: this codec runs in Cloudflare Workers (see test:workers in package.json and the workerd CI job), so runtime src statically bans node:* imports, bare Node builtin imports, and the Buffer global. Test files and src/test-support legitimately use node:fs for fixtures and are exempt -- they are not published. A pre-audit confirmed every runtime src module is already node-free, so this is a guardrail against regressions, not a migration.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/test-support/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'node:*/**'], message: 'This is a Worker-isomorphic library: node:* imports are banned in runtime src. Use a Web API or an isomorphic helper.' },
            // Bare builtins use an anchored regex rather than `group`: no-restricted-imports `group` matches via the `ignore` package (gitignore semantics), which strips a leading `./` and matches path segments, so a `group: ['util']` entry false-positives on this repo's own `./util/base64` and `./util/abort` relative imports. The regex is tested against the raw import source (which keeps its `./` prefix), so `^util$` matches a real `import 'util'` but not `import './util/base64'`.
            { regex: '^(fs|path|crypto|child_process|os|net|http|https|stream|util|buffer|url|zlib|readline|worker_threads|timers|events|assert)(/.*)?$', message: 'This is a Worker-isomorphic library: bare Node builtin imports are banned in runtime src. Use a Web API or an isomorphic helper.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'Buffer', message: 'Buffer is Node-only; this Worker-isomorphic library uses Uint8Array.' }],
    },
  },
);
