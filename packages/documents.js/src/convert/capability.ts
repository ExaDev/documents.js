import type { DocumentBridgeOptions, DocumentToPdfOptions, PdfToDocumentOptions } from './convert';
import {
  docxToMarkdown,
  docxToOdt,
  docxToPdf,
  docxToPptx,
  markdownToDocx,
  markdownToOdt,
  markdownToPdf,
  odfToPdf,
  odgToPdf,
  odpToPdf,
  odpToPptx,
  odpToOdt,
  odsToPdf,
  odsToXlsx,
  odtToDocx,
  odtToMarkdown,
  odtToOdp,
  odtToPdf,
  pdfToDocx,
  pdfToMarkdown,
  pdfToOdg,
  pdfToOdp,
  pdfToOds,
  pdfToOdt,
  pdfToPptx,
  pdfToXlsx,
  pptxToDocx,
  pptxToOdp,
  pptxToPdf,
  xlsxToOds,
  xlsxToPdf,
  xlsxToMarkdown,
  markdownToXlsx,
} from './convert';
import type { DocumentFormat } from './port';

// This module models the real ContentDocument-variant compatibility this family already has (wordprocessing = {docx, odt, markdown}, presentation = {pptx, odp}, spreadsheet = {xlsx, ods}, drawing = {odg alone}) plus which nodes have a direct layout-engine path to/from LayoutDocument (FORMAT_CAPABILITIES below), then exposes a direct-edge path resolver (resolveConversionPath) over DIRECT_EDGES. Every (source, target) pair this package actually supports is a direct edge in DIRECT_EDGES: a layout-engine edge to/from pdf, a same-variant bridge, or -- for xlsx<->pdf specifically -- a real, ergonomic conversion function (xlsxToPdf/pdfToXlsx, convert.ts) that composes the ods<->xlsx bridge with the ods<->pdf layout edge internally, registered as a direct edge since it is a real, single-call function from a caller's own point of view rather than something a caller has to chain themselves.
//
// markdown's bridges (markdownToDocx/docxToMarkdown, markdownToOdt/odtToMarkdown) are wired the same way -- hand-written, real bridge functions (convert.ts) registered as direct edges. local.ts's DocumentConverter only ever executes a direct edge, so any pair not in DIRECT_EDGES is unsupported and rejected (UnsupportedConversionError); there is no implicit multi-hop composition.

// All five of document-schema.js's own ContentDocument kinds. 'formula' is a genuine member rather than a forward-looking one: readOdfFormulaContent produces a real `{kind:'formula', ...}` ContentDocument and odfToPdf consumes one, so `odf` below models it. Unlike the other four, it is a variant of exactly ONE format -- there is no second 'formula'-variant format to bridge it to, which is why a shared variant does not by itself imply a bridge edge exists (see DIRECT_EDGES below, the resolver's only actual input).
export type ContentVariant = 'wordprocessing' | 'presentation' | 'spreadsheet' | 'drawing' | 'formula';

export interface FormatCapability {
  readonly format: DocumentFormat;
  // The ContentDocument variant this format reads into / builds from, when it participates in that shared pivot at all. Only `pdf` leaves this undefined: it is the LayoutDocument pivot itself, not a ContentDocument variant at all.
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
  // xlsx shares the spreadsheet ContentDocument variant with ods (readXlsxContent/buildXlsxPackage, both from ooxml.js) but has no layout-engine path of its own -- there is no convertSpreadsheetToLayout-equivalent xlsx entry point, only ods's. hasLayoutPath stays false even though xlsx now has a real xlsx<->pdf edge in DIRECT_EDGES below (xlsxToPdf/pdfToXlsx): that edge composes the ods<->xlsx bridge with ods's own layout engine rather than being a genuine ContentDocument -> LayoutDocument pipeline of xlsx's own, mirroring how odf's own one-way edge below is also present in DIRECT_EDGES despite reporting hasLayoutPath: false.
  xlsx: { format: 'xlsx', variant: 'spreadsheet', hasLayoutPath: false },
  odg: { format: 'odg', variant: 'drawing', hasLayoutPath: true },
  // odf reads into the 'formula' ContentDocument variant (readOdfFormulaContent), but hasLayoutPath stays false: odfToPdf renders its formula through writePdf's own separate formula positioning rather than a ContentDocument -> LayoutDocument layout engine, and there is no reverse pdf -> odf at all (see odfToPdf's own module comment in convert.ts).
  odf: { format: 'odf', variant: 'formula', hasLayoutPath: false },
  // markdown shares the wordprocessing variant with docx/odt (readMarkdownContent produces the identical WordprocessingContentDocument shape -- see convert.ts's own top-of-file comment) and has a genuine layout-engine edge of its own (markdownToPdf/pdfToMarkdown both reuse convertWordprocessingToLayout/reconstructWordprocessing unmodified), unlike xlsx above.
  markdown: { format: 'markdown', variant: 'wordprocessing', hasLayoutPath: true },
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

// Every direct conversion this package implements today, in the exact order local.ts's own SUPPORTED_CONVERSIONS/the DocumentConverter port's `conversions` field have always listed them -- see local.test.ts's own exact-array assertion. This is the resolver's only input: resolveConversionPath returns a direct edge from this list or rejects (UnsupportedConversionError) -- there is no implicit multi-hop composition.
export const DIRECT_EDGES: readonly ConversionEdge[] = [
  { kind: 'toPdf', source: 'docx', target: 'pdf', convert: docxToPdf },
  { kind: 'toPdf', source: 'pptx', target: 'pdf', convert: pptxToPdf },
  { kind: 'toPdf', source: 'odt', target: 'pdf', convert: odtToPdf },
  { kind: 'toPdf', source: 'odp', target: 'pdf', convert: odpToPdf },
  { kind: 'toPdf', source: 'ods', target: 'pdf', convert: odsToPdf },
  { kind: 'toPdf', source: 'odg', target: 'pdf', convert: odgToPdf },
  // odf's own one-way direction -- see FORMAT_CAPABILITIES.odf and port.ts's own note on why there is no pdf -> odf entry below.
  { kind: 'toPdf', source: 'odf', target: 'pdf', convert: odfToPdf },
  // xlsx's own edge -- unlike every other 'toPdf' edge above, xlsxToPdf has no genuine layout-engine pipeline of its own: it composes the xlsx<->ods bridge with ods's own layout edge internally (see FORMAT_CAPABILITIES.xlsx and xlsxToPdf's own module comment in convert.ts). Still a real, direct, single-call edge from this list's own point of view.
  { kind: 'toPdf', source: 'xlsx', target: 'pdf', convert: xlsxToPdf },
  // markdown's own edge -- unlike xlsx above, markdownToPdf DOES have a genuine layout-engine pipeline of its own (it reuses convertWordprocessingToLayout unmodified, see FORMAT_CAPABILITIES.markdown).
  { kind: 'toPdf', source: 'markdown', target: 'pdf', convert: markdownToPdf },
  { kind: 'fromPdf', source: 'pdf', target: 'docx', convert: pdfToDocx },
  { kind: 'fromPdf', source: 'pdf', target: 'pptx', convert: pdfToPptx },
  { kind: 'fromPdf', source: 'pdf', target: 'odt', convert: pdfToOdt },
  { kind: 'fromPdf', source: 'pdf', target: 'odp', convert: pdfToOdp },
  { kind: 'fromPdf', source: 'pdf', target: 'ods', convert: pdfToOds },
  { kind: 'fromPdf', source: 'pdf', target: 'odg', convert: pdfToOdg },
  // pdfToXlsx's own edge, mirroring xlsxToPdf above -- composed via pdfToOds + odsToXlsx internally, still a real, direct, single-call edge here.
  { kind: 'fromPdf', source: 'pdf', target: 'xlsx', convert: pdfToXlsx },
  { kind: 'fromPdf', source: 'pdf', target: 'markdown', convert: pdfToMarkdown },
  // The ten PDF-bypassing cross-format bridges, five pairs (src/convert/convert.ts's own dedicated section) -- direct ContentDocument-pivot conversions, not routed through pdf.
  { kind: 'bridge', source: 'odt', target: 'docx', convert: odtToDocx },
  { kind: 'bridge', source: 'docx', target: 'odt', convert: docxToOdt },
  { kind: 'bridge', source: 'odp', target: 'pptx', convert: odpToPptx },
  { kind: 'bridge', source: 'pptx', target: 'odp', convert: pptxToOdp },
  { kind: 'bridge', source: 'ods', target: 'xlsx', convert: odsToXlsx },
  { kind: 'bridge', source: 'xlsx', target: 'ods', convert: xlsxToOds },
  { kind: 'bridge', source: 'markdown', target: 'docx', convert: markdownToDocx },
  { kind: 'bridge', source: 'docx', target: 'markdown', convert: docxToMarkdown },
  { kind: 'bridge', source: 'markdown', target: 'odt', convert: markdownToOdt },
  { kind: 'bridge', source: 'odt', target: 'markdown', convert: odtToMarkdown },
  // Four cross-variant content bridges (wordprocessing <-> presentation): docx <-> pptx and odt <-> odp. Unlike the same-variant bridges above, these cross a ContentDocument variant boundary via a semantic transform (src/convert/variant-bridges.ts), not a direct content copy. Approximate -- a flow document has no real slide boundaries -- but the blocks themselves survive intact, bypassing PDF entirely.
  { kind: 'bridge', source: 'docx', target: 'pptx', convert: docxToPptx },
  { kind: 'bridge', source: 'pptx', target: 'docx', convert: pptxToDocx },
  { kind: 'bridge', source: 'odt', target: 'odp', convert: odtToOdp },
  { kind: 'bridge', source: 'odp', target: 'odt', convert: odpToOdt },
  // Two pdf-composed bridge edges (xlsx <-> markdown): unlike every bridge above, these two formats share no ContentDocument variant, so they route through PDF internally (xlsxToPdf + pdfToMarkdown; markdownToPdf + pdfToXlsx) rather than copying a ContentDocument pivot directly. Registered as bridge edges (neither endpoint is pdf) so the port routes them; see convert.ts's xlsxToMarkdown/markdownToXlsx for the inherited-lossiness caveat and why this is a last-resort pair.
  { kind: 'bridge', source: 'xlsx', target: 'markdown', convert: xlsxToMarkdown },
  { kind: 'bridge', source: 'markdown', target: 'xlsx', convert: markdownToXlsx },
];

// Thrown when a requested (source, target) pair has no direct edge in DIRECT_EDGES -- the local DocumentConverter (local.ts) rejects rather than silently routing through a lossy two-hop path. A named class matching this package's own OdmUnresolvedSectionError/HsqldbSqlUnsupportedError convention for "recognised but unsupported", so a caller can branch on it rather than string-matching a message.
export class UnsupportedConversionError extends Error {
  readonly source: DocumentFormat;
  readonly target: DocumentFormat;

  constructor(source: DocumentFormat, target: DocumentFormat) {
    super(`unsupported conversion: ${source} -> ${target}`);
    this.name = 'UnsupportedConversionError';
    this.source = source;
    this.target = target;
  }
}

// Direct-edge lookup over `edges` -- the ONLY strategy the local DocumentConverter (local.ts) ever executes. An earlier revision also composed a one-intermediate-hop path for a pair with no direct edge (xlsx -> ods -> pdf, odg -> pdf -> xlsx), but local.ts never ran a composed result -- it rejected anything that was not a direct edge -- so the composed arm was dead code, claiming to solve pairs the port refused. It is removed: the resolver now returns only what the port will actually execute, and every worthwhile composed route (xlsxToPdf/pdfToXlsx, which compose the ods<->xlsx bridge with the ods<->pdf edge internally) is already hand-written as its own direct edge in DIRECT_EDGES. Never proposes a same-format "conversion".
export function resolveConversionPath(source: DocumentFormat, target: DocumentFormat, edges: readonly ConversionEdge[] = DIRECT_EDGES): ConversionEdge | undefined {
  if (source === target) {
    return undefined;
  }
  return edges.find((edge) => edge.source === source && edge.target === target);
}
