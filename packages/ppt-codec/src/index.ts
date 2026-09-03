// The PowerPoint 97-2003 binary file format ([MS-PPT]) reader for the documents.js family: the compound-file stream layer, the record-tree walk over the PowerPoint Document stream, and the mapping of slide text and geometry onto document-schema.js's shared presentation content model. Worker-isomorphic -- no node:*, no Buffer -- so the same code runs under Node and inside a Cloudflare Workers isolate.
export * from "./content";
export * from "./document/document-atom";
export * from "./document/fonts";
export * from "./document/slide-list";
export * from "./drawing/shapes";
export * from "./errors";
export * from "./read";
export * from "./record/header";
export * from "./record/tree";
export * from "./record/types";
export * from "./stream/current-user";
export * from "./stream/persist";
export * from "./text/atoms";
export * from "./text/style";
export * from "./units";
