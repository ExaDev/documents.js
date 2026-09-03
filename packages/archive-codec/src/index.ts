// The archive and container utility package for the documents.js family: ZIP container read/write, archive-format detection, recursive ZIP-in-ZIP walking under explicit depth and cumulative decompressed-size guards, classic OLE compound-file (CFB) reading and writing including the OLE Package stream wrapper an embed's real file rides in, and [MS-OLEPS] Property Set Stream reading and writing (generic, the SummaryInformation-specific mapping every legacy binary Office format's metadata lives in, and the LayoutMetadata mapping on top of that, shared across every codec since the mapping itself is format-agnostic) -- with zero document-format knowledge (it knows bytes and container structure, never that any entry or stream is a document). Motivated by documents.js#564: OOXML embedded-object packages are genuinely separate ZIP blobs inside the outer ZIP, and nothing in the family recursed into them safely before this.
export * from "./cfb/detect";
export * from "./cfb/ole-package";
export * from "./cfb/read";
export * from "./cfb/write";
export * from "./oleps/layout-metadata";
export * from "./oleps/read";
export * from "./oleps/summary-information";
export type { PropertySet, PropertyValue } from "./oleps/wire";
export * from "./oleps/write";
export * from "./zip/container";
export * from "./zip/detect";
export * from "./zip/walk";
