export * from './color';
export * from './geometry';
export * from './style';
export * from './metadata';
export * from './mathml';
export * from './math';
export * from './content';
export * from './definitions';
export * from './construct';
export * from './package-node';
export * from './package';
export * from './codec';
export * from './schema-io';
export * from './content-json-schema-defs';
export * from './text-layout';
export * from './font-port';
export * from './math-layout';
export * from './a1';

// --- The package boundary: the structural transform between this package's own two encodings of one document -- the flat ContentDocument every codec reads and writes, and the DocumentPackage tree a serialised artefact carries. assemblePackage is the one helper a construction site calls (decompose then factorStyles), decompose/flattenPackage are the two directions exposed for a caller composing its own boundary, and factorStyles re-mints an already-assembled tree to the identical styles table (minting is idempotent). Together they satisfy the three laws src/package.ts states: strict structural round-trip both directions for a styles-free package, effective-property equality universally (flattenPackage materialises refs away), and minting idempotence -- pinned in bijection.test.ts.
//
// Named exports rather than the `export *` every module above uses, because these four modules carry genuine internals that are not public API: decompose's per-container helpers (which factor-styles calls), factor-styles' own mint entry point, and the canonicaliser behind tuple identity. Adding a name here is a deliberate act, not a side effect of exporting it from its module.
export { decompose, ConstructMarkerImbalanceError, type PackageChildren } from './decompose';
export { flattenPackage } from './flatten';
export { assemblePackage, factorStyles } from './factor-styles';
