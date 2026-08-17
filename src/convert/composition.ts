// A declarative composition engine for documents.js's conversion surface: a plain-data primitive registry (FORMAT_NODES, TRANSFORMS, LAYOUT_ENGINES, RECONSTRUCTORS) drives three real executors (bridge / toPdf / fromPdf) and a minimum-cost graph pathfinder (resolveCompositionPlan), surfaced through a single convertDocument entry point that resolves a path between any two DocumentFormats and runs each hop against the real primitives. This file calls real functions at runtime -- it generates nothing. Each executor reproduces the exact decode/read/layout/build/encode sequence and option-threading of the corresponding hand-written function in convert.ts (docxToPdf/pdfToOdt/odtToDocx/docxToPptx/xlsxToPdf/xlsxToMarkdown/odgToPdf/markdownToPdf), so a later stage can rewire convert.ts's own bodies onto these executors without changing observable behaviour.
//
// odf (a standalone formula document) and odm (an ODF master document) are deliberately NOT part of this engine: odfToPdf renders through src/mathml's own formula-positioning path rather than a ContentDocument -> LayoutDocument layout engine, and odmToPdf needs a caller-supplied resolveSubDocument callback that a fixed bytes-in/bytes-out contract cannot express. Both stay as the dedicated functions in convert.ts.

import { DOCUMENT_PACKAGE_FORMAT_VERSION, type ContentDocument, type DocumentPackage, type FontSubstitution, type LayoutDocument, type MathFontMetrics, type PageSize, type PositionedFormula, type ProvidedFont } from 'document-schema.js';
import { buildXlsxPackage, decodePackage as decodeOoxmlPackage, encodePackage as encodeOoxmlPackage, readXlsxContent, type Package as OoxmlPackage } from 'ooxml.js';
import { decodePackage as decodeOdfPackage, encodePackage as encodeOdfPackage } from 'odf.js';
import { createFontMeasurer, createFontRegistry, loadMathFont, readPdf, writePdf, type FontRegistry, type PdfDiagnosticSink, type WinAnsiSubstitution } from 'pdf-codec';
import { type MarkdownImageResolver } from 'markdown-codec';

import { buildDocxPackage } from '../edit/docx/content';
import { buildOdgPackage } from '../edit/odg/content';
import { buildOdpPackage } from '../edit/odp/content';
import { buildOdsPackage } from '../edit/ods/content';
import { buildOdtPackage } from '../edit/odt/content';
import { buildPptxPackage } from '../edit/pptx/content';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import { readOdgContent } from '../odf/odg/read';
import { readOdpContent } from '../odf/odp/read';
import { readOdsContent } from '../odf/ods/read';
import { readOdtContent } from '../odf/odt/read';
import { buildMarkdownText } from '../markdown/write';
import { decodeMarkdownText, encodeMarkdownText } from '../markdown/text';
import { readMarkdownContent } from '../markdown/read';
import { convertDrawingToLayout } from '../layout/drawing';
import { convertWordprocessingToLayout } from '../layout/engine';
import { reconstructDrawing, reconstructPresentation, reconstructSpreadsheet, reconstructWordprocessing, type ReconstructOptions } from '../layout/reconstruct';
import { convertSpreadsheetToLayout } from '../layout/sheets';
import { convertPresentationToLayout } from '../layout/slides';
import { type OmmlDiagnostic } from '../omml/shared';
import { throwIfAborted } from '../ports/abort';
import { type ClockPort } from '../ports/clock';
import { resolveMetadataTimestamps } from '../model/metadata';
import { createDocumentFontRegistry, type FontSourcePackage } from '../fonts/registry';
import { drawingToPresentation, presentationToDrawing, presentationToWordprocessing, wordprocessingToPresentation } from './variant-bridges';
import { type ContentVariant, UnsupportedConversionError } from './capability';
import { type DocumentFormat } from './port';

// ooxml.js's and odf.js's Package types are structurally identical (src/interop.test.ts is the standing type-level proof, mutually assignable in both directions), so a single canonical alias covers both: every package-format read/build/encode/decode closure below flows an ooxml.js Package through odf.js primitives (and vice versa) without a cast at the boundary. This is the identical structural-typing bet createDocumentFontRegistry's own FontSourcePackage union already rests on.
type SourcePackage = OoxmlPackage;

// A thin factory over pdf-codec's cached loadMathFont singleton, injected into each formula-placing layout engine's options as `mathMetricsAt` -- the identical one-liner convert.ts defines (line 45), restated here so this module owns no dependency on convert.ts. The drawing engine takes no mathMetricsAt (formulas cannot embed in a drawing), so it is wired per-variant in executeToPdf rather than unconditionally.
const mathMetricsAt = (sizePt: number): MathFontMetrics => loadMathFont().metricsAt(sizePt);

// The union of every option field any conversion in this package accepts, all optional: the ComposedDocumentOptions shape (convert.ts:283) promoted to cover the X-to-PDF and PDF-to-X-only fields too, so a single options object threads through every hop of a composed path. Each hop's executor reads only the fields relevant to its stage: the toPdf hop consumes fonts/onFontSubstitution/onSubstitution/clock, the fromPdf hop consumes sink, bridges consume onMathDiagnostic/images, and signal/onDocument are shared.
export interface UnifiedConversionOptions {
  readonly signal?: AbortSignal;
  readonly onDocument?: (pkg: DocumentPackage) => void;
  readonly fonts?: readonly ProvidedFont[];
  readonly onFontSubstitution?: (substitution: FontSubstitution) => void;
  readonly onSubstitution?: (substitution: WinAnsiSubstitution, context: { readonly pageIndex: number }) => void;
  readonly sink?: PdfDiagnosticSink;
  readonly onMathDiagnostic?: (diagnostic: OmmlDiagnostic, context: { readonly sourcePath?: string }) => void;
  readonly images?: MarkdownImageResolver;
  readonly clock?: ClockPort;
}

// --- Registry: declarative per-format primitive wiring -----------------------------------------

// The eight content formats this engine routes between (pdf is the layout pivot, reached via toPdf/fromPdf edges; odf is special, excluded entirely -- see the module doc).
export type ContentFormat = 'docx' | 'pptx' | 'xlsx' | 'odt' | 'odp' | 'ods' | 'odg' | 'markdown';

// The explicit, typed list of content formats, kept in sync with FORMAT_NODES' own keys. Used for iteration in the graph builder in place of `Object.keys(FORMAT_NODES)` (which returns `string[]` and would need a cast back to ContentFormat), so the registry stays cast-free end to end.
const CONTENT_FORMATS: readonly ContentFormat[] = ['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'odg', 'markdown'];

// The four ContentDocument variants a layout engine exists for. 'formula' is the fifth ContentVariant member but has no layout engine of its own (odfToPdf renders through writePdf's formula positioning, not a ContentDocument -> LayoutDocument pass), so it is excluded from this engine's layout/reconstruct registries.
type LayoutVariant = Exclude<ContentVariant, 'formula'>;

// Every content format's node in the composition graph: the decode -> read -> build -> encode primitive chain, plus the ContentDocument variant every format reads into and builds from. A discriminated union on `family` keeps the package (SourcePackage) and markdown (string) halves' decode/read/build/encode signatures concrete and cast-free: the executors narrow on `family === 'markdown'` to select the right shape. hasSourcePackage drives the font-registry choice in executeToPdf (createDocumentFontRegistry for a package, createFontRegistry for markdown text), mirroring markdownToPdf's own documented divergence from docxToPdf.
interface PackageFormatNode {
  readonly variant: LayoutVariant;
  readonly family: 'ooxml' | 'odf';
  readonly decode: (bytes: Uint8Array<ArrayBuffer>) => SourcePackage;
  readonly read: (pkg: SourcePackage, options?: UnifiedConversionOptions) => ContentDocument;
  readonly build: (content: ContentDocument, options?: UnifiedConversionOptions) => SourcePackage;
  readonly encode: (pkg: SourcePackage) => Uint8Array<ArrayBuffer>;
  readonly hasSourcePackage: true;
}

interface MarkdownFormatNode {
  readonly variant: LayoutVariant;
  readonly family: 'markdown';
  readonly decode: (bytes: Uint8Array<ArrayBuffer>) => string;
  readonly read: (text: string, options?: UnifiedConversionOptions) => ContentDocument;
  readonly build: (content: ContentDocument) => string;
  readonly encode: (text: string) => Uint8Array<ArrayBuffer>;
  readonly hasSourcePackage: false;
}

export type FormatNode = PackageFormatNode | MarkdownFormatNode;

// The single source of truth for "which primitives does each format use". read/build closures thread their own per-format option subset internally: docx and pptx read/build both pull onMathDiagnostic (mirroring readDocxContent's/readPptxContent's own `{ onMathDiagnostic }` and buildDocxPackage's/buildPptxPackage's own option -- ExaDev/documents.js#563 gave pptx the identical OMML degrade-diagnostic channel docx already had), markdown read pulls signal/images (mirroring readMarkdownContent's ReadMarkdownOptions), and every other format's read/build accept and ignore the thread. docxToPdf's openDocx(bytes).toPackage() and decodeOoxmlPackage(bytes) produce the identical Package (openDocx wraps decodeOoxmlPackage and toPackage returns it unmutated), so decode uses the package codec directly for uniformity -- byte-identical to docxToPdf at every downstream call site.
export const FORMAT_NODES: Readonly<Record<ContentFormat, FormatNode>> = {
  docx: {
    variant: 'wordprocessing',
    family: 'ooxml',
    decode: (bytes) => decodeOoxmlPackage(bytes),
    read: (pkg, options) => readDocxContent(pkg, { onMathDiagnostic: options?.onMathDiagnostic }),
    build: (content, options) => buildDocxPackage(content, { onMathDiagnostic: options?.onMathDiagnostic }),
    encode: (pkg) => encodeOoxmlPackage(pkg),
    hasSourcePackage: true,
  },
  pptx: {
    variant: 'presentation',
    family: 'ooxml',
    decode: (bytes) => decodeOoxmlPackage(bytes),
    read: (pkg, options) => readPptxContent(pkg, { onMathDiagnostic: options?.onMathDiagnostic }),
    build: (content, options) => buildPptxPackage(content, { onMathDiagnostic: options?.onMathDiagnostic }),
    encode: (pkg) => encodeOoxmlPackage(pkg),
    hasSourcePackage: true,
  },
  xlsx: {
    variant: 'spreadsheet',
    family: 'ooxml',
    decode: (bytes) => decodeOoxmlPackage(bytes),
    read: (pkg) => readXlsxContent(pkg),
    build: (content) => buildXlsxPackage(content),
    encode: (pkg) => encodeOoxmlPackage(pkg),
    hasSourcePackage: true,
  },
  odt: {
    variant: 'wordprocessing',
    family: 'odf',
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdtContent(pkg),
    build: (content) => buildOdtPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    hasSourcePackage: true,
  },
  odp: {
    variant: 'presentation',
    family: 'odf',
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdpContent(pkg),
    build: (content) => buildOdpPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    hasSourcePackage: true,
  },
  ods: {
    variant: 'spreadsheet',
    family: 'odf',
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdsContent(pkg),
    build: (content) => buildOdsPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    hasSourcePackage: true,
  },
  odg: {
    variant: 'drawing',
    family: 'odf',
    decode: (bytes) => decodeOdfPackage(bytes),
    read: (pkg) => readOdgContent(pkg),
    build: (content) => buildOdgPackage(content),
    encode: (pkg) => encodeOdfPackage(pkg),
    hasSourcePackage: true,
  },
  markdown: {
    variant: 'wordprocessing',
    family: 'markdown',
    decode: (bytes) => decodeMarkdownText(bytes),
    read: (text, options) => readMarkdownContent(text, { signal: options?.signal, images: options?.images }),
    build: (content) => buildMarkdownText(content),
    encode: (text) => encodeMarkdownText(text),
    hasSourcePackage: false,
  },
};

// The formats that have a direct layout-engine path to/from PDF (convertXToLayout + writePdf). xlsx is deliberately absent: it has no layout engine of its own, so the pathfinder routes xlsx <-> pdf through ods instead (xlsx -> ods bridge, then ods -> pdf toPdf), reproducing the composed route xlsxToPdf/pdfToXlsx already hard-code in convert.ts.
const LAYOUT_CAPABLE: ReadonlySet<ContentFormat> = new Set<ContentFormat>(['docx', 'pptx', 'odt', 'odp', 'ods', 'odg', 'markdown']);

// Cross-variant transforms keyed by `${fromVariant}->${toVariant}`. Each wrapper narrows its input with a runtime kind guard so the underlying transform receives its exact concrete variant type -- the same "no cast, narrow at the boundary" discipline every read/build closure above follows. Today wordprocessing <-> presentation and drawing <-> presentation transforms exist (src/convert/variant-bridges.ts); the pathfinder derives its cross-variant edges from this object's keys, so adding a transform here is the single change needed to teach both the pathfinder and the bridge executor a new variant crossing.
const TRANSFORMS: Readonly<Record<string, (doc: ContentDocument) => ContentDocument>> = {
  'wordprocessing->presentation': (doc) => {
    if (doc.kind !== 'wordprocessing') {
      throw new Error('wordprocessingToPresentation: expected a wordprocessing ContentDocument');
    }
    return wordprocessingToPresentation(doc);
  },
  'presentation->wordprocessing': (doc) => {
    if (doc.kind !== 'presentation') {
      throw new Error('presentationToWordprocessing: expected a presentation ContentDocument');
    }
    return presentationToWordprocessing(doc);
  },
  'drawing->presentation': (doc) => {
    if (doc.kind !== 'drawing') {
      throw new Error('drawingToPresentation: expected a drawing ContentDocument');
    }
    return drawingToPresentation(doc);
  },
  'presentation->drawing': (doc) => {
    if (doc.kind !== 'presentation') {
      throw new Error('presentationToDrawing: expected a presentation ContentDocument');
    }
    return presentationToDrawing(doc);
  },
};

// Layout engines and reconstructors keyed by variant -- declarative registries the executors dispatch through. Each maps a LayoutVariant to the concrete function the corresponding convert.ts path already calls: convertWordprocessingToLayout for the flow/pagination engine docx/odt/markdown feed, convertPresentationToLayout for the direct-placement engine pptx/odp feed, convertSpreadsheetToLayout for ods/xlsx's own column/row-band pagination, convertDrawingToLayout for odg's vector-primitive vocabulary, and the four reconstruct* counterparts for the PDF -> X reverse direction.
const LAYOUT_ENGINES = {
  wordprocessing: convertWordprocessingToLayout,
  presentation: convertPresentationToLayout,
  spreadsheet: convertSpreadsheetToLayout,
  drawing: convertDrawingToLayout,
} as const;

const RECONSTRUCTORS: Readonly<Record<LayoutVariant, (doc: LayoutDocument, options?: ReconstructOptions) => ContentDocument>> = {
  wordprocessing: reconstructWordprocessing,
  presentation: reconstructPresentation,
  drawing: reconstructDrawing,
  spreadsheet: reconstructSpreadsheet,
};

// --- Executors: real functions, parameterised by the registry ----------------------------------

// decode(source) -> read(source) -> [optional cross-variant transform] -> build(target) -> encode(target), reproducing the exact sequence and option-threading of convert.ts's bridge functions (odtToDocx/docxToOdt/markdownToDocx/docxToPptx). onMathDiagnostic reaches the docx reader and builder only (via the registry closures); images reach the markdown reader only; throwIfAborted frames the read and build stages exactly as the hand-written bridges do. The pathfinder only proposes a bridge hop when source and target either share a variant (same-variant direct copy) or have a TRANSFORMS entry between their variants (cross-variant semantic transform), so a missing transform here is a pathfinder bug, not a runtime hazard.
function executeBridge(source: ContentFormat, target: ContentFormat, bytes: Uint8Array<ArrayBuffer>, options?: UnifiedConversionOptions): Uint8Array<ArrayBuffer> {
  throwIfAborted(options?.signal);
  const sourceNode = FORMAT_NODES[source];
  const targetNode = FORMAT_NODES[target];

  // Decode + read the source, branching on family so the package (SourcePackage) and markdown (string) decoded shapes stay concrete.
  let content: ContentDocument;
  if (sourceNode.family === 'markdown') {
    const text = sourceNode.decode(bytes);
    content = sourceNode.read(text, options);
  } else {
    const pkg = sourceNode.decode(bytes);
    content = sourceNode.read(pkg, options);
  }
  if (content.kind !== sourceNode.variant) {
    throw new Error(`executeBridge: ${source} read returned a non-${sourceNode.variant} ContentDocument`);
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
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content: buildContent });

  // Build + encode the target. A bridge never runs a layout engine, so the reported DocumentPackage carries content only, with no pages array and no node frames -- the identical layoutless shape convert.ts's own bridges report.
  if (targetNode.family === 'markdown') {
    const text = targetNode.build(buildContent);
    return targetNode.encode(text);
  }
  const pkg = targetNode.build(buildContent, options);
  return targetNode.encode(pkg);
}

// decode(source) -> [extract source fonts] -> build font registry -> read(source) -> resolve metadata -> layout engine by variant -> writePdf, reproducing the exact sequence and option-threading of convert.ts's *ToPdf functions (docxToPdf/odtToPdf/odpToPdf/odsToPdf/odgToPdf/markdownToPdf). The font registry is built from the source package's own embedded faces for package formats (createDocumentFontRegistry) and from caller-supplied faces alone for markdown (createFontRegistry), matching markdownToPdf's own documented divergence. The drawing engine takes no mathMetricsAt and produces no positioned formulas, so writePdf is called without `formulas` for that variant -- byte-identical to odgToPdf. markdownToPdf's leading throwIfAborted (decodeMarkdownText has no abort hook of its own) is reproduced; the package paths match docxToPdf/odtToPdf by not checking abort until writePdf's own loops do.
function executeToPdf(format: ContentFormat, bytes: Uint8Array<ArrayBuffer>, options?: UnifiedConversionOptions): Uint8Array<ArrayBuffer> {
  if (!LAYOUT_CAPABLE.has(format)) {
    throw new Error(`executeToPdf: '${format}' has no layout engine of its own`);
  }
  const node = FORMAT_NODES[format];

  let content: ContentDocument;
  let fonts: FontRegistry;
  if (node.family === 'markdown') {
    throwIfAborted(options?.signal);
    const text = node.decode(bytes);
    const read = node.read(text, options);
    content = { ...read, metadata: resolveMetadataTimestamps(read.metadata, options?.clock) };
    fonts = createFontRegistry({ fonts: options?.fonts, onSubstitution: options?.onFontSubstitution });
  } else {
    const pkg = node.decode(bytes);
    const read = node.read(pkg, options);
    content = { ...read, metadata: resolveMetadataTimestamps(read.metadata, options?.clock) };
    const fontSource: FontSourcePackage = node.family === 'odf' ? { kind: 'odf', package: pkg } : format === 'pptx' ? { kind: 'pptx', package: pkg } : { kind: 'docx', package: pkg };
    fonts = createDocumentFontRegistry(fontSource, { fonts: options?.fonts, onFontSubstitution: options?.onFontSubstitution });
  }
  const measurer = createFontMeasurer(fonts);

  // Layout by variant. Every engine returns { document, pages } plus (for the three that render embedded formulas) positioned MathML; the drawing engine takes no mathMetricsAt and produces no positioned formulas, so writePdf omits `formulas` for it -- the exact odgToPdf divergence. Each engine also stamps the placements it computed onto `content`'s own nodes in place (frames), so the content reported below is the fused unified package half, not the bare read output.
  let layout: LayoutDocument;
  let pages: readonly PageSize[];
  let formulas: readonly PositionedFormula[] | undefined;
  switch (content.kind) {
    case 'wordprocessing': {
      const result = LAYOUT_ENGINES.wordprocessing(content, { measurer, mathMetricsAt });
      layout = result.document;
      pages = result.pages;
      formulas = result.formulas;
      break;
    }
    case 'presentation': {
      const result = LAYOUT_ENGINES.presentation(content, { measurer, mathMetricsAt });
      layout = result.document;
      pages = result.pages;
      formulas = result.formulas;
      break;
    }
    case 'spreadsheet': {
      const result = LAYOUT_ENGINES.spreadsheet(content, { measurer, mathMetricsAt, signal: options?.signal });
      layout = result.document;
      pages = result.pages;
      formulas = result.formulas;
      break;
    }
    case 'drawing': {
      const result = LAYOUT_ENGINES.drawing(content, { measurer });
      layout = result.document;
      pages = result.pages;
      break;
    }
    default: {
      throw new Error(`executeToPdf: cannot lay out a '${content.kind}' document`);
    }
  }

  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, pages: [...pages] });

  if (formulas === undefined) {
    return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution, fonts });
  }
  return writePdf(layout, { signal: options?.signal, onSubstitution: options?.onSubstitution, formulas, fonts });
}

// readPdf -> reconstruct(target variant) -> build(target) -> encode(target), reproducing the exact sequence and option-threading of convert.ts's pdfTo* functions (pdfToDocx/pdfToOdt/pdfToOdp/pdfToOds/pdfToOdg/pdfToMarkdown). sink reaches readPdf; signal reaches both readPdf and the reconstructor. The reconstructor's onCellTypeInference (reconstructSpreadsheet's audit channel) is deliberately left unset -- UnifiedConversionOptions does not carry it today, matching every pdfToOds caller in convert.ts. build is called with no options, matching pdfTo*'s own `buildXPackage(content)` calls (no clock, no onMathDiagnostic threaded on this direction).
function executeFromPdf(target: ContentFormat, bytes: Uint8Array<ArrayBuffer>, options?: UnifiedConversionOptions): Uint8Array<ArrayBuffer> {
  const node = FORMAT_NODES[target];
  const layout = readPdf(bytes, { signal: options?.signal, sink: options?.sink });
  const content = RECONSTRUCTORS[node.variant](layout, { signal: options?.signal });
  // The pages half derives from the read LayoutDocument's own pages -- every rendered page's size, indexed to match the frames the reconstructor attached to the content it built.
  const pages = layout.pages.map((page) => ({ widthPt: page.widthPt, heightPt: page.heightPt }));
  options?.onDocument?.({ formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, pages });

  if (node.family === 'markdown') {
    const text = node.build(content);
    return node.encode(text);
  }
  const pkg = node.build(content);
  return node.encode(pkg);
}

// --- Pathfinder: minimum-cost route over the composition graph ---------------------------------

export type HopExecutor = 'bridge' | 'toPdf' | 'fromPdf';

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

// Builds the composition graph's adjacency list from the registry, with fidelity-ordered edge costs: a same-variant bridge (cost 1, lossless) always beats a cross-variant transform (cost 2, approximate), which always beats a toPdf/fromPdf edge (cost 3, geometry-based render or reconstruction). Edges are bidirectional with symmetric costs. The toPdf/fromPdf edges cover exactly LAYOUT_CAPABLE (xlsx absent -- it routes through ods), and cross-variant transform edges are derived from TRANSFORMS' own keys so the graph cannot drift from the registered transforms.
function buildCompositionGraph(): ReadonlyMap<DocumentFormat, readonly GraphEdge[]> {
  const adj = new Map<DocumentFormat, GraphEdge[]>();
  const addDirected = (from: DocumentFormat, to: DocumentFormat, cost: number): void => {
    const list = adj.get(from);
    if (list === undefined) {
      adj.set(from, [{ to, cost }]);
    } else {
      list.push({ to, cost });
    }
  };
  const addEdge = (from: DocumentFormat, to: DocumentFormat, cost: number): void => {
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
    const parts = key.split('->');
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

  // toPdf/fromPdf edges (cost 3) for every layout-capable format. xlsx is absent, so it reaches pdf only through its ods bridge.
  for (const format of CONTENT_FORMATS) {
    if (LAYOUT_CAPABLE.has(format)) {
      addEdge(format, 'pdf', 3);
    }
  }

  return adj;
}

const COMPOSITION_GRAPH: ReadonlyMap<DocumentFormat, readonly GraphEdge[]> = buildCompositionGraph();

// Standard Dijkstra over the small (<= 9-node) composition graph. Returns the ordered node path from source to target, or undefined if source === target or target is unreachable.
function shortestPath(source: DocumentFormat, target: DocumentFormat): readonly DocumentFormat[] | undefined {
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
export function resolveCompositionPlan(source: DocumentFormat, target: DocumentFormat): ConversionPlan | undefined {
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
    const executor: HopExecutor = to === 'pdf' ? 'toPdf' : from === 'pdf' ? 'fromPdf' : 'bridge';
    hops.push({ executor, from, to });
  }
  return { hops };
}

// Narrows a DocumentFormat to the ContentFormat union (the eight formats with a FORMAT_NODES entry). pdf and odf are excluded: pdf is the layout pivot reached only via toPdf/fromPdf edges, and odf is the special-case format this engine does not route at all. Used by convertDocument to narrow a hop's DocumentFormat endpoints to the ContentFormat the executors are typed against.
function isContentFormat(format: DocumentFormat): format is ContentFormat {
  return format !== 'pdf' && format !== 'odf';
}

// The entry point: resolves a path between source and target and executes each hop in order, feeding the previous hop's output bytes into the next hop's input. Options thread to whichever hop consumes each field (fonts/onFontSubstitution/onSubstitution/clock reach the toPdf hop; sink reaches the fromPdf hop; onMathDiagnostic/images reach bridge hops; signal reaches every hop), and onDocument fires exactly once -- on the LAST hop, so the caller receives the package that actually produced the output bytes (content+layout for a toPdf/fromPdf final hop, content-only for a bridge final hop) -- mirroring the convention the original hand-written composed functions already followed (each forwarded onDocument to its own last hop). Throws UnsupportedConversionError (from capability.ts) for any pair the pathfinder cannot route.
export function convertDocument(source: DocumentFormat, target: DocumentFormat, bytes: Uint8Array<ArrayBuffer>, options?: UnifiedConversionOptions): Uint8Array<ArrayBuffer> {
  const plan = resolveCompositionPlan(source, target);
  if (plan === undefined) {
    throw new UnsupportedConversionError(source, target);
  }
  let current = bytes;
  for (let i = 0; i < plan.hops.length; i++) {
    const hop = plan.hops[i];
    if (hop === undefined) {
      throw new Error('convertDocument: resolveCompositionPlan returned a malformed hop');
    }
    // onDocument fires on the last hop only: null out onDocument for every hop before the last, then pass the caller's options through unchanged on the final hop so the callback receives the package that actually produced the output bytes. This mirrors the convention the original hand-written composed functions (xlsxToPdf/pdfToXlsx/xlsxToMarkdown/markdownToXlsx) already followed -- each forwarded onDocument to its own last hop, never the first -- so a caller of xlsxToPdf still receives the odsToPdf hop's content+layout package rather than the intermediate xlsx->ods bridge's content-only one.
    const isLastHop = i === plan.hops.length - 1;
    const hopOptions: UnifiedConversionOptions | undefined = isLastHop ? options : options === undefined ? undefined : { ...options, onDocument: undefined };
    if (hop.executor === 'toPdf') {
      if (!isContentFormat(hop.from)) {
        throw new Error(`convertDocument: toPdf source '${hop.from}' is not a content format`);
      }
      current = executeToPdf(hop.from, current, hopOptions);
    } else if (hop.executor === 'fromPdf') {
      if (!isContentFormat(hop.to)) {
        throw new Error(`convertDocument: fromPdf target '${hop.to}' is not a content format`);
      }
      current = executeFromPdf(hop.to, current, hopOptions);
    } else {
      if (!isContentFormat(hop.from) || !isContentFormat(hop.to)) {
        throw new Error(`convertDocument: bridge endpoints '${hop.from}' -> '${hop.to}' are not both content formats`);
      }
      current = executeBridge(hop.from, hop.to, current, hopOptions);
    }
  }
  return current;
}
