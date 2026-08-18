import { z } from 'zod';
import { readPdf } from './read';
import { writePdf } from './write';
import { LayoutDocumentSchema } from './layout';

// '%PDF-' -- the PDF header (ISO 32000-1 section 7.5.2). Per the spec it may be preceded by arbitrary bytes (some producers prepend a comment or BOM), so this checks for the signature within the first kilobyte rather than requiring it at offset 0. A standalone, independently-duplicated copy of documents.js's own src/model/bytes.ts PdfBytesSchema logic -- that file is co-located there alongside unrelated docx/pptx/odt schemas which must stay in documents.js, so this package owns its own narrow ~20-line copy of just the PDF-specific check rather than importing the whole thing.
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PDF_HEADER_SEARCH_WINDOW = 1024;

function containsBytesWithin(bytes: Uint8Array, signature: readonly number[], window: number): boolean {
  const limit = Math.min(bytes.length - signature.length, window);
  for (let start = 0; start <= limit; start++) {
    let matched = true;
    for (let i = 0; i < signature.length; i++) {
      if (bytes[start + i] !== signature[i]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }
  return false;
}

export const PdfBytesSchema = z.instanceof(Uint8Array).refine(
  (bytes) => containsBytesWithin(bytes, PDF_HEADER, PDF_HEADER_SEARCH_WINDOW),
  { message: 'not a valid PDF file: missing the %PDF- header' },
);

// PDF bytes <-> LayoutDocument, the structured JSON pivot readPdf/writePdf both speak -- mirroring ooxml.js's own packageCodec (bytes <-> Package) exactly. z.codec() validates both directions on every call: decode checks the input against PdfBytesSchema (the %PDF- header) before parsing, and its result against LayoutDocumentSchema; encode validates the reverse, so a writer bug that produced a schema-invalid LayoutDocument-shaped value would be caught here even though readPdf/writePdf never call .parse() themselves. This is the no-extra-options form only: readPdf/writePdf remain the primary entry points for a caller that needs an AbortSignal, a PdfDiagnosticSink, a ClockPort, or an onSubstitution callback, none of which fit z.codec()'s fixed decode(input)/encode(output) signature.
export const pdfCodec = z.codec(PdfBytesSchema, LayoutDocumentSchema, {
  decode: (bytes) => readPdf(bytes),
  encode: (doc) => writePdf(doc),
});
