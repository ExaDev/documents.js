// The archive utility package for the documents.js family: ZIP container read/write, archive-format detection, and recursive ZIP-in-ZIP walking under explicit depth and cumulative decompressed-size guards -- with zero document-format knowledge (it knows bytes and ZIP structure, never that any entry is a document). Motivated by documents.js#564: OOXML embedded-object packages are genuinely separate ZIP blobs inside the outer ZIP, and nothing in the family recursed into them safely before this.
export * from './zip/container';
export * from './zip/detect';
export * from './zip/walk';
