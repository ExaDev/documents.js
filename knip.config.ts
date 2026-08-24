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
  ignoreBinaries: ["qpdf"],

  workspaces: {
    // The workspace root builds nothing. Its files are the tooling configs, which are entry points by definition -- each is loaded by the tool it configures, never imported.
    ".": {
      // Only eslint.shared.ts needs naming: knip already infers every other root config from the tool that reads it. This one is imported by the others rather than loaded by a tool, so nothing else marks it as reachable.
      entry: ["eslint.shared.ts"],
      project: ["*.ts"],
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
    "packages/documents": {
      // Only the Web Worker needs naming. knip's Vite plugin already finds index.html, src/main.tsx, the generated router tree, and vite.config.ts; the worker is reached through `new Worker(new URL(...))`, which is not a static import and so is invisible to it.
      entry: ["src/workers/documents.worker.ts"],
      project: ["src/**/*.{ts,tsx}"],
    },
  },
};

export default config;
