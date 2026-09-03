import type {
  ContentBlock,
  ContentDocument,
  ContentSection,
  DocumentTree,
} from "document-schema.js";
import { assembleTree, COLOR_BLACK } from "document-schema.js";
import type { OdmSection, Package } from "odf.js";
import {
  decodePackage,
  encodePackage as encodeOdfPackage,
  readOdfMetadata,
  readOdfParagraph,
  readOdfTable,
  readOdm,
} from "odf.js";
import { buildXlsxPackageFromContent, encodePackage } from "ooxml.js";
import { buildDocxPackage } from "../edit/docx/content";
import { buildOdtPackage } from "../edit/odt/content";
import { layoutFormula } from "../mathml/layout";
import { convertWordprocessingToLayout } from "../layout/engine";
import type { Margins } from "document-schema.js";
import { flipY } from "../model/geometry";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { readOdfFormulaContent } from "../odf/formula/read";
import { readOdtContent } from "../odf/odt/read";
import { buildOdbTableCsv } from "../odb/csv";
import type { HsqldbDecodeOptions } from "../hsqldb/rowformat";
import { readOdbTables } from "../odb/read";
import { odbTablesToSpreadsheetDocument } from "../odb/spreadsheet";
import type { OmmlDiagnostic } from "../omml/shared";
import type { MarkdownImageResolver } from "markdown-codec";
import type {
  LayoutDocument,
  PdfDiagnosticSink,
  WinAnsiSubstitution,
} from "pdf-codec";
import type { ProvidedFont } from "document-schema.js";
import {
  createFontMeasurer,
  createFontRegistry,
  loadMathFont,
  writePdf,
  LAYOUT_FORMAT_VERSION,
} from "pdf-codec";

// A thin factory over pdf-codec's cached loadMathFont singleton, injected into each layout engine's options as `mathMetricsAt` so the layout engine never imports loadMathFont itself (the last direct pdf-codec runtime call the formula-placing engines had). The layout engine receives `(sizePt) => MathFontMetrics` and calls it at whatever size it needs, with no knowledge of where the metrics came from.
const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);
import type { DocumentFontRegistryOptions } from "../fonts/registry";
import { extractSourceFonts } from "../fonts/registry";
import { throwIfAborted } from "../ports/abort";
import { resolveMetadataTimestamps } from "../model/metadata";
import type { ClockPort } from "../ports/clock";
import { convertDocument } from "./composition-to-pdf";
import type { CellTypeInferenceSink } from "../layout/cell-typing";
import type { SvgDiagnosticSink } from "../svg/diagnostics";

// The ergonomic X <-> PDF conversions (docx/pptx/odt/odp/ods/odg/markdown/csv/svg, all round-trip both ways). Each is a thin forwarder to convertDocument (src/convert/composition.ts), which resolves the composition plan for the pair and runs the real decode/read/layout/build/encode primitives -- reproducing the exact sequence and option-threading the hand-written body below used to inline. The four special cases further down this file (odfToPdf, odmToPdf, odbToXlsx, odbToCsv) stay as their real hand-written bodies, since none is a composition-graph pair (formula one-way, resolver callback, table extraction).

// `fonts` and `onFontSubstitution` are inherited from DocumentFontRegistryOptions (src/fonts/registry.ts) rather than redeclared here, so the ergonomic conversions and createDocumentFontRegistry describe the same two options in exactly one place. Every X-to-PDF conversion below builds a real FontRegistry from the SOURCE PACKAGE'S OWN embedded faces first, then those caller-supplied faces, then pdf-codec's vendored Carlito/Caladea substitutes, then the standard 14 -- which is why a document that embeds nothing, and asks for no family a vendored substitute covers, still writes byte-identical output to the standard-font-only pipeline this package had before (see convert-fonts.test.ts's own byte-identity proof).
export interface DocumentToPdfOptions extends DocumentFontRegistryOptions {
  readonly signal?: AbortSignal;
  // Called once per WinAnsi character substitution made while emitting text (see pdf-codec's winansi.ts) -- writePdf's own hook, passed straight through. Distinct from onFontSubstitution above, which reports a whole FACE falling back rather than a single character: a run rendered through a real embedded face never reaches WinAnsi encoding at all.
  readonly onSubstitution?: (
    substitution: WinAnsiSubstitution,
    context: { readonly pageIndex: number },
  ) => void;
  // Called exactly once, synchronously, with the DocumentTree (content + layout) this conversion built internally, before the function returns its bytes -- a side channel for a caller that wants the intermediate pivot value, not just the target bytes, mirroring onSubstitution's own callback shape. Every conversion sharing this options type invokes it, odfToPdf included: a standalone formula document reports a genuine 'formula'-kind ContentDocument (see that function's own comment for what its LayoutDocument half does and does not carry).
  readonly onDocument?: (pkg: DocumentTree) => void;
  // Called once per OMML construct that degraded or was approximated while a docx's own equations were recovered as MathML (src/omml/read.ts). Only docxToPdf ever invokes it, and deliberately so rather than being declared on a docx-specific options type of its own: OOXML math is the one source vocabulary in this package whose READ direction involves a translation that can degrade at all -- every ODF-sourced conversion reads real MathML straight out of the source package with nothing to translate.
  readonly onMathDiagnostic?: (
    diagnostic: OmmlDiagnostic,
    context: { readonly sourcePath?: string },
  ) => void;
  // A synchronous resolver for markdown images with a non-data: destination (a relative path, a bare URL), threaded straight through to markdown-codec's own MarkdownImageResolver port. Only the markdown-sourced conversions (markdownToPdf) consult it; every other conversion sharing this options type ignores it -- the same precedent onMathDiagnostic already establishes for a docx-only option living on the shared type. documents.js itself performs no I/O (matching markdown-codec's own platform-neutral convention); a caller wanting local-file resolution supplies a resolver, and the Node entry points (document-cli, document-mcp) supply a filesystem resolver against the input file's own directory.
  readonly images?: MarkdownImageResolver;
  // Opt-in clock for writePdf's /CreationDate and /ModDate stamps. With no clock supplied, those stamps come only from createdIso/modifiedIso the source document already carried (unchanged from before this option existed -- which is what keeps an X-to-PDF conversion byte-identical to the pre-clock pipeline when nothing is embedded). Supply a fixedClock for byte-identical output across runs, or a systemClock to fill any timestamps the source lacked; a document already stating both is left untouched either way (see resolveMetadataTimestamps in src/model/metadata.ts).
  readonly clock?: ClockPort;
}

// Forwards to convertDocument (src/convert/composition.ts).
export function docxToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("docx", "pdf", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odtToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("odt", "pdf", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function pptxToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("pptx", "pdf", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odpToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("odp", "pdf", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odsToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("ods", "pdf", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odgToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("odg", "pdf", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function markdownToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("markdown", "pdf", bytes, options);
}

// The two csv option groups the named csv conversions below intersect into the shared options type each already uses, rather than a csv-specific options type per function: every csv-SOURCED conversion parses with { delimiter, onCellTypeInference } (readCsvContent's own two options, src/csv/read.ts) and every csv-TARGET one writes with { delimiter, sheet } (buildCsvText's own two, src/csv/write.ts) -- exactly the fields UnifiedConversionOptions (src/convert/composition.ts) threads to the csv node's read/build legs. Declaring the two groups once here keeps each ergonomic signature honest about which csv knobs that particular function consumes without duplicating the field comments eight times over.
export interface CsvReadOptions {
  // The field delimiter to parse with -- ',' (RFC 4180's own default, and readCsvContent's own default when omitted) or '\t' for TSV. TSV is deliberately a delimiter choice on the SAME 'csv' format rather than a second DocumentFormat member, since a delimiter is a parse option, not a different document format (see port.ts's own csv comment).
  readonly delimiter?: string;
  // Called once per data cell whose text inferCellValue re-typed (or considered and declined) while the csv was being read into spreadsheet cells -- the audit channel for the one lossy step a csv read performs, reported at the read boundary where the re-typing actually happens.
  readonly onCellTypeInference?: CellTypeInferenceSink;
}

export interface CsvWriteOptions {
  // The field delimiter to write with -- ',' by default (RFC 4180), '\t' for TSV output. Feeds quoteCsvField's own quoting decision too, so a field containing the delimiter is quoted and a field containing a comma under a tab delimiter is not.
  readonly delimiter?: string;
  // Selects which sheet of a multi-sheet spreadsheet document to write as csv. Required whenever the document has more than one sheet -- omitting it then throws CsvSheetNotSpecifiedError naming every available sheet, rather than guessing (the identical contract odbToCsv's own `table` option follows for a multi-table .odb). May be omitted when the document has exactly one sheet.
  readonly sheet?: string;
}

// The two svg option groups the named svg conversions below intersect into the shared options type each uses, exactly the way CsvReadOptions/CsvWriteOptions above already do for csv: every svg-SOURCED conversion reads with { onSvgDiagnostic } (readSvgContent's own option, src/svg/read.ts) and every svg-TARGET one writes with { page, onSvgDiagnostic } (buildSvgText's own two, src/svg/write.ts).
export interface SvgReadOptions {
  // Called once per scope limit or bounded approximation the svg reader made while mapping SVG markup onto ContentVectors (src/svg/diagnostics.ts's own vocabulary) -- the audit channel for every degrade this reader performs, reported at the read boundary where it happens.
  readonly onSvgDiagnostic?: SvgDiagnosticSink;
}

export interface SvgWriteOptions {
  // Selects which page of a multi-page drawing document to write as svg. Required whenever the document has more than one page -- omitting it then throws SvgMultiPageNotSpecifiedError, rather than guessing (the same contract CsvWriteOptions.sheet holds for sheets, carried by index here because drawing pages are anonymous). May be omitted when the document has exactly one page.
  readonly page?: number;
  // Called once per construct the svg writer could not express in SVG markup and skipped or degraded (a ContentShape, a 'double' stroke style) -- the write-side mirror of SvgReadOptions.onSvgDiagnostic, sharing the same diagnostic vocabulary.
  readonly onSvgDiagnostic?: SvgDiagnosticSink;
}

// csv bytes -> PDF bytes: csv has no layout engine of its own (exactly like xlsx), so convertDocument's pathfinder resolves this as [csv -> ods bridge, ods -> pdf toPdf] -- the reader parses RFC 4180 text into a spreadsheet ContentDocument (first record as the header row, data cells re-typed by inferCellValue with onCellTypeInference auditing each decision), then ods's own layout engine renders it. `onDocument` reports the last hop's package under the composition engine's own "fires exactly once, on the last hop" convention: the odsToPdf hop's content+layout.
export function csvToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions & CsvReadOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("csv", "pdf", bytes, options);
}

// svg bytes -> PDF bytes: svg HAS a layout engine path of its own (unlike csv/xlsx) -- convertDocument resolves this as a single [svg -> pdf toPdf] hop, readSvgContent mapping the six shape primitives onto a drawing ContentDocument and the same convertDrawingToLayout engine odgToPdf feeds rendering it. onSvgDiagnostic is the reader's scope-limit channel (text/gradients/images/CSS/use degrade under it, never silently); fonts/onFontSubstitution are accepted through the shared DocumentToPdfOptions and consulted for the drawing engine's shape-text pass exactly as they are for odg.
export function svgToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions & SvgReadOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("svg", "pdf", bytes, options);
}

const STANDALONE_FORMULA_SIZE_PT = 18; // larger than a typical embedded formula (see engine.ts's own formulaSizePtForFrame), since a standalone .odf's own formula is usually the whole document's content, not a small inline element.
const STANDALONE_FORMULA_MARGIN_PT = 72; // 1 inch

// odf bytes -> PDF bytes: readOdfFormulaContent -> src/mathml's layoutFormula -> a single formula positioned on one A4 page -> writePdf, with the embedded STIX Two Math font (pdf-codec's math-font.ts) doing the actual glyph rendering. options.onDocument IS invoked here now, with a genuine 'formula'-kind ContentDocument (document-schema.js 2.0.0's fifth variant, carrying the formula's own MathML and StarMath annotation) alongside the LayoutDocument -- previously there was no ContentDocument shape a standalone formula could be reported as at all, so the callback was accepted and never called. The reported `layout` still carries no LayoutItems, by construction: the formula renders through writePdf's separate `formulas` positioning rather than as page content, so its page really is empty of items and the page geometry is all the layout has to report. This is NOT one of the twelve round-trip conversions above (and has no reverse pdfToOdf, no z.codec() pair, and no DocumentConverter port entry -- see src/convert/port.ts's own note): scope for v1, per the design plan this package was built against, is odfToPdf alone, rendering "faithful mathematical typesetting" for a single formula (or small formula document). PDF -> structured MathML is a categorically different, OCR-adjacent problem -- recovering a semantic operator tree (msub vs msup vs a coincidentally-superscript-shaped run of glyphs) from nothing but positioned glyphs and paths has no geometry-reconstruction analogue anywhere else in this package (reconstructWordprocessing/reconstructPresentation recover paragraph/shape STRUCTURE from geometry, never semantic MEANING the way "this pair of glyphs forms a fraction" would require) -- and is deliberately not attempted here.
//
// options.fonts/options.onFontSubstitution are accepted (this function shares DocumentToPdfOptions with the conversions above) and never consulted, for the same structural reason options.onSubstitution already is: the LayoutDocument built below carries NO items at all, so there is no LayoutFont anywhere for a FontRegistry to resolve. The formula's own glyphs come from pdf-codec's embedded STIX Two Math font, which is not a registry-resolvable face and cannot be overridden by a caller-supplied one. Passing a registry into writePdf here would be wiring that nothing can ever reach, so it is documented instead.
//
// This is one of the four SPECIAL cases that stays as its real hand-written body rather than forwarding to convertDocument: a standalone formula document renders through src/mathml's own formula-positioning path rather than a ContentDocument -> LayoutDocument layout engine, so it has no place in the composition graph (src/convert/composition.ts's own module doc excludes odf explicitly).
export function odfToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odf is an ODF package.
  const read = readOdfFormulaContent(pkg);
  // readOdfFormulaContent's declared return type is the full ContentDocument union, even though it always produces the formula variant in practice -- this both documents and enforces that, mirroring every other readXContent guard in this file.
  if (read.kind !== "formula") {
    throw new Error(
      "readOdfFormulaContent returned a non-formula ContentDocument",
    );
  }
  const content = {
    ...read,
    metadata: resolveMetadataTimestamps(read.metadata, options?.clock),
  };

  const metrics = loadMathFont().metricsAt(STANDALONE_FORMULA_SIZE_PT);
  const { box } = layoutFormula(content.formula.mathml, {
    metrics,
    sizePt: STANDALONE_FORMULA_SIZE_PT,
    color: COLOR_BLACK,
  });
  const flipped = flipY(
    {
      xPt: STANDALONE_FORMULA_MARGIN_PT,
      yPt: STANDALONE_FORMULA_MARGIN_PT,
      widthPt: box.widthPt,
      heightPt: box.heightPt,
    },
    PAGE_SIZE_A4.heightPt,
  );

  const layout: LayoutDocument = {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: content.metadata,
    pages: [
      {
        widthPt: PAGE_SIZE_A4.widthPt,
        heightPt: PAGE_SIZE_A4.heightPt,
        items: [],
      },
    ],
    images: {},
  };
  throwIfAborted(options?.signal);
  const out = writePdf(layout, {
    signal: options?.signal,
    formulas: [{ pageIndex: 0, xPt: flipped.xPt, yPt: flipped.yPt, box }],
  });
  // The reported tree-form package carries the one real A4 page it renders (pages) and no node frames -- a formula document's content has no renderable-item placements at all, since the formula's glyphs travel through writePdf's own formulas side channel rather than as page content -- and is assembled only after the output bytes exist, like every construction site.
  options?.onDocument?.(
    assembleTree(content, [
      { widthPt: PAGE_SIZE_A4.widthPt, heightPt: PAGE_SIZE_A4.heightPt },
    ]),
  );
  return out;
}

// The same-variant cross-format bridges (odt<->docx, odp<->pptx, ods<->xlsx, csv<->ods, csv<->xlsx, svg<->odg, and -- further down this section -- markdown<->docx, markdown<->odt), each bypassing PDF entirely. Every conversion above this point pivots through a LayoutDocument; these pairs don't have that problem: both formats in each pair already read into and build from the identical ContentDocument variant, so the bridge is nothing more than reader -> writer, with no layout engine, no font measurement, and no geometry-based reconstruction in between. Each forwarder below hands the pair to convertDocument (src/convert/composition.ts), whose pathfinder resolves it as a single same-variant bridge hop and runs the identical decode/read/build/encode sequence.
export interface DocumentBridgeOptions {
  readonly signal?: AbortSignal;
  // Called exactly once, synchronously, with the DocumentTree this bridge built internally, before the function returns its bytes -- mirroring DocumentToPdfOptions/PdfToDocumentOptions's own onDocument. A bridge never runs a layout engine (see this section's own top-of-block comment), so the reported package carries content only, with no pages array and no node frames -- running a layout conversion purely to populate positions no caller asked for would be wasted work.
  readonly onDocument?: (pkg: DocumentTree) => void;
  // Called once per formula construct that degraded or was approximated while an embedded formula crossed this bridge, in whichever direction the bridge translates: a MathML construct with no OMML counterpart when BUILDING a docx (src/omml/write.ts -- odtToDocx genuinely produces these; markdownToDocx threads the option for consistency but has no formula construct in its own source format to produce one from), and an OMML construct with no MathML counterpart when READING one (src/omml/read.ts -- docxToOdt and docxToMarkdown). pdfToDocx deliberately has no equivalent option -- reconstructWordprocessing recovers positioned glyphs, never a formula block, so there is nothing there to report.
  readonly onMathDiagnostic?: (
    diagnostic: OmmlDiagnostic,
    context: { readonly sourcePath?: string },
  ) => void;
  // A synchronous resolver for markdown images with a non-data: destination (a relative path, a bare URL), threaded straight through to markdown-codec's own MarkdownImageResolver port. Only the markdown-sourced bridges (markdownToDocx, markdownToOdt) consult it; the other eight bridges ignore it -- the same precedent onMathDiagnostic already establishes for a format-specific option living on the shared type. See DocumentToPdfOptions.images for the full rationale (no I/O in documents.js itself; the Node entry points supply a filesystem resolver).
  readonly images?: MarkdownImageResolver;
}

// Options for a composed edge whose two formats share no ContentDocument variant, so the only route is through PDF (today: xlsx <-> markdown, csv <-> markdown). These are 'bridge' hops from the composition engine's point of view (neither endpoint is pdf), but internally they compose a toPdf leg -- which lays content out, so fonts/onFontSubstitution/onSubstitution/clock reach it -- with a fromPdf leg, which reconstructs, so sink reaches it. That is a wider shape than the PDF-bypassing DocumentBridgeOptions above, and every field is optional deliberately: a DocumentBridgeOptions (what local.ts's port passes to any bridge hop) is assignable to this, which is exactly what lets these run as ordinary bridge hops without a new hop kind -- through the port they run with fonts/sink undefined (the defaults), while a direct ergonomic caller can supply them for finer control over the layout and reconstruction legs.
export interface ComposedDocumentOptions extends DocumentFontRegistryOptions {
  readonly signal?: AbortSignal;
  readonly onSubstitution?: (
    substitution: WinAnsiSubstitution,
    context: { readonly pageIndex: number },
  ) => void;
  readonly clock?: ClockPort;
  readonly images?: MarkdownImageResolver;
  readonly sink?: PdfDiagnosticSink;
  readonly onDocument?: (pkg: DocumentTree) => void;
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odtToDocx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("odt", "docx", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function docxToOdt(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("docx", "odt", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odpToPptx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("odp", "pptx", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function pptxToOdp(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("pptx", "odp", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odsToXlsx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("ods", "xlsx", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function xlsxToOds(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("xlsx", "ods", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function markdownToDocx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("markdown", "docx", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function docxToMarkdown(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("docx", "markdown", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function markdownToOdt(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("markdown", "odt", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odtToMarkdown(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("odt", "markdown", bytes, options);
}

// csv <-> xlsx and csv <-> ods: csv is the spreadsheet family's plain-text member -- it reads into and builds from the same spreadsheet ContentDocument variant as xlsx/ods (see capability.ts), so these resolve as single same-variant bridge hops, the csv side decoding/encoding RFC 4180 text with no package in between. The csv-sourced directions intersect CsvReadOptions (delimiter/onCellTypeInference reach readCsvContent's own parse) and the csv-target ones CsvWriteOptions (delimiter/sheet reach buildCsvText's own writer); every non-csv field of DocumentBridgeOptions threads exactly as it does for the bridges above.

// Forwards to convertDocument (src/convert/composition.ts).
export function csvToXlsx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions & CsvReadOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("csv", "xlsx", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function xlsxToCsv(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions & CsvWriteOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("xlsx", "csv", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function csvToOds(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions & CsvReadOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("csv", "ods", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odsToCsv(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions & CsvWriteOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("ods", "csv", bytes, options);
}

// svg <-> odg: svg is the drawing family's plain-text member -- it reads into and builds from the same drawing ContentDocument variant as odg (see capability.ts), so these resolve as single same-variant bridge hops, the svg side decoding/encoding plain text with no package in between. The svg-sourced direction intersects SvgReadOptions (onSvgDiagnostic reaches readSvgContent's own scope-limit channel) and the svg-target one SvgWriteOptions (page/onSvgDiagnostic reach buildSvgText's own writer); every non-svg field of DocumentBridgeOptions threads exactly as it does for the bridges above. Geometry crosses losslessly in both directions because both sides speak the identical six-primitive ContentVector vocabulary -- the one honest asymmetry is paint defaults (an SVG shape with no fill attribute reads as black-filled, the SVG specification's own default).

// Forwards to convertDocument (src/convert/composition.ts).
export function svgToOdg(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions & SvgReadOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("svg", "odg", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odgToSvg(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions & SvgWriteOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("odg", "svg", bytes, options);
}

// Four cross-variant content bridges (wordprocessing <-> presentation), two pairs: docx <-> pptx and odt <-> odp. These cross a VARIANT BOUNDARY via a real semantic transform (src/convert/variant-bridges.ts), which convertDocument's pathfinder resolves as a single cross-variant bridge hop. Both directions are APPROXIMATIONS -- a flow document has no real slide boundaries, and a deck has no flow -- but the blocks themselves (paragraphs, tables, images, list membership, run styling) survive intact through both transforms.

// Forwards to convertDocument (src/convert/composition.ts).
export function docxToPptx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("docx", "pptx", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function pptxToDocx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("pptx", "docx", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odtToOdp(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("odt", "odp", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function odpToOdt(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentBridgeOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("odp", "odt", bytes, options);
}

// xlsx bytes -> PDF bytes: xlsx has no layout engine of its own, so convertDocument's pathfinder resolves this as [xlsx -> ods bridge, ods -> pdf toPdf] -- the identical composed route the hand-written body used to hard-code. The `onDocument` callback reports the last hop's package under the composition engine's own "fires exactly once, on the last hop" convention (see convertDocument's own doc): the odsToPdf hop's content+layout. The reverse direction (pdfToXlsx) lives in from-pdf.ts with the rest of the pdf-sourced family.

// Forwards to convertDocument (src/convert/composition.ts).
export function xlsxToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("xlsx", "pdf", bytes, options);
}

// rtf bytes -> PDF bytes: rtf has no layout engine of its own either (capability.ts's own FORMAT_CAPABILITIES.rtf), so convertDocument's pathfinder resolves this the same shape as xlsx above -- [rtf -> docx bridge, docx -> pdf toPdf] -- rather than a direct toPdf hop. The reverse direction (pdfToRtf) lives in from-pdf.ts with the rest of the pdf-sourced family.

// Forwards to convertDocument (src/convert/composition.ts).
export function rtfToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("rtf", "pdf", bytes, options);
}

// doc bytes -> PDF bytes: doc has no layout engine of its own either (capability.ts's own FORMAT_CAPABILITIES.doc), so convertDocument's pathfinder resolves this the same shape as rtf above -- [doc -> docx bridge, docx -> pdf toPdf]. The reverse direction (pdfToDoc) lives in from-pdf.ts with the rest of the pdf-sourced family.

// Forwards to convertDocument (src/convert/composition.ts).
export function docToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("doc", "pdf", bytes, options);
}

// xls bytes -> PDF bytes: xls has no layout engine of its own either, so convertDocument's pathfinder resolves this the same shape as xlsx above -- [xls -> ods bridge, ods -> pdf toPdf]. The reverse direction (pdfToXls) lives in from-pdf.ts with the rest of the pdf-sourced family.

// Forwards to convertDocument (src/convert/composition.ts).
export function xlsToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("xls", "pdf", bytes, options);
}

// ppt bytes -> PDF bytes: ppt has no layout engine of its own either, so convertDocument's pathfinder resolves this as [ppt -> pptx bridge, pptx -> pdf toPdf] rather than a direct toPdf hop. The reverse direction (pdfToPpt) lives in from-pdf.ts with the rest of the pdf-sourced family.

// Forwards to convertDocument (src/convert/composition.ts).
export function pptToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("ppt", "pdf", bytes, options);
}

// xlsx <-> markdown: xlsx and markdown share no ContentDocument variant (spreadsheet vs wordprocessing), so convertDocument's pathfinder resolves this as [xlsx -> ods, ods -> pdf, pdf -> markdown] -- three hops, both legs' lossiness inherited in full (the single lossiest path in the package). onDocument reports the last hop's package under the composition engine's own "fires exactly once, on the last hop" convention.

// Forwards to convertDocument (src/convert/composition.ts).
export function xlsxToMarkdown(
  bytes: Uint8Array<ArrayBuffer>,
  options?: ComposedDocumentOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("xlsx", "markdown", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function markdownToXlsx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: ComposedDocumentOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("markdown", "xlsx", bytes, options);
}

// csv <-> markdown: csv and markdown share no ContentDocument variant (spreadsheet vs wordprocessing), so convertDocument's pathfinder resolves these the same three-hop way as xlsx <-> markdown above -- csvToMarkdown as [csv -> ods, ods -> pdf, pdf -> markdown], markdownToCsv as [markdown -> pdf, pdf -> ods, ods -> csv] -- with both legs' lossiness inherited in full. onDocument reports the last hop's package under the composition engine's own "fires exactly once, on the last hop" convention.

// Forwards to convertDocument (src/convert/composition.ts).
export function csvToMarkdown(
  bytes: Uint8Array<ArrayBuffer>,
  options?: ComposedDocumentOptions & CsvReadOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("csv", "markdown", bytes, options);
}

// Forwards to convertDocument (src/convert/composition.ts).
export function markdownToCsv(
  bytes: Uint8Array<ArrayBuffer>,
  options?: ComposedDocumentOptions & CsvWriteOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocument("markdown", "csv", bytes, options);
}

// odmToPdf -- one of the four SPECIAL cases that stays as its real hand-written body rather than forwarding to convertDocument: a .odm master document doesn't carry its chapters' own content at all (readOdm's own module -- see odf.js's implementation report -- confirmed against real LibreOffice output that a text:section-source is always a bare external reference, never an embedded or cached copy), so producing a PDF requires a caller-supplied resolveSubDocument callback to hand back each chapter's own .odt bytes given its href. This is why odmToPdf takes an options object shape the other conversions don't, and why it is not wired into the DocumentConverter port (src/convert/port.ts) -- that port's convert(request, options) contract is fixed single-bytes-in/bytes-out, and widening it with a resolver parameter for this one format would leak an odm-specific concern into every other conversion's own request shape. A caller wanting odmToPdf behind the port can wrap it in their own adapter. convertDocument's own bytes-in/bytes-out contract cannot express the resolver callback either, which is why this stays hand-written.
export interface OdmToPdfOptions extends DocumentToPdfOptions {
  // Called once per section whose chapter content could not be read inline from the master document itself, with that section's own href (e.g. "../chapter1.odt"). Returns that chapter's own .odt bytes, or undefined if the caller has no bytes for it -- an undefined result is not itself an error here; odmToPdf collects every section that ends up unresolved (no inline content AND no bytes from this callback, or no callback at all) and throws exactly once, naming all of them, rather than surfacing only the first the loop happens to reach.
  readonly resolveSubDocument?: (
    href: string,
  ) => Uint8Array<ArrayBuffer> | undefined;
}

// The throw tier for odmToPdf's own source-resolution step: a section whose chapter content could not be obtained at all. This mirrors pdf-codec's diagnostics.ts's own PdfParseError -- "a file that cannot be meaningfully processed at all" throws rather than degrading -- but that class's own code namespace and module doc are both scoped to pdf-codec's own read-side failures specifically ("This module is the shared vocabulary every other read-side module reports through"), and odmToPdf's own failure happens earlier, before any PDF has been touched, while still resolving the master document's own external references. A dedicated class rather than a PdfParseError subclass, then, with every unresolved href collected up front (see the loop in odmToPdf below) so a caller sees the complete list in one thrown error instead of fixing hrefs one at a time across repeated calls.
export class OdmUnresolvedSectionError extends Error {
  readonly hrefs: readonly string[];

  constructor(hrefs: readonly string[]) {
    super(
      `odmToPdf: ${hrefs.length} chapter section(s) could not be resolved -- no inline content and no resolveSubDocument result for: ${hrefs.join(", ")}`,
    );
    this.name = "OdmUnresolvedSectionError";
    this.hrefs = hrefs;
  }
}

// 2cm margins on an A4 page -- the exact fallback odf.js's own readOdtContent falls back to (readFirstMasterPageGeometry) when a document has no page-layout of its own, confirmed directly against the installed odf.js build. inlineOdmSectionToContentSection reaches this same fallback for the identical reason: inline chapter content was never its own document with its own master-page/page-layout chain to resolve a real page size from.
const INLINE_SECTION_MARGIN_PT = 56.69291338582677;
const INLINE_SECTION_MARGINS: Margins = {
  topPt: INLINE_SECTION_MARGIN_PT,
  rightPt: INLINE_SECTION_MARGIN_PT,
  bottomPt: INLINE_SECTION_MARGIN_PT,
  leftPt: INLINE_SECTION_MARGIN_PT,
};

// Builds a ContentSection directly from an OdmSection's own inlineContent (readonly XmlNode[]), for the case readOdm's own type declares but the installed odf.js build never actually produces (see readOdm's own implementation report: a real .odm's text:section-source is always a bare external reference, never inline-cached content) -- kept for schema-completeness against a future odf.js version, or a producer other than LibreOffice, that does populate it. readOdfParagraph/readOdfTable are the exact per-element primitives odf.js's own readOdtContent calls internally (via its own unexported readBlocks) to build a real chapter's blocks, so walking inlineContent with them directly produces the identical ContentParagraph/ContentTable shapes readOdtContent would for equivalent real chapter content. Any other inline node kind (a bare draw frame, a table-of-contents placeholder) has no ContentBlock this package's own odt reader produces either -- silently skipped, mirroring paginateSection's own handling of block kinds it doesn't lay out (src/layout/engine.ts).
export function inlineOdmSectionToContentSection(
  section: OdmSection,
  pkg: Package,
): ContentSection {
  const blocks: ContentBlock[] = [];
  for (const node of section.inlineContent ?? []) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "text:p" || node.tag === "text:h") {
      blocks.push(readOdfParagraph(node, pkg));
    } else if (node.tag === "table:table") {
      blocks.push(readOdfTable(node, pkg));
    }
  }
  return { pageSize: PAGE_SIZE_A4, margins: INLINE_SECTION_MARGINS, blocks };
}

// Prepends an explicit page-break block to a chapter's own first section, the same {kind:'pageBreak'} block ooxml.js's own readDocxContent already derives from w:pageBreakBefore (see paginateSection's own handling of it, src/layout/engine.ts) -- signalling "a new chapter starts here" as an explicit content-level marker rather than leaning on the incidental fact that a fresh ContentSection already starts its own fresh page in the engine today. Applied to every chapter after the first when combining chapters below.
function withLeadingChapterBreak(section: ContentSection): ContentSection {
  const pageBreak: ContentBlock = { kind: "pageBreak" };
  return { ...section, blocks: [pageBreak, ...section.blocks] };
}

// odm bytes -> PDF bytes: reads the master document's own text:section list (readOdm), resolves each chapter's own content -- inline (rare to nonexistent in practice, see inlineOdmSectionToContentSection's own note) or via options.resolveSubDocument reading that section's href -- then concatenates every chapter's own ContentSection[] in text:section document order into one combined section list, with an explicit page-break block marking each chapter boundary, and feeds the WHOLE combined document through convertWordprocessingToLayout completely unmodified. This is the same "zero engine modification" bet every other conversion in this file relies on: the engine has no idea, and no way to tell, that its sections came from six chapters instead of one document's own multi-section w:sectPr/style:master-page structure. A section with neither inline content nor a resolveSubDocument result is never silently dropped -- every such section across the whole document is collected first, and only once every section has been attempted does an OdmUnresolvedSectionError throw, naming all of them together.
export function odmToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: OdmToPdfOptions,
): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odm is an ODF package.
  const odm = readOdm(pkg);

  const unresolvedHrefs: string[] = [];
  const chapterSections: ContentSection[][] = [];
  // A master document and every chapter it links are each their own ODF package, and each can declare its own embedded faces -- so the registry's sourceFonts are all of them concatenated, master first, then chapters in text:section order. extractSourceFonts is exported from src/fonts/registry.ts for exactly this "merge several documents' fonts" case; createFontRegistry resolves an exact family+bold+italic request by first occurrence, so the master's own declaration wins a tie against a chapter's, and an earlier chapter's over a later one's.
  const sourceFonts: ProvidedFont[] = extractSourceFonts({
    kind: "odf",
    package: pkg,
  });

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
    sourceFonts.push(
      ...extractSourceFonts({ kind: "odf", package: chapterPkg }),
    );
    const chapterContent = readOdtContent(chapterPkg);
    if (chapterContent.kind !== "wordprocessing") {
      throw new Error(
        "readOdtContent returned a non-wordprocessing ContentDocument",
      );
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
    combinedSections.push(
      ...sections.map((section, sectionIndex) =>
        sectionIndex === 0 ? withLeadingChapterBreak(section) : section,
      ),
    );
  });

  throwIfAborted(options?.signal);
  // Typed via Extract rather than the full ContentDocument union -- unlike every X-to-PDF sibling above, which reads a full-union-typed ContentDocument from another function and narrows it with a runtime `if (content.kind !== '...')` guard, this object is a literal this function writes itself two lines below: its 'wordprocessing' discriminant is already statically known, so a runtime guard here would only ever check something already proven at compile time.
  const content: Extract<ContentDocument, { kind: "wordprocessing" }> = {
    kind: "wordprocessing",
    metadata: resolveMetadataTimestamps(readOdfMetadata(pkg), options?.clock),
    sections: combinedSections,
  };
  const fonts = createFontRegistry({
    sourceFonts,
    fonts: options?.fonts,
    onSubstitution: options?.onFontSubstitution,
  });
  const { document: layout, formulas } = convertWordprocessingToLayout(
    content,
    { measurer: createFontMeasurer(fonts), mathMetricsAt },
  );
  return writePdf(layout, {
    signal: options?.signal,
    onSubstitution: options?.onSubstitution,
    formulas,
    fonts,
  });
}

// odb (ODF database front-end) Tier 1 support: readOdbTables(pkg) already does the real work (decoder selection over odf.js's own readOdbInventory, then src/hsqldb/script.ts's bounded HSQLDB TEXT-script parser) -- odbToXlsx/odbToCsv below are thin compositions over it, matching odsToXlsx's own "reader -> pivot -> writer" shape. Unlike every conversion above, .odb has no PDF conversion of its own and no reverse (xlsx/csv -> odb) direction at all -- so, like odmToPdf, these are deliberately NOT wired into the DocumentConverter port (src/convert/port.ts): that port's {source, targetFormat} contract assumes a conversion has a natural place in DocumentFormat's own bytes-in/bytes-out shape, and odb's own asymmetry (one source format, two unrelated target shapes, one of which needs a table-selection option the other doesn't) doesn't fit it any better than odmToPdf's resolver-shaped conversion did. These stay hand-written rather than forwarding to convertDocument: .odb table extraction is a genuine table-extraction operation with no composition-graph counterpart, not a content-format conversion.
export interface OdbConversionOptions
  extends DocumentBridgeOptions, HsqldbDecodeOptions {}

export function odbToXlsx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: OdbConversionOptions,
): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odb is an ODF package.
  const tables = readOdbTables(pkg, { timeZone: options?.timeZone });
  throwIfAborted(options?.signal);
  const content = odbTablesToSpreadsheetDocument(tables);
  const out = encodePackage(buildXlsxPackageFromContent(content)); // ooxml.js's own encodePackage -- buildXlsxPackageFromContent (the flat ContentDocument builder; ooxml.js 4.0.0 gives the bare buildXlsxPackage name to the tree-form DocumentTree counterpart) produces an OOXML package.
  // Fires the content-only tree package OdbConversionOptions has always accepted via DocumentBridgeOptions but these two odb functions never delivered -- no layout pass runs here, so there are no pages and no node frames, exactly like every other bridge's package. Fired after the output bytes exist so a callback that inspects the tree cannot observe a half-built conversion.
  options?.onDocument?.(assembleTree(content));
  return out;
}

export interface OdbToCsvOptions extends OdbConversionOptions {
  // Selects which table to write as CSV. Required whenever the .odb has more than one table -- omitting it then throws OdbTableNotSpecifiedError naming every available table, rather than guessing. May be omitted when the .odb has exactly one table.
  readonly table?: string;
}

export function odbToCsv(
  bytes: Uint8Array<ArrayBuffer>,
  options?: OdbToCsvOptions,
): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const pkg = decodePackage(bytes); // odf.js's own decodePackage -- odb is an ODF package.
  const tables = readOdbTables(pkg, { timeZone: options?.timeZone });
  throwIfAborted(options?.signal);
  const csv = buildOdbTableCsv(tables, options?.table);
  // The CSV writer pivots through HsqldbTable rows rather than a ContentDocument, so the reported package is built only when a callback asks for it -- the .odb's whole spreadsheet content (every table), since that is the document this conversion read, with the selected table carried by the CSV itself.
  if (options?.onDocument !== undefined) {
    options.onDocument(assembleTree(odbTablesToSpreadsheetDocument(tables)));
  }
  return csv;
}

// readOdbReportContent (src/odb/report/content.ts) already turns a report into a real wordprocessing ContentDocument -- the three functions below are the last step, dispatching that ContentDocument to real docx/odt/pdf bytes, the same "read/render -> encode" shape every other ergonomic conversion in this file has. They take a ContentDocument rather than a Package: a rendered report has no source package of its own to round-trip through (readOdbReportContent already consumed the .odb), so there is nothing left to decode here, unlike odbToXlsx/odbToCsv above. They stay hand-written rather than forwarding to convertDocument: convertDocument's contract is bytes-in/bytes-out, and these take a ContentDocument directly.
export interface OdbReportToDocxOptions {
  readonly signal?: AbortSignal;
  // Forwarded to buildDocxPackage: the one construct-level degradation a rendered report's own text can hit, since a report control's own text is plain (no MathML formulas), but buildDocxPackage's own onMathDiagnostic parameter is otherwise silently ignored when there is nothing to report -- accepted here for the same "every docx-building entry point exposes the same diagnostic channel" consistency odtToDocx/docxToOdt already follow, not because a report is expected to trigger it.
  readonly onMathDiagnostic?: (
    diagnostic: OmmlDiagnostic,
    context: { readonly sourcePath?: string },
  ) => void;
}

// A rendered report's own ContentDocument -> real docx bytes, via buildDocxPackage -- the exact "encodePackage(buildDocxPackage(content))" shape docxToOdt's own reverse hop and every other ContentDocument-to-docx caller in this file already uses. buildDocxPackage itself throws if content is somehow not the wordprocessing variant readOdbReportContent always produces, so there is no separate guard to duplicate here.
export function odbReportToDocx(
  content: ContentDocument,
  options?: OdbReportToDocxOptions,
): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  return encodePackage(
    buildDocxPackage(content, { onMathDiagnostic: options?.onMathDiagnostic }),
  ); // ooxml.js's own encodePackage -- buildDocxPackage produces an OOXML package.
}

export interface OdbReportToOdtOptions {
  readonly signal?: AbortSignal;
}

// A rendered report's own ContentDocument -> real odt bytes, mirroring odbReportToDocx exactly for the ODF side -- buildOdtPackage takes no onMathDiagnostic option at all (an embedded ODF formula is written as a real formula sub-object with no OMML translation step to degrade -- see src/odf-package/formula.ts), so OdbReportToOdtOptions carries nothing beyond signal.
export function odbReportToOdt(
  content: ContentDocument,
  options?: OdbReportToOdtOptions,
): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  return encodeOdfPackage(buildOdtPackage(content)); // odf.js's own encodePackage -- buildOdtPackage produces an ODF package.
}

// A rendered report's own ContentDocument -> real PDF bytes. Mirrors markdownToPdf's own pipeline exactly (createFontRegistry directly, not createDocumentFontRegistry): a rendered report has no source PACKAGE of its own to extract embedded fonts from, any more than markdown text does, so there is no sourceFonts slot to populate -- options.fonts/onFontSubstitution still reach a real FontRegistry, just one built from the caller's own faces and pdf-codec's vendored substitutes/standard 14 alone. options shape is DocumentToPdfOptions verbatim -- the same type docxToPdf/odtToPdf/markdownToPdf already use -- rather than a bespoke OdbReportToPdfOptions, so a caller already familiar with any other *ToPdf function in this package needs to learn nothing new here.
export function odbReportToPdf(
  content: ContentDocument,
  options?: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  if (content.kind !== "wordprocessing") {
    throw new Error("odbReportToPdf requires a wordprocessing ContentDocument");
  }
  const fonts = createFontRegistry({
    fonts: options?.fonts,
    onSubstitution: options?.onFontSubstitution,
  });
  const {
    document: layout,
    formulas,
    pages,
  } = convertWordprocessingToLayout(content, {
    measurer: createFontMeasurer(fonts),
    mathMetricsAt,
  });
  const out = writePdf(layout, {
    signal: options?.signal,
    onSubstitution: options?.onSubstitution,
    formulas,
    fonts,
  });
  // Assembled and reported after the output bytes exist, matching every other construction site's ownership rule.
  options?.onDocument?.(assembleTree(content, pages));
  return out;
}
