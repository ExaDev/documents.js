// The archive and container utility package for the documents.js family: ZIP container read/write, archive-format detection, recursive ZIP-in-ZIP walking under explicit depth and cumulative decompressed-size guards, and classic OLE compound-file (CFB) reading including the OLE Package stream wrapper an embed's real file rides in -- with zero document-format knowledge (it knows bytes and container structure, never that any entry or stream is a document). Motivated by documents.js#564: OOXML embedded-object packages are genuinely separate ZIP blobs inside the outer ZIP, and nothing in the family recursed into them safely before this.
export * from "./cfb/detect";
export * from "./cfb/ole-package";
export * from "./cfb/read";
export * from "./zip/container";
export * from "./zip/detect";
export * from "./zip/walk";
