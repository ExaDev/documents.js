// Artefact utilities for the documents.js family, since document-outline.js#2 phase 2 re-chartered the package around document-schema.js 4.0.0's tree-form DocumentTree (ExaDev/document-schema.js#20): the tree types and the lossless decompose/flatten grouping semantics are the schema's and documents.js's to own, and this package's own copies are gone (one implementation, one authority). What remains, for a consumer already holding a tree-form package JSON without importing the producer that built it: the TOC outline projection over the package tree (buildOutline), effective-property resolution of style refs (effectivePackage), the content-addressed property-graph projection (projectDocumentGraph), and the kind-agnostic walking helpers every consumer of grouped content ends up needing — flatten-to-leaves, a leaf's own text, and a stable per-leaf content hash.
export * from "./outline/build";
export * from "./outline/effective";
export * from "./outline/graph";
// The write side of the property-graph projection above (ExaDev/documents.js#935): insertNode/insertEdge/removeEdge/replaceEdge and their supporting types/errors live in their own module rather than outline/graph.ts itself, split apart once that module's combined read and write content passed this workspace's max-lines limit. See the module doc on outline/graph-edit.ts.
export * from "./outline/graph-edit";
// Sheet region segmentation and neighbour-derived labels (ExaDev/documents.js#823, "Ask 2"): both are purely additional artefacts a consumer opts into over a sheet's own cell array, never wired into buildOutline or any other existing entry point — see the module docs on outline/regions.ts and outline/labels.ts.
export * from "./outline/regions";
export * from "./outline/labels";
// PDF region segmentation (ExaDev/documents.js#931): the PDF-specific sibling of outline/regions.ts's sheet segmentation, reusing the same RegionClassification vocabulary — see the module doc on outline/pdf-regions.ts.
export * from "./outline/pdf-regions";
// The order-key module's named rebalance signal, so a caller catching exhaustion from any of the `orderKeys.*` operations branches on instanceof rather than parsing a message. Exported from here rather than relayed through outline/graph.ts, which is not a barrel: the root surface was always the intent, and graph.ts was only the conduit that reached it. Deliberately not `export *` — the individual order-key operations stay namespaced under graph.ts's own `orderKeys` object rather than becoming top-level names.
export { OrderKeyBudgetExhaustedError } from "./outline/order-keys";
export * from "./outline/helpers";
export * from "./outline/node";
