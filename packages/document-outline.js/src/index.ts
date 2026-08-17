// The outline package for the documents.js family: heading- and list-level-driven hierarchical outlines over any ContentDocument (all five document kinds), plus the kind-agnostic tree-walking helpers every consumer of a grouped tree ends up needing -- flatten-to-leaves, a leaf's own text, and a stable per-leaf content hash. Motivated by document-schema.js#14: none of ContentDocument's shapes groups content by heading or list level, so chunking, TOC generation, and structural diffing each had to rebuild the same nesting transform.
export * from './outline/build';
export * from './outline/helpers';
export * from './outline/node';
