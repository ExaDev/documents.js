import js from "@eslint/js";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import depend from "eslint-plugin-depend";
import yml from "eslint-plugin-yml";
import exadevRecommendedTypeChecked from "@exadev/eslint-config";
import globals from "globals";
import { builtinModules } from "node:module";
import tseslint from "typescript-eslint";

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
      .filter((name) => !name.startsWith("_") && !name.startsWith("node:"))
      .map((name) =>
        name.includes("/") ? name.slice(0, name.indexOf("/")) : name,
      ),
  ),
].sort();

/**
 * Matches a bare Node builtin specifier and any subpath of one.
 *
 * `regex`, not `group`. `no-restricted-imports` matches `group` entries through the `ignore` package, i.e. gitignore semantics over path segments, so a `group: ['util']` entry also matches this workspace's own relative `./util/base64` and `../util` imports -- a false positive several packages hit and worked around inconsistently, some by switching to a regex and some by leaving the bug in place. The regex is tested against the raw specifier, which keeps its `./` prefix, so `^util$` matches `import 'util'` and never `import './util/base64'`.
 */
const bareNodeBuiltinPattern = `^(${nodeBuiltinBaseModules.join("|")})(/.*)?$`;

const isomorphicNodeImportMessage =
  "This is a Worker-isomorphic library: node:* imports are banned in runtime src. Use a Web API or an isomorphic helper.";
const isomorphicBareBuiltinMessage =
  "This is a Worker-isomorphic library: bare Node builtin imports are banned in runtime src. Use a Web API or an isomorphic helper.";
const isomorphicBufferMessage =
  "Buffer is Node-only; this Worker-isomorphic library uses Uint8Array.";

/**
 * Linting for the data and prose files that sit beside the code -- JSON, Markdown, and YAML -- defined once and used by both the workspace root's config and every package's.
 *
 * Defined here rather than only at the root, because a root config cannot reach these files usefully. `eslint .` from the workspace root has to walk the whole tree to find them, and the tree contains a 400 MB turbo cache, every package's node_modules, and this workspace's binary document fixtures; several of these plugins also ship with no `files` restriction at all, which makes every path a lint target. The result exhausted a 4 GB heap rather than finishing. Running the identical rules from inside each package instead keeps every run scoped to one small directory, and turbo runs the thirteen concurrently.
 *
 * One definition, thirteen call sites -- which is the property that matters. It is not thirteen copies of a decision.
 */
/**
 * `@eslint/json`'s own language option, which ESLint's core `LanguageOptions` type does not model -- it declares no index signature, so writing the key inline is an excess property. Held in a bag typed for what it is (a language's own options, whose shape belongs to the plugin) rather than asserted past the core type.
 */
const jsoncLanguageOptions: Record<string, unknown> = {
  allowTrailingCommas: true,
};

export const dataFileLintConfig: ReturnType<typeof tseslint.config> =
  tseslint.config(
    // Plain JSON: no comments, no trailing commas.
    {
      files: ["**/*.json"],
      ignores: ["**/tsconfig*.json", "**/turbo.json"],
      plugins: { json },
      language: "json/json",
      extends: [json.configs.recommended],
    },

    // JSONC, for the three families that genuinely carry comments -- established by grep, not assumed. turbo.json documents its own pipeline inline; every tsconfig*.json carries explanatory comments (TypeScript has always permitted them); wrangler.jsonc says so in its extension. Parsed as plain JSON, every one of those comments is a syntax error.
    {
      files: ["**/*.jsonc", "**/tsconfig*.json", "**/turbo.json"],
      plugins: { json },
      language: "json/jsonc",
      // A trailing comma is part of what JSONC is, and every consumer of these particular files accepts one: TypeScript in a tsconfig, turbo in its own pipeline file, wrangler's jsonc-parser in a Worker config. Prettier writes one, so the language has to admit it or the two disagree permanently and each of these files fails to parse instead of being checked.
      languageOptions: jsoncLanguageOptions,
      extends: [json.configs.recommended],
    },

    // Markdown. The recommended set is structural -- no empty links, no duplicate H1, no reversed link syntax -- rather than stylistic, so it does not argue with how the prose is written.
    ...markdown.configs.recommended,
    {
      // Off: this workspace's prose uses square brackets for things that are not reference links, and the rule cannot tell the difference. A GFM task list is written `- [ ] item`, and the READMEs cite specifications by bracketed short name (`[MS-CFB]`, `[MS-OLEDS]`). Both are correct as written; every report from this rule here was one of the two.
      files: ["**/*.md"],
      rules: { "markdown/no-missing-label-refs": "off" },
    },

    // YAML. Each entry gets an explicit `files`: two of the three the plugin ships set none, which would make every path in the repository a YAML lint target.
    ...yml.configs["flat/recommended"].map((config) => ({
      ...config,
      files: ["**/*.{yml,yaml}"],
    })),
    {
      // A GitHub workflow trigger with no filters is a bare key -- `pull_request:` means "every pull request", `workflow_dispatch:` means "manually runnable". The value is genuinely absent, which is what the schema expects, so this rule reports correct YAML as a defect. Scoped to .github/ rather than off outright, since an accidentally empty value elsewhere usually is a mistake.
      files: [".github/**/*.{yml,yaml}"],
      rules: { "yml/no-empty-mapping-value": "off" },
    },

    // Flags a dependency a native API or a lighter package now covers.
    //
    // The plugin and the one rule are registered directly rather than by spreading the shipped `flat/recommended`. That preset sets no `files`, so it would apply to every path in the package, and its `configs` is typed as possibly-undefined -- naming the rule states exactly what is switched on and needs no narrowing of a third-party shape.
    {
      files: ["**/package.json"],
      plugins: { depend },
      rules: {
        // lint-staged is allowed deliberately. The rule suggests a lighter alternative, which is reasonable advice in general, but this workspace's pre-commit hook is built around it, and swapping a working tool for a lint opinion is not a dependency decision worth making here.
        "depend/ban-dependencies": ["error", { allowed: ["lint-staged"] }],
      },
    },
  );

/** Build output, dependencies, coverage reports, and the smoke suite -- which imports from `../dist`, a build artefact deliberately outside every package's TSConfig program because it tests built output rather than source. */
const alwaysIgnored: readonly string[] = [
  "dist",
  "coverage",
  "node_modules",
  "test",
  // AGENTS.md and CLAUDE.md are symlinks to README.md in every package, so linting all three lints one file three times.
  "AGENTS.md",
  "CLAUDE.md",
  // Written by semantic-release on every release; reformatting it would fight the release pipeline.
  "CHANGELOG.md",
  // Vendored third-party corpora (the CommonMark and GFM specs, the WHATWG entity table), each carrying its own NOTICE.md recording source and licence, kept byte-for-byte as published.
  "assets",
  // Generated: examples by GENERATE_EXAMPLES, schemas by document-schema.js's own build step.
  "examples",
  "schemas",
];

/** `exadev/barrel-policy`'s own modes, plus `off` for a package whose file layout the rule cannot describe. */
export type BarrelPolicy = "banned" | "single" | "siblings" | "off";

/** One `no-restricted-imports` pattern entry: a gitignore-semantics `group`, or an anchored `regex` tested against the raw specifier. */
export interface RestrictedImportPattern {
  readonly group?: readonly string[];
  readonly regex?: string;
  readonly message: string;
}

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

  /**
   * Whether to put Node's globals in scope for every linted file. Defaults to true.
   *
   * True suits every library package here, including the Worker-isomorphic ones: what enforces their portability is the import ban and the web-only TSConfig program, not the absence of ambient global types. The web UI passes false and scopes browser, worker, and Node globals to the layers that actually have them -- handing that app Node globals everywhere would let a `process.env` read in browser code lint clean.
   */
  readonly nodeGlobals?: boolean;

  /**
   * Extra `no-restricted-imports` patterns, merged into the same rule the isomorphism guard writes.
   *
   * They have to be merged rather than declared in the calling package, because flat config REPLACES a same-key rule instead of merging it: a package that declared its own `no-restricted-imports` over the same files would silently drop the Node-builtin ban and keep passing. markdown-codec is the case this exists for -- it bans every third-party markdown library over exactly the files the isomorphism guard covers.
   */
  readonly additionalRestrictedImportPatterns?: readonly RestrictedImportPattern[];

  /**
   * Runtime `src/` paths that are exempt from the isomorphism guard, on top of the test files and test-support it always exempts.
   *
   * For an executed entry point rather than an importable one: `documents.js`'s `src/bin.ts` is a launcher that spawns `npx`/`pnpm`/`yarn`/`bunx`, so it is Node-only by definition. It is never imported into the isomorphic surface, so exempting it leaves that surface pure -- and the package's own `tsconfig.node.json` already routes it to the Node program, so the two agree.
   */
  readonly isomorphicExemptions?: readonly string[];

  /**
   * Whether `no-non-null-assertion` is enforced. Defaults to `'error'`.
   *
   * `strictTypeChecked` turns this on, and it is the single largest source of violations in this workspace by an order of magnitude -- 2,395 sites, of which `documents.js` and `pdf-codec` hold 91% between them. Clearing one is not mechanical: a `!` marks a place where the code asserts a value is present, and removing it honestly means deciding what the absence means and handling it at the right boundary, not substituting a sentinel.
   *
   * So a package carrying more than can be worked through carefully sets `'off'` here, in its own config where the debt is visible rather than buried in this file, and is tracked for burn-down. Every other package enforces it.
   */
  readonly nonNullAssertion?: "error" | "off";
}

export function packageLintConfig(
  options: PackageLintOptions,
): ReturnType<typeof tseslint.config> {
  const {
    tsconfigRootDir,
    projects = ["./tsconfig.json", "./tsconfig.node.json"],
    additionalIgnores = [],
    isomorphic = false,
    barrelPolicy = "single",
    nodeGlobals = true,
    additionalRestrictedImportPatterns = [],
    isomorphicExemptions = [],
    nonNullAssertion = "error",
  } = options;

  const typeScriptFiles = ["**/*.ts", "**/*.tsx"];

  const runtimeSrcExemptions = [
    "src/**/*.test.ts",
    "src/test-support/**",
    ...isomorphicExemptions,
  ];

  const restrictedImportPatterns: readonly RestrictedImportPattern[] = [
    ...additionalRestrictedImportPatterns,
    ...(isomorphic
      ? [
          {
            group: ["node:*", "node:*/**"],
            message: isomorphicNodeImportMessage,
          },
          {
            regex: bareNodeBuiltinPattern,
            message: isomorphicBareBuiltinMessage,
          },
        ]
      : []),
  ];

  return tseslint.config(
    { ignores: [...alwaysIgnored, ...additionalIgnores] },
    {
      // Every TypeScript rule below is scoped to TypeScript files. Without this the parser project and the JS/TS rule sets apply to the JSON, Markdown, and YAML files too -- the TS parser cannot read them, and a core rule like no-irregular-whitespace crashes outright on a JSON AST rather than reporting anything.
      files: typeScriptFiles,
      languageOptions: {
        parserOptions: { project: [...projects], tsconfigRootDir },
        ...(nodeGlobals ? { globals: { ...globals.node } } : {}),
      },
      extends: [
        js.configs.recommended,
        // Bundles typescript-eslint's recommendedTypeChecked and stylisticTypeChecked (recommendedTypeChecked already subsumes plain recommended outright), the exadev/* rules, linterOptions.noInlineConfig, consistent-type-assertions banning every type assertion, and ban-ts-comment banning @ts-expect-error alongside the preset's @ts-ignore/@ts-nocheck bans -- the last two relaxed automatically in test files. See @exadev/eslint-config's own README for the full set.
        ...exadevRecommendedTypeChecked,
        // The strict tier on top of the preset's recommended one. What it actually adds here, measured across all thirteen packages against a current build: 3,298 violations, of which no-non-null-assertion is 2,395 and restrict-template-expressions 689 -- leaving 214 genuine findings the two deviations below do not touch. Those 214 are real (confusing void expressions, conditions that are always truthy, deprecated API use, misused spreads) and are fixed rather than configured away.
        ...tseslint.configs.strictTypeChecked,
      ],
      rules: {
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { fixStyle: "inline-type-imports" },
        ],
        // Deviation from strictTypeChecked, which sets every allow* to false. `allowNumber: true` accounts for all 689 reports the strict tier adds for this rule, and every one is a number interpolated into a message or an identifier -- page counts, byte offsets, sector indices, error strings naming a size. A number has one unambiguous string form, so interpolating it loses nothing and demanding an explicit String() around each would be noise.
        //
        // `allowAny` deliberately stays false, which is the half of this rule that catches real defects: interpolating an `any` is how "[object Object]" and "undefined" reach a user-visible message.
        "@typescript-eslint/restrict-template-expressions": [
          "error",
          { allowNumber: true },
        ],
        "@typescript-eslint/no-non-null-assertion": nonNullAssertion,
        // Deviation from strictTypeChecked, which reports every string spread. Spreading a string is how you iterate it by code point -- `[...text]` splits on code points where `text.split('')` splits on UTF-16 code units and so tears every astral character in half. This workspace parses real-world documents full of them (emoji, CJK extensions, mathematical alphanumerics), and the sites reporting here are named `codePoints` precisely because that is what they are computing.
        //
        // Only `string` is allowed. Every other case the rule catches -- spreading a Map, a class instance, a Promise, an array into an object -- stays an error, and those are the ones that are actually bugs.
        "@typescript-eslint/no-misused-spread": [
          "error",
          { allow: ["string"] },
        ],
        // `only-allowed-literals` rather than strictTypeChecked's own `never`. The rule's default rejects `while (true)`, which this workspace uses for exactly the loops it is meant for: a Dijkstra main loop over a priority queue and two predecessor-chain walks, each terminating on an internal `break` whose condition cannot be lifted into the header without duplicating it. Rewriting them as `while (queue.length > 0)` would either change the semantics or need a second copy of the exit test.
        //
        // Only literal `true` is exempted, so a condition that is constant because of a genuine type mistake -- an always-truthy object, a comparison the types already decide -- still reports.
        "@typescript-eslint/no-unnecessary-condition": [
          "error",
          { allowConstantLoopConditions: "only-allowed-literals" },
        ],
        // Off. Every pair it reports is a live-view editor property where the getter returns `T | undefined` (the underlying XML attribute may be absent) and the setter takes `T` (you can only assign a real value). TypeScript has supported divergent accessor types since 4.3 precisely for this, and the asymmetry is the honest description of the API.
        //
        // Making them agree would mean widening each setter to `T | undefined` and giving it a documented "clear the property" behaviour -- a genuine improvement, since there is currently no way to unset a font family or colour, but a feature addition to a published editor surface with its own tests to write. Worth doing on its own; not something to smuggle into a tooling change.
        "@typescript-eslint/related-getter-setter-pairs": "off",
        "exadev/barrel-policy":
          barrelPolicy === "off" ? "off" : ["error", { mode: barrelPolicy }],
      },
    },
    {
      // The config files themselves call `tseslint.config()`, which typescript-eslint deprecated in favour of ESLint core's `defineConfig()`. Migrating is blocked upstream rather than by choice: `defineConfig`'s stricter `Plugin` type rejects eslint-plugin-react-hooks@7, whose `configs.flat` is a nested record of configs where ESLint's own index signature admits only a config or an array of them. The web UI's config registers that plugin, so `defineConfig` there fails `tsc` outright, and the only way through is a type assertion this workspace bans.
      //
      // Scoped to the config files alone, so a deprecated API anywhere in real source still reports. Revisit when eslint-plugin-react-hooks' types satisfy ESLint's `Plugin`.
      files: ["eslint.config.ts"],
      rules: { "@typescript-eslint/no-deprecated": "off" },
    },
    {
      // A no-op arrow standing in for a callback prop a given test case never exercises is the ordinary way to write that, and flagging each one only pushes authors to pad it with a meaningless body. Scoped to tests: production code has no legitimate empty function body.
      //
      // The CLI and the MCP server each carried this already, scoped to `**/*.test.ts` -- a glob that silently misses `.test.tsx`, so twelve such stand-ins in one Ink component test were reported as errors while the identical pattern in a `.ts` test was not. Stated once here, over both extensions.
      files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
      rules: {
        "@typescript-eslint/no-empty-function": [
          "error",
          { allow: ["arrowFunctions", "asyncFunctions"] },
        ],
      },
    },
    ...(restrictedImportPatterns.length > 0
      ? tseslint.config({
          // The static half of the isomorphism guarantee. The workerd suite (pnpm test:workers) proves the same property dynamically, but only over the paths a test actually exercises; this catches an offending import at lint time on every file, before any test runs. Any package-specific bans are folded into the same rule here rather than declared separately, since a second no-restricted-imports over these files would replace this one outright.
          files: ["src/**/*.ts"],
          ignores: [...runtimeSrcExemptions],
          rules: {
            "no-restricted-imports": [
              "error",
              { patterns: [...restrictedImportPatterns] },
            ],
          },
        })
      : []),
    ...(isomorphic
      ? tseslint.config({
          // Its own config object rather than a key alongside no-restricted-imports above, because that block also carries package-specific import bans and this ban is strictly about isomorphism. Different rule key, so there is nothing for flat config to replace either way.
          files: ["src/**/*.ts"],
          ignores: [...runtimeSrcExemptions],
          rules: {
            // Each restriction is a separate option element after the severity, not wrapped in an inner array -- see the rule's own arrayOfGlobals schema. Only Buffer is banned; a typeof-process check stays legitimate, since the import ban above covers the real Node surface.
            "no-restricted-globals": [
              "error",
              { name: "Buffer", message: isomorphicBufferMessage },
            ],
          },
        })
      : []),
    ...dataFileLintConfig,
    // LAST, and that ordering is the whole contract: this bundles eslint-config-prettier, which turns OFF every stylistic rule that would otherwise fight the formatter. Placed earlier, a later config could re-enable one and the two would disagree forever, each "fixing" the other's output.
    prettierRecommended,
  );
}
