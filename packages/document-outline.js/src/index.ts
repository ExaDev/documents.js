// Artefact utilities for the documents.js family, since document-outline.js#2 phase 2 re-chartered the package around document-schema.js 4.0.0's tree-form DocumentTree (ExaDev/document-schema.js#20): the tree types and the lossless decompose/flatten grouping semantics are the schema's and documents.js's to own, and this package's own copies are gone (one implementation, one authority). What remains, for a consumer already holding a tree-form package JSON without importing the producer that built it: the TOC outline projection over the package tree (buildOutline), effective-property resolution of style refs (effectivePackage), the content-addressed property-graph projection (projectDocumentGraph), and the kind-agnostic walking helpers every consumer of grouped content ends up needing -- flatten-to-leaves, a leaf's own text, and a stable per-leaf content hash.
export * from './outline/build';
export * from './outline/effective';
export * from './outline/graph';
export * from './outline/helpers';
export * from './outline/node';
