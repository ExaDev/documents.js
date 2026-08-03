import type { ContentBlock, ContentDocument, ContentSection, DocumentPackage, LayoutDocument } from 'document-schema.js';
import { COLOR_BLACK, CONTENT_FORMAT_VERSION, DOCUMENT_PACKAGE_FORMAT_VERSION, LAYOUT_FORMAT_VERSION } from 'document-schema.js';
import type { OdmSection, Package } from 'odf.js';
import { decodePackage, encodePackage as encodeOdfPackage, readOdfMetadata, readOdfParagraph, readOdfTable, readOdm } from 'odf.js';
import { buildXlsxPackage, decodePackage as decodeOoxmlPackage, encodePackage, readXlsxContent } from 'ooxml.js';
import { buildDocxPackage } from '../edit/docx/content';
import { openDocx } from '../edit/docx/editor';
import { buildOdgPackage } from '../edit/odg/content';
import { buildOdpPackage } from '../edit/odp/content';
import { buildOdsPackage } from '../edit/ods/content';
import { buildOdtPackage } from '../edit/odt/content';
import { buildPptxPackage } from '../edit/pptx/content';
import { openPptx } from '../edit/pptx/editor';
import { layoutFormula } from '../mathml/layout';
import { convertDrawingToLayout } from '../layout/drawing';
import { convertWordprocessingToLayout } from '../layout/engine';
import { reconstructDrawing, reconstructPresentation, reconstructSpreadsheet, reconstructWordprocessing } from '../layout/reconstruct';
import { convertSpreadsheetToLayout } from '../layout/sheets';
import { convertPresentationToLayout } from '../layout/slides';
import type { Margins } from '../model/geometry';
import { flipY, PAGE_SIZE_A4 } from '../model/geometry';
import { readOdfFormulaContent } from '../odf/formula/read';
import { readOdgContent } from '../odf/odg/read';
import { readOdpContent } from '../odf/odp/read';
import { readOdsContent } from '../odf/ods/read';
import { readOdtContent } from '../odf/odt/read';
import { buildOdbTableCsv } from '../odb/csv';
import type { HsqldbDecodeOptions } from '../hsqldb/rowformat';
import { readOdbTables } from '../odb/read';
import { odbTablesToSpreadsheetDocument } from '../odb/spreadsheet';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import { readMarkdownContent } from '../markdown/read';
import { buildMarkdownText } from '../markdown/write';
import { decodeMarkdownText, encodeMarkdownText } from '../markdown/text';
import type { OmmlDiagnostic } from '../omml/write';
import type { PdfDiagnosticSink, WinAnsiSubstitution } from 'pdf-codec';
import { createStandardFontMeasurer, loadMathFont, readPdf, writePdf } from 'pdf-codec';
import { throwIfAborted } from '../ports/abort';

// Twelve ergonomic conversions (docx/pptx/odt/odp/ods/odg <-> PDF, all now round-trip both ways), each composing already-independently-tested pipeline stages: docx/pptx/odt/odp/ods/odg -> PDF reads the source package into a ContentDocument, lays it out into a LayoutDocument, and writes PDF bytes -- odtToPdf and odpToPdf both reuse convertWordprocessingToLayout/convertPresentationToLayout completely unmodified, the exact same engines docxToPdf/pptxToPdf feed, since readDocxContent/readOdtContent produce the identical WordprocessingContentDocument shape and readPptxContent/readOdpContent produce the identical PresentationContentDocument shape regardless of which package format (OOXML or ODF) they read; odsToPdf and odgToPdf are each genuinely new layout algorithms instead, since neither a spreadsheet's column/row-band pagination (convertSpreadsheetToLayout, src/layout/sheets.ts) nor a drawing's vector-primitive vocabulary (convertDrawingToLayout, src/layout/drawing.ts -- which DOES reuse slides.ts's own convertShape for whatever text/image/table content a drawing page also carries) has a docx/pptx analogue to share a pivot shape with. PDF -> docx/pptx/odt/odp/ods/odg reads PDF bytes into a LayoutDocument, reconstructs a best-effort ContentDocument from its geometry via reconstructWordprocessing/reconstructPresentation/reconstructSpreadsheet/reconstructDrawing, and builds a fresh OOXML or ODF package. pdfToOdt's own package-building half is buildOdtPackage (src/edit/odt/content.ts); pdfToOdp's is buildOdpPackage (src/edit/odp/content.ts) -- the odp-side counterpart to buildPptxPackage, built on the src/edit/odp/* live-view editor, closing the same reverse-direction gap odt closed once pdfToOdt existed. pdfToOdg's is buildOdgPackage (src/edit/odg/content.ts); unlike reconstructWordprocessing/reconstructPresentation (baseline-proximity line clustering, then paragraph/text-block clustering from geometry -- see src/layout/reconstruct.ts's own module doc), reconstructDrawing does no clustering at all, since a drawing has no semantic paragraph or shape structure to recover in the first place -- every painted LayoutItem maps close to 1:1 back onto a ContentVector or ContentShape, in the exact z-order it was painted. pdfToOds's own package-building half is buildOdsPackage (src/edit/ods/content.ts); reconstructSpreadsheet is a genuinely different geometry-recovery problem from either of those two -- a real gridline lattice (when a printed sheet had gridlines enabled) is used DIRECTLY as cell boundaries, and absent one, text is clustered into a 2D grid (rows via clusterIntoLines, columns via recurring x-position anchors) rather than a 1D paragraph flow or a 1:1 item mapping. It recovers what was printed, not what was entered: every cell comes back as a bare string carrying only its own extracted display text, never re-parsed into a number/date/boolean or claimed as a formula. No round-trip direction claims round-trip fidelity -- see src/layout/reconstruct.ts's own module doc for why PDF -> docx/pptx/odt/odp/ods/odg specifically cannot. xlsx <-> PDF is a further, thirteenth round-trip pair with the same ergonomic shape and options as the twelve above, but composed rather than laid out directly -- see xlsxToPdf/pdfToXlsx's own comment further down this file for why. markdown <-> PDF is a fourteenth pair, and needs ZERO new layout code at all: readMarkdownContent (src/markdown/read.ts) produces the identical WordprocessingContentDocument shape readDocxContent/readOdtContent already do, so markdownToPdf feeds convertWordprocessingToLayout completely unmodified, the exact same engine docxToPdf/odtToPdf feed -- markdown becomes the THIRD format sharing that one pivot and one layout engine, not just a second data point. pdfToMarkdown's own package-building half is buildMarkdownText (src/markdown/write.ts), reusing reconstructWordprocessing unmodified too. This makes pdfToMarkdown the single lossiest conversion in the whole package: every other PDF -> X direction reconstructs into a format that can still represent most of what reconstructWordprocessing recovers (styleId, bold/italic/colour/size, list membership, table structure) -- markdown itself cannot. CommonMark/GFM has no colour, no font family, no font size, no explicit alignment, and no page-geometry concept at all, so buildMarkdownText's own writeMarkdown discards every one of those on top of whatever reconstructWordprocessing's own geometry-based best-effort recovery already approximated from the PDF page. Two independent, stacked layers of lossiness, not one.

export interface DocumentToPdfOptions {
  readonly signal?: AbortSignal;
  // Called once per WinAnsi character substitution made while emitting text (see pdf-codec's winansi.ts) -- writePdf's own hook, passed straight through.
  readonly onSubstitution?: (substitution: WinAnsiSubstitution, context: { readonly pageIndex: number }) => void;
  // Called exactly once, synchronously, with the DocumentPackage (content + layout) this conversion built internally, before the function returns its bytes -- a side channel for a caller that wants the intermediate pivot value, not just the target bytes, mirroring onSubstitution's own callback shape. Every conversion sharing this options type invokes it, odfToPdf included: a standalone formula document reports a genuine 'formula'-kind ContentDocument (see that function's own comment for what its LayoutDocument half does and does not carry).
  readonly onDocument?: (pkg: DocumentPackage) => void;
}

export function docxToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  const pkg = openDocx(bytes).toPackage();
  const content = readDocxContent(pkg);
  // readDocxContent's declared return type is the full ContentDocument union, even though it always produces the wordprocessing variant in practice -- this both documents and enforces that.
  if (content.kind !== 'wordprocessing') {
    throw new Error('readDocxContent returned a non-wordprocessing ContentDocument');
  }
  const { document: layout, formulas } = convertWordprocessingToLayout(content, { measurer: createStandardFontMeasurer() });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution, formulas });
}

// odt's package is decoded via odf.js's own decodePackage, NOT ooxml.js's -- an odt file is an ODF package, not an OOXML one, so it needs odf.js's own codec to become a Package at all. Everything downstream of that (readOdtContent -> convertWordprocessingToLayout -> writePdf) is identical to docxToPdf's own pipeline, byte for byte at the call-site level, which is the whole architectural point: an embedded formula travels inside the ContentDocument itself (a real ContentEmbeddedObjectBlock carrying a 'formula'-kind document -- see src/model/formula.ts), so there is no odt-specific option to thread anywhere, and the layout engine renders real MathML without ever being told which format the document came from.
export function odtToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  const pkg = decodePackage(bytes);
  const content = readOdtContent(pkg);
  // readOdtContent's declared return type is the full ContentDocument union, even though it always produces the wordprocessing variant in practice -- this both documents and enforces that, mirroring docxToPdf's own guard above.
  if (content.kind !== 'wordprocessing') {
    throw new Error('readOdtContent returned a non-wordprocessing ContentDocument');
  }
  const { document: layout, formulas } = convertWordprocessingToLayout(content, { measurer: createStandardFontMeasurer() });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution, formulas });
}

export function pptxToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  const pkg = openPptx(bytes).toPackage();
  const content = readPptxContent(pkg);
  if (content.kind !== 'presentation') {
    throw new Error('readPptxContent returned a non-presentation ContentDocument');
  }
  const { document: layout, formulas } = convertPresentationToLayout(content, { measurer: createStandardFontMeasurer() });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  // Threaded through for the same reason odpToPdf's is, even though readPptxContent produces no formula block today: a formula lives inside the ContentDocument now, so whether any given conversion can carry one is a property of its READER, not of its writePdf call -- discarding the engine's own formula output here would silently drop one the moment ooxml.js's reader learns to produce an OMML-sourced formula block.
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution, formulas });
}

// odp's package is decoded via odf.js's own decodePackage, NOT ooxml.js's -- an odp file is an ODF package, not an OOXML one, so it needs odf.js's own codec to become a Package at all. Everything downstream of that (readOdpContent -> convertPresentationToLayout -> writePdf) is identical to pptxToPdf's own pipeline, including the same hidden-annotation speaker-notes mechanism (see src/layout/slides.ts's own note-carrying comment), which is what this package's own tests prove notes survive for free. An embedded formula needs no special wiring here either, for the same reason odtToPdf's doesn't: it travels inside the ContentDocument as a real embedded-object block.
export function odpToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  const pkg = decodePackage(bytes);
  const content = readOdpContent(pkg);
  // readOdpContent's declared return type is the full ContentDocument union, even though it always produces the presentation variant in practice -- this both documents and enforces that, mirroring pptxToPdf's own guard above.
  if (content.kind !== 'presentation') {
    throw new Error('readOdpContent returned a non-presentation ContentDocument');
  }
  const { document: layout, formulas } = convertPresentationToLayout(content, { measurer: createStandardFontMeasurer() });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution, formulas });
}

// ods's package is decoded via odf.js's own decodePackage, mirroring odtToPdf/odpToPdf above -- but unlike those two, convertSpreadsheetToLayout is genuinely new layout code (src/layout/sheets.ts), not a reused docx/pptx engine, since a spreadsheet's own column-band x row-band pagination and print-settings-driven page grid have no docx/pptx analogue.
export function odsToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  const pkg = decodePackage(bytes);
  const content = readOdsContent(pkg);
  // readOdsContent's declared return type is the full ContentDocument union, even though it always produces the spreadsheet variant in practice -- this both documents and enforces that, mirroring odtToPdf/odpToPdf's own guards above.
  if (content.kind !== 'spreadsheet') {
    throw new Error('readOdsContent returned a non-spreadsheet ContentDocument');
  }
  const layout = convertSpreadsheetToLayout(content, { measurer: createStandardFontMeasurer(), signal: options?.signal });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution });
}

// odg's package is decoded via odf.js's own decodePackage, mirroring odtToPdf/odpToPdf/odsToPdf above. convertDrawingToLayout (src/layout/drawing.ts) is genuinely new layout code, like convertSpreadsheetToLayout -- a drawing's vector-primitive vocabulary (rect/ellipse/line/path) has no docx/pptx analogue, even though the ContentShape (text/image/table) half of a drawing page reuses convertShape from slides.ts unmodified.
export function odgToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  const pkg = decodePackage(bytes);
  const content = readOdgContent(pkg);
  // readOdgContent's declared return type is the full ContentDocument union, even though it always produces the drawing variant in practice -- this both documents and enforces that, mirroring odtToPdf/odpToPdf/odsToPdf's own guards above.
  if (content.kind !== 'drawing') {
    throw new Error('readOdgContent returned a non-drawing ContentDocument');
  }
  const layout = convertDrawingToLayout(content, { measurer: createStandardFontMeasurer() });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution });
}

// markdown bytes -> PDF bytes: readMarkdownContent(decodeMarkdownText(bytes)) feeds convertWordprocessingToLayout completely unmodified -- the identical engine docxToPdf/odtToPdf feed, since readMarkdownContent produces the same WordprocessingContentDocument shape those two adapters do (see this file's own top-of-file comment). Markdown carries no page geometry of its own -- readMarkdownContent's own defaults (document-schema.js's PAGE_SIZE_A4, markdown-codec's own 1in DEFAULT_MARGINS) supply whatever ContentSection.pageSize/margins the layout engine needs; a caller wanting different page geometry calls readMarkdownContent directly with its own ReadMarkdownOptions.pageSize/margins rather than through this fixed-options ergonomic wrapper (see DocumentToPdfOptions -- unlike readDocxContent/readOdtContent, readMarkdownContent genuinely does take options, but DocumentToPdfOptions has no room for markdown-specific ones any more than it does for a docx/odt-specific option, so only `signal` is threaded through here).
export function markdownToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const text = decodeMarkdownText(bytes);
  const content = readMarkdownContent(text, { signal: options?.signal });
  // readMarkdownContent's declared return type is the full ContentDocument union, even though it always produces the wordprocessing variant in practice -- this both documents and enforces that, mirroring docxToPdf/odtToPdf's own guards above.
  if (content.kind !== 'wordprocessing') {
    throw new Error('readMarkdownContent returned a non-wordprocessing ContentDocument');
  }
  const { document: layout, formulas } = convertWordprocessingToLayout(content, { measurer: createStandardFontMeasurer() });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution, formulas });
}

const STANDALONE_FORMULA_SIZE_PT = 18; // larger than a typical embedded formula (see engine.ts's own formulaSizePtFromFrame), since a standalone .odf's own formula is usually the whole document's content, not a small inline element.
const STANDALONE_FORMULA_MARGIN_PT = 72; // 1 inch

// odf bytes -> PDF bytes: readOdfFormulaContent -> src/mathml's layoutFormula -> a single formula positioned on one A4 page -> writePdf, with the embedded STIX Two Math font (pdf-codec's math-font.ts) doing the actual glyph rendering. options.onDocument IS invoked here now, with a genuine 'formula'-kind ContentDocument (document-schema.js 2.0.0's fifth variant, carrying the formula's own MathML and StarMath annotation) alongside the LayoutDocument -- previously there was no ContentDocument shape a standalone formula could be reported as at all, so the callback was accepted and never called. The reported `layout` still carries no LayoutItems, by construction: the formula renders through writePdf's separate `formulas` positioning rather than as page content, so its page really is empty of items and the page geometry is all the layout has to report. This is NOT one of the twelve round-trip conversions above (and has no reverse pdfToOdf, no z.codec() pair, and no DocumentConverter port entry -- see src/convert/port.ts's own note): scope for v1, per the design plan this package was built against, is odfToPdf alone, rendering "faithful mathematical typesetting" for a single formula (or small formula document). PDF -> structured MathML is a categorically different, OCR-adjacent problem -- recovering a semantic operator tree (msub vs msup vs a coincidentally-superscript-shaped run of glyphs) from nothing but positioned glyphs and paths has no geometry-reconstruction analogue anywhere else in this package (reconstructWordprocessing/reconstructPresentation recover paragraph/shape STRUCTURE from geometry, never semantic MEANING the way "this pair of glyphs forms a fraction" would require) -- and is deliberately not attempted here.
export function odfToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odf is an ODF package.
  const content = readOdfFormulaContent(pkg);
  // readOdfFormulaContent's declared return type is the full ContentDocument union, even though it always produces the formula variant in practice -- this both documents and enforces that, mirroring every other readXContent guard in this file.
  if (content.kind !== 'formula') {
    throw new Error('readOdfFormulaContent returned a non-formula ContentDocument');
  }

  const metrics = loadMathFont().metricsAt(STANDALONE_FORMULA_SIZE_PT);
  const { box } = layoutFormula(content.formula.mathml, { metrics, sizePt: STANDALONE_FORMULA_SIZE_PT, color: COLOR_BLACK });
  const flipped = flipY({ xPt: STANDALONE_FORMULA_MARGIN_PT, yPt: STANDALONE_FORMULA_MARGIN_PT, widthPt: box.widthPt, heightPt: box.heightPt }, PAGE_SIZE_A4.heightPt);

  const layout: LayoutDocument = {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: content.metadata,
    pages: [{ widthPt: PAGE_SIZE_A4.widthPt, heightPt: PAGE_SIZE_A4.heightPt, items: [] }],
    images: {},
  };
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  throwIfAborted(options?.signal);
  return writePdf(layout, { signal: options?.signal, formulas: [{ pageIndex: 0, xPt: flipped.xPt, yPt: flipped.yPt, box }] });
}

export interface PdfToDocumentOptions {
  readonly signal?: AbortSignal;
  readonly sink?: PdfDiagnosticSink;
  // Called exactly once, synchronously, with the DocumentPackage (the readPdf-produced layout, and the reconstructed content built from it) this conversion built internally, before the function returns its bytes -- see DocumentToPdfOptions.onDocument for the mirrored X-to-PDF side of this same side channel.
  readonly onDocument?: (pkg: DocumentPackage) => void;
}

export function pdfToDocx(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructWordprocessing(layout, { signal: options?.signal });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return encodePackage(buildDocxPackage(content));
}

export function pdfToPptx(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructPresentation(layout, { signal: options?.signal });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return encodePackage(buildPptxPackage(content));
}

// buildOdtPackage produces an odf.js Package, not an ooxml.js one -- odf.js's own encodePackage (aliased encodeOdfPackage above) is the correct serializer, mirroring odtToPdf's own use of odf.js's decodePackage for the read direction.
export function pdfToOdt(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructWordprocessing(layout, { signal: options?.signal });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return encodeOdfPackage(buildOdtPackage(content));
}

// buildOdpPackage produces an odf.js Package too, mirroring pdfToOdt's own use of encodeOdfPackage above -- reconstructPresentation is the exact same function odpToPdf's own module doc already documents as unmodified for odp; this is simply its reverse direction.
export function pdfToOdp(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructPresentation(layout, { signal: options?.signal });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return encodeOdfPackage(buildOdpPackage(content));
}

// buildOdgPackage produces an odf.js Package too, mirroring pdfToOdt/pdfToOdp's own use of encodeOdfPackage above. reconstructDrawing (src/layout/reconstruct.ts) is the drawing-side counterpart to reconstructWordprocessing/reconstructPresentation, but does no baseline/paragraph clustering at all -- a drawing has no semantic structure to infer, only a near-1:1 LayoutItem -> ContentVector/ContentShape mapping to make, in the same paint order the items were recovered in.
export function pdfToOdg(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructDrawing(layout, { signal: options?.signal });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return encodeOdfPackage(buildOdgPackage(content));
}

// buildOdsPackage produces an odf.js Package too, mirroring pdfToOdt/pdfToOdp/pdfToOdg's own use of encodeOdfPackage above. reconstructSpreadsheet (src/layout/reconstruct.ts) closes ods's own round trip: a real gridline lattice on the page is used directly as cell boundaries when present, otherwise text is clustered into a grid from geometry alone -- see that module's own top-of-block note. Every recovered cell is a bare string; this recovers what was printed, not what was entered.
export function pdfToOds(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructSpreadsheet(layout, { signal: options?.signal });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  return encodeOdfPackage(buildOdsPackage(content));
}

// buildMarkdownText produces a plain string, not a Package -- encodeMarkdownText (src/markdown/text.ts) is the final UTF-8 encode step every other pdfToX function's own format-specific encodePackage call plays here. reconstructWordprocessing is the exact same function pdfToDocx/pdfToOdt already document as unmodified; this is simply its third caller. This is the single lossiest conversion in the whole package -- see this file's own top-of-file comment for why.
export function pdfToMarkdown(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructWordprocessing(layout, { signal: options?.signal });
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, layout });
  const text = buildMarkdownText(content);
  return encodeMarkdownText(text);
}

// Ten cross-format bridges, five pairs (odt<->docx, odp<->pptx, ods<->xlsx, and -- further down this section -- markdown<->docx, markdown<->odt), each bypassing PDF entirely. Every conversion above this point pivots through a LayoutDocument -- a real page-of-positioned-items layout, then (on the way back) a best-effort geometric reconstruction -- because PDF has no semantic document structure of its own to preserve. These five pairs don't have that problem: both formats in each pair already read into and build from the identical ContentDocument variant (readOdtContent/readDocxContent both produce a WordprocessingContentDocument; readOdpContent/readPptxContent both produce a PresentationContentDocument; readOdsContent/readXlsxContent both produce a SpreadsheetContentDocument; readMarkdownContent shares that same WordprocessingContentDocument variant with readDocxContent/readOdtContent), so the bridge is nothing more than reader -> writer, with no layout engine, no font measurement, and no geometry-based reconstruction in between. That is a categorically different, much higher-fidelity operation than routing through odtToPdf -> pdfToDocx (or markdownToPdf -> pdfToDocx) would be -- see this module's own top-of-file comment for why the PDF-pivot conversions are lossy, and the README's Fidelity section for what these ten functions preserve instead. readXlsxContent/buildXlsxPackage come from ooxml.js (its own typed xlsx reader/writer, added alongside the rest of ooxml.js's readDocx/readPptx-family readers); the other eight reader/builder pairs are the same functions the PDF-pivot conversions above already use.
export interface DocumentBridgeOptions {
  readonly signal?: AbortSignal;
  // Called exactly once, synchronously, with the DocumentPackage this bridge built internally, before the function returns its bytes -- mirroring DocumentToPdfOptions/PdfToDocumentOptions's own onDocument. A bridge never runs a layout engine (see this section's own top-of-block comment), so `layout` is always left undefined here -- DocumentPackageSchema already models layout as optional for exactly this case, and running a layout conversion purely to populate a field no caller asked for would be wasted work.
  readonly onDocument?: (pkg: DocumentPackage) => void;
  // Called once per MathML construct that degraded or was approximated while an embedded formula was translated into OMML (src/omml/write.ts). Only the bridges that BUILD a docx from a formula-bearing source can ever invoke it: odtToDocx genuinely can, markdownToDocx threads it for consistency but has no formula construct in its own source format to produce one from, and every other bridge in this section either builds a non-OOXML package or has no formula-writing path at all. pdfToDocx deliberately has no equivalent option -- reconstructWordprocessing recovers positioned glyphs, never a formula block, so there is nothing there to report.
  readonly onMathDiagnostic?: (diagnostic: OmmlDiagnostic, context: { readonly sourcePath?: string }) => void;
}

// odt bytes -> docx bytes: readOdtContent(decodePackage(odtBytes)) feeds directly into buildDocxPackage, then ooxml.js's own encodePackage serializes the result -- no writePdf/readPdf, no measurer, no reconstruction. Cancellation has no loop to hook into the way writePdf/readPdf's own page/content-stream loops do (see src/ports/abort.ts's own module comment) -- read and build are each a single bounded pass over the source document -- so the signal is checked once before each of those two stages rather than threaded into buildDocxPackage/readOdtContent themselves, which accept no such option today. An embedded formula now crosses this bridge as REAL, editable OOXML math: buildDocxPackage translates the block's own MathML into genuine OMML (m:oMathPara > m:oMath -- see src/omml/write.ts) rather than degrading it to the plain-text stand-in it used to become. Only a construct OMML has no counterpart for degrades, individually and with a diagnostic reported through options.onMathDiagnostic.
export function odtToDocx(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odt is an ODF package.
  const content = readOdtContent(pkg);
  if (content.kind !== 'wordprocessing') {
    throw new Error('readOdtContent returned a non-wordprocessing ContentDocument');
  }
  throwIfAborted(options?.signal);
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content });
  return encodePackage(buildDocxPackage(content, { onMathDiagnostic: options?.onMathDiagnostic })); // ooxml.js's own encodePackage -- buildDocxPackage produces an OOXML package.
}

// docx bytes -> odt bytes, the reverse of odtToDocx: readDocxContent(decodePackage(docxBytes)) feeds directly into buildOdtPackage, then odf.js's own encodePackage serializes the result.
export function docxToOdt(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodeOoxmlPackage(bytes); // ooxml.js's own decodePackage -- docx is an OOXML package.
  const content = readDocxContent(pkg);
  if (content.kind !== 'wordprocessing') {
    throw new Error('readDocxContent returned a non-wordprocessing ContentDocument');
  }
  throwIfAborted(options?.signal);
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content });
  return encodeOdfPackage(buildOdtPackage(content)); // odf.js's own encodePackage -- buildOdtPackage produces an ODF package.
}

// odp bytes -> pptx bytes, mirroring odtToDocx exactly for the presentation variant: readOdpContent(decodePackage(odpBytes)) -> buildPptxPackage -> ooxml.js's encodePackage. Speaker notes carry across for free -- both readOdpContent and readPptxContent populate ContentSlide.notes from their own format's native notes mechanism (odp's presentation:notes page vs pptx's notesSlide part), and buildPptxPackage writes ContentSlide.notes straight into a real p:notes part, not the hidden-annotation trick odpToPdf/pptxToPdf need to smuggle notes through a format (PDF) that has no native concept of them at all.
export function odpToPptx(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odp is an ODF package.
  const content = readOdpContent(pkg);
  if (content.kind !== 'presentation') {
    throw new Error('readOdpContent returned a non-presentation ContentDocument');
  }
  throwIfAborted(options?.signal);
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content });
  return encodePackage(buildPptxPackage(content)); // ooxml.js's own encodePackage -- buildPptxPackage produces an OOXML package.
}

// pptx bytes -> odp bytes, the reverse of odpToPptx: readPptxContent(decodePackage(pptxBytes)) -> buildOdpPackage -> odf.js's encodePackage. Notes carry across for the identical reason odpToPptx's own comment documents.
export function pptxToOdp(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodeOoxmlPackage(bytes); // ooxml.js's own decodePackage -- pptx is an OOXML package.
  const content = readPptxContent(pkg);
  if (content.kind !== 'presentation') {
    throw new Error('readPptxContent returned a non-presentation ContentDocument');
  }
  throwIfAborted(options?.signal);
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content });
  return encodeOdfPackage(buildOdpPackage(content)); // odf.js's own encodePackage -- buildOdpPackage produces an ODF package.
}

// ods bytes -> xlsx bytes, mirroring odtToDocx/odpToPptx for the spreadsheet variant: readOdsContent(decodePackage(odsBytes)) -> buildXlsxPackage -> ooxml.js's encodePackage. This is the least mature of the three bridges -- buildXlsxPackage is ooxml.js's first xlsx writer, and readOdsContent/buildXlsxPackage's own documented gaps (see this package's README Gotchas) both still apply here exactly as they do to every other caller of those two functions.
export function odsToXlsx(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- ods is an ODF package.
  const content = readOdsContent(pkg);
  if (content.kind !== 'spreadsheet') {
    throw new Error('readOdsContent returned a non-spreadsheet ContentDocument');
  }
  throwIfAborted(options?.signal);
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content });
  return encodePackage(buildXlsxPackage(content)); // ooxml.js's own encodePackage -- buildXlsxPackage produces an OOXML package.
}

// xlsx bytes -> ods bytes, the reverse of odsToXlsx: readXlsxContent(decodePackage(xlsxBytes)) -> buildOdsPackage -> odf.js's encodePackage. readXlsxContent's declared return type is document-schema.js's own ContentDocument union (ooxml.js re-exports it), the exact same type this package imports directly, so the narrowed value passes straight into buildOdsPackage without any conversion step.
export function xlsxToOds(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodeOoxmlPackage(bytes); // ooxml.js's own decodePackage -- xlsx is an OOXML package.
  const content = readXlsxContent(pkg);
  if (content.kind !== 'spreadsheet') {
    throw new Error('readXlsxContent returned a non-spreadsheet ContentDocument');
  }
  throwIfAborted(options?.signal);
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content });
  return encodeOdfPackage(buildOdsPackage(content)); // odf.js's own encodePackage -- buildOdsPackage produces an ODF package.
}

// markdown bytes -> docx bytes: readMarkdownContent(decodeMarkdownText(bytes)) feeds directly into buildDocxPackage, then ooxml.js's own encodePackage serializes the result -- mirroring odtToDocx exactly, since markdown and docx both read into / build from the identical wordprocessing ContentDocument variant (see capability.ts's own FORMAT_CAPABILITIES.markdown). No writePdf/readPdf, no measurer, no reconstruction -- the same "reader -> writer, nothing in between" shape every bridge in this section has. Markdown carries no page geometry of its own (see markdownToPdf's own comment above); readMarkdownContent's own defaults supply whatever ContentSection.pageSize/margins buildDocxPackage needs.
export function markdownToDocx(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const text = decodeMarkdownText(bytes);
  const content = readMarkdownContent(text, { signal: options?.signal });
  // readMarkdownContent's declared return type is the full ContentDocument union, even though it always produces the wordprocessing variant in practice -- this both documents and enforces that, mirroring markdownToPdf's own guard above.
  if (content.kind !== 'wordprocessing') {
    throw new Error('readMarkdownContent returned a non-wordprocessing ContentDocument');
  }
  throwIfAborted(options?.signal);
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content });
  return encodePackage(buildDocxPackage(content, { onMathDiagnostic: options?.onMathDiagnostic })); // ooxml.js's own encodePackage -- buildDocxPackage produces an OOXML package.
}

// docx bytes -> markdown bytes, the reverse of markdownToDocx: readDocxContent(decodeOoxmlPackage(docxBytes)) feeds directly into buildMarkdownText, then encodeMarkdownText (src/markdown/text.ts) is the final UTF-8 encode step in place of every other bridge's own format-specific encodePackage call.
export function docxToMarkdown(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodeOoxmlPackage(bytes); // ooxml.js's own decodePackage -- docx is an OOXML package.
  const content = readDocxContent(pkg);
  if (content.kind !== 'wordprocessing') {
    throw new Error('readDocxContent returned a non-wordprocessing ContentDocument');
  }
  throwIfAborted(options?.signal);
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content });
  const text = buildMarkdownText(content);
  return encodeMarkdownText(text);
}

// markdown bytes -> odt bytes, mirroring markdownToDocx for the odt side of the same wordprocessing variant: readMarkdownContent(decodeMarkdownText(bytes)) feeds directly into buildOdtPackage, then odf.js's own encodePackage serializes the result. An embedded formula has no markdown source construct to come from at all, so -- unlike odtToDocx's own comment on this point -- there is nothing here for buildOdtPackage's own formula-writing (there is none) to even be silent about.
export function markdownToOdt(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const text = decodeMarkdownText(bytes);
  const content = readMarkdownContent(text, { signal: options?.signal });
  // readMarkdownContent's declared return type is the full ContentDocument union, even though it always produces the wordprocessing variant in practice -- this both documents and enforces that, mirroring markdownToPdf's own guard above.
  if (content.kind !== 'wordprocessing') {
    throw new Error('readMarkdownContent returned a non-wordprocessing ContentDocument');
  }
  throwIfAborted(options?.signal);
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content });
  return encodeOdfPackage(buildOdtPackage(content)); // odf.js's own encodePackage -- buildOdtPackage produces an ODF package.
}

// odt bytes -> markdown bytes, the reverse of markdownToOdt: readOdtContent(decodePackage(odtBytes)) feeds directly into buildMarkdownText, then encodeMarkdownText encodes the result. An embedded formula degrades to its own plain-text stand-in here exactly as it does in odtToDocx -- CommonMark/GFM has no math construct at all, so buildMarkdownText flattens a formula block to a paragraph carrying that text (src/markdown/write.ts's own toLegacyBlock).
export function odtToMarkdown(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odt is an ODF package.
  const content = readOdtContent(pkg);
  if (content.kind !== 'wordprocessing') {
    throw new Error('readOdtContent returned a non-wordprocessing ContentDocument');
  }
  throwIfAborted(options?.signal);
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content });
  const text = buildMarkdownText(content);
  return encodeMarkdownText(text);
}

// xlsx bytes <-> PDF bytes: xlsx has no layout engine of its own -- there is no convertSpreadsheetToLayout-equivalent xlsx entry point, only ods's (see capability.ts's own FORMAT_CAPABILITIES.xlsx) -- so these two compose the existing ods<->xlsx bridge with the existing ods<->pdf layout-engine pair rather than duplicating one: xlsxToPdf is xlsxToOds followed by odsToPdf; pdfToXlsx is pdfToOds followed by odsToXlsx. Each hop's own bytes are decoded and rebuilt in full -- there is no shortcut reusing an already-parsed ContentDocument across the two calls -- but this is still a genuine, direct, single-call conversion pair from a caller's own point of view, not a composition they have to chain themselves; capability.ts's DIRECT_EDGES lists both as real edges for exactly that reason. Every existing fidelity caveat this composition inherits (the ods<->xlsx bridge's own percentage/currency/time/formula-dialect gaps; PDF -> ods's own "recovers what was printed, not what was entered" limit) is already documented at its own source and is not restated here. The `onDocument` callback reports only the LAST hop's own package, not the intermediate one: for xlsxToPdf that is odsToPdf's package (content + layout, exactly the shape every other X-to-PDF conversion above already reports); for pdfToXlsx that is odsToXlsx's package (content only, layout undefined, exactly the shape every PDF-bypassing bridge already reports) -- the final hop's own package is the one that actually reflects what was written to the returned bytes.
export function xlsxToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const odsBytes = xlsxToOds(bytes, { signal: options?.signal });
  throwIfAborted(options?.signal);
  return odsToPdf(odsBytes, { signal: options?.signal, onSubstitution: options?.onSubstitution, onDocument: options?.onDocument });
}

export function pdfToXlsx(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const odsBytes = pdfToOds(bytes, { signal: options?.signal, sink: options?.sink });
  throwIfAborted(options?.signal);
  return odsToXlsx(odsBytes, { signal: options?.signal, onDocument: options?.onDocument });
}

// odmToPdf -- the fourteenth conversion, and the one deliberately not shaped like the other twelve: a .odm master document doesn't carry its chapters' own content at all (readOdm's own module -- see odf.js's implementation report -- confirmed against real LibreOffice output that a text:section-source is always a bare external reference, never an embedded or cached copy), so producing a PDF requires a caller-supplied resolveSubDocument callback to hand back each chapter's own .odt bytes given its href. This is why odmToPdf takes an options object shape the other twelve conversions don't, and why it is not wired into the DocumentConverter port (src/convert/port.ts) -- that port's convert(request, options) contract is fixed single-bytes-in/bytes-out, and widening it with a resolver parameter for this one format would leak an odm-specific concern into every other conversion's own request shape. A caller wanting odmToPdf behind the port can wrap it in their own adapter.
export interface OdmToPdfOptions extends DocumentToPdfOptions {
  // Called once per section whose chapter content could not be read inline from the master document itself, with that section's own href (e.g. "../chapter1.odt"). Returns that chapter's own .odt bytes, or undefined if the caller has no bytes for it -- an undefined result is not itself an error here; odmToPdf collects every section that ends up unresolved (no inline content AND no bytes from this callback, or no callback at all) and throws exactly once, naming all of them, rather than surfacing only the first the loop happens to reach.
  readonly resolveSubDocument?: (href: string) => Uint8Array<ArrayBuffer> | undefined;
}

// The throw tier for odmToPdf's own source-resolution step: a section whose chapter content could not be obtained at all. This mirrors pdf-codec's diagnostics.ts's own PdfParseError -- "a file that cannot be meaningfully processed at all" throws rather than degrading -- but that class's own code namespace and module doc are both scoped to pdf-codec's own read-side failures specifically ("This module is the shared vocabulary every other read-side module reports through"), and odmToPdf's own failure happens earlier, before any PDF has been touched, while still resolving the master document's own external references. A dedicated class rather than a PdfParseError subclass, then, with every unresolved href collected up front (see the loop in odmToPdf below) so a caller sees the complete list in one thrown error instead of fixing hrefs one at a time across repeated calls.
export class OdmUnresolvedSectionError extends Error {
  readonly hrefs: readonly string[];

  constructor(hrefs: readonly string[]) {
    super(`odmToPdf: ${hrefs.length} chapter section(s) could not be resolved -- no inline content and no resolveSubDocument result for: ${hrefs.join(', ')}`);
    this.name = 'OdmUnresolvedSectionError';
    this.hrefs = hrefs;
  }
}

// 2cm margins on an A4 page -- the exact fallback odf.js's own readOdt falls back to (readFirstMasterPageGeometry) when a document has no page-layout of its own, confirmed directly against the installed odf.js 1.9.0 build. inlineOdmSectionToContentSection reaches this same fallback for the identical reason: inline chapter content was never its own document with its own master-page/page-layout chain to resolve a real page size from.
const INLINE_SECTION_MARGIN_PT = 56.69291338582677;
const INLINE_SECTION_MARGINS: Margins = { topPt: INLINE_SECTION_MARGIN_PT, rightPt: INLINE_SECTION_MARGIN_PT, bottomPt: INLINE_SECTION_MARGIN_PT, leftPt: INLINE_SECTION_MARGIN_PT };

// Builds a ContentSection directly from an OdmSection's own inlineContent (readonly XmlNode[]), for the case readOdm's own type declares but the installed odf.js 1.9.0 never actually produces (see readOdm's own implementation report: a real .odm's text:section-source is always a bare external reference, never inline-cached content) -- kept for schema-completeness against a future odf.js version, or a producer other than LibreOffice, that does populate it. readOdfParagraph/readOdfTable are the exact per-element primitives odf.js's own readOdt calls internally (via its own unexported readBlocks) to build a real chapter's blocks, so walking inlineContent with them directly produces the identical ContentParagraph/ContentTable shapes readOdt would for equivalent real chapter content. Any other inline node kind (a bare draw frame, a table-of-contents placeholder) has no ContentBlock this package's own odt reader produces either -- silently skipped, mirroring paginateSection's own handling of block kinds it doesn't lay out (src/layout/engine.ts).
export function inlineOdmSectionToContentSection(section: OdmSection, pkg: Package): ContentSection {
  const blocks: ContentBlock[] = [];
  for (const node of section.inlineContent ?? []) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'text:p' || node.tag === 'text:h') {
      blocks.push(readOdfParagraph(node, pkg));
    } else if (node.tag === 'table:table') {
      blocks.push(readOdfTable(node, pkg));
    }
  }
  return { pageSize: PAGE_SIZE_A4, margins: INLINE_SECTION_MARGINS, blocks };
}

// Prepends an explicit page-break block to a chapter's own first section, the same {kind:'pageBreak'} block ooxml.js's own readDocx already derives from w:pageBreakBefore (see paginateSection's own handling of it, src/layout/engine.ts) -- signalling "a new chapter starts here" as an explicit content-level marker rather than leaning on the incidental fact that a fresh ContentSection already starts its own fresh page in the engine today. Applied to every chapter after the first when combining chapters below.
function withLeadingChapterBreak(section: ContentSection): ContentSection {
  const pageBreak: ContentBlock = { kind: 'pageBreak' };
  return { ...section, blocks: [pageBreak, ...section.blocks] };
}

// odm bytes -> PDF bytes: reads the master document's own text:section list (readOdm), resolves each chapter's own content -- inline (rare to nonexistent in practice, see inlineOdmSectionToContentSection's own note) or via options.resolveSubDocument reading that section's href -- then concatenates every chapter's own ContentSection[] in text:section document order into one combined section list, with an explicit page-break block marking each chapter boundary, and feeds the WHOLE combined document through convertWordprocessingToLayout completely unmodified. This is the same "zero engine modification" bet every other conversion in this file relies on: the engine has no idea, and no way to tell, that its sections came from six chapters instead of one document's own multi-section w:sectPr/style:master-page structure. A section with neither inline content nor a resolveSubDocument result is never silently dropped -- every such section across the whole document is collected first, and only once every section has been attempted does an OdmUnresolvedSectionError throw, naming all of them together.
export function odmToPdf(bytes: Uint8Array<ArrayBuffer>, options?: OdmToPdfOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odm is an ODF package.
  const odm = readOdm(pkg);

  const unresolvedHrefs: string[] = [];
  const chapterSections: ContentSection[][] = [];

  for (const section of odm.sections) {
    throwIfAborted(options?.signal);

    if (section.inlineContent !== undefined) {
      chapterSections.push([inlineOdmSectionToContentSection(section, pkg)]);
      continue;
    }

    const chapterBytes = options?.resolveSubDocument?.(section.href);
    if (chapterBytes === undefined) {
      unresolvedHrefs.push(section.href);
      continue;
    }

    const chapterPkg = decodePackage(chapterBytes); // odf.js's own decodePackage -- a linked chapter is itself an odt (ODF) package.
    const chapterContent = readOdtContent(chapterPkg);
    if (chapterContent.kind !== 'wordprocessing') {
      throw new Error('readOdtContent returned a non-wordprocessing ContentDocument');
    }
    // A chapter's own embedded formulas need nothing special here at all: a formula is an ordinary block inside the chapter's own ContentDocument (see src/model/formula.ts), so it survives concatenation into the combined document exactly as every paragraph and table does, and renders as real MathML through the same convertWordprocessingToLayout every other conversion uses. This used to be a documented gap -- the formulas travelled in a side-channel map keyed by sourcePath, and re-keying every entry against combinedSections' own renumbered block indices was intractable -- which the move of a formula's content INTO the ContentDocument removed outright rather than solved.
    chapterSections.push(chapterContent.sections);
  }

  if (unresolvedHrefs.length > 0) {
    throw new OdmUnresolvedSectionError(unresolvedHrefs);
  }

  const combinedSections: ContentSection[] = [];
  chapterSections.forEach((sections, chapterIndex) => {
    if (chapterIndex === 0) {
      combinedSections.push(...sections);
      return;
    }
    combinedSections.push(...sections.map((section, sectionIndex) => (sectionIndex === 0 ? withLeadingChapterBreak(section) : section)));
  });

  throwIfAborted(options?.signal);
  // Typed via Extract rather than the full ContentDocument union -- unlike every X-to-PDF sibling above, which reads a full-union-typed ContentDocument from another function and narrows it with a runtime `if (content.kind !== '...')` guard, this object is a literal this function writes itself two lines below: its 'wordprocessing' discriminant is already statically known, so a runtime guard here would only ever check something already proven at compile time.
  const content: Extract<ContentDocument, { kind: 'wordprocessing' }> = {
    kind: 'wordprocessing',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: readOdfMetadata(pkg),
    sections: combinedSections,
  };
  const { document: layout, formulas } = convertWordprocessingToLayout(content, { measurer: createStandardFontMeasurer() });
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution, formulas });
}

// odb (ODF database front-end) Tier 1 support: readOdbTables(pkg) already does the real work (decoder selection over odf.js's own readOdbInventory, then src/hsqldb/script.ts's bounded HSQLDB TEXT-script parser) -- odbToXlsx/odbToCsv below are thin compositions over it, matching odsToXlsx's own "reader -> pivot -> writer" shape. Unlike every conversion above, .odb has no PDF conversion and no reverse (xlsx/csv -> odb) direction at all -- Reports require live SQL execution to render, categorically out of scope (see README) -- so, like odmToPdf, these are deliberately NOT wired into the DocumentConverter port (src/convert/port.ts): that port's {source, targetFormat} contract assumes a conversion has a natural place in DocumentFormat's own bytes-in/bytes-out shape, and odb's own asymmetry (one source format, two unrelated target shapes, one of which needs a table-selection option the other doesn't) doesn't fit it any better than odmToPdf's resolver-shaped conversion did.
export interface OdbConversionOptions extends DocumentBridgeOptions, HsqldbDecodeOptions {}

export function odbToXlsx(bytes: Uint8Array<ArrayBuffer>, options?: OdbConversionOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odb is an ODF package.
  const tables = readOdbTables(pkg, { timeZone: options?.timeZone });
  throwIfAborted(options?.signal);
  const content = odbTablesToSpreadsheetDocument(tables);
  return encodePackage(buildXlsxPackage(content)); // ooxml.js's own encodePackage -- buildXlsxPackage produces an OOXML package.
}

export interface OdbToCsvOptions extends OdbConversionOptions {
  // Selects which table to write as CSV. Required whenever the .odb has more than one table -- omitting it then throws OdbTableNotSpecifiedError naming every available table, rather than guessing. May be omitted when the .odb has exactly one table.
  readonly table?: string;
}

export function odbToCsv(bytes: Uint8Array<ArrayBuffer>, options?: OdbToCsvOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odb is an ODF package.
  const tables = readOdbTables(pkg, { timeZone: options?.timeZone });
  throwIfAborted(options?.signal);
  return buildOdbTableCsv(tables, options?.table);
}
