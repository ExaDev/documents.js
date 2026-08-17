import { z } from 'zod';
import { CsvBytesSchema, DocxBytesSchema, MarkdownBytesSchema, OdgBytesSchema, OdpBytesSchema, OdsBytesSchema, OdtBytesSchema, PdfBytesSchema, PptxBytesSchema, SvgBytesSchema, XlsxBytesSchema } from '../model/bytes';
import {
  csvToMarkdown,
  csvToOds,
  csvToPdf,
  csvToXlsx,
  docxToMarkdown,
  docxToOdt,
  docxToPdf,
  markdownToCsv,
  markdownToDocx,
  markdownToOdt,
  markdownToPdf,
  odgToPdf,
  odgToSvg,
  odpToPdf,
  odpToPptx,
  odsToCsv,
  odsToPdf,
  odsToXlsx,
  odtToDocx,
  odtToMarkdown,
  odtToPdf,
  pdfToCsv,
  pdfToDocx,
  pdfToMarkdown,
  pdfToOdg,
  pdfToOdp,
  pdfToOds,
  pdfToOdt,
  pdfToPptx,
  pdfToSvg,
  pdfToXlsx,
  pptxToOdp,
  pptxToPdf,
  svgToOdg,
  svgToPdf,
  xlsxToCsv,
  xlsxToOds,
  xlsxToPdf,
  xlsxToMarkdown,
  markdownToXlsx,
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

// markdown bytes <-> PDF bytes: a schema-validated z.codec() pair over markdownToPdf/pdfToMarkdown (convert.ts), which -- unlike xlsxPdfCodec above -- DOES lay markdown out directly (markdownToPdf reuses convertWordprocessingToLayout unmodified, the same engine docxPdfCodec/odtPdfCodec above feed). Still the no-options form only, and still fully subject to the "not round-trip-lossless" caveat every PDF-pivot codec carries -- more so than any other codec in this file, in fact: pdfToMarkdown is the single lossiest conversion in the whole package (see convert.ts's own top-of-file comment and the README's Fidelity section).
export const markdownPdfCodec = z.codec(MarkdownBytesSchema, PdfBytesSchema, {
  decode: (markdownBytes) => markdownToPdf(markdownBytes),
  encode: (pdfBytes) => pdfToMarkdown(pdfBytes),
});

// svg bytes <-> PDF bytes: a schema-validated z.codec() pair over svgToPdf/pdfToSvg (convert.ts), which -- like markdownPdfCodec above and unlike csvPdfCodec/xlsxPdfCodec below -- DOES lay its source out directly (svgToPdf feeds the drawing ContentDocument readSvgContent produced into the same convertDrawingToLayout engine odgPdfCodec feeds). Decode-side lossiness is the reader's documented scope limits (text, gradients, filters, images, CSS, and <use> degrade under diagnostics, never silently); encode-side is reconstructDrawing's near-1:1 mapping with the kind-narrowing every pdf-to-content recovery performs. Still the no-options form only: svgToPdf accepts onSvgDiagnostic and pdfToSvg accepts page/onSvgDiagnostic, neither of which z.codec()'s fixed decode(input)/encode(output) signature has room for -- and the encode leg WILL throw SvgMultiPageNotSpecifiedError on a multi-page PDF, since page selection is exactly such an option.
export const svgPdfCodec = z.codec(SvgBytesSchema, PdfBytesSchema, {
  decode: (svgBytes) => svgToPdf(svgBytes),
  encode: (pdfBytes) => pdfToSvg(pdfBytes),
});

// odt bytes <-> docx bytes, odp bytes <-> pptx bytes, ods bytes <-> xlsx bytes, markdown bytes <-> docx bytes, and markdown bytes <-> odt bytes: schema-validated z.codec() pairs over the cross-format bridge functions (convert.ts), which unlike every PDF-pivot codec above bypass PDF entirely -- see convert.ts's own module comment on that section. The blanket "not round-trip-lossless doesn't apply to these" claim this comment used to make here is genuinely false for the two markdown pairs below, and is now stated precisely rather than glossed over: odtDocxCodec/odpPptxCodec/odsXlsxCodec decode/encode a direct ContentDocument pivot copy with no layout or reconstruction step, so those three really do carry no PDF-pivot-style lossiness of their own -- but markdownDocxCodec/markdownOdtCodec still lose everything CommonMark/GFM itself cannot represent (colour, font family/size, explicit alignment, page geometry) on the DECODE side (markdown -> docx/odt), simply because that information was never in the markdown source to begin with; ENCODE (docx/odt -> markdown) then discards it a second time on the way back down, same as it always would. That is not the PDF-pivot's geometry-based reconstruction lossiness -- there is still no layout engine and no geometric guessing anywhere in either direction -- but it is real, format-boundary lossiness all the same, and pretending otherwise here would misdescribe what markdownDocxCodec/markdownOdtCodec actually preserve. Still the no-options form only, for the same reason as above: odtToDocx et al. (and now markdownToDocx et al.) accept a signal option z.codec()'s fixed decode(input)/encode(output) signature has no room for.
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

export const markdownDocxCodec = z.codec(MarkdownBytesSchema, DocxBytesSchema, {
  decode: (markdownBytes) => markdownToDocx(markdownBytes),
  encode: (docxBytes) => docxToMarkdown(docxBytes),
});

export const markdownOdtCodec = z.codec(MarkdownBytesSchema, OdtBytesSchema, {
  decode: (markdownBytes) => markdownToOdt(markdownBytes),
  encode: (odtBytes) => odtToMarkdown(odtBytes),
});

// xlsx bytes <-> markdown bytes: the no-options form over the two pdf-composed bridge functions (convert.ts), schema-validated both ways. The most lossy codec in this file by some margin -- decode stacks xlsxToPdf's spreadsheet render on top of pdfToMarkdown's geometry reconstruction, and encode stacks markdownToPdf's render on top of pdfToXlsx's reconstruction -- so neither direction is remotely round-trip-lossless; see convert.ts's own xlsxToMarkdown/markdownToXlsx comment for why this last-resort pair exists at all (a caller with xlsx bytes wanting text who cannot read the cells directly via readXlsxContent).
export const xlsxMarkdownCodec = z.codec(XlsxBytesSchema, MarkdownBytesSchema, {
  decode: (xlsxBytes) => xlsxToMarkdown(xlsxBytes),
  encode: (markdownBytes) => markdownToXlsx(markdownBytes),
});

// csv bytes <-> PDF bytes: the no-options form over csvToPdf/pdfToCsv (convert.ts), schema-validated both ways. csvToPdf composes the csv -> ods bridge with ods -> pdf internally (csv has no layout engine of its own, exactly like xlsx), so this pair carries the same "not round-trip-lossless" caveat every PDF-pivot codec above carries, with csv's own additional boundaries on both sides: decode re-types the parsed cells heuristically (inferCellValue), encode reconstructs from geometry.
export const csvPdfCodec = z.codec(CsvBytesSchema, PdfBytesSchema, {
  decode: (csvBytes) => csvToPdf(csvBytes),
  encode: (pdfBytes) => pdfToCsv(pdfBytes),
});

// ods bytes <-> csv bytes and xlsx bytes <-> csv bytes: schema-validated z.codec() pairs over the same-variant spreadsheet bridges (convert.ts) -- direct ContentDocument pivot copies with no layout engine and no reconstruction, exactly like odsXlsxCodec above. Two honest csv-boundary caveats rather than codec lossiness: the csv side is displayText-only, so a typed ods/xlsx cell (currency, percentage, date) re-reads as whatever inferCellValue re-types its printed text as on the way back; and a multi-sheet ods/xlsx source throws CsvSheetNotSpecifiedError from the no-options build, naming every sheet, rather than silently truncating -- the identical contract the registry codec (src/codecs/registry.ts) documents for its own csv write.
export const odsCsvCodec = z.codec(OdsBytesSchema, CsvBytesSchema, {
  decode: (odsBytes) => odsToCsv(odsBytes),
  encode: (csvBytes) => csvToOds(csvBytes),
});

export const xlsxCsvCodec = z.codec(XlsxBytesSchema, CsvBytesSchema, {
  decode: (xlsxBytes) => xlsxToCsv(xlsxBytes),
  encode: (csvBytes) => csvToXlsx(csvBytes),
});

// odg bytes <-> svg bytes: a schema-validated z.codec() pair over the same-variant drawing bridge (convert.ts) -- a direct ContentDocument pivot copy with no layout engine and no reconstruction, exactly like odsXlsxCodec above. Both sides speak the identical six-primitive ContentVector vocabulary, so geometry crosses losslessly; the one boundary is paint defaults (an SVG shape with no fill attribute reads as black-filled, the SVG specification's own default). The no-options encode leg throws SvgMultiPageNotSpecifiedError on a multi-page odg rather than silently truncating -- the identical contract the registry codec (src/codecs/registry.ts) documents for its own svg write.
export const odgSvgCodec = z.codec(OdgBytesSchema, SvgBytesSchema, {
  decode: (odgBytes) => odgToSvg(odgBytes),
  encode: (svgBytes) => svgToOdg(svgBytes),
});

// csv bytes <-> markdown bytes: the no-options form over the two pdf-composed bridge functions (convert.ts), routing csv -> ods -> pdf -> markdown and markdown -> pdf -> ods -> csv. Lossy in the same stacked way as xlsxMarkdownCodec above -- the spreadsheet render and the markdown reconstruction each add their own loss -- with csv read's heuristic re-typing on top on the decode side.
export const csvMarkdownCodec = z.codec(CsvBytesSchema, MarkdownBytesSchema, {
  decode: (csvBytes) => csvToMarkdown(csvBytes),
  encode: (markdownBytes) => markdownToCsv(markdownBytes),
});
