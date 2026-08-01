import { z } from 'zod';
import { DocxBytesSchema, OdgBytesSchema, OdpBytesSchema, OdtBytesSchema, PdfBytesSchema, PptxBytesSchema } from '../model/bytes';
import { docxToPdf, odgToPdf, odpToPdf, odtToPdf, pdfToDocx, pdfToOdg, pdfToOdp, pdfToOdt, pdfToPptx, pptxToPdf } from './convert';

// docx bytes <-> PDF bytes, pptx bytes <-> PDF bytes, odt bytes <-> PDF bytes, odp bytes <-> PDF bytes, and odg bytes <-> PDF bytes, each a schema-validated z.codec() pair over the already-independently-tested docxToPdf/pdfToDocx, pptxToPdf/pdfToPptx, odtToPdf/pdfToOdt, odpToPdf/pdfToOdp, and odgToPdf/pdfToOdg functions -- the no-options form only, for the same reason pdf/codec.ts's pdfCodec is: docxToPdf et al. accept a signal/onSubstitution/sink options object z.codec()'s fixed decode(input)/encode(output) signature has no room for. Neither direction is round-trip-lossless (see convert.ts's own module doc and the README's Fidelity section) -- the codec adds schema validation and Zod composability on top of the existing conversions, it does not change what they recover. odsPdfCodec deliberately does not exist: this package's own established rule is that a codec needs both a genuine decode and encode half, and odsToPdf alone, with no pdfToOds, does not warrant one.
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

export const odpPdfCodec = z.codec(OdpBytesSchema, PdfBytesSchema, {
  decode: (odpBytes) => odpToPdf(odpBytes),
  encode: (pdfBytes) => pdfToOdp(pdfBytes),
});

export const odgPdfCodec = z.codec(OdgBytesSchema, PdfBytesSchema, {
  decode: (odgBytes) => odgToPdf(odgBytes),
  encode: (pdfBytes) => pdfToOdg(pdfBytes),
});
