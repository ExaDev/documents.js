// markdownCodec / markdownContentCodec: a z.codec() pair per encoding document-schema.js states for one document, each wrapping the matching read/write pair from src/read.ts and src/write.ts with automatic two-way schema validation — this family's own convention (pdf-codec's pdfCodec, documents.js's docxPdfCodec/odtDocxCodec/etc.) of wrapping an already-independently-tested function pair. markdownCodec decodes to the tree-form DocumentTree and markdownContentCodec to the flat ContentDocument, matching which of readMarkdown/readMarkdownContent each is built over, so the codec surface and the function surface name the same thing the same way. Both are deliberately the no-options form — readMarkdown/writeMarkdown remain the entry points wherever a caller needs an AbortSignal or a diagnostic sink, since z.codec()'s fixed decode(input)/encode(output) signature has no room for side-channel options.
//
// MarkdownBytesSchema is the one genuinely checkable thing about arbitrary markdown bytes: unlike pdf-codec's PdfBytesSchema (a real "%PDF-" magic-byte header) or documents.js's docx/pptx magic-byte schemas, markdown has no header, no magic bytes, and no reserved byte sequence of its own, and any text is, structurally, valid markdown (CommonMark's own grammar has no "this is not markdown" rejection path; worst case, an unparseable line becomes an ordinary paragraph). So the one thing worth validating at the bytes boundary is whether the bytes are text at all, which byte-codec's decodeText answers by working the encoding out rather than assuming one: bytes carrying a NUL, or a density of other C0 control bytes, are binary whatever encoding is tried, and text in an encoding it cannot place is refused rather than guessed at. That refusal is what keeps this schema a real check in the absence of a magic number.
//
// Widening it beyond UTF-8 is the point, not a side effect. A markdown file saved by a Windows editor in the system code page, or as UTF-16 with a byte order mark, is an ordinary markdown file, and the previous fatal-mode UTF-8 decode turned every one of them away. Nothing that decoded before decodes differently: UTF-8 is still tried, and still wins, before any encoding is guessed at.
import { z } from "zod";
import { ContentDocumentSchema, DocumentTreeSchema } from "document-schema.js";
import { decodeText, tryDecodeText } from "byte-codec";
import { readMarkdown, readMarkdownContent } from "./read";
import { writeMarkdown, writeMarkdownContent } from "./write";

export const MarkdownBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => tryDecodeText(bytes) !== undefined, {
    message: "not text in any supported character encoding",
  });

export const markdownCodec = z.codec(MarkdownBytesSchema, DocumentTreeSchema, {
  // MarkdownBytesSchema already proved these bytes decode, so decodeText here cannot itself fail. MarkdownUndecodableTextError (src/diagnostics/diagnostics.ts) exists for a caller that decodes bytes to text itself, outside this schema-guarded path, not for this one.
  decode: (bytes) => readMarkdown(decodeText(bytes).text).documentPackage,
  encode: (documentPackage) =>
    new TextEncoder().encode(writeMarkdown(documentPackage)),
});

export const markdownContentCodec = z.codec(
  MarkdownBytesSchema,
  ContentDocumentSchema,
  {
    decode: (bytes) => readMarkdownContent(decodeText(bytes).text).document,
    encode: (document) =>
      new TextEncoder().encode(writeMarkdownContent(document)),
  },
);
