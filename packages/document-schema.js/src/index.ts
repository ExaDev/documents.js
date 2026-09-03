export * from "./color";
export * from "./border-weight";
export * from "./geometry";
export * from "./style";
export * from "./metadata";
export * from "./mathml";
export * from "./math";
export * from "./content";
export * from "./definitions";
export * from "./source";
export * from "./construct";
export * from "./package-node";
export * from "./package";
export * from "./codec";
export * from "./schema-io";
export * from "./content-json-schema-defs";
export * from "./text-layout";
export * from "./font-port";
export * from "./math-layout";
export * from "./a1";

// --- The package boundary: the structural transform between this package's own two encodings of one document -- the flat ContentDocument every codec reads and writes, and the DocumentTree tree a serialised artefact carries. assembleTree is the one helper a construction site calls (decompose then factorStyles), decompose/flattenTree are the two directions exposed for a caller composing its own boundary, and factorStyles re-mints an already-assembled tree to the identical styles table (minting is idempotent). Together they satisfy the three laws src/package.ts states: strict structural round-trip both directions for a styles-free package, effective-property equality universally (flattenTree materialises refs away), and minting idempotence -- pinned in bijection.test.ts.
//
// Named exports rather than the `export *` every module above uses, because these four modules also carry helpers that are not meant as this barrel's public surface: decompose's per-container helpers (which factor-styles calls), factor-styles' own mint entry point, and the canonicaliser behind tuple identity. Curating the names re-exported here is a deliberate act, not a side effect of exporting a module's contents wholesale -- but per the README's "every module is also importable directly", `package.json`'s `"./*"` subpath export still makes each of those helpers reachable by importing the module directly (e.g. `document-schema.js/decompose`), so this curation narrows the index barrel, not the package's overall published surface.
export {
  decompose,
  ConstructMarkerImbalanceError,
  type TreeChildren,
} from "./decompose";
export { flattenTree } from "./flatten";
export { assembleTree, factorStyles } from "./factor-styles";
