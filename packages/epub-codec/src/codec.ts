// epubCodec / epubContentCodec: a z.codec() pair per encoding document-schema.js states for one document, wrapping the matching read/write pair from src/read.ts and src/write.ts with automatic two-way schema validation -- this family's own convention (markdown-codec's markdownCodec/markdownContentCodec, pdf-codec's pdfCodec), and the identical tree-vs-flat split markdownCodec/markdownContentCodec already draws: epubCodec decodes to the tree-form DocumentTree (readEpub/writeEpub), epubContentCodec to the flat ContentDocument (readEpubContent/writeEpubContent). Both are deliberately the no-options form -- readEpub(Content)/writeEpub(Content) remain the entry points wherever a caller needs a diagnostic sink, since z.codec()'s fixed decode(input)/encode(output) signature has no room for one.
//
// EpubBytesSchema checks the one cheap, real magic-byte fact every EPUB shares with every other zip archive: a local file header signature ("PK\x03\x04") at the very start -- matching pdf-codec's own PdfBytesSchema precedent (a real header check, not a full parse) rather than markdown-codec's MarkdownBytesSchema (which has no magic bytes to check at all and validates UTF-8 instead, the nearest thing markdown has). It does NOT also verify the "mimetype" entry's own content is genuinely "application/epub+zip" -- that would mean unzipping as part of schema validation, duplicating work readEpub(Content) already does and that EpubInvalidMimetypeError already reports at decode time with a much more specific error than a schema refinement could give.
import { z } from "zod";
import { ContentDocumentSchema, DocumentTreeSchema } from "document-schema.js";
import { EpubPackageSchema, type EpubPackage } from "./model/package";
import { parsePackage } from "./package-io/read";
import { serializePackage } from "./package-io/write";
import { readEpub, readEpubContent } from "./read";
import { writeEpub, writeEpubContent } from "./write";

const ZIP_LOCAL_FILE_HEADER = [0x50, 0x4b, 0x03, 0x04];

function hasZipHeader(bytes: Uint8Array): boolean {
  return ZIP_LOCAL_FILE_HEADER.every((byte, index) => bytes[index] === byte);
}

export const EpubBytesSchema = z.instanceof(Uint8Array).refine(hasZipHeader, {
  message: "not a zip archive (no PK\\x03\\x04 header)",
});

export const epubCodec = z.codec(EpubBytesSchema, DocumentTreeSchema, {
  decode: (bytes) => readEpub(bytes),
  encode: (tree) => writeEpub(tree),
});

export const epubContentCodec = z.codec(
  EpubBytesSchema,
  ContentDocumentSchema,
  {
    decode: (bytes) => readEpubContent(bytes),
    encode: (document) => writeEpubContent(document),
  },
);

// EPUB bytes <-> a genuinely lossless, byte/part-faithful EpubPackage (ExaDev/documents.js#963) -- the core round-trip codec, mirroring ooxml.js's and odf.js's own packageCodec/decodePackage/encodePackage exactly. readEpub(Content)/writeEpub(Content) above stay this package's own one-shot bytes-in/bytes-out convenience (unlike ooxml.js/odf.js, which require a caller to call decodePackage itself before handing the result to a typed reader) -- src/read.ts's own readEpubInternal and src/write.ts's own writeEpubContent both now call decodePackage/encodePackage internally as their first/last step, so this codec is genuinely the SAME lossless boundary those two entry points already cross, exposed directly for a caller who wants byte-level part access without going through the ContentDocument/DocumentTree projection at all.
export const packageCodec = z.codec(EpubBytesSchema, EpubPackageSchema, {
  decode: (bytes) => parsePackage(bytes),
  encode: (pkg) => serializePackage(pkg),
});

export function decodePackage(bytes: Uint8Array<ArrayBuffer>): EpubPackage {
  return z.decode(packageCodec, bytes);
}

export function encodePackage(pkg: EpubPackage): Uint8Array<ArrayBuffer> {
  return z.encode(packageCodec, pkg);
}
