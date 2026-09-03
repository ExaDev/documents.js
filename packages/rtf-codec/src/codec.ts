// rtfCodec / rtfContentCodec: a z.codec() pair per encoding document-schema.js states for one document, each wrapping the matching read/write pair from src/read.ts and src/write.ts with automatic two-way schema validation -- this family's own convention (markdown-codec's markdownCodec, pdf-codec's pdfCodec, documents.js's docxPdfCodec) of wrapping an already-independently-tested function pair. rtfCodec decodes to the tree-form DocumentTree and rtfContentCodec to the flat ContentDocument, matching which of readRtf/readRtfContent each is built over, so the codec surface and the function surface name the same thing the same way. Both are deliberately the no-options form -- readRtf/writeRtf remain the entry points wherever a caller needs an AbortSignal or a diagnostic sink, since z.codec()'s fixed decode(input)/encode(output) signature has no room for side-channel options.
//
// RtfBytesSchema is a real magic-byte check, unlike markdown-codec's own bytes schema: the <File> production requires an RTF document to begin '{' \rtf1, so the first five bytes are literally "{\rtf" in every conforming file. Checking that at the schema boundary means a caller handing the codec a docx or a PDF is refused there rather than deep inside the tokenizer. It deliberately does not check the version digit: the spec says the parameter "should still be emitted as 1" but a reader that rejected \rtf2 outright would refuse a future document it could very likely still read.

import { z } from "zod";
import { ContentDocumentSchema, DocumentTreeSchema } from "document-schema.js";
import { readRtf, readRtfContent } from "./read";
import { writeRtf, writeRtfContent } from "./write";

const RTF_MAGIC = [0x7b, 0x5c, 0x72, 0x74, 0x66]; // "{\rtf"

function hasRtfMagic(bytes: Uint8Array): boolean {
  return RTF_MAGIC.every((byte, index) => bytes[index] === byte);
}

export const RtfBytesSchema = z
  .instanceof(Uint8Array)
  .refine(hasRtfMagic, { message: "does not begin with '{\\rtf'" });

export const rtfCodec = z.codec(RtfBytesSchema, DocumentTreeSchema, {
  decode: (bytes) => readRtf(bytes).documentPackage,
  encode: (documentPackage) => writeRtf(documentPackage),
});

export const rtfContentCodec = z.codec(RtfBytesSchema, ContentDocumentSchema, {
  decode: (bytes) => readRtfContent(bytes).document,
  encode: (document) => writeRtfContent(document),
});
