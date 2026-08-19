import js from '@eslint/js';
import exadevRecommendedTypeChecked from '@exadev/eslint-config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
  // Bundles typescript-eslint's own recommendedTypeChecked + stylisticTypeChecked (recommendedTypeChecked already subsumes plain tseslint.configs.recommended outright -- every one of its 46 rules is a strict subset of recommendedTypeChecked's 73), this package's own four exadev/* rules (self-scoped internally to the barrel, so no files/ignores wiring is needed here), linterOptions.noInlineConfig, consistent-type-assertions banning all type assertions, and ban-ts-comment banning @ts-expect-error outright alongside the preset's own existing @ts-ignore/@ts-nocheck bans -- both relaxed automatically in *.test.ts/*.spec.ts files. See @exadev/eslint-config's own README for the full rule set and rationale.
  ...exadevRecommendedTypeChecked,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // This package's src/index.ts is its public entry point (package.json exports), so it keeps one barrel: override the default 'banned' barrel-policy to 'single'. The umbrella catches both single- and split-statement re-exports outside src/index.ts, replacing the hand-rolled no-restricted-syntax + no-non-barrel-reexport wiring this config used to carry.
      'exadev/barrel-policy': ['error', { mode: 'single' }],
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
