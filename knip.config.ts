import type { KnipConfig } from "knip";

/**
 * One config for the whole workspace. knip discovers the members from pnpm-workspace.yaml itself, so the keys below only describe what each member's entry points are.
 *
 * `entry` has to be given explicitly rather than left to knip's own inference. Its wildcard-exports source mapping needs a tsconfig `outDir` to walk back from `dist/`, and no package here has one -- every tsconfig is `noEmit`, and the build is tsdown's. Without an entry list knip would see almost every module as unreachable.
 *
 * The consequence, stated plainly: the unused-*exports* half of knip is close to inert in this workspace, and that is correct rather than a misconfiguration. Every published package's `exports` map carries a `"./*"` wildcard, and tsdown builds one dist module per src module, so every nested module genuinely is public API -- `documents.js/model/units` is as importable as the barrel. What knip is here for is the other half: unused files, unused dependencies, and unlisted dependencies, across thirteen manifests that no single command previously checked.
 */
const config: KnipConfig = {
  // qpdf is a deliberately optional external tool, not a dependency to declare. documents.js's formula test probes for it with `which qpdf` and skips the cross-check when it is absent, so the suite passes with or without it -- the same convention this repo already uses for its gitignored conformance corpora. Declaring it would make an optional local convenience a hard requirement of the workspace.
  //
  // `info` is not a binary at all: check-dependency-age.ts runs `execFileSync("pnpm", ["info", name, "time", "--json"])`, and knip reads the first argument as a command of its own. There is nothing to declare -- pnpm is the package manager running the script.
  ignoreBinaries: ["qpdf", "info"],

  // release-workspace.config.json names the conventionalcommits preset as a string, and @semantic-release/release-notes-generator loads it by deriving the package name from that string at runtime. There is no import anywhere for knip to follow, and knip's own semantic-release plugin cannot help: it reads semantic-release's `plugins` array, whereas this file is @exadev/semantic-release-workspace's own schema. The dependency is declared directly rather than left to pnpm's hoisted store, because resolution through the store depends on it staying a transitive dependency of @commitlint/config-conventional -- true today, and nothing enforces it.
  //
  // @stryker-mutator/core, typescript-checker, and vitest-runner are declared at the root even though no root file imports any of the three: stryker.shared.ts names typescript-checker and vitest-runner by string in its own `plugins` array (loaded by Stryker's own plugin resolver at runtime, not by an import statement knip can trace), and removing any of the three from the root manifest reproducibly breaks every package's own `stryker run` with "Cannot find Checker plugin \"typescript\"" -- confirmed by removing them and re-running. Each package also declares its own copy (needed for pnpm to resolve the `stryker` binary and these same plugins from that package's own node_modules when its `_test:mutation` script runs `stryker run` from its own directory), so this is a real, load-bearing duplication rather than dead weight at either level.
  ignoreDependencies: [
    "conventional-changelog-conventionalcommits",
    "@stryker-mutator/core",
    "@stryker-mutator/typescript-checker",
    "@stryker-mutator/vitest-runner",
  ],

  workspaces: {
    // The workspace root builds nothing. Its files are the tooling configs, which are entry points by definition -- each is loaded by the tool it configures, never imported.
    ".": {
      // eslint.shared.ts and stryker.shared.ts are each imported by every package's own config rather than loaded by a tool directly, so nothing else marks them reachable. The .github/scripts entries are the opposite case: CI invokes each as a `node` entry point and nothing imports them, so without naming them knip reports both the scripts and everything they import as unused -- which is how `semver` first looked dead here.
      entry: ["eslint.shared.ts", "stryker.shared.ts", ".github/scripts/*.ts"],
      // `*.ts` alone is not recursive, so it never reached .github/scripts and the scripts' own imports were invisible.
      project: ["*.ts", ".github/scripts/**/*.ts"],
    },

    // Every library package. Every module rather than just `src/index.ts`: the exports map's `"./*"` wildcard plus tsdown's own `entry: ["src/**/*.ts"]` means each module ships as its own importable subpath, so treating only the barrel as an entry would report the entire package as unused.
    "packages/*": {
      // `.tsx` as well as `.ts`, and that is not cosmetic: document-cli's whole Ink TUI is .tsx, and omitting the extension made every module it reaches invisible to knip -- which then reported the TUI's own dependencies as unused.
      entry: ["src/**/*.{ts,tsx}"],
      project: ["src/**/*.{ts,tsx}"],
    },

    // The web UI, restated in full rather than extended. knip resolves a `workspaces` key to the single most specific match and uses it verbatim -- a glob entry and an exact entry do not merge -- so every field this needs has to appear here even where it repeats the glob above.
    //
    // Its entries are genuinely different: it is a private Vite app that publishes nothing and has no exports map, so nothing is reachable through a package subpath. The real roots are the HTML document, the browser Web Worker (reached through `new Worker(new URL(...))`, which is not a static import), and the generated router tree.
    "packages/web": {
      // Only the Web Worker needs naming. knip's Vite plugin already finds index.html, src/main.tsx, the generated router tree, and vite.config.ts; the worker is reached through `new Worker(new URL(...))`, which is not a static import and so is invisible to it.
      entry: ["src/workers/documents.worker.ts"],
      project: ["src/**/*.{ts,tsx}"],
    },
  },
};

export default config;
