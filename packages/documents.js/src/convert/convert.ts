import { decodePackage, encodePackage as encodeOdfPackage } from 'odf.js';
import { encodePackage } from 'ooxml.js';
import { buildDocxPackage } from '../edit/docx/content';
import { openDocx } from '../edit/docx/editor';
import { buildOdtPackage } from '../edit/odt/content';
import { buildPptxPackage } from '../edit/pptx/content';
import { openPptx } from '../edit/pptx/editor';
import { convertWordprocessingToLayout } from '../layout/engine';
import { reconstructPresentation, reconstructWordprocessing } from '../layout/reconstruct';
import { convertPresentationToLayout } from '../layout/slides';
import { readOdtContent } from '../odf/odt/read';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import type { PdfDiagnosticSink } from '../pdf/diagnostics';
import { createStandardFontMeasurer } from '../pdf/measure';
import { readPdf } from '../pdf/read';
import { writePdf } from '../pdf/write';
import type { WinAnsiSubstitution } from '../pdf/winansi';

// Six round-trip ergonomic conversions (docx/pptx/odt <-> PDF), each composing already-independently-tested pipeline stages: docx/pptx/odt -> PDF reads the source package into a ContentDocument, lays it out into a LayoutDocument, and writes PDF bytes -- odtToPdf reuses convertWordprocessingToLayout completely unmodified, the exact same engine docxToPdf feeds, since readDocxContent and readOdtContent both produce the identical WordprocessingContentDocument shape regardless of which package format (OOXML or ODF) they read; PDF -> docx/pptx/odt reads PDF bytes into a LayoutDocument, reconstructs a best-effort ContentDocument from its geometry via reconstructWordprocessing/reconstructPresentation (entirely unmodified, format-agnostic functions -- the same architectural bet odtToPdf's own build already proved), and builds a fresh OOXML or ODF package. pdfToOdt's own package-building half is buildOdtPackage (src/edit/odt/content.ts), the odt-side counterpart to buildDocxPackage, built on the src/edit/odt/* live-view editor. Neither round-trip direction claims round-trip fidelity -- see src/layout/reconstruct.ts's own module doc for why PDF -> docx/pptx/odt specifically cannot.

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
