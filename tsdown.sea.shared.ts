import type { UserConfig } from "tsdown";

/**
 * The tsdown build config every package producing a Node SEA (single-executable application) binary shares: one extra build entry alongside a package's normal index/bin entries, fully bundling every dependency (workspace siblings and npm packages alike) into a single file with zero external `require`s/`import`s -- a SEA embeds no `node_modules` of its own, so nothing may be left external.
 *
 * Kept separate from a package's own `dist/` (via `outDir: "dist-sea"`) so the SEA-specific bundle never ships inside the published npm package -- `files: ["dist"]` in every package.json already excludes it, this option just keeps the two outputs from colliding on disk during a build.
 *
 * Defaults to CommonJS output, matching Node's SEA feature's original, longest-supported main-script format: the injected script runs via `require()` semantics, which cannot load a module containing top-level await (see https://nodejs.org/api/esm.html#require, "Interoperability with CommonJS"). Each package's own `src/sea-entry.ts` is written for this by default: it imports the identical `main()` the package's ordinary ESM `src/bin.ts` awaits at its own top level, but invokes it with `.catch()` instead, keeping the entry's own top level synchronous.
 *
 * Pass `format: "esm"` for a package whose bundle graph cannot be flattened into CommonJS at all -- not because of this package's own code, but because a dependency it pulls in has top-level await baked into ITS OWN module graph (document-cli's own Ink/yoga-layout dependency chain does; see that package's tsdown.config.ts for the concrete case). Node 25.7+ added native ESM main-script support to SEA (`"mainFormat": "module"` in sea-config.json) specifically to remove the CommonJS ceiling on what a SEA can embed -- see https://nodejs.org/api/single-executable-applications.html. In that mode `src/sea-entry.ts` can be `await main();` directly, identical to `src/bin.ts`, since ESM has no top-level-await restriction to route around. This only constrains the machine that BUILDS the binary (whichever Node version runs `.github/scripts/build-sea-binary.ts` for that platform) -- SEA injection always copies the currently-running node binary, so the built executable embeds that same, already-new-enough runtime regardless of this repository's own Node 20 minimum for the published npm package.
 */
export function seaEntryBuildConfig(
  entry: string,
  format: "cjs" | "esm" = "cjs",
): UserConfig {
  return {
    entry: [entry],
    format: [format],
    platform: "node",
    dts: false,
    clean: false,
    outDir: "dist-sea",
    // Output extension follows `format` regardless of this package's own package.json "type": "module" -- fixedExtension: true always writes .cjs/.mjs for the chosen format, rather than following the package's own module type the way the main dist/ build's fixedExtension: false does.
    fixedExtension: true,
    // Bundles every dependency -- workspace siblings (documents.js, document-operations) and ordinary npm packages (zod, ink) alike -- rather than leaving any of them as an external import a SEA binary has no node_modules to satisfy. () => true forces every import, matching the "a SEA is a single file with nothing else alongside it" requirement exactly.
    deps: {
      alwaysBundle: () => true,
    },
  };
}
