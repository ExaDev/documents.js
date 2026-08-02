// markdownCodec: a z.codec() pair over readMarkdown/writeMarkdown, matching this family's own convention (pdf-codec's pdfCodec, documents.js's docxPdfCodec/odtDocxCodec/etc.) of wrapping an already-independently-tested function pair with automatic two-way schema validation. Deliberately the no-options form -- readMarkdown/writeMarkdown remain the entry points wherever a caller needs an AbortSignal or a diagnostic sink, since z.codec()'s fixed decode(input)/encode(output) signature has no room for side-channel options.
//
// MarkdownBytesSchema is the one genuinely checkable thing about arbitrary markdown bytes -- unlike pdf-codec's PdfBytesSchema (a real "%PDF-" magic-byte header) or documents.js's docx/pptx magic-byte schemas, markdown has no header, no magic bytes, and no reserved byte sequence of its own: any well-formed UTF-8 text is, structurally, valid markdown (CommonMark's own grammar has no "this is not markdown" rejection path -- worst case, an unparseable line becomes an ordinary paragraph). So the one thing actually worth validating at the bytes boundary is well-formed UTF-8 -- decoding is done with a `fatal: true` TextDecoder specifically so a malformed byte sequence is caught here, at the schema, rather than surfacing later as silently-mangled replacement characters inside readMarkdown's own output.
import { z } from 'zod';
import { ContentDocumentSchema } from 'document-schema.js';
import { readMarkdown } from './read';
import { writeMarkdown } from './write';

function isWellFormedUtf8Text(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export const MarkdownBytesSchema = z.instanceof(Uint8Array).refine(isWellFormedUtf8Text, { message: 'not well-formed UTF-8 text' });

export const markdownCodec = z.codec(MarkdownBytesSchema, ContentDocumentSchema, {
  // isWellFormedUtf8Text already validated `bytes` above, so a plain (non-fatal) decode here cannot itself fail on malformed input -- MarkdownInvalidUtf8Error (src/diagnostics/diagnostics.ts) exists for a caller that decodes bytes to text itself, outside this schema-guarded path, not for this one.
  decode: (bytes) => readMarkdown(new TextDecoder().decode(bytes)).document,
  encode: (document) => new TextEncoder().encode(writeMarkdown(document)),
});
