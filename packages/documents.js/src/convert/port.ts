import type { DocumentTree } from "document-schema.js";
import type { MarkdownImageResolver } from "markdown-codec";
import type { FontSubstitution, ProvidedFont } from "document-schema.js";
import type { ClockPort } from "../ports/clock";
import { z } from "zod";

// The conversion behaviour modelled as a swappable port/contract, not a hard-wired function -- this workspace's standing "portable runtime and storage boundaries" convention, even though the only implementation today (local.ts) is entirely synchronous under the hood. `convert()` itself stays async and takes a mandatory abort signal regardless of that: it's a portability contract for a future non-local adapter (a remote conversion service, say), not a reflection of the local implementation's own synchronicity.

// 'odf' (an ODF formula document) has exactly one direction wired into this port (odf -> pdf, via odfToPdf -- see local.ts) -- unlike every other member here, there is deliberately no pdf -> odf entry: odmToPdf's own README/gotcha explains why that reverse direction is not attempted (recovering structured MathML from rendered glyphs is a categorically different, OCR-adjacent problem, not a geometry-reconstruction one). 'markdown' shares the wordprocessing ContentDocument variant with docx/odt (see capability.ts's own FORMAT_CAPABILITIES.markdown) -- it has a genuine two-way layout-engine edge to/from pdf (markdownToPdf/pdfToMarkdown), plus direct same-variant bridges to docx and odt, exactly like odt already has to docx. 'csv' shares the spreadsheet ContentDocument variant with xlsx/ods -- like xlsx it has no layout engine of its own (the composition engine routes csv <-> pdf through the ods bridge), and TSV is the SAME member with { delimiter: '\t' } rather than a second enum entry, since a delimiter is a parse option, not a different document format. 'svg' shares the drawing ContentDocument variant with odg -- unlike csv it DOES have a layout path of its own (svg -> pdf renders the read drawing ContentDocument through the same convertDrawingToLayout engine odg feeds), plus a same-variant bridge to odg and pdf-composed routes to everything else. 'rtf' shares the wordprocessing ContentDocument variant with docx/odt/markdown (rtf-codec's own readRtfContent/writeRtfContent) but, like csv, has no layout engine of its own -- rtf <-> pdf routes through a same-variant bridge to docx/odt/markdown plus that format's own toPdf/fromPdf edge, never a direct rtf <-> LayoutDocument pipeline. 'doc'/'xls'/'ppt' are the three legacy binary formats (doc-codec, xls-codec, ppt-codec -- [MS-DOC]/BIFF8/[MS-PPT], each wrapped in an [MS-CFB] compound file) joining the same way rtf did: 'doc' shares the wordprocessing variant, 'xls' the spreadsheet variant, 'ppt' the presentation variant, and none has a layout engine of its own, so each routes to/from pdf through a same-variant bridge plus that bridge target's own toPdf/fromPdf edge -- exactly rtf's own routing, one variant over for xls and ppt. 'wpd' (WordPerfect 6.x-X6, wpd-codec) is the first READ-ONLY member: it shares the wordprocessing variant too, but wpd-codec ships a reader and no writer at all, deliberately (a lossless round trip through a function-code stream is a much larger job than reading one, and a half-correct writer is worse than none). So every pair naming wpd as a SOURCE is routable and every pair naming it as a TARGET is not -- an asymmetry the composition engine states in its graph rather than in a rule, since a read-only format's edges are directed out of it and nothing points back (see composition.ts's own ReadOnlyContentFormat). A caller must therefore not assume DocumentFormat membership implies both directions; `createLocalDocumentConverter().conversions` is the runtime source of truth for which pairs actually route.
//
// Zod-first, matching this package's own convention (src/model/bytes.ts and every document-schema.js-sourced union re-exported above): the schema is the source of truth, DocumentFormat is inferred from it rather than hand-written, and DOCUMENT_FORMATS (below) is derived from the same schema rather than a second, independently-typed literal array that could drift out of sync with it.
export const DocumentFormatSchema = z.enum([
  "docx",
  "pptx",
  "xlsx",
  "odt",
  "odp",
  "ods",
  "odg",
  "svg",
  "odf",
  "csv",
  "markdown",
  "rtf",
  "doc",
  "xls",
  "ppt",
  "wpd",
  "pdf",
]);
export type DocumentFormat = z.infer<typeof DocumentFormatSchema>;
// Every DocumentFormat member as a plain readonly array, for a caller that wants to enumerate or validate against the full format set without constructing its own Zod schema -- e.g. a CLI's own usage-error text, or an MCP tool's JSON-schema `enum` input.
export const DOCUMENT_FORMATS: readonly DocumentFormat[] =
  DocumentFormatSchema.options;

export interface DocumentPayload {
  readonly format: DocumentFormat;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface Diagnostic {
  readonly severity: "info" | "warning";
  readonly code: string;
  readonly message: string;
  readonly pageIndex?: number;
}

export interface ConversionRequest {
  readonly source: DocumentPayload;
  readonly targetFormat: DocumentFormat;
}

export interface ConversionResult {
  readonly document: DocumentPayload;
  // Diagnostics are for expected, scoped-out-of-v1 degradations (a font substitution, an unsupported PDF filter) -- anything that would actually corrupt output throws instead of becoming a silently-swallowed diagnostic.
  readonly diagnostics: readonly Diagnostic[];
  // The intermediate tree-form DocumentTree (structure, layout, and content fused in one tree, document-schema.js 4.0.0) the underlying conversion function built while producing `document`, when that function supports building one (see convert.ts's own onDocument option) and the DocumentConverter implementation chooses to wire it through. Not every implementation is obligated to populate this -- a hypothetical remote adapter might not want to serialize a full DocumentTree over the wire by default.
  readonly package?: DocumentTree;
}

// The per-call options every DocumentConverter implementation must accept. `signal` is mandatory (see this module's own top comment on why the contract is async and cancellable regardless of the local implementation's synchronicity); the two font options are optional and serialisable-adjacent rather than freely so -- `fonts` carries raw font bytes, which a remote adapter would have to ship over the wire, and `onFontSubstitution` is a live callback a remote adapter would instead surface through ConversionResult.diagnostics (which the local implementation ALSO populates, so a caller that supplies no callback still learns every face that fell back).
export interface ConversionOptions {
  readonly signal: AbortSignal;
  // Faces to make available on top of whatever the source document itself embeds. Only reaches conversions that actually lay text out -- an X-to-PDF conversion; a PDF-to-X reconstruction and a PDF-bypassing bridge each run no layout engine and resolve no font at all (see local.ts).
  readonly fonts?: readonly ProvidedFont[];
  // Called once per requested family+bold+italic that resolved to something else -- a different face of the same family, or a vendored metric-compatible substitute. Reported through ConversionResult.diagnostics as well, so this callback is for a caller wanting the structured value rather than the rendered message.
  readonly onFontSubstitution?: (substitution: FontSubstitution) => void;
  // A synchronous resolver for markdown images with a non-data: destination (a relative path, a bare URL) -- the same live-callback shape as onFontSubstitution, with the same remote-adapter caveat: the local implementation honours it (threading it through to markdown-codec's MarkdownImageResolver port for the markdown-sourced conversions), a remote adapter would have no way to call back into the caller's process and would instead leave non-data: images degraded to alt-text. Only the markdown-sourced conversions consult it; every other conversion ignores it.
  readonly images?: MarkdownImageResolver;
  // The single-character field delimiter the csv-sourced hops of a conversion parse with, and the csv-target hops write with -- ',' by default (records.ts's DEFAULT_CSV_DELIMITER), '\t' (TSV_DELIMITER) for TSV. A plain string, so a remote adapter honours it exactly as the local one does; every non-csv hop ignores it.
  readonly delimiter?: string;
  // Selects which sheet of a multi-sheet spreadsheet a csv-TARGET hop writes -- csv has no second sheet, so writing one is a caller decision (see buildCsvText's own CsvSheetNotSpecifiedError). Every non-csv-target hop ignores it.
  readonly sheet?: string;
  // Selects which page of a multi-page drawing an svg-TARGET hop writes, by index -- svg has no second page, so writing one is a caller decision exactly the way a csv sheet is (see buildSvgText's own SvgMultiPageNotSpecifiedError; an index rather than a name because drawing pages are anonymous where sheets are named). Every non-svg-target hop ignores it.
  readonly page?: number;
  // An injectable clock forwarded to the X-to-PDF conversion's own /CreationDate and /ModDate stamping (see DocumentToPdfOptions.clock) -- a fixed instant is fully serialisable, so a remote adapter honours it the same way the local one does.
  readonly clock?: ClockPort;
}

export interface DocumentConverter {
  // Bumped whenever DocumentConverter's own contract shape changes -- e.g. ConversionResult gaining a new field a caller might need to branch on, or convert()'s own options gaining one an implementation is now expected to honour -- not when the conversions table simply grows with more supported source/target pairs (that's discoverable at runtime via `conversions` itself, not a breaking contract change).
  readonly contractVersion: number;
  readonly conversions: readonly {
    readonly source: DocumentFormat;
    readonly target: DocumentFormat;
  }[];
  convert(
    request: ConversionRequest,
    options: ConversionOptions,
  ): Promise<ConversionResult>;
}
