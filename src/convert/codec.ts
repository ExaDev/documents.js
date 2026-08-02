import { z } from 'zod';
import { DocxBytesSchema, OdgBytesSchema, OdpBytesSchema, OdsBytesSchema, OdtBytesSchema, PdfBytesSchema, PptxBytesSchema, XlsxBytesSchema } from '../model/bytes';
import {
  docxToOdt,
  docxToPdf,
  odgToPdf,
  odpToPdf,
  odpToPptx,
  odsToPdf,
  odsToXlsx,
  odtToDocx,
  odtToPdf,
  pdfToDocx,
  pdfToOdg,
  pdfToOdp,
  pdfToOds,
  pdfToOdt,
  pdfToPptx,
  pdfToXlsx,
  pptxToOdp,
  pptxToPdf,
  xlsxToOds,
  xlsxToPdf,
} from './convert';

// docx bytes <-> PDF bytes, pptx bytes <-> PDF bytes, odt bytes <-> PDF bytes, odp bytes <-> PDF bytes, ods bytes <-> PDF bytes, and odg bytes <-> PDF bytes, each a schema-validated z.codec() pair over the already-independently-tested docxToPdf/pdfToDocx, pptxToPdf/pdfToPptx, odtToPdf/pdfToOdt, odpToPdf/pdfToOdp, odsToPdf/pdfToOds, and odgToPdf/pdfToOdg functions -- the no-options form only, for the same reason pdf/codec.ts's pdfCodec is: docxToPdf et al. accept a signal/onSubstitution/sink options object z.codec()'s fixed decode(input)/encode(output) signature has no room for. Neither direction is round-trip-lossless (see convert.ts's own module doc and the README's Fidelity section) -- the codec adds schema validation and Zod composability on top of the existing conversions, it does not change what they recover.
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

export const odsPdfCodec = z.codec(OdsBytesSchema, PdfBytesSchema, {
  decode: (odsBytes) => odsToPdf(odsBytes),
  encode: (pdfBytes) => pdfToOds(pdfBytes),
});

export const odgPdfCodec = z.codec(OdgBytesSchema, PdfBytesSchema, {
  decode: (odgBytes) => odgToPdf(odgBytes),
  encode: (pdfBytes) => pdfToOdg(pdfBytes),
});

// xlsx bytes <-> PDF bytes: a schema-validated z.codec() pair over xlsxToPdf/pdfToXlsx (convert.ts), which -- unlike the six PDF-pivot codecs above -- compose the ods<->xlsx bridge with the ods<->pdf layout pair internally rather than laying xlsx out directly (xlsx has no layout engine of its own). Still the no-options form only, for the same reason as above, and still subject to the same "not round-trip-lossless" caveat every PDF-pivot codec carries (README's Fidelity section) -- the codec adds schema validation on top of xlsxToPdf/pdfToXlsx, it does not change what they recover.
export const xlsxPdfCodec = z.codec(XlsxBytesSchema, PdfBytesSchema, {
  decode: (xlsxBytes) => xlsxToPdf(xlsxBytes),
  encode: (pdfBytes) => pdfToXlsx(pdfBytes),
});

// odt bytes <-> docx bytes, odp bytes <-> pptx bytes, and ods bytes <-> xlsx bytes: schema-validated z.codec() pairs over the cross-format bridge functions (convert.ts), which unlike every codec above bypass PDF entirely -- see convert.ts's own module comment on that section. These three are consequently NOT subject to the "not round-trip-lossless" caveat the six PDF-pivot codecs above carry (README's Fidelity section); decode/encode is a direct ContentDocument pivot copy with no layout or reconstruction step. Still the no-options form only, for the same reason as above: odtToDocx et al. accept a signal option z.codec()'s fixed decode(input)/encode(output) signature has no room for.
export const odtDocxCodec = z.codec(OdtBytesSchema, DocxBytesSchema, {
  decode: (odtBytes) => odtToDocx(odtBytes),
  encode: (docxBytes) => docxToOdt(docxBytes),
});

export const odpPptxCodec = z.codec(OdpBytesSchema, PptxBytesSchema, {
  decode: (odpBytes) => odpToPptx(odpBytes),
  encode: (pptxBytes) => pptxToOdp(pptxBytes),
});

export const odsXlsxCodec = z.codec(OdsBytesSchema, XlsxBytesSchema, {
  decode: (odsBytes) => odsToXlsx(odsBytes),
  encode: (xlsxBytes) => xlsxToOds(xlsxBytes),
});
