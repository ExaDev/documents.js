import { decodePackage, encodePackage as encodeOdfPackage } from 'odf.js';
import { encodePackage } from 'ooxml.js';
import { buildDocxPackage } from '../edit/docx/content';
import { openDocx } from '../edit/docx/editor';
import { buildOdpPackage } from '../edit/odp/content';
import { buildOdtPackage } from '../edit/odt/content';
import { buildPptxPackage } from '../edit/pptx/content';
import { openPptx } from '../edit/pptx/editor';
import { convertWordprocessingToLayout } from '../layout/engine';
import { reconstructPresentation, reconstructWordprocessing } from '../layout/reconstruct';
import { convertSpreadsheetToLayout } from '../layout/sheets';
import { convertPresentationToLayout } from '../layout/slides';
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

// Nine ergonomic conversions (docx/pptx/odt/odp/ods <-> PDF -- ods is one-directional, PDF -> ods does not exist yet), each composing already-independently-tested pipeline stages: docx/pptx/odt/odp/ods -> PDF reads the source package into a ContentDocument, lays it out into a LayoutDocument, and writes PDF bytes -- odtToPdf and odpToPdf both reuse convertWordprocessingToLayout/convertPresentationToLayout completely unmodified, the exact same engines docxToPdf/pptxToPdf feed, since readDocxContent/readOdtContent produce the identical WordprocessingContentDocument shape and readPptxContent/readOdpContent produce the identical PresentationContentDocument shape regardless of which package format (OOXML or ODF) they read; odsToPdf is different -- there is no xlsx reader anywhere in this package's own dependency graph to share a pivot shape with, so convertSpreadsheetToLayout (src/layout/sheets.ts) is a genuinely new layout algorithm, not a reused one, and odsToPdf is its only current caller. PDF -> docx/pptx/odt/odp reads PDF bytes into a LayoutDocument, reconstructs a best-effort ContentDocument from its geometry via reconstructWordprocessing/reconstructPresentation (entirely unmodified, format-agnostic functions -- the same architectural bet odtToPdf's own build already proved, and reconstructPresentation needed zero changes for odp either), and builds a fresh OOXML or ODF package. pdfToOdt's own package-building half is buildOdtPackage (src/edit/odt/content.ts); pdfToOdp's is buildOdpPackage (src/edit/odp/content.ts) -- the odp-side counterpart to buildPptxPackage, built on the src/edit/odp/* live-view editor, closing the same reverse-direction gap odt closed once pdfToOdt existed. There is no pdfToOds: reconstructing a ContentSheet's own cell/row/column addressing from PDF geometry (which values are numbers vs formatted strings, where one cell ends and the next begins) is a fundamentally different, unstarted problem from reconstructWordprocessing/reconstructPresentation's own paragraph/shape geometry clustering, not a small extension of it. Neither round-trip direction that DOES exist claims round-trip fidelity -- see src/layout/reconstruct.ts's own module doc for why PDF -> docx/pptx/odt/odp specifically cannot.

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
