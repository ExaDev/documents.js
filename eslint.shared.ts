import js from '@eslint/js';
import exadevRecommendedTypeChecked from '@exadev/eslint-config';
import globals from 'globals';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

/**
 * The lint configuration every package in this workspace shares, as a function rather than a static array.
 *
 * A static array would not work here: the real per-package variation is structural, not cosmetic. Which TSConfig programs a package runs, whether it is Worker-isomorphic, and what its barrel policy is are all genuinely different between packages, and each one has to reach the parser or rule wiring. Those are the parameters below.
 *
 * What is NOT parameterised is the rule set itself. Before this file existed the thirteen package configs had drifted into three incompatible tiers -- four packages ran no type-aware linting at all, two hand-inlined their own approximation of it, and seven used the shared preset -- so a rule added "everywhere" reached seven packages and a Worker-isomorphism guard could be silently absent from a package that needed it. Every package now gets the same rules; only the wiring differs.
 */

/**
 * Node's own builtin module list, reduced to base specifiers.
 *
 * The ban list this replaces was eighteen names written out by hand, which left most of Node's surface unguarded: a bare `import dns from 'dns'` in a Worker-isomorphic package passed the guard, as did `cluster`, `tls`, `vm`, `v8`, `repl`, and the rest. Deriving the list from `builtinModules` closes that gap permanently and keeps it closed as Node adds modules.
 *
 * `_`-prefixed entries are deprecated internals nobody imports deliberately, and `node:`-prefixed entries are covered by the separate `node:*` group pattern below -- some of them (`node:test`) exist only in prefixed form and have no bare spelling to ban. Subpaths collapse to their base (`fs/promises` to `fs`) because the pattern below matches subpaths through its own suffix group.
 */
const nodeBuiltinBaseModules: readonly string[] = [
  ...new Set(
    builtinModules
      .filter((name) => !name.startsWith('_') && !name.startsWith('node:'))
      .map((name) => (name.includes('/') ? name.slice(0, name.indexOf('/')) : name)),
  ),
].sort();

/**
 * Matches a bare Node builtin specifier and any subpath of one.
 *
 * `regex`, not `group`. `no-restricted-imports` matches `group` entries through the `ignore` package, i.e. gitignore semantics over path segments, so a `group: ['util']` entry also matches this workspace's own relative `./util/base64` and `../util` imports -- a false positive several packages hit and worked around inconsistently, some by switching to a regex and some by leaving the bug in place. The regex is tested against the raw specifier, which keeps its `./` prefix, so `^util$` matches `import 'util'` and never `import './util/base64'`.
 */
const bareNodeBuiltinPattern = `^(${nodeBuiltinBaseModules.join('|')})(/.*)?$`;

const isomorphicNodeImportMessage =
  'This is a Worker-isomorphic library: node:* imports are banned in runtime src. Use a Web API or an isomorphic helper.';
const isomorphicBareBuiltinMessage =
  'This is a Worker-isomorphic library: bare Node builtin imports are banned in runtime src. Use a Web API or an isomorphic helper.';
const isomorphicBufferMessage = 'Buffer is Node-only; this Worker-isomorphic library uses Uint8Array.';

/** Build output, dependencies, coverage reports, and the smoke suite -- which imports from `../dist`, a build artefact deliberately outside every package's TSConfig program because it tests built output rather than source. */
const alwaysIgnored: readonly string[] = ['dist', 'coverage', 'node_modules', 'test'];

/** `exadev/barrel-policy`'s own modes, plus `off` for a package whose file layout the rule cannot describe. */
export type BarrelPolicy = 'banned' | 'single' | 'siblings' | 'off';

export interface PackageLintOptions {
  /** Always `import.meta.dirname` from the calling package's own `eslint.config.ts`. Pins the TSConfig root so the parser is not confused by another package's tsconfig elsewhere in the tree, which matters because lint-staged runs eslint at commit time. */
  readonly tsconfigRootDir: string;

  /**
   * The TSConfig programs to resolve linted files against, relative to the package.
   *
   * Defaults to the dual-program layout every library package here uses: `tsconfig.json` is the web-only gate (lib ES2024+WebWorker, `types: []`, tests excluded) that makes the isomorphism constraint a type-level fact rather than only a lint rule, and `tsconfig.node.json` covers tests, test-support, and config files under Node types.
   *
   * `project`, not `projectService`, and that is load-bearing for the dual layout: the project service only ever assigns a file to its nearest `tsconfig.json`, so files that exist solely in `tsconfig.node.json` end up unaffiliated and every type-aware rule crashes on them. Listing both programs explicitly routes each file to the one that includes it. A package with a single program covering everything (the CLI and MCP server) passes just that one.
   */
  readonly projects?: readonly string[];

  /** Appended to the always-ignored set above, for paths only this package has -- a `scripts/` directory that imports from `../dist`, a generated router tree, a test-report directory. */
  readonly additionalIgnores?: readonly string[];

  /**
   * Whether this package is Worker-isomorphic, i.e. its published `src/` must run unchanged in a Cloudflare Worker or a browser.
   *
   * True for every foundation and format-codec package; false for the CLI, the MCP server, and the web UI, which legitimately target Node or a browser rather than needing portability between them. When true, runtime `src/` is barred from importing `node:*` or a bare Node builtin and from using the `Buffer` global. Test files and test-support are exempt: they are not published and read fixtures off disk.
   */
  readonly isomorphic?: boolean;

  /** Defaults to `single` -- every published package here exposes exactly one barrel at `src/index.ts`, named in its `exports` map. */
  readonly barrelPolicy?: BarrelPolicy;
}

export function packageLintConfig(options: PackageLintOptions): ReturnType<typeof tseslint.config> {
  const {
    tsconfigRootDir,
    projects = ['./tsconfig.json', './tsconfig.node.json'],
    additionalIgnores = [],
    isomorphic = false,
    barrelPolicy = 'single',
  } = options;

  return tseslint.config(
    { ignores: [...alwaysIgnored, ...additionalIgnores] },
    {
      languageOptions: {
        parserOptions: { project: [...projects], tsconfigRootDir },
        globals: { ...globals.node },
      },
    },
    js.configs.recommended,
    // Bundles typescript-eslint's recommendedTypeChecked and stylisticTypeChecked (recommendedTypeChecked already subsumes plain recommended outright), the exadev/* rules, linterOptions.noInlineConfig, consistent-type-assertions banning every type assertion, and ban-ts-comment banning @ts-expect-error alongside the preset's @ts-ignore/@ts-nocheck bans -- the last two relaxed automatically in test files. See @exadev/eslint-config's own README for the full set.
    ...exadevRecommendedTypeChecked,
    {
      rules: {
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        'exadev/barrel-policy': barrelPolicy === 'off' ? 'off' : ['error', { mode: barrelPolicy }],
      },
    },
    ...(isomorphic
      ? tseslint.config({
          // The static half of the isomorphism guarantee. The workerd suite (pnpm test:workers) proves the same property dynamically, but only over the paths a test actually exercises; this catches an offending import at lint time on every file, before any test runs.
          files: ['src/**/*.ts'],
          ignores: ['src/**/*.test.ts', 'src/test-support/**'],
          rules: {
            'no-restricted-imports': [
              'error',
              {
                patterns: [
                  { group: ['node:*', 'node:*/**'], message: isomorphicNodeImportMessage },
                  { regex: bareNodeBuiltinPattern, message: isomorphicBareBuiltinMessage },
                ],
              },
            ],
            'no-restricted-globals': ['error', { name: 'Buffer', message: isomorphicBufferMessage }],
          },
        })
      : []),
  );
}
