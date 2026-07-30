import { z } from 'zod';
import { PdfBytesSchema } from '../model/bytes';
import { LayoutDocumentSchema } from '../model/layout';
import { readPdf } from './read';
import { writePdf } from './write';

// PDF bytes <-> LayoutDocument, the structured JSON pivot readPdf/writePdf both speak -- mirroring ooxml.js's own packageCodec (bytes <-> Package) exactly. z.codec() validates both directions on every call: decode checks the input against PdfBytesSchema (the %PDF- header) before parsing, and its result against LayoutDocumentSchema; encode validates the reverse, so a writer bug that produced a schema-invalid LayoutDocument-shaped value would be caught here even though readPdf/writePdf never call .parse() themselves. This is the no-extra-options form only: readPdf/writePdf remain the primary entry points for a caller that needs an AbortSignal, a PdfDiagnosticSink, a ClockPort, or an onSubstitution callback, none of which fit z.codec()'s fixed decode(input)/encode(output) signature.
export const pdfCodec = z.codec(PdfBytesSchema, LayoutDocumentSchema, {
  decode: (bytes) => readPdf(bytes),
  encode: (doc) => writePdf(doc),
});
