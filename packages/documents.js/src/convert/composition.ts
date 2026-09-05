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
import { readRtfContent, rtfBytesFromLatin1, writeRtfContent } from "rtf-codec";
import { readDocContent, writeDocContent } from "doc-codec";
import { readXlsContent, writeXlsContent } from "xls-codec";
import { readPptContent } from "../ppt/read";
import { writePptContent } from "../ppt/write";
import { readWpdContent } from "wpd-codec";
import { requireArrayBufferBytes } from "../model/bytes";
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
  readonly clock?: ClockPort;
}

// --- Registry: declarative per-format primitive wiring -----------------------------------------

// The fourteen read-and-write content formats this engine routes between (pdf is the layout pivot, reached via toPdf/fromPdf edges; odf is special, excluded entirely -- see the module doc). A format here can be either end of a conversion, which is what the read/build pair in its FORMAT_NODES entry means; the read-only formats that can only ever be a SOURCE are ReadOnlyContentFormat below.
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
  | "rtf"
  | "doc"
  | "xls"
  | "ppt";

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
  "rtf",
  "doc",
  "xls",
  "ppt",
];

// The four ContentDocument variants a layout engine exists for. 'formula' is the fifth ContentVariant member but has no layout engine of its own (odfToPdf renders through writePdf's formula positioning, not a ContentDocument -> LayoutDocument pass), so it is excluded from this engine's layout/reconstruct registries.
type LayoutVariant = Exclude<ContentVariant, "formula">;

// Every content format's node in the composition graph: the decode -> read -> build -> encode primitive chain, plus the ContentDocument variant every format reads into and builds from. A discriminated union keeps the package (SourcePackage) and plain-text (string) halves' decode/read/build/encode signatures concrete and cast-free: the executors narrow through isTextFormatNode (below) to select the right shape. hasSourcePackage is the boolean-literal discriminant that split rests on -- and it also drives the font-registry choice in executeToPdf (createDocumentFontRegistry for a package, createFontRegistry for text), mirroring markdownToPdf's own documented divergence from docxToPdf.
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
  readonly hasSourcePackage: true;
}

// The plain-text half of the union: markdown, csv, svg, rtf, doc, xls, and ppt all decode straight from bytes to a string and read/build through their own text-level codecs -- no zip package, no font embedding, no source-package concept at all. family names the text dialect so a format can never be a member of both halves. build takes options because csv's build consumes { delimiter, sheet } and svg's build consumes { page, onSvgDiagnostic } from UnifiedConversionOptions; markdown's, rtf's, doc's, xls's, and ppt's build ignore them.
//
// rtf/doc/xls/ppt are the four members whose decode/encode are not a genuine text conversion: their own read/write pairs (rtf-codec's readRtfContent/writeRtfContent; doc-codec's readDocContent/writeDocContent; xls-codec's readXlsContent/writeXlsContent; this package's own src/ppt/read.ts+write.ts wrapping ppt-codec's readPptContent/writePptContent) all operate on raw bytes directly -- none of the four is UTF-8 text (rtf's \binN run can carry arbitrary raw picture bytes; the other three are genuinely binary containers, [MS-DOC]/BIFF8/[MS-PPT] each wrapped in an [MS-CFB] compound file), so unlike markdown/csv/svg there is no well-formed-UTF-8 decode any of their own bytes always survive. Widening decode/read/build/encode's shared TMiddle type to accommodate that honestly (a second FormatNode variant, or a generic TextFormatNode<TMiddle>) breaks executeBridge's and executeToPdf's generic "decode then read" dispatch over the whole ContentFormat space: FORMAT_NODES[format] for a non-literal format widens to the union of every member's node type, and calling a union of methods whose parameter types differ per member (string here, Uint8Array there) requires the argument to satisfy every member's parameter type at once, which TypeScript correctly rejects. So each of the four instead wraps and unwraps the identical lossless byte<->code-unit mapping bytesToLatin1/latin1ToBytes below implement -- "the one string form that genuinely still holds bytes" per rtf-codec's own rtfBytesFromLatin1 doc comment (the function rtf's own encode leg still calls directly, since rtf-codec already exports it; doc/xls/ppt have no such export of their own, hence the local generic pair) -- a sanctioned, lossless representation, not a workaround invented here.
interface TextFormatNode {
  readonly variant: LayoutVariant;
  readonly family: "markdown" | "csv" | "svg" | "rtf" | "doc" | "xls" | "ppt";
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
  readonly hasSourcePackage: false;
}

export type FormatNode = PackageFormatNode | TextFormatNode;

// Narrowing on the boolean-literal hasSourcePackage discriminant (not on family), so the text half stays open to further plain-text families without touching any executor: TypeScript narrows a discriminated union on literal true/false just as it does on string literals. Exported because composition-to-pdf.ts's executeToPdf branches through the same narrowing.
export function isTextFormatNode(node: FormatNode): node is TextFormatNode {
  return !node.hasSourcePackage;
}

// --- Read-only formats: a source that can never be a target -------------------------------------
//
// Some formats in this family have a genuine, tested reader and no writer at all -- not "no writer yet" as an omission, but as a deliberate scope decision, because a half-correct writer for a format nobody can round-trip against is worse than none (wpd-codec's own Scope section states exactly that for WordPerfect). Such a format is a real conversion SOURCE and can never be a target, and that asymmetry is the thing this engine had no way to express: FORMAT_NODES' read/build pair says a format does both, and the graph builder's edges are all bidirectional.
//
// A read-only format is therefore a second kind of node with its own registry and its own DIRECTED edges. Nothing points at one, so the pathfinder can never route TO a read-only format: reachability does the work, and no target-side guard is needed anywhere. wpd is the one member here today -- doc-codec, xls-codec, and ppt-codec, once unwired for the identical reason, have each since gained a real writer and joined FORMAT_NODES as full read-and-write members instead (capability.ts's own FORMAT_CAPABILITIES.doc/.xls/.ppt), so this type is not a growing enumeration so much as a holding area for whichever format genuinely has no writer at a given moment.
//
// odf is deliberately NOT modelled this way even though it too has a reader and no writer. It reads into the 'formula' variant, which has no layout engine, no reconstructor, and no second format to bridge to -- so a read-only odf node would have zero outgoing edges and route nothing. Its one real edge, odf -> pdf, goes through src/mathml's own formula positioning rather than any executor here, which is why it stays local.ts's special case (see this module's own top comment).
export type ReadOnlyContentFormat = "wpd";

// The explicit, typed list, kept in sync with READ_ONLY_FORMAT_NODES' own keys for the same reason CONTENT_FORMATS is: iterating `Object.keys` would return `string[]` and need a cast back.
const READ_ONLY_CONTENT_FORMATS: readonly ReadOnlyContentFormat[] = ["wpd"];

// A source-only node. Deliberately not a third member of the FormatNode union: it has no build/encode half at all, so widening that union would make every executor's target-side call site branch on a case that can never occur there, and the "no decode step" shape below would have to be faked with an identity decode. `read` takes bytes directly because a read-only codec has no round trip to keep symmetrical -- there is no encode to be the inverse of a decode, so the intermediate representation that split exists for (a Package, a text string) has nothing to hold.
export interface ReadOnlyFormatNode {
  readonly variant: LayoutVariant;
  readonly read: (
    bytes: Uint8Array<ArrayBuffer>,
    options?: UnifiedConversionOptions,
  ) => ContentDocument;
}

// wpd reads WordPerfect 6.x-X6 into the wordprocessing ContentDocument variant (wpd-codec's readWpdContent), so it bridges to docx/odt/markdown/rtf at cost 1 and rides the wordprocessing layout engine to pdf directly -- markdown's own justification for a layout path, since convertWordprocessingToLayout consumes what it reads unmodified. read passes only signal through; readWpdContent's own ReadWpdOptions carries a WpdDiagnosticSink too, but UnifiedConversionOptions declares no field for it, matching csv/svg/rtf's own precedent of surfacing only the options this shared shape already has room for.
export const READ_ONLY_FORMAT_NODES: Readonly<
  Record<ReadOnlyContentFormat, ReadOnlyFormatNode>
> = {
  wpd: {
    variant: "wordprocessing",
    read: (bytes) => readWpdContent(bytes),
  },
};

// Every format this engine can read FROM: the read-and-write ones plus the read-only ones. This is the type a bridge's or a toPdf hop's SOURCE is, where its target stays the narrower ContentFormat.
export type SourceContentFormat = ContentFormat | ReadOnlyContentFormat;

export function isReadOnlyContentFormat(
  format: DocumentFormat,
): format is ReadOnlyContentFormat {
  return (READ_ONLY_CONTENT_FORMATS as readonly DocumentFormat[]).includes(
    format,
  );
}

// Decodes and reads whichever kind of source node this format has, so an executor states the "get a ContentDocument out of these bytes" step once rather than branching on node kind at every call site. The read-and-write half keeps its decode/read split (the package or text intermediate its own encode is the inverse of); the read-only half has none.
function readSourceContent(
  format: SourceContentFormat,
  bytes: Uint8Array<ArrayBuffer>,
  options: UnifiedConversionOptions | undefined,
): { readonly content: ContentDocument; readonly variant: LayoutVariant } {
  if (isReadOnlyContentFormat(format)) {
    const node = READ_ONLY_FORMAT_NODES[format];
    return { content: node.read(bytes, options), variant: node.variant };
  }
  const node = FORMAT_NODES[format];
  if (isTextFormatNode(node)) {
    const text = node.decode(bytes);
    return { content: node.read(text, options), variant: node.variant };
  }
  const pkg = node.decode(bytes);
  return { content: node.read(pkg, options), variant: node.variant };
}

// The bytes -> latin1-string half of the round trip every byte-oriented FORMAT_NODES member (rtf, doc, xls, ppt) uses for decode/build (see TextFormatNode's own comment on why this exists): each byte becomes exactly one UTF-16 code unit 0x00-0xFF, the inverse of latin1ToBytes below. Chunked at 8192 bytes per String.fromCharCode call, mirroring rtf-codec's own internal asciiStringFromBytes (src/bytes.ts, not part of that package's public surface) -- spreading an unbounded byte array as call arguments in one shot risks "Maximum call stack size exceeded" well before a real legacy binary file's own size limit is reached.
const LATIN1_CHUNK_SIZE = 8192;
function bytesToLatin1(bytes: Uint8Array): string {
  let text = "";
  for (let start = 0; start < bytes.length; start += LATIN1_CHUNK_SIZE) {
    text += String.fromCharCode(
      ...bytes.subarray(start, start + LATIN1_CHUNK_SIZE),
    );
  }
  return text;
}

// The inverse, for doc/xls/ppt's own encode leg: a code unit above U+00FF proves the string was decoded through a multi-byte encoding rather than genuinely still holding bytes, so this throws rather than truncating -- the identical contract rtf-codec's own rtfBytesFromLatin1 states in its doc comment (that function still serves rtf's own encode leg directly, since rtf-codec already exports it publicly; doc-codec/xls-codec/ppt-codec have no equivalent export of their own, which is what this local counterpart is for). Always called here on a string this same module's own bytesToLatin1 just produced, so the throw path is an internal-invariant guard in practice, never a caller-facing validation failure.
function latin1ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0xff) {
      throw new TypeError(
        `latin1ToBytes: character at index ${String(index)} is U+${code.toString(16).toUpperCase().padStart(4, "0")}, above U+00FF -- this string no longer holds the file's original bytes`,
      );
    }
    bytes[index] = code;
  }
  return bytes;
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
    hasSourcePackage: true,
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
    hasSourcePackage: true,
  },
  xlsx: {
    variant: "spreadsheet",
    family: "ooxml",
    decode: (bytes) => decodeOoxmlPackage(bytes),
    read: (pkg) => readXlsxContent(pkg),
    build: (content) => buildXlsxPackageFromContent(content),
    encode: (pkg) => encodeOoxmlPackage(pkg),
    hasSourcePackage: true,
  },
  odt: {
    variant: "wordprocessing",
    family: "odf",
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdtContent(pkg),
    build: (content) => buildOdtPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    hasSourcePackage: true,
  },
  odp: {
    variant: "presentation",
    family: "odf",
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdpContent(pkg),
    build: (content) => buildOdpPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    hasSourcePackage: true,
  },
  ods: {
    variant: "spreadsheet",
    family: "odf",
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdsContent(pkg),
    build: (content) => buildOdsPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    hasSourcePackage: true,
  },
  odg: {
    variant: "drawing",
    family: "odf",
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdgContent(pkg),
    build: (content) => buildOdgPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    hasSourcePackage: true,
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
    hasSourcePackage: false,
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
    hasSourcePackage: false,
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
    hasSourcePackage: false,
  },
  // rtf shares the wordprocessing ContentDocument variant with docx/odt/markdown (readRtfContent/writeRtfContent, rtf-codec), so it same-variant bridges to all three at cost 1 -- but it has no layout engine of its own (capability.ts's own FORMAT_CAPABILITIES.rtf), so it is deliberately absent from LAYOUT_CAPABLE below: rtf <-> pdf routes through one of those bridges plus that format's own toPdf/fromPdf edge, never a direct rtf <-> LayoutDocument pipeline. read/build pass only signal through -- readRtfContent's/writeRtfContent's own ReadRtfOptions/WriteRtfOptions also carry an RtfDiagnosticSink (and, for read, resource-limit overrides), but UnifiedConversionOptions declares no field for those; a caller wanting them uses rtf-codec's readRtf/writeRtf directly, matching csv/svg's own onCellTypeInference/onSvgDiagnostic precedent of only surfacing options this shared shape already has room for.
  rtf: {
    variant: "wordprocessing",
    family: "rtf",
    decode: (bytes) => bytesToLatin1(bytes),
    read: (text, options) =>
      readRtfContent(text, { signal: options?.signal }).document,
    build: (content) => bytesToLatin1(writeRtfContent(content)),
    // rtfBytesFromLatin1's declared return type is the bare Uint8Array (Uint8Array<ArrayBufferLike>, admitting a SharedArrayBuffer-backed view), one step broader than FormatNode's own Uint8Array<ArrayBuffer> convention -- requireArrayBufferBytes narrows it with a real runtime check rather than a cast, exactly as every other write-side boundary in this package already does for a builder's returned bytes (see that function's own doc comment in model/bytes.ts).
    encode: (text) => requireArrayBufferBytes(rtfBytesFromLatin1(text)),
    hasSourcePackage: false,
  },
  // doc reads/writes a real wordprocessing ContentDocument directly (doc-codec's readDocContent/writeDocContent), so it same-variant bridges to docx/odt/markdown/rtf at cost 1 -- but it has no layout engine of its own (capability.ts's own FORMAT_CAPABILITIES.doc), so it is deliberately absent from LAYOUT_CAPABLE below: doc <-> pdf routes through one of those bridges plus that format's own toPdf/fromPdf edge, never a direct doc <-> LayoutDocument pipeline. readDocContent takes no options at all (doc-codec's read side has no loop of its own to hook a signal into and no diagnostic sink), so read checks the signal once via throwIfAborted before decoding -- the identical no-loop-format shape docx/pptx/odt get from CONTENT_READERS' own convention. writeDocContent's own WriteDocContentOptions does carry a diagnostic sink now (onWarning, for the table writer's lost-boundary-budget fallback -- see doc-codec's own README), but UnifiedConversionOptions declares no field for it, matching rtf's own precedent twelve lines above of only surfacing options this shared shape already has room for; a caller wanting it uses doc-codec's writeDocContent directly. build therefore still ignores options entirely.
  doc: {
    variant: "wordprocessing",
    family: "doc",
    decode: (bytes) => bytesToLatin1(bytes),
    read: (text, options) => {
      throwIfAborted(options?.signal);
      return readDocContent(latin1ToBytes(text));
    },
    build: (content) => bytesToLatin1(writeDocContent(content)),
    encode: (text) => latin1ToBytes(text),
    hasSourcePackage: false,
  },
  // xls reads/writes a real spreadsheet ContentDocument directly (xls-codec's readXlsContent/writeXlsContent, over XlsContentDocument -- a plain Extract<ContentDocument, {kind:'spreadsheet'}>, fully interchangeable with the shared type at this boundary), so it same-variant bridges to xlsx/ods/csv at cost 1 -- but it has no layout engine of its own (capability.ts's own FORMAT_CAPABILITIES.xls), so it follows xlsx/csv's own routing exactly: xls <-> pdf goes through the ods bridge + ods's own layout engine. writeXlsContent's own parameter type is the narrowed XlsContentDocument rather than the bare ContentDocument doc-codec's writeDocContent accepts, so build narrows with a real runtime check (matching this module's own TRANSFORMS narrowing convention) rather than a cast -- a throw here is an internal-invariant guard, since executeBridge only ever calls build after confirming the content's variant already matches this node's own.
  xls: {
    variant: "spreadsheet",
    family: "xls",
    decode: (bytes) => bytesToLatin1(bytes),
    read: (text, options) => {
      throwIfAborted(options?.signal);
      return readXlsContent(latin1ToBytes(text));
    },
    build: (content) => {
      if (content.kind !== "spreadsheet") {
        throw new Error(
          "FORMAT_NODES.xls.build: expected a spreadsheet ContentDocument",
        );
      }
      return bytesToLatin1(writeXlsContent(content));
    },
    encode: (text) => latin1ToBytes(text),
    hasSourcePackage: false,
  },
  // ppt reads/writes a real presentation ContentDocument, but only via this package's own src/ppt/read.ts+write.ts adapter -- ppt-codec's own readPptContent/writePptContent operate on the flat { metadata, slides } shape (mirroring ooxml.js's/odf.js's own upstream flat readers), not the full envelope, exactly as CONTENT_READERS.ppt (src/codecs/read.ts) and DOCUMENT_FORMAT_CODECS.ppt (src/codecs/registry.ts) both go through the identical adapter rather than calling ppt-codec directly. So it same-variant bridges to pptx/odp at cost 1 -- but it has no layout engine of its own (capability.ts's own FORMAT_CAPABILITIES.ppt), so it follows rtf/doc's own routing exactly: ppt <-> pdf goes through a same-variant bridge plus that format's own toPdf/fromPdf edge.
  ppt: {
    variant: "presentation",
    family: "ppt",
    decode: (bytes) => bytesToLatin1(bytes),
    read: (text, options) => {
      throwIfAborted(options?.signal);
      return readPptContent(latin1ToBytes(text));
    },
    build: (content) => bytesToLatin1(writePptContent(content)),
    encode: (text) => latin1ToBytes(text),
    hasSourcePackage: false,
  },
};

// The formats that have a direct layout-engine path to/from PDF (convertXToLayout + writePdf). xlsx and csv are deliberately absent: neither has a layout engine of its own, so the pathfinder routes each <-> pdf through ods instead (e.g. csv -> ods bridge, then ods -> pdf toPdf), reproducing the composed route xlsxToPdf/pdfToXlsx already hard-code in convert.ts. rtf is absent for the identical reason, routed through a same-variant bridge to docx/odt/markdown instead -- and doc/xls/ppt join it there for the same reason again: none of the three legacy binary codecs has a layout engine of its own, so each routes through a same-variant bridge (doc to docx/odt/markdown/rtf, xls to ods, ppt to pptx/odp) plus that bridge target's own toPdf/fromPdf edge. svg is present: its read half produces a drawing ContentDocument whose page geometry comes from the svg root's own viewBox/width/height, and convertDrawingToLayout renders it unmodified. Exported because composition-to-pdf.ts's executeToPdf is the executor that enforces it.
//
// wpd is present, and being read-only is exactly why. For a read-and-write format the entry is a judgement between two working routes -- rtf reaches pdf through a docx bridge at a cost the hand-written rtfToPdf already accepted -- but for a read-only one there is no reverse direction to keep symmetrical, and the only question left is markdown's own: does its read produce a ContentDocument the variant's layout engine consumes unmodified? readWpdContent produces a wordprocessing document that convertWordprocessingToLayout renders exactly as it renders docx's, so routing wpd -> pdf through a docx bridge instead would build and re-read an OOXML package for nothing, losing whatever that builder cannot express on the way through.
export const LAYOUT_CAPABLE: ReadonlySet<SourceContentFormat> =
  new Set<SourceContentFormat>([
    "docx",
    "pptx",
    "odt",
    "odp",
    "ods",
    "odg",
    "svg",
    "markdown",
    "wpd",
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
  source: SourceContentFormat,
  target: ContentFormat,
  bytes: Uint8Array<ArrayBuffer>,
  options?: UnifiedConversionOptions,
): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const targetNode = FORMAT_NODES[target];

  // Read the source through whichever kind of node it has -- readSourceContent states the read-and-write half's decode/read split and the read-only half's bytes-straight-to-content shape once, so a bridge's SOURCE may be either while its target stays a read-and-write format by type.
  const { content, variant: sourceVariant } = readSourceContent(
    source,
    bytes,
    options,
  );
  if (content.kind !== sourceVariant) {
    throw new Error(
      `executeBridge: ${source} read returned a non-${sourceVariant} ContentDocument`,
    );
  }

  // Cross-variant bridges apply the semantic transform between read and build (docx -> pptx, odt -> odp, ...). Same-variant bridges copy the content straight through.
  let buildContent: ContentDocument = content;
  if (sourceVariant !== targetNode.variant) {
    const key = `${sourceVariant}->${targetNode.variant}`;
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

  // Read-only formats (see ReadOnlyContentFormat above) get the same three edge kinds at the same three costs, but DIRECTED -- out of the read-only node only. That single asymmetry is the whole mechanism: with nothing pointing at one, Dijkstra can never reach a read-only format as a target, so "a source that can never be a target" is a property of the graph's shape rather than a rule some resolver has to remember to apply.
  for (const source of READ_ONLY_CONTENT_FORMATS) {
    const variant = READ_ONLY_FORMAT_NODES[source].variant;
    for (const target of CONTENT_FORMATS) {
      const targetVariant = FORMAT_NODES[target].variant;
      if (targetVariant === variant) {
        addDirected(source, target, 1);
      } else if (TRANSFORMS[`${variant}->${targetVariant}`] !== undefined) {
        addDirected(source, target, 2);
      }
    }
    if (LAYOUT_CAPABLE.has(source)) {
      addDirected(source, "pdf", 3);
    }
  }

  return adj;
}

const COMPOSITION_GRAPH: ReadonlyMap<DocumentFormat, readonly GraphEdge[]> =
  buildCompositionGraph();

// Standard Dijkstra over the small (<= 16-node) composition graph. Returns the ordered node path from source to target, or undefined if source === target or target is unreachable.
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

// Narrows a DocumentFormat to the ContentFormat union (the fourteen formats with a FORMAT_NODES entry) -- the type every hop's TARGET must be, since a target is built and encoded. pdf, odf, and every read-only format are excluded: pdf is the layout pivot reached only via toPdf/fromPdf edges, odf is the special-case format this engine does not route at all, and a read-only format has no build half to be a target with.
function isContentFormat(format: DocumentFormat): format is ContentFormat {
  return (
    format !== "pdf" && format !== "odf" && !isReadOnlyContentFormat(format)
  );
}

// The same narrowing for a hop's SOURCE, which may additionally be a read-only format. Used by runCompositionPlan for the `from` endpoint of a bridge or toPdf hop, where isContentFormat covers the `to`.
function isSourceContentFormat(
  format: DocumentFormat,
): format is SourceContentFormat {
  return isContentFormat(format) || isReadOnlyContentFormat(format);
}

// The executor binding a plan runner dispatches through. bridge and fromPdf are always present (both live in this module); toPdf is bound only by composition-to-pdf.ts's full convertDocument, because the executor that renders a PDF is exactly the half of the engine a read-only caller must not reach. A plan needing a toPdf hop against a binding that carries none fails loudly below -- for the read-only entry that state is unreachable by construction (pdf as a source never routes back through pdf; Dijkstra never revisits a node), so the throw is an internal-invariant guard, not a caller-facing branch.
export interface CompositionExecutorBinding {
  readonly bridge: (
    source: SourceContentFormat,
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
    source: SourceContentFormat,
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
      if (!isSourceContentFormat(hop.from)) {
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
      if (!isSourceContentFormat(hop.from) || !isContentFormat(hop.to)) {
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
