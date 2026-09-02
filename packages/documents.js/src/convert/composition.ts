// A declarative composition engine for documents.js's conversion surface: a plain-data primitive registry (FORMAT_NODES, TRANSFORMS, RECONSTRUCTORS) drives the read-side executors (bridge / fromPdf) and a minimum-cost graph pathfinder (resolveCompositionPlan), with the plan runner (runCompositionPlan) parameterised by an executor binding so the same loop serves both this module's read-only entry (convertDocumentFromPdf) and composition-to-pdf.ts's full convertDocument. This file calls real functions at runtime -- it generates nothing. Each executor reproduces the exact decode/read/layout/build/encode sequence and option-threading of the corresponding hand-written function in convert.ts (pdfToOdt/odtToDocx/docxToPptx/xlsxToMarkdown), so a later stage can rewire convert.ts's own bodies onto these executors without changing observable behaviour.
//
// This module is deliberately the READ half of the engine: nothing here imports the X-to-PDF renderers, so nothing here imports writePdf, a font registry, a font measurer, or the vendored font assets those pull in. The toPdf executor (executeToPdf, the layout engines, and the full convertDocument that binds them) lives in composition-to-pdf.ts, and a consumer that only ever converts FROM pdf (the documents.js/read entry, src/convert/from-pdf.ts) reaches this module without ever reaching that one -- the split the package's read-graph guard test (src/read-graph.test.ts) holds. readPdf itself is imported from 'pdf-codec/read' for the same reason: the pdf-codec root barrel's write half must not enter this graph.
//
// odf (a standalone formula document) and odm (an ODF master document) are deliberately NOT part of this engine: odfToPdf renders through src/mathml's own formula-positioning path rather than a ContentDocument -> LayoutDocument layout engine, and odmToPdf needs a caller-supplied resolveSubDocument callback that a fixed bytes-in/bytes-out contract cannot express. Both stay as the dedicated functions in convert.ts.

import {
  assembleTree,
  type ContentDocument,
  type DocumentTree,
  type FontSubstitution,
  type ProvidedFont,
} from "document-schema.js";
import {
  buildXlsxPackageFromContent,
  decodePackage as decodeOoxmlPackage,
  encodePackage as encodeOoxmlPackage,
  readXlsxContent,
  type Package as OoxmlPackage,
} from "ooxml.js";
import {
  decodePackage as decodeOdfPackage,
  encodePackage as encodeOdfPackage,
} from "odf.js";
import { readPdf } from "pdf-codec/read";
import type {
  LayoutDocument,
  PdfDiagnosticSink,
  WinAnsiSubstitution,
} from "pdf-codec";
import { type MarkdownImageResolver } from "markdown-codec";

import { buildDocxPackage } from "../edit/docx/content";
import { buildOdgPackage } from "../edit/odg/content";
import { buildOdpPackage } from "../edit/odp/content";
import { buildOdsPackage } from "../edit/ods/content";
import { buildOdtPackage } from "../edit/odt/content";
import { buildPptxPackage } from "../edit/pptx/content";
import { readDocxContent } from "../ooxml/docx/read";
import { readPptxContent } from "../ooxml/pptx/read";
import { readOdgContent } from "../odf/odg/read";
import { readOdpContent } from "../odf/odp/read";
import { readOdsContent } from "../odf/ods/read";
import { readOdtContent } from "../odf/odt/read";
import { buildMarkdownText } from "../markdown/write";
import { decodeMarkdownText, encodeMarkdownText } from "../markdown/text";
import { readMarkdownContent } from "../markdown/read";
import { decodeCsvText, encodeCsvText } from "../csv/text";
import { readCsvContent } from "../csv/read";
import { buildCsvText } from "../csv/write";
import type { SvgDiagnosticSink } from "../svg/diagnostics";
import { decodeSvgText, encodeSvgText } from "../svg/text";
import { readSvgContent } from "../svg/read";
import { buildSvgText } from "../svg/write";
import type { EpubDiagnosticSink } from "epub-codec";
import { readEpubContent, writeEpubContent } from "epub-codec";
import type { CellTypeInferenceSink } from "../layout/cell-typing";
import {
  reconstructDrawing,
  reconstructPresentation,
  reconstructSpreadsheet,
  reconstructWordprocessing,
  type ReconstructOptions,
} from "../layout/reconstruct";
import { stampPdfPackageTables } from "./pdf-package-tables";
import { type OmmlDiagnostic } from "../omml/shared";
import { throwIfAborted } from "../ports/abort";
import { type ClockPort } from "../ports/clock";
import {
  drawingToPresentation,
  presentationToDrawing,
  presentationToWordprocessing,
  wordprocessingToPresentation,
} from "./variant-bridges";
import { type ContentVariant, UnsupportedConversionError } from "./capability";
import { type DocumentFormat } from "./port";

// ooxml.js's and odf.js's Package types are structurally identical (src/interop.test.ts is the standing type-level proof, mutually assignable in both directions), so a single canonical alias covers both: every package-format read/build/encode/decode closure below flows an ooxml.js Package through odf.js primitives (and vice versa) without a cast at the boundary. This is the identical structural-typing bet createDocumentFontRegistry's own FontSourcePackage union already rests on.
type SourcePackage = OoxmlPackage;

// The union of every option field any conversion in this package accepts, all optional: the ComposedDocumentOptions shape (convert.ts:283) promoted to cover the X-to-PDF and PDF-to-X-only fields too, so a single options object threads through every hop of a composed path. Each hop's executor reads only the fields relevant to its stage: the toPdf hop consumes fonts/onFontSubstitution/onSubstitution/clock, the fromPdf hop consumes sink, bridges consume onMathDiagnostic/images, and signal/onDocument are shared.
export interface UnifiedConversionOptions {
  readonly signal?: AbortSignal;
  readonly onDocument?: (pkg: DocumentTree) => void;
  readonly fonts?: readonly ProvidedFont[];
  readonly onFontSubstitution?: (substitution: FontSubstitution) => void;
  readonly onSubstitution?: (
    substitution: WinAnsiSubstitution,
    context: { readonly pageIndex: number },
  ) => void;
  readonly sink?: PdfDiagnosticSink;
  readonly onMathDiagnostic?: (
    diagnostic: OmmlDiagnostic,
    context: { readonly sourcePath?: string },
  ) => void;
  readonly images?: MarkdownImageResolver;
  // The csv hops' own knobs, on the shared shape for the same reason onMathDiagnostic (docx/pptx only) and images (markdown only) already sit here: the pathfinder picks the hops, so per-format options must ride the one options object every hop receives, and each hop's registry closure reads only the fields it knows -- csv read consumes delimiter/onCellTypeInference, csv build consumes delimiter/sheet, every non-csv hop ignores all three. The svg row is the drawing-family counterpart: svg read consumes onSvgDiagnostic (the reader's scope-limit/degrade channel), svg build consumes page/onSvgDiagnostic, every non-svg hop ignores both.
  readonly delimiter?: string;
  readonly sheet?: string;
  readonly onCellTypeInference?: CellTypeInferenceSink;
  readonly page?: number;
  readonly onSvgDiagnostic?: SvgDiagnosticSink;
  // The epub row's own knob, on the shared shape for the identical reason onSvgDiagnostic/onCellTypeInference already sit here: epub read and build both consult the one sink epub-codec's ReadEpubOptions/WriteEpubOptions declare (a single field covering both directions, unlike svg's split read/build channels), every non-epub hop ignores it.
  readonly onEpubDiagnostic?: EpubDiagnosticSink;
  readonly clock?: ClockPort;
}

// --- Registry: declarative per-format primitive wiring -----------------------------------------

// The eleven content formats this engine routes between (pdf is the layout pivot, reached via toPdf/fromPdf edges; odf is special, excluded entirely -- see the module doc). docx is listed first among the wordprocessing-variant members deliberately: CONTENT_FORMATS' own order is buildCompositionGraph's iteration order, and it is the tie-break buildCompositionGraph's own Map-insertion order resolves epub's equal-cost toPdf/fromPdf routes through (see capability.ts's own FORMAT_CAPABILITIES.epub comment and composition-plans.test.ts's pinned route).
export type ContentFormat =
  | "docx"
  | "pptx"
  | "xlsx"
  | "odt"
  | "odp"
  | "ods"
  | "odg"
  | "svg"
  | "csv"
  | "markdown"
  | "epub";

// The explicit, typed list of content formats, kept in sync with FORMAT_NODES' own keys. Used for iteration in the graph builder in place of `Object.keys(FORMAT_NODES)` (which returns `string[]` and would need a cast back to ContentFormat), so the registry stays cast-free end to end.
const CONTENT_FORMATS: readonly ContentFormat[] = [
  "docx",
  "pptx",
  "xlsx",
  "odt",
  "odp",
  "ods",
  "odg",
  "svg",
  "csv",
  "markdown",
  "epub",
];

// The four ContentDocument variants a layout engine exists for. 'formula' is the fifth ContentVariant member but has no layout engine of its own (odfToPdf renders through writePdf's formula positioning, not a ContentDocument -> LayoutDocument pass), so it is excluded from this engine's layout/reconstruct registries.
type LayoutVariant = Exclude<ContentVariant, "formula">;

// Every content format's node in the composition graph: the decode -> read -> build -> encode primitive chain, plus the ContentDocument variant every format reads into and builds from. A discriminated union keeps the package (SourcePackage), plain-text (string), and raw-bytes halves' decode/read/build/encode signatures concrete and cast-free: the executors narrow through isTextFormatNode/isBytesFormatNode (below) to select the right shape. kind is the string-literal discriminant the split rests on (a boolean hasSourcePackage flag before epub joined -- widened to a string literal the moment a third genuinely different shape arrived, rather than overloading a two-valued flag to mean three things) -- it also drives the font-registry choice in executeToPdf (createDocumentFontRegistry for a package, createFontRegistry for text/bytes), mirroring markdownToPdf's own documented divergence from docxToPdf.
interface PackageFormatNode {
  readonly variant: LayoutVariant;
  readonly family: "ooxml" | "odf";
  readonly decode: (bytes: Uint8Array<ArrayBuffer>) => SourcePackage;
  readonly read: (
    pkg: SourcePackage,
    options?: UnifiedConversionOptions,
  ) => ContentDocument;
  readonly build: (
    content: ContentDocument,
    options?: UnifiedConversionOptions,
  ) => SourcePackage;
  readonly encode: (pkg: SourcePackage) => Uint8Array<ArrayBuffer>;
  readonly kind: "package";
}

// The plain-text half of the union: markdown, csv, and svg all decode straight from bytes to a string and read/build through their own text-level codecs -- no zip package, no font embedding, no source-package concept at all. family names the text dialect so a format can never be a member of more than one half. build takes options because csv's build consumes { delimiter, sheet } and svg's build consumes { page, onSvgDiagnostic } from UnifiedConversionOptions; markdown's build ignores them.
interface TextFormatNode {
  readonly variant: LayoutVariant;
  readonly family: "markdown" | "csv" | "svg";
  readonly decode: (bytes: Uint8Array<ArrayBuffer>) => string;
  readonly read: (
    text: string,
    options?: UnifiedConversionOptions,
  ) => ContentDocument;
  readonly build: (
    content: ContentDocument,
    options?: UnifiedConversionOptions,
  ) => string;
  readonly encode: (text: string) => Uint8Array<ArrayBuffer>;
  readonly kind: "text";
}

// The raw-bytes half of the union: epub's own read/build (epub-codec's readEpubContent/writeEpubContent) operate on the zip bytes directly, with no intermediate decoded shape at all -- unlike the package half (bytes -> a real Package object) or the text half (bytes -> a UTF-8 string), epub's own OCF/ZIP layer is entirely internal to epub-codec and never surfaces here. There is consequently no decode/encode pair to declare: read takes bytes and produces a ContentDocument in one step, build takes a ContentDocument and produces bytes in one step. family is a one-member union today (only epub needs this shape), left open the same way TextFormatNode's family is for a future second raw-bytes format.
interface BytesFormatNode {
  readonly variant: LayoutVariant;
  readonly family: "epub";
  readonly read: (
    bytes: Uint8Array<ArrayBuffer>,
    options?: UnifiedConversionOptions,
  ) => ContentDocument;
  readonly build: (
    content: ContentDocument,
    options?: UnifiedConversionOptions,
  ) => Uint8Array<ArrayBuffer>;
  readonly kind: "bytes";
}

export type FormatNode = PackageFormatNode | TextFormatNode | BytesFormatNode;

// Narrowing on the string-literal kind discriminant (not on family), so each half stays open to further members of its own shape without touching any executor: TypeScript narrows a discriminated union on a string-literal field just as it does on true/false. Both exported because composition-to-pdf.ts's executeToPdf branches through the same narrowing.
export function isTextFormatNode(node: FormatNode): node is TextFormatNode {
  return node.kind === "text";
}
export function isBytesFormatNode(node: FormatNode): node is BytesFormatNode {
  return node.kind === "bytes";
}

// The single source of truth for "which primitives does each format use". read/build closures thread their own per-format option subset internally: docx and pptx read/build both pull onMathDiagnostic (mirroring readDocxContent's/readPptxContent's own `{ onMathDiagnostic }` and buildDocxPackage's/buildPptxPackage's own option -- ExaDev/documents.js#563 gave pptx the identical OMML degrade-diagnostic channel docx already had), markdown read pulls signal/images (mirroring readMarkdownContent's ReadMarkdownOptions), csv read pulls delimiter/onCellTypeInference and csv build pulls delimiter/sheet (mirroring readCsvContent's ReadCsvContentOptions and buildCsvText's BuildCsvTextOptions), svg read pulls onSvgDiagnostic and svg build pulls page/onSvgDiagnostic (mirroring readSvgContent's ReadSvgContentOptions and buildSvgText's BuildSvgTextOptions), and every other format's read/build accept and ignore the thread. docxToPdf's openDocx(bytes).toPackage() and decodeOoxmlPackage(bytes) produce the identical Package (openDocx wraps decodeOoxmlPackage and toPackage returns it unmutated), so decode uses the package codec directly for uniformity -- byte-identical to docxToPdf at every downstream call site.
export const FORMAT_NODES: Readonly<Record<ContentFormat, FormatNode>> = {
  docx: {
    variant: "wordprocessing",
    family: "ooxml",
    decode: (bytes) => decodeOoxmlPackage(bytes),
    read: (pkg, options) =>
      readDocxContent(pkg, { onMathDiagnostic: options?.onMathDiagnostic }),
    build: (content, options) =>
      buildDocxPackage(content, {
        onMathDiagnostic: options?.onMathDiagnostic,
      }),
    encode: (pkg) => encodeOoxmlPackage(pkg),
    kind: "package",
  },
  pptx: {
    variant: "presentation",
    family: "ooxml",
    decode: (bytes) => decodeOoxmlPackage(bytes),
    read: (pkg, options) =>
      readPptxContent(pkg, { onMathDiagnostic: options?.onMathDiagnostic }),
    build: (content, options) =>
      buildPptxPackage(content, {
        onMathDiagnostic: options?.onMathDiagnostic,
      }),
    encode: (pkg) => encodeOoxmlPackage(pkg),
    kind: "package",
  },
  xlsx: {
    variant: "spreadsheet",
    family: "ooxml",
    decode: (bytes) => decodeOoxmlPackage(bytes),
    read: (pkg) => readXlsxContent(pkg),
    build: (content) => buildXlsxPackageFromContent(content),
    encode: (pkg) => encodeOoxmlPackage(pkg),
    kind: "package",
  },
  odt: {
    variant: "wordprocessing",
    family: "odf",
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdtContent(pkg),
    build: (content) => buildOdtPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    kind: "package",
  },
  odp: {
    variant: "presentation",
    family: "odf",
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdpContent(pkg),
    build: (content) => buildOdpPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    kind: "package",
  },
  ods: {
    variant: "spreadsheet",
    family: "odf",
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdsContent(pkg),
    build: (content) => buildOdsPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    kind: "package",
  },
  odg: {
    variant: "drawing",
    family: "odf",
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdgContent(pkg),
    build: (content) => buildOdgPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    kind: "package",
  },
  // svg reads into the same drawing ContentDocument variant odg does, so the two form a same-variant bridge pair (cost 1) and svg additionally rides the drawing layout engine through its own toPdf/fromPdf edges -- a text format with a genuine layout path, the one combination csv's entry does not have. read pulls onSvgDiagnostic and build pulls page/onSvgDiagnostic (mirroring readSvgContent's ReadSvgContentOptions and buildSvgText's BuildSvgTextOptions, src/svg/), so a multi-page drawing reached through the build leg throws SvgMultiPageNotSpecifiedError exactly as a direct buildSvgText call would until a caller selects a page.
  svg: {
    variant: "drawing",
    family: "svg",
    decode: (bytes) => decodeSvgText(bytes),
    read: (text, options) =>
      readSvgContent(text, { onSvgDiagnostic: options?.onSvgDiagnostic }),
    build: (content, options) =>
      buildSvgText(content, {
        page: options?.page,
        onSvgDiagnostic: options?.onSvgDiagnostic,
      }),
    encode: (text) => encodeSvgText(text),
    kind: "text",
  },
  markdown: {
    variant: "wordprocessing",
    family: "markdown",
    decode: (bytes) => decodeMarkdownText(bytes),
    read: (text, options) =>
      readMarkdownContent(text, {
        signal: options?.signal,
        images: options?.images,
      }),
    build: (content) => buildMarkdownText(content),
    encode: (text) => encodeMarkdownText(text),
    kind: "text",
  },
  csv: {
    variant: "spreadsheet",
    family: "csv",
    decode: (bytes) => decodeCsvText(bytes),
    read: (text, options) =>
      readCsvContent(text, {
        delimiter: options?.delimiter,
        onCellTypeInference: options?.onCellTypeInference,
      }),
    build: (content, options) =>
      buildCsvText(content, {
        delimiter: options?.delimiter,
        sheet: options?.sheet,
      }),
    encode: (text) => encodeCsvText(text),
    kind: "text",
  },
  // epub reads into the same wordprocessing ContentDocument variant docx/odt/markdown do, so it forms a same-variant bridge pair (cost 1) with all three -- but unlike svg's drawing-family entry above, epub has no toPdf/fromPdf edges of its own (LAYOUT_CAPABLE excludes it below): epub-codec's readEpubContent/writeEpubContent operate on the zip bytes directly, with no decode/encode split at all, so this is the one BytesFormatNode entry (see that interface's own comment). read and build both thread the one epub-codec diagnostic sink (ReadEpubOptions/WriteEpubOptions' shared `sink` field) from options.onEpubDiagnostic.
  epub: {
    variant: "wordprocessing",
    family: "epub",
    read: (bytes, options) =>
      readEpubContent(bytes, { sink: options?.onEpubDiagnostic }),
    build: (content, options) =>
      writeEpubContent(content, { sink: options?.onEpubDiagnostic }),
    kind: "bytes",
  },
};

// The formats that have a direct layout-engine path to/from PDF (convertXToLayout + writePdf). xlsx and csv are deliberately absent: neither has a layout engine of its own, so the pathfinder routes each <-> pdf through ods instead (e.g. csv -> ods bridge, then ods -> pdf toPdf), reproducing the composed route xlsxToPdf/pdfToXlsx already hard-code in convert.ts. svg is present: its read half produces a drawing ContentDocument whose page geometry comes from the svg root's own viewBox/width/height, and convertDrawingToLayout renders it unmodified. Exported because composition-to-pdf.ts's executeToPdf is the executor that enforces it.
export const LAYOUT_CAPABLE: ReadonlySet<ContentFormat> =
  new Set<ContentFormat>([
    "docx",
    "pptx",
    "odt",
    "odp",
    "ods",
    "odg",
    "svg",
    "markdown",
  ]);

// Cross-variant transforms keyed by `${fromVariant}->${toVariant}`. Each wrapper narrows its input with a runtime kind guard so the underlying transform receives its exact concrete variant type -- the same "no cast, narrow at the boundary" discipline every read/build closure above follows. Today wordprocessing <-> presentation and drawing <-> presentation transforms exist (src/convert/variant-bridges.ts); the pathfinder derives its cross-variant edges from this object's keys, so adding a transform here is the single change needed to teach both the pathfinder and the bridge executor a new variant crossing.
const TRANSFORMS: Readonly<
  Record<string, (doc: ContentDocument) => ContentDocument>
> = {
  "wordprocessing->presentation": (doc) => {
    if (doc.kind !== "wordprocessing") {
      throw new Error(
        "wordprocessingToPresentation: expected a wordprocessing ContentDocument",
      );
    }
    return wordprocessingToPresentation(doc);
  },
  "presentation->wordprocessing": (doc) => {
    if (doc.kind !== "presentation") {
      throw new Error(
        "presentationToWordprocessing: expected a presentation ContentDocument",
      );
    }
    return presentationToWordprocessing(doc);
  },
  "drawing->presentation": (doc) => {
    if (doc.kind !== "drawing") {
      throw new Error(
        "drawingToPresentation: expected a drawing ContentDocument",
      );
    }
    return drawingToPresentation(doc);
  },
  "presentation->drawing": (doc) => {
    if (doc.kind !== "presentation") {
      throw new Error(
        "presentationToDrawing: expected a presentation ContentDocument",
      );
    }
    return presentationToDrawing(doc);
  },
};

// Reconstructors keyed by variant -- the declarative registry executeFromPdf dispatches through, mapping a LayoutVariant to the concrete reconstruct* function the corresponding convert.ts PDF-to-X path already calls. The layout-engine counterpart (LAYOUT_ENGINES) lives in composition-to-pdf.ts with the toPdf executor it serves.
const RECONSTRUCTORS: Readonly<
  Record<
    LayoutVariant,
    (doc: LayoutDocument, options?: ReconstructOptions) => ContentDocument
  >
> = {
  wordprocessing: reconstructWordprocessing,
  presentation: reconstructPresentation,
  drawing: reconstructDrawing,
  spreadsheet: reconstructSpreadsheet,
};

// --- Executors: real functions, parameterised by the registry ----------------------------------

// decode(source) -> read(source) -> [optional cross-variant transform] -> build(target) -> encode(target), reproducing the exact sequence and option-threading of convert.ts's bridge functions (odtToDocx/docxToOdt/markdownToDocx/docxToPptx). onMathDiagnostic reaches the docx reader and builder only (via the registry closures); images reach the markdown reader only; throwIfAborted frames the read and build stages exactly as the hand-written bridges do. The pathfinder only proposes a bridge hop when source and target either share a variant (same-variant direct copy) or have a TRANSFORMS entry between their variants (cross-variant semantic transform), so a missing transform here is a pathfinder bug, not a runtime hazard.
export function executeBridge(
  source: ContentFormat,
  target: ContentFormat,
  bytes: Uint8Array<ArrayBuffer>,
  options?: UnifiedConversionOptions,
): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const sourceNode = FORMAT_NODES[source];
  const targetNode = FORMAT_NODES[target];

  // Decode + read the source, branching on kind so the package (SourcePackage), text (string), and raw-bytes decoded shapes stay concrete. The bytes half (epub) has no decode stage at all -- read consumes the source bytes directly.
  let content: ContentDocument;
  if (isTextFormatNode(sourceNode)) {
    const text = sourceNode.decode(bytes);
    content = sourceNode.read(text, options);
  } else if (isBytesFormatNode(sourceNode)) {
    content = sourceNode.read(bytes, options);
  } else {
    const pkg = sourceNode.decode(bytes);
    content = sourceNode.read(pkg, options);
  }
  if (content.kind !== sourceNode.variant) {
    throw new Error(
      `executeBridge: ${source} read returned a non-${sourceNode.variant} ContentDocument`,
    );
  }

  // Cross-variant bridges apply the semantic transform between read and build (docx -> pptx, odt -> odp, ...). Same-variant bridges copy the content straight through.
  let buildContent: ContentDocument = content;
  if (sourceNode.variant !== targetNode.variant) {
    const key = `${sourceNode.variant}->${targetNode.variant}`;
    const transform = TRANSFORMS[key];
    if (transform === undefined) {
      throw new Error(`executeBridge: no transform registered for ${key}`);
    }
    buildContent = transform(content);
  }

  throwIfAborted(options?.signal);

  // Build + encode the target first, then report the package: onDocument fires after the output bytes exist (the ownership rule every construction site follows -- a callback that inspects the tree cannot observe a half-built conversion; this executor historically fired before the build and was reordered with the tree promotion). A bridge never runs a layout engine, so the reported DocumentTree is content-only -- assembleTree decomposes it into its tree with no pages array and no node frames, the identical layoutless shape convert.ts's own bridges report.
  let out: Uint8Array<ArrayBuffer>;
  if (isTextFormatNode(targetNode)) {
    const text = targetNode.build(buildContent, options);
    out = targetNode.encode(text);
  } else if (isBytesFormatNode(targetNode)) {
    out = targetNode.build(buildContent, options);
  } else {
    const pkg = targetNode.build(buildContent, options);
    out = targetNode.encode(pkg);
  }
  options?.onDocument?.(assembleTree(buildContent));
  return out;
}

// readPdf -> reconstruct(target variant) -> build(target) -> encode(target), reproducing the exact sequence and option-threading of convert.ts's pdfTo* functions (pdfToDocx/pdfToOdt/pdfToOdp/pdfToOds/pdfToOdg/pdfToMarkdown). sink reaches readPdf; signal reaches both readPdf and the reconstructor. onCellTypeInference reaches the reconstructor (reconstructSpreadsheet's audit channel) AND csv's read -- the two places a cell re-typing decision can happen, threaded on the one options object every hop receives; the ergonomic pdfTo* functions do not declare it, so a caller wanting that audit channel on a pdf -> spreadsheet route passes it to convertDocument directly (the first-class entry point every named function forwards to). The package build half is called with no options, matching pdfTo*'s own `buildXPackage(content)` calls (no clock, no onMathDiagnostic threaded on this direction); the text build half receives options because csv's build consumes { delimiter, sheet }.
export function executeFromPdf(
  target: ContentFormat,
  bytes: Uint8Array<ArrayBuffer>,
  options?: UnifiedConversionOptions,
): Uint8Array<ArrayBuffer> {
  const node = FORMAT_NODES[target];
  // epub (the one BytesFormatNode) is never LAYOUT_CAPABLE, so the pathfinder never resolves a fromPdf hop whose target is epub -- a route into epub always lands its final bridge hop from one of docx/odt/markdown instead (see FORMAT_CAPABILITIES.epub's own comment). This narrows the type for the isTextFormatNode/else branch below and documents the invariant rather than leaving a silent runtime-only guarantee.
  if (isBytesFormatNode(node)) {
    throw new Error(
      `executeFromPdf: '${target}' is a bytes-native format with no decode/encode split and can never be a fromPdf hop's target -- LAYOUT_CAPABLE excludes it, so the pathfinder never proposes this hop`,
    );
  }
  const layout = readPdf(bytes, {
    signal: options?.signal,
    sink: options?.sink,
  });
  const content = RECONSTRUCTORS[node.variant](layout, {
    signal: options?.signal,
    onCellTypeInference: options?.onCellTypeInference,
  });
  // The pages half derives from the read LayoutDocument's own pages -- every rendered page's size, indexed to match the frames the reconstructor attached to the content it built.
  const pages = layout.pages.map((page) => ({
    widthPt: page.widthPt,
    heightPt: page.heightPt,
  }));

  // Build + encode the target first, then report the package (the ownership rule every construction site follows), with assembleTree decomposing the reconstructed content + page sizes into the tree-form DocumentTree. stampPdfPackageTables then lands the layout's document-level surfaces (destinations, outline, attachments, layers, residue, comment bodies) on the tree -- the tables the flat ContentDocument has no root for.
  let out: Uint8Array<ArrayBuffer>;
  if (isTextFormatNode(node)) {
    const text = node.build(content, options);
    out = node.encode(text);
  } else {
    const pkg = node.build(content);
    out = node.encode(pkg);
  }
  const reported = assembleTree(content, pages);
  stampPdfPackageTables(reported, layout);
  options?.onDocument?.(reported);
  return out;
}

// --- Pathfinder: minimum-cost route over the composition graph ---------------------------------

export type HopExecutor = "bridge" | "toPdf" | "fromPdf";

export interface CompositionHop {
  readonly executor: HopExecutor;
  readonly from: DocumentFormat;
  readonly to: DocumentFormat;
}

export interface ConversionPlan {
  readonly hops: readonly CompositionHop[];
}

interface GraphEdge {
  readonly to: DocumentFormat;
  readonly cost: number;
}

// Builds the composition graph's adjacency list from the registry, with fidelity-ordered edge costs: a same-variant bridge (cost 1, lossless) always beats a cross-variant transform (cost 2, approximate), which always beats a toPdf/fromPdf edge (cost 3, geometry-based render or reconstruction). Edges are bidirectional with symmetric costs. The toPdf/fromPdf edges cover exactly LAYOUT_CAPABLE (xlsx and csv absent -- each routes through ods), and cross-variant transform edges are derived from TRANSFORMS' own keys so the graph cannot drift from the registered transforms.
function buildCompositionGraph(): ReadonlyMap<
  DocumentFormat,
  readonly GraphEdge[]
> {
  const adj = new Map<DocumentFormat, GraphEdge[]>();
  const addDirected = (
    from: DocumentFormat,
    to: DocumentFormat,
    cost: number,
  ): void => {
    const list = adj.get(from);
    if (list === undefined) {
      adj.set(from, [{ to, cost }]);
    } else {
      list.push({ to, cost });
    }
  };
  const addEdge = (
    from: DocumentFormat,
    to: DocumentFormat,
    cost: number,
  ): void => {
    addDirected(from, to, cost);
    addDirected(to, from, cost);
  };

  // Same-variant bridges (cost 1): every pair of content formats sharing a variant.
  for (const a of CONTENT_FORMATS) {
    for (const b of CONTENT_FORMATS) {
      if (a === b) {
        continue;
      }
      if (FORMAT_NODES[a].variant === FORMAT_NODES[b].variant) {
        addEdge(a, b, 1);
      }
    }
  }

  // Cross-variant transforms (cost 2): every format of the source variant <-> every format of the target variant, for each direction registered in TRANSFORMS.
  for (const key of Object.keys(TRANSFORMS)) {
    const parts = key.split("->");
    const fromVariant = parts[0];
    const toVariant = parts[1];
    if (fromVariant === undefined || toVariant === undefined) {
      continue;
    }
    for (const a of CONTENT_FORMATS) {
      if (FORMAT_NODES[a].variant !== fromVariant) {
        continue;
      }
      for (const b of CONTENT_FORMATS) {
        if (FORMAT_NODES[b].variant !== toVariant) {
          continue;
        }
        addEdge(a, b, 2);
      }
    }
  }

  // toPdf/fromPdf edges (cost 3) for every layout-capable format. xlsx and csv are absent, so each reaches pdf only through its ods bridge.
  for (const format of CONTENT_FORMATS) {
    if (LAYOUT_CAPABLE.has(format)) {
      addEdge(format, "pdf", 3);
    }
  }

  return adj;
}

const COMPOSITION_GRAPH: ReadonlyMap<DocumentFormat, readonly GraphEdge[]> =
  buildCompositionGraph();

// Standard Dijkstra over the small (<= 11-node) composition graph. Returns the ordered node path from source to target, or undefined if source === target or target is unreachable.
function shortestPath(
  source: DocumentFormat,
  target: DocumentFormat,
): readonly DocumentFormat[] | undefined {
  if (source === target) {
    return undefined;
  }
  const distances = new Map<DocumentFormat, number>([[source, 0]]);
  const previous = new Map<DocumentFormat, DocumentFormat | undefined>();
  const visited = new Set<DocumentFormat>();
  while (true) {
    let current: DocumentFormat | undefined = undefined;
    let currentDist = Infinity;
    for (const [node, dist] of distances) {
      if (!visited.has(node) && dist < currentDist) {
        current = node;
        currentDist = dist;
      }
    }
    if (current === undefined || current === target) {
      break;
    }
    visited.add(current);
    for (const edge of COMPOSITION_GRAPH.get(current) ?? []) {
      if (visited.has(edge.to)) {
        continue;
      }
      const alt = currentDist + edge.cost;
      const known = distances.get(edge.to);
      if (known === undefined || alt < known) {
        distances.set(edge.to, alt);
        previous.set(edge.to, current);
      }
    }
  }
  if (distances.get(target) === undefined) {
    return undefined;
  }
  const path: DocumentFormat[] = [];
  let cursor: DocumentFormat | undefined = target;
  while (cursor !== undefined) {
    path.unshift(cursor);
    cursor = previous.get(cursor);
  }
  return path;
}

// Resolves the minimum-cost path between two DocumentFormats as an ordered hop list, or undefined if no route exists. Each hop is tagged with the executor that runs it (derivable from which endpoint is pdf: target pdf -> toPdf, source pdf -> fromPdf, otherwise bridge). Capped at 3 hops -- the most any real route needs (xlsx -> markdown = xlsx -> ods -> pdf -> markdown, three hops), and the bound beyond which a composed route would stack more lossy layers than any existing conversion in this package does today. Reproduces every route convert.ts's own functions handle: docx -> pdf is a direct toPdf hop; odt -> docx is a same-variant bridge; docx -> pptx is a cross-variant transform bridge; xlsx -> pdf is [xlsx -> ods bridge, ods -> pdf toPdf]; xlsx -> markdown is [xlsx -> ods, ods -> pdf, pdf -> markdown].
export function resolveCompositionPlan(
  source: DocumentFormat,
  target: DocumentFormat,
): ConversionPlan | undefined {
  const path = shortestPath(source, target);
  if (path === undefined) {
    return undefined;
  }
  // path.length includes both endpoints: 2 nodes = 1 hop, 4 nodes = 3 hops (the cap).
  if (path.length > 4) {
    return undefined;
  }
  const hops: CompositionHop[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const from = path[i];
    const to = path[i + 1];
    if (from === undefined || to === undefined) {
      return undefined;
    }
    const executor: HopExecutor =
      to === "pdf" ? "toPdf" : from === "pdf" ? "fromPdf" : "bridge";
    hops.push({ executor, from, to });
  }
  return { hops };
}

// Narrows a DocumentFormat to the ContentFormat union (the ten formats with a FORMAT_NODES entry). pdf and odf are excluded: pdf is the layout pivot reached only via toPdf/fromPdf edges, and odf is the special-case format this engine does not route at all. Used by runCompositionPlan to narrow a hop's DocumentFormat endpoints to the ContentFormat the executors are typed against.
function isContentFormat(format: DocumentFormat): format is ContentFormat {
  return format !== "pdf" && format !== "odf";
}

// The executor binding a plan runner dispatches through. bridge and fromPdf are always present (both live in this module); toPdf is bound only by composition-to-pdf.ts's full convertDocument, because the executor that renders a PDF is exactly the half of the engine a read-only caller must not reach. A plan needing a toPdf hop against a binding that carries none fails loudly below -- for the read-only entry that state is unreachable by construction (pdf as a source never routes back through pdf; Dijkstra never revisits a node), so the throw is an internal-invariant guard, not a caller-facing branch.
export interface CompositionExecutorBinding {
  readonly bridge: (
    source: ContentFormat,
    target: ContentFormat,
    bytes: Uint8Array<ArrayBuffer>,
    options?: UnifiedConversionOptions,
  ) => Uint8Array<ArrayBuffer>;
  readonly fromPdf: (
    target: ContentFormat,
    bytes: Uint8Array<ArrayBuffer>,
    options?: UnifiedConversionOptions,
  ) => Uint8Array<ArrayBuffer>;
  readonly toPdf?: (
    source: ContentFormat,
    bytes: Uint8Array<ArrayBuffer>,
    options?: UnifiedConversionOptions,
  ) => Uint8Array<ArrayBuffer>;
}

// Executes a resolved plan hop by hop, feeding the previous hop's output bytes into the next hop's input. Options thread to whichever hop consumes each field (fonts/onFontSubstitution/onSubstitution/clock reach the toPdf hop; sink reaches the fromPdf hop; onMathDiagnostic/images reach bridge hops; signal reaches every hop), and onDocument fires exactly once -- on the LAST hop, so the caller receives the package that actually produced the output bytes (content+layout for a toPdf/fromPdf final hop, content-only for a bridge final hop) -- mirroring the convention the original hand-written composed functions already followed (each forwarded onDocument to its own last hop). One loop serves both bindings (read-only and full) so the two entries can never drift apart in execution semantics -- the identical executors run either way.
export function runCompositionPlan(
  plan: ConversionPlan,
  bytes: Uint8Array<ArrayBuffer>,
  options: UnifiedConversionOptions | undefined,
  executors: CompositionExecutorBinding,
): Uint8Array<ArrayBuffer> {
  let current = bytes;
  for (let i = 0; i < plan.hops.length; i++) {
    const hop = plan.hops[i];
    if (hop === undefined) {
      throw new Error(
        "runCompositionPlan: resolveCompositionPlan returned a malformed hop",
      );
    }
    // onDocument fires on the last hop only: null out onDocument for every hop before the last, then pass the caller's options through unchanged on the final hop so the callback receives the package that actually produced the output bytes. This mirrors the convention the original hand-written composed functions (xlsxToPdf/pdfToXlsx/xlsxToMarkdown/markdownToXlsx) already followed -- each forwarded onDocument to its own last hop, never the first -- so a caller of xlsxToPdf still receives the odsToPdf hop's content+layout package rather than the intermediate xlsx->ods bridge's content-only one.
    const isLastHop = i === plan.hops.length - 1;
    const hopOptions: UnifiedConversionOptions | undefined = isLastHop
      ? options
      : options === undefined
        ? undefined
        : { ...options, onDocument: undefined };
    if (hop.executor === "toPdf") {
      if (!isContentFormat(hop.from)) {
        throw new Error(
          `runCompositionPlan: toPdf source '${hop.from}' is not a content format`,
        );
      }
      const toPdf = executors.toPdf;
      if (toPdf === undefined) {
        throw new Error(
          `runCompositionPlan: the plan's ${hop.from} -> ${hop.to} hop needs a toPdf executor, but this binding carries none (the read-only entry cannot render PDFs)`,
        );
      }
      current = toPdf(hop.from, current, hopOptions);
    } else if (hop.executor === "fromPdf") {
      if (!isContentFormat(hop.to)) {
        throw new Error(
          `runCompositionPlan: fromPdf target '${hop.to}' is not a content format`,
        );
      }
      current = executors.fromPdf(hop.to, current, hopOptions);
    } else {
      if (!isContentFormat(hop.from) || !isContentFormat(hop.to)) {
        throw new Error(
          `runCompositionPlan: bridge endpoints '${hop.from}' -> '${hop.to}' are not both content formats`,
        );
      }
      current = executors.bridge(hop.from, hop.to, current, hopOptions);
    }
  }
  return current;
}

// The read-only entry: resolves a pdf -> target route and runs it through this module's bridge/fromPdf executors alone -- the forward target of every pdfTo* function (src/convert/from-pdf.ts), and the one conversion entry whose module graph excludes the X-to-PDF renderers entirely. Behaviour is identical to convertDocument('pdf', target, ...) by construction: the same pathfinder resolves the plan and the same executors run its hops, and a route out of pdf never contains a toPdf hop (pdf is the source, and Dijkstra never revisits a node), so the absent executor is never consulted. Every target the pdfTo* family names is routable; an unroutable pair throws the same UnsupportedConversionError convertDocument would.
export function convertDocumentFromPdf(
  target: ContentFormat,
  bytes: Uint8Array<ArrayBuffer>,
  options?: UnifiedConversionOptions,
): Uint8Array<ArrayBuffer> {
  const plan = resolveCompositionPlan("pdf", target);
  if (plan === undefined) {
    throw new UnsupportedConversionError("pdf", target);
  }
  return runCompositionPlan(plan, bytes, options, {
    bridge: executeBridge,
    fromPdf: executeFromPdf,
  });
}
