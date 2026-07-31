import { z } from 'zod';
import { DocxBytesSchema, OdtBytesSchema, PdfBytesSchema, PptxBytesSchema } from '../model/bytes';
import { docxToPdf, odtToPdf, pdfToDocx, pdfToOdt, pdfToPptx, pptxToPdf } from './convert';

// docx bytes <-> PDF bytes, pptx bytes <-> PDF bytes, and odt bytes <-> PDF bytes, each a schema-validated z.codec() pair over the already-independently-tested docxToPdf/pdfToDocx, pptxToPdf/pdfToPptx, and odtToPdf/pdfToOdt functions -- the no-options form only, for the same reason pdf/codec.ts's pdfCodec is: docxToPdf et al. accept a signal/onSubstitution/sink options object z.codec()'s fixed decode(input)/encode(output) signature has no room for. Neither direction is round-trip-lossless (see convert.ts's own module doc and the README's Fidelity section) -- the codec adds schema validation and Zod composability on top of the existing conversions, it does not change what they recover.
export const docxPdfCodec = z.codec(DocxBytesSchema, PdfBytesSchema, {
  decode: (docxBytes) => docxToPdf(docxBytes),
  encode: (pdfBytes) => pdfToDocx(pdfBytes),
});

export const pptxPdfCodec = z.codec(PptxBytesSchema, PdfBytesSchema, {
  decode: (pptxBytes) => pptxToPdf(pptxBytes),
  encode: (pdfBytes) => pdfToPptx(pdfBytes),
});

export const odtPdfCodec = z.codec(OdtBytesSchema, PdfBytesSchema, {
  decode: (odtBytes) => odtToPdf(odtBytes),
  encode: (pdfBytes) => pdfToOdt(pdfBytes),
});
