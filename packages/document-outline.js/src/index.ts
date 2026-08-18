// The outline package for the documents.js family: heading- and list-level-driven hierarchical outlines over any ContentDocument (all five document kinds), the kind-agnostic tree-walking helpers every consumer of a grouped tree ends up needing -- flatten-to-leaves, a leaf's own text, and a stable per-leaf content hash -- and, since the re-charter in document-outline.js#2, the decompose/flatten pair over DocumentPackage with its bijection property tests: the lossless package-tree view and its exact inverse, the phase-1 gate for document-schema.js#20's DocumentPackage promotion (phase 2 ports the pair into documents.js's package boundary).
export * from './outline/build';
export * from './outline/decompose';
export * from './outline/flatten';
export * from './outline/helpers';
export * from './outline/node';
export * from './outline/package-node';
