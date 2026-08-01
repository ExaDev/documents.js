import { decodePackage, encodePackage as encodeOdfPackage } from 'odf.js';
import { buildXlsxPackage, decodePackage as decodeOoxmlPackage, encodePackage, readXlsxContent } from 'ooxml.js';
import { buildDocxPackage } from '../edit/docx/content';
import { openDocx } from '../edit/docx/editor';
import { buildOdgPackage } from '../edit/odg/content';
import { buildOdpPackage } from '../edit/odp/content';
import { buildOdsPackage } from '../edit/ods/content';
import { buildOdtPackage } from '../edit/odt/content';
import { buildPptxPackage } from '../edit/pptx/content';
import { openPptx } from '../edit/pptx/editor';
import { convertDrawingToLayout } from '../layout/drawing';
import { convertWordprocessingToLayout } from '../layout/engine';
import { reconstructDrawing, reconstructPresentation, reconstructSpreadsheet, reconstructWordprocessing } from '../layout/reconstruct';
import { convertSpreadsheetToLayout } from '../layout/sheets';
import { convertPresentationToLayout } from '../layout/slides';
import { readOdgContent } from '../odf/odg/read';
import { readOdpContent } from '../odf/odp/read';
import { readOdsContent } from '../odf/ods/read';
import { readOdtContent } from '../odf/odt/read';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import type { PdfDiagnosticSink } from '../pdf/diagnostics';
import { createStandardFontMeasurer } from '../pdf/measure';
import { readPdf } from '../pdf/read';
import { writePdf } from '../pdf/write';
import type { WinAnsiSubstitution } from '../pdf/winansi';
import { throwIfAborted } from '../ports/abort';

// Twelve ergonomic conversions (docx/pptx/odt/odp/ods/odg <-> PDF, all now round-trip both ways), each composing already-independently-tested pipeline stages: docx/pptx/odt/odp/ods/odg -> PDF reads the source package into a ContentDocument, lays it out into a LayoutDocument, and writes PDF bytes -- odtToPdf and odpToPdf both reuse convertWordprocessingToLayout/convertPresentationToLayout completely unmodified, the exact same engines docxToPdf/pptxToPdf feed, since readDocxContent/readOdtContent produce the identical WordprocessingContentDocument shape and readPptxContent/readOdpContent produce the identical PresentationContentDocument shape regardless of which package format (OOXML or ODF) they read; odsToPdf and odgToPdf are each genuinely new layout algorithms instead, since neither a spreadsheet's column/row-band pagination (convertSpreadsheetToLayout, src/layout/sheets.ts) nor a drawing's vector-primitive vocabulary (convertDrawingToLayout, src/layout/drawing.ts -- which DOES reuse slides.ts's own convertShape for whatever text/image/table content a drawing page also carries) has a docx/pptx analogue to share a pivot shape with. PDF -> docx/pptx/odt/odp/ods/odg reads PDF bytes into a LayoutDocument, reconstructs a best-effort ContentDocument from its geometry via reconstructWordprocessing/reconstructPresentation/reconstructSpreadsheet/reconstructDrawing, and builds a fresh OOXML or ODF package. pdfToOdt's own package-building half is buildOdtPackage (src/edit/odt/content.ts); pdfToOdp's is buildOdpPackage (src/edit/odp/content.ts) -- the odp-side counterpart to buildPptxPackage, built on the src/edit/odp/* live-view editor, closing the same reverse-direction gap odt closed once pdfToOdt existed. pdfToOdg's is buildOdgPackage (src/edit/odg/content.ts); unlike reconstructWordprocessing/reconstructPresentation (baseline-proximity line clustering, then paragraph/text-block clustering from geometry -- see src/layout/reconstruct.ts's own module doc), reconstructDrawing does no clustering at all, since a drawing has no semantic paragraph or shape structure to recover in the first place -- every painted LayoutItem maps close to 1:1 back onto a ContentVector or ContentShape, in the exact z-order it was painted. pdfToOds's own package-building half is buildOdsPackage (src/edit/ods/content.ts); reconstructSpreadsheet is a genuinely different geometry-recovery problem from either of those two -- a real gridline lattice (when a printed sheet had gridlines enabled) is used DIRECTLY as cell boundaries, and absent one, text is clustered into a 2D grid (rows via clusterIntoLines, columns via recurring x-position anchors) rather than a 1D paragraph flow or a 1:1 item mapping. It recovers what was printed, not what was entered: every cell comes back as a bare string carrying only its own extracted display text, never re-parsed into a number/date/boolean or claimed as a formula. No round-trip direction claims round-trip fidelity -- see src/layout/reconstruct.ts's own module doc for why PDF -> docx/pptx/odt/odp/ods/odg specifically cannot.

export interface DocumentToPdfOptions {
  readonly signal?: AbortSignal;
  // Called once per WinAnsi character substitution made while emitting text (see src/pdf/winansi.ts) -- writePdf's own hook, passed straight through.
  readonly onSubstitution?: (substitution: WinAnsiSubstitution, context: { readonly pageIndex: number }) => void;
}

export function docxToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  const pkg = openDocx(bytes).toPackage();
  const content = readDocxContent(pkg);
  // readDocxContent's declared return type is the full ContentDocument union, even though it always produces the wordprocessing variant in practice -- this both documents and enforces that.
  if (content.kind !== 'wordprocessing') {
    throw new Error('readDocxContent returned a non-wordprocessing ContentDocument');
  }
  const layout = convertWordprocessingToLayout(content, { measurer: createStandardFontMeasurer() });
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution });
}

// odt's package is decoded via odf.js's own decodePackage, NOT ooxml.js's -- an odt file is an ODF package, not an OOXML one, so it needs odf.js's own codec to become a Package at all. Everything downstream of that (readOdtContent -> convertWordprocessingToLayout -> writePdf) is identical to docxToPdf's own pipeline, which is the whole architectural point.
export function odtToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  const pkg = decodePackage(bytes);
  const content = readOdtContent(pkg);
  // readOdtContent's declared return type is the full ContentDocument union, even though it always produces the wordprocessing variant in practice -- this both documents and enforces that, mirroring docxToPdf's own guard above.
  if (content.kind !== 'wordprocessing') {
    throw new Error('readOdtContent returned a non-wordprocessing ContentDocument');
  }
  const layout = convertWordprocessingToLayout(content, { measurer: createStandardFontMeasurer() });
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution });
}

export function pptxToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  const pkg = openPptx(bytes).toPackage();
  const content = readPptxContent(pkg);
  if (content.kind !== 'presentation') {
    throw new Error('readPptxContent returned a non-presentation ContentDocument');
  }
  const layout = convertPresentationToLayout(content, { measurer: createStandardFontMeasurer() });
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution });
}

// odp's package is decoded via odf.js's own decodePackage, NOT ooxml.js's -- an odp file is an ODF package, not an OOXML one, so it needs odf.js's own codec to become a Package at all. Everything downstream of that (readOdpContent -> convertPresentationToLayout -> writePdf) is identical to pptxToPdf's own pipeline, including the same hidden-annotation speaker-notes mechanism (see src/layout/slides.ts's own note-carrying comment), which is what this package's own tests prove notes survive for free.
export function odpToPdf(bytes: Uint8Array<ArrayBuffer>, options?: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  const pkg = decodePackage(bytes);
  const content = readOdpContent(pkg);
  // readOdpContent's declared return type is the full ContentDocument union, even though it always produces the presentation variant in practice -- this both documents and enforces that, mirroring pptxToPdf's own guard above.
  if (content.kind !== 'presentation') {
    throw new Error('readOdpContent returned a non-presentation ContentDocument');
  }
  const layout = convertPresentationToLayout(content, { measurer: createStandardFontMeasurer() });
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution });
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
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution });
}

export interface PdfToDocumentOptions {
  readonly signal?: AbortSignal;
  readonly sink?: PdfDiagnosticSink;
}

export function pdfToDocx(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructWordprocessing(layout, { signal: options?.signal });
  return encodePackage(buildDocxPackage(content));
}

export function pdfToPptx(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructPresentation(layout, { signal: options?.signal });
  return encodePackage(buildPptxPackage(content));
}

// buildOdtPackage produces an odf.js Package, not an ooxml.js one -- odf.js's own encodePackage (aliased encodeOdfPackage above) is the correct serializer, mirroring odtToPdf's own use of odf.js's decodePackage for the read direction.
export function pdfToOdt(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructWordprocessing(layout, { signal: options?.signal });
  return encodeOdfPackage(buildOdtPackage(content));
}

// buildOdpPackage produces an odf.js Package too, mirroring pdfToOdt's own use of encodeOdfPackage above -- reconstructPresentation is the exact same function odpToPdf's own module doc already documents as unmodified for odp; this is simply its reverse direction.
export function pdfToOdp(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructPresentation(layout, { signal: options?.signal });
  return encodeOdfPackage(buildOdpPackage(content));
}

// buildOdgPackage produces an odf.js Package too, mirroring pdfToOdt/pdfToOdp's own use of encodeOdfPackage above. reconstructDrawing (src/layout/reconstruct.ts) is the drawing-side counterpart to reconstructWordprocessing/reconstructPresentation, but does no baseline/paragraph clustering at all -- a drawing has no semantic structure to infer, only a near-1:1 LayoutItem -> ContentVector/ContentShape mapping to make, in the same paint order the items were recovered in.
export function pdfToOdg(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructDrawing(layout, { signal: options?.signal });
  return encodeOdfPackage(buildOdgPackage(content));
}

// buildOdsPackage produces an odf.js Package too, mirroring pdfToOdt/pdfToOdp/pdfToOdg's own use of encodeOdfPackage above. reconstructSpreadsheet (src/layout/reconstruct.ts) closes ods's own round trip: a real gridline lattice on the page is used directly as cell boundaries when present, otherwise text is clustered into a grid from geometry alone -- see that module's own top-of-block note. Every recovered cell is a bare string; this recovers what was printed, not what was entered.
export function pdfToOds(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = reconstructSpreadsheet(layout, { signal: options?.signal });
  return encodeOdfPackage(buildOdsPackage(content));
}

// Six cross-format bridges (odt<->docx, odp<->pptx, ods<->xlsx), each bypassing PDF entirely. Every conversion above this point pivots through a LayoutDocument -- a real page-of-positioned-items layout, then (on the way back) a best-effort geometric reconstruction -- because PDF has no semantic document structure of its own to preserve. These six pairs don't have that problem: both formats in each pair already read into and build from the identical ContentDocument variant (readOdtContent/readDocxContent both produce a WordprocessingContentDocument; readOdpContent/readPptxContent both produce a PresentationContentDocument; readOdsContent/readXlsxContent both produce a SpreadsheetContentDocument), so the bridge is nothing more than reader -> writer, with no layout engine, no font measurement, and no geometry-based reconstruction in between. That is a categorically different, much higher-fidelity operation than routing through odtToPdf -> pdfToDocx would be -- see this module's own top-of-file comment for why the PDF-pivot conversions are lossy, and the README's Fidelity section for what these six functions preserve instead. readXlsxContent/buildXlsxPackage come from ooxml.js (its own typed xlsx reader/writer, added alongside the rest of ooxml.js's readDocx/readPptx-family readers); the other four reader/builder pairs are the same functions the PDF-pivot conversions above already use.
export interface DocumentBridgeOptions {
  readonly signal?: AbortSignal;
}

// odt bytes -> docx bytes: readOdtContent(decodePackage(odtBytes)) feeds directly into buildDocxPackage, then ooxml.js's own encodePackage serializes the result -- no writePdf/readPdf, no measurer, no reconstruction. Cancellation has no loop to hook into the way writePdf/readPdf's own page/content-stream loops do (see src/ports/abort.ts's own module comment) -- read and build are each a single bounded pass over the source document -- so the signal is checked once before each of those two stages rather than threaded into buildDocxPackage/readOdtContent themselves, which accept no such option today.
export function odtToDocx(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odt is an ODF package.
  const content = readOdtContent(pkg);
  if (content.kind !== 'wordprocessing') {
    throw new Error('readOdtContent returned a non-wordprocessing ContentDocument');
  }
  throwIfAborted(options?.signal);
  return encodePackage(buildDocxPackage(content)); // ooxml.js's own encodePackage -- buildDocxPackage produces an OOXML package.
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
  return encodePackage(buildXlsxPackage(content)); // ooxml.js's own encodePackage -- buildXlsxPackage produces an OOXML package.
}

// xlsx bytes -> ods bytes, the reverse of odsToXlsx: readXlsxContent(decodePackage(xlsxBytes)) -> buildOdsPackage -> odf.js's encodePackage. readXlsxContent's declared return type is document-content-model's own ContentDocument union (ooxml.js re-exports it, rather than documents.js's local, independently-versioned equivalent -- see src/model/content.ts's own module comment on why the two stay separate types), but the two are structurally identical schemas, so the narrowed value passes straight into buildOdsPackage without any conversion step.
export function xlsxToOds(bytes: Uint8Array<ArrayBuffer>, options?: DocumentBridgeOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodeOoxmlPackage(bytes); // ooxml.js's own decodePackage -- xlsx is an OOXML package.
  const content = readXlsxContent(pkg);
  if (content.kind !== 'spreadsheet') {
    throw new Error('readXlsxContent returned a non-spreadsheet ContentDocument');
  }
  throwIfAborted(options?.signal);
  return encodeOdfPackage(buildOdsPackage(content)); // odf.js's own encodePackage -- buildOdsPackage produces an ODF package.
}
