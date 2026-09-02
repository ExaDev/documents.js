// epubCodec / epubContentCodec: a z.codec() pair per encoding document-schema.js states for one document, wrapping the matching read/write pair from src/read.ts and src/write.ts with automatic two-way schema validation -- this family's own convention (markdown-codec's markdownCodec/markdownContentCodec, pdf-codec's pdfCodec), and the identical tree-vs-flat split markdownCodec/markdownContentCodec already draws: epubCodec decodes to the tree-form DocumentTree (readEpub/writeEpub), epubContentCodec to the flat ContentDocument (readEpubContent/writeEpubContent). Both are deliberately the no-options form -- readEpub(Content)/writeEpub(Content) remain the entry points wherever a caller needs a diagnostic sink, since z.codec()'s fixed decode(input)/encode(output) signature has no room for one.
//
// EpubBytesSchema checks the one cheap, real magic-byte fact every EPUB shares with every other zip archive: a local file header signature ("PK\x03\x04") at the very start -- matching pdf-codec's own PdfBytesSchema precedent (a real header check, not a full parse) rather than markdown-codec's MarkdownBytesSchema (which has no magic bytes to check at all and validates UTF-8 instead, the nearest thing markdown has). It does NOT also verify the "mimetype" entry's own content is genuinely "application/epub+zip" -- that would mean unzipping as part of schema validation, duplicating work readEpub(Content) already does and that EpubInvalidMimetypeError already reports at decode time with a much more specific error than a schema refinement could give.
import { z } from "zod";
import { ContentDocumentSchema, DocumentTreeSchema } from "document-schema.js";
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
