import type { DocumentBridgeOptions, DocumentToPdfOptions, PdfToDocumentOptions } from './convert';
import {
  docxToOdt,
  docxToPdf,
  odfToPdf,
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
  pptxToOdp,
  pptxToPdf,
  xlsxToOds,
} from './convert';
import type { DocumentFormat } from './port';

// This module models the real ContentDocument-variant compatibility this family already has (wordprocessing = {docx, odt}, presentation = {pptx, odp}, spreadsheet = {xlsx, ods}, drawing = {odg alone}) plus which nodes have a direct layout-engine path to/from LayoutDocument, then exposes a small, capped, one-intermediate-hop path resolver over that model. Today, every (source, target) pair this package actually supports (local.ts's own DIRECT_EDGES below) already has either a direct layout-engine edge to/from pdf or a direct same-variant bridge -- the one gap in the whole format set is xlsx, which shares the spreadsheet variant with ods but has no layout-engine edge of its own, so it can only reach pdf today by a caller manually chaining xlsxToOds + odsToPdf. resolveConversionPath can already find that one-hop composed path (xlsx -> ods -> pdf, via the existing ods<->xlsx bridge and ods<->pdf layout edge) -- see capability.test.ts's own dedicated proof -- but local.ts deliberately does not dispatch on a composed strategy yet, and DIRECT_EDGES/SUPPORTED_CONVERSIONS deliberately do not include xlsx<->pdf yet: wiring composition into the public conversion list and convert()'s own dispatch is the next phase's job, not this one.

export type ContentVariant = 'wordprocessing' | 'presentation' | 'spreadsheet' | 'drawing';

export interface FormatCapability {
  readonly format: DocumentFormat;
  // The ContentDocument variant this format reads into / builds from, when it participates in that shared pivot at all. `pdf` is the LayoutDocument pivot itself, not a ContentDocument variant; `odf` (a standalone ODF formula document) reads into its own formula shape with no ContentDocument-shaped structure at all (see convert.ts's own odfToPdf comment) -- both leave this undefined.
  readonly variant?: ContentVariant;
  // Whether a direct layout-engine conversion (a real ContentDocument -> LayoutDocument -> PDF pipeline, or its reverse) already exists for this format today. `odf` is a one-way exception -- formula -> PDF only, with no reverse and no genuine round-trip layout pivot (see odfToPdf's own module comment on why pdf -> odf is not attempted) -- so it is modelled as false here even though its own one-way edge is still present in DIRECT_EDGES below.
  readonly hasLayoutPath: boolean;
}

export const FORMAT_CAPABILITIES: Readonly<Record<DocumentFormat, FormatCapability>> = {
  docx: { format: 'docx', variant: 'wordprocessing', hasLayoutPath: true },
  odt: { format: 'odt', variant: 'wordprocessing', hasLayoutPath: true },
  pptx: { format: 'pptx', variant: 'presentation', hasLayoutPath: true },
  odp: { format: 'odp', variant: 'presentation', hasLayoutPath: true },
  ods: { format: 'ods', variant: 'spreadsheet', hasLayoutPath: true },
  // xlsx shares the spreadsheet ContentDocument variant with ods (readXlsxContent/buildXlsxPackage, both from ooxml.js) but has no layout-engine path of its own -- there is no convertSpreadsheetToLayout-equivalent xlsx entry point, only ods's.
  xlsx: { format: 'xlsx', variant: 'spreadsheet', hasLayoutPath: false },
  odg: { format: 'odg', variant: 'drawing', hasLayoutPath: true },
  odf: { format: 'odf', hasLayoutPath: false },
  pdf: { format: 'pdf', hasLayoutPath: false },
};

// A direct edge already implemented in convert.ts, discriminated by which options shape (and therefore which diagnostic/document-callback wiring) its own `convert` function accepts -- mirroring the three option interfaces convert.ts itself declares (DocumentToPdfOptions, PdfToDocumentOptions, DocumentBridgeOptions).
export interface ToPdfEdge {
  readonly kind: 'toPdf';
  readonly source: DocumentFormat;
  readonly target: 'pdf';
  readonly convert: (bytes: Uint8Array<ArrayBuffer>, options: DocumentToPdfOptions) => Uint8Array<ArrayBuffer>;
}

export interface FromPdfEdge {
  readonly kind: 'fromPdf';
  readonly source: 'pdf';
  readonly target: DocumentFormat;
  readonly convert: (bytes: Uint8Array<ArrayBuffer>, options: PdfToDocumentOptions) => Uint8Array<ArrayBuffer>;
}

export interface BridgeEdge {
  readonly kind: 'bridge';
  readonly source: DocumentFormat;
  readonly target: DocumentFormat;
  readonly convert: (bytes: Uint8Array<ArrayBuffer>, options: DocumentBridgeOptions) => Uint8Array<ArrayBuffer>;
}

export type ConversionEdge = ToPdfEdge | FromPdfEdge | BridgeEdge;

// Every direct conversion this package implements today, in the exact order local.ts's own SUPPORTED_CONVERSIONS/the DocumentConverter port's `conversions` field have always listed them -- see local.test.ts's own exact-array assertion. This is the resolver's only input in this phase: resolveConversionPath is capable of composing a path this list doesn't contain directly (xlsx<->pdf, via ods -- see this module's own top-of-file comment), but local.ts does not yet act on a composed result.
export const DIRECT_EDGES: readonly ConversionEdge[] = [
  { kind: 'toPdf', source: 'docx', target: 'pdf', convert: docxToPdf },
  { kind: 'toPdf', source: 'pptx', target: 'pdf', convert: pptxToPdf },
  { kind: 'toPdf', source: 'odt', target: 'pdf', convert: odtToPdf },
  { kind: 'toPdf', source: 'odp', target: 'pdf', convert: odpToPdf },
  { kind: 'toPdf', source: 'ods', target: 'pdf', convert: odsToPdf },
  { kind: 'toPdf', source: 'odg', target: 'pdf', convert: odgToPdf },
  // odf's own one-way direction -- see FORMAT_CAPABILITIES.odf and port.ts's own note on why there is no pdf -> odf entry below.
  { kind: 'toPdf', source: 'odf', target: 'pdf', convert: odfToPdf },
  { kind: 'fromPdf', source: 'pdf', target: 'docx', convert: pdfToDocx },
  { kind: 'fromPdf', source: 'pdf', target: 'pptx', convert: pdfToPptx },
  { kind: 'fromPdf', source: 'pdf', target: 'odt', convert: pdfToOdt },
  { kind: 'fromPdf', source: 'pdf', target: 'odp', convert: pdfToOdp },
  { kind: 'fromPdf', source: 'pdf', target: 'ods', convert: pdfToOds },
  { kind: 'fromPdf', source: 'pdf', target: 'odg', convert: pdfToOdg },
  // The six PDF-bypassing cross-format bridges (src/convert/convert.ts's own dedicated section) -- direct ContentDocument-pivot conversions, not routed through pdf.
  { kind: 'bridge', source: 'odt', target: 'docx', convert: odtToDocx },
  { kind: 'bridge', source: 'docx', target: 'odt', convert: docxToOdt },
  { kind: 'bridge', source: 'odp', target: 'pptx', convert: odpToPptx },
  { kind: 'bridge', source: 'pptx', target: 'odp', convert: pptxToOdp },
  { kind: 'bridge', source: 'ods', target: 'xlsx', convert: odsToXlsx },
  { kind: 'bridge', source: 'xlsx', target: 'ods', convert: xlsxToOds },
];

export type ConversionStrategy =
  | { readonly kind: 'direct'; readonly edge: ConversionEdge }
  | { readonly kind: 'composed'; readonly via: DocumentFormat; readonly first: ConversionEdge; readonly second: ConversionEdge };

// Capped, one-intermediate-hop path resolution over `edges` -- deliberately NOT an unbounded graph search: every real path in this family's format set resolves within one hop (a direct edge, or exactly one shared intermediate node with a direct edge on each leg), so there is no recursion and no need for one. Prefers a direct edge (today's hand-written docx<->odt, pptx<->odp, xlsx<->ods bridges, and every direct layout-engine <-> pdf edge) over composing one, and never proposes a same-format "conversion".
export function resolveConversionPath(source: DocumentFormat, target: DocumentFormat, edges: readonly ConversionEdge[] = DIRECT_EDGES): ConversionStrategy | undefined {
  if (source === target) {
    return undefined;
  }

  const direct = edges.find((edge) => edge.source === source && edge.target === target);
  if (direct !== undefined) {
    return { kind: 'direct', edge: direct };
  }

  for (const first of edges) {
    if (first.source !== source) {
      continue;
    }
    const second = edges.find((edge) => edge.source === first.target && edge.target === target);
    if (second !== undefined) {
      return { kind: 'composed', via: first.target, first, second };
    }
  }

  return undefined;
}
