// Placeholder public surface: re-exports ooxml.js's lossless OOXML core so the dependency wiring, tsdown dual-build, and smoke test are exercised before any of documents.js's own code exists. Superseded by the full export list once src/convert/* and the rest of the package land.
export { decodePackage, encodePackage } from 'ooxml.js';
