import type { UserConfig } from "tsdown";

/**
 * The tsdown build config every package producing a Node SEA (single-executable application) binary shares: one extra build entry alongside a package's normal index/bin entries, fully bundling every dependency (workspace siblings and npm packages alike) into a single CommonJS file with zero external `require`s -- a SEA embeds no `node_modules` of its own, so nothing may be left external.
 *
 * Kept separate from a package's own `dist/` (via `outDir: "dist-sea"`) so the SEA-specific bundle never ships inside the published npm package -- `files: ["dist"]` in every package.json already excludes it, this option just keeps the two outputs from colliding on disk during a build.
 *
 * `entry` must point at a CJS-safe entry with no top-level await (Node's SEA feature runs the injected script via `require()` semantics, which cannot load a module containing one -- see https://nodejs.org/api/esm.html#require, "Interoperability with CommonJS"). Each package's own `src/sea-entry.ts` is that entry: it imports the identical `main()` the package's ordinary ESM `src/bin.ts` awaits at its own top level, but invokes it with `.catch()` instead.
 */
export function seaEntryBuildConfig(entry: string): UserConfig {
  return {
    entry: [entry],
    format: ["cjs"],
    platform: "node",
    dts: false,
    clean: false,
    outDir: "dist-sea",
    // CJS output regardless of this package's own package.json "type": "module" -- fixedExtension: true always writes .cjs for a cjs format target, rather than following the package's own module type the way the main dist/ build's fixedExtension: false does.
    fixedExtension: true,
    // Bundles every dependency -- workspace siblings (documents.js, document-operations) and ordinary npm packages (zod) alike -- rather than leaving any of them as an external `require()` a SEA binary has no node_modules to satisfy. () => true forces every import, matching the "a SEA is a single file with nothing else alongside it" requirement exactly.
    deps: {
      alwaysBundle: () => true,
    },
  };
}
