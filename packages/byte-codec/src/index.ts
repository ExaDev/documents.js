// The shared byte/image utility package for the documents.js family: generic byte-level primitives (ByteWriter, ByteReader, CRC-32, deflate/inflate) and PNG/JPEG image encoding/decoding with zero PDF knowledge. Extracted from pdf-codec (where they lived as a directory-isolated subgraph with no PDF imports) so both pdf-codec and documents.js consume them from a neutral home rather than one fetching byte utilities from a backend.
export * from "./bytes/writer";
export * from "./bytes/reader";
export * from "./bytes/crc32";
export * from "./bytes/flate";
export * from "./image/png-encode";
export * from "./image/png-decode";
export * from "./image/png-filter";
export * from "./image/jpeg-info";
