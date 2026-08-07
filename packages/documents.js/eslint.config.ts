import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import exadevRecommendedTypeChecked from '@exadev/eslint-config';

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
  // Bundles typescript-eslint's own recommendedTypeChecked + stylisticTypeChecked (recommendedTypeChecked already subsumes plain tseslint.configs.recommended outright -- every one of its 46 rules is a strict subset of recommendedTypeChecked's 73), this package's own four exadev/* rules (self-scoped internally to the barrel, so no files/ignores wiring is needed here), linterOptions.noInlineConfig, consistent-type-assertions banning all type assertions, and ban-ts-comment banning @ts-expect-error outright alongside the preset's own existing @ts-ignore/@ts-nocheck bans -- both relaxed automatically in *.test.ts/*.spec.ts files. See @exadev/eslint-config's own README for the full rule set and rationale. The hand-written PDF codec (now the external pdf-codec dependency, formerly src/pdf/) established the no-type-assertions pattern by narrowing third-party-shaped values through PdfObject's own `kind` discriminant rather than a cast; every other module in this package follows the same convention.
  ...exadevRecommendedTypeChecked,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // This package's src/index.ts is its public entry point (package.json exports), so it keeps one barrel: override the default 'banned' barrel-policy to 'single'. The umbrella catches both single- and split-statement re-exports outside src/index.ts, replacing the hand-rolled no-restricted-syntax + no-non-barrel-reexport wiring this config used to carry.
      'exadev/barrel-policy': ['error', { mode: 'single' }],
    },
  },
  {
    // Four non-barrel files deliberately re-export from sibling packages (odf.js / document-schema.js) under documents.js's own established names -- the barrel-policy umbrella flags re-exports outside src/index.ts, so these repo-specific exceptions turn it off for exactly those files.
    files: ['src/odf-package/manifest.ts', 'src/model/geometry.ts', 'src/model/style.ts', 'src/model/color.ts'],
    rules: { 'exadev/barrel-policy': 'off' },
  },
  {
    // Static Worker-isomorphism guard for runtime src: this package's runtime code must run unchanged in a Cloudflare Worker (no Node-only builtins or globals), mirroring the runtime enforcement the vitest workers pool already applies at test time. Test files and src/test-support/** legitimately use node:fs etc for fixtures and are not published, so they are exempt here -- as is src/bin.ts, the launcher entry point, which spawns child processes (npx/pnpm/yarn/bunx) and so is Node-only by definition; it is an executed entry, never imported into the worker-isomorphic runtime, so exempting it leaves the importable surface pure. The runtime surface alone is what matters.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/test-support/**', 'src/bin.ts'],
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
