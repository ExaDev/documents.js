import { encodePackage } from 'ooxml.js';
import { buildDocxPackage } from '../edit/docx/content';
import { openDocx } from '../edit/docx/editor';
import { buildPptxPackage } from '../edit/pptx/content';
import { openPptx } from '../edit/pptx/editor';
import { convertWordprocessingToLayout } from '../layout/engine';
import { reconstructPresentation, reconstructWordprocessing } from '../layout/reconstruct';
import { convertPresentationToLayout } from '../layout/slides';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import type { PdfDiagnosticSink } from '../pdf/diagnostics';
import { createStandardFontMeasurer } from '../pdf/measure';
import { readPdf } from '../pdf/read';
import { writePdf } from '../pdf/write';
import type { WinAnsiSubstitution } from '../pdf/winansi';

// The four ergonomic top-level conversions, each composing already-independently-tested pipeline stages: docx/pptx -> PDF reads the OOXML package into a ContentDocument, lays it out into a LayoutDocument, and writes PDF bytes; PDF -> docx/pptx reads PDF bytes into a LayoutDocument, reconstructs a best-effort ContentDocument from its geometry, and builds a fresh OOXML package. Neither direction claims round-trip fidelity -- see src/layout/reconstruct.ts's own module doc for why PDF -> docx/pptx specifically cannot.

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
