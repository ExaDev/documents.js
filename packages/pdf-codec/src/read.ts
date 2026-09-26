import { concatBytes } from "./bytes/writer";
import { readPageAnnotations } from "./annotations";
import {
  convertExtractedItem,
  readLinkAnnotations,
  readPageNotes,
} from "./read-convert";
import { readAcroForm } from "./form";
import { readXmpMetadata } from "./xmp";
import { readAttachments } from "./attachments";
import { readOptionalContent } from "./optional-content";
import { readStructure } from "./structure";
import type { LayoutMetadata, SourceResidue } from "document-schema.js";
import type {
  LayoutDocument,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
} from "./layout";
import { LAYOUT_FORMAT_VERSION } from "./layout";
import { openPdfDocument } from "./document";
import type { PdfDocument } from "./document";
import type { PdfDiagnosticSink } from "./diagnostics";
import { NOOP_DIAGNOSTIC_SINK, PdfParseError } from "./diagnostics";
import { decodeStream } from "./filters";
import { throwIfAborted } from "./util/abort";
import type { FontResolverService } from "./font-read";
import { createFontResolver } from "./font-read";
import type { PdfObjectResolver } from "./interpret";
import { interpretContentStream } from "./interpret";
import type { Matrix } from "./matrix";
import {
  applyMatrix,
  multiplyMatrices,
  rotatePointAboutCenter,
  translationMatrix,
} from "./matrix";
import type { DestinationRegistry } from "./navigation";
import { createDestinationRegistry, readOutline } from "./navigation";
import type { PdfDict, PdfObject } from "./objects";
import {
  asArray,
  asNumber,
  dictGet,
  pdfArray,
  pdfDict,
  pdfNull,
  pdfNum,
} from "./objects";
import { serializeObjectToText } from "./serialize";
import { decodePdfString, parsePdfDate } from "./pdf-text";

// readPdf(bytes, options?) -> LayoutDocument: the top of the read pipeline, assembling every other src/pdf/* read module (document.ts's object store and page tree, interpret.ts's graphics/text extraction, font-read.ts's width/decode, images-read.ts's PNG/JPEG recovery) into the same pivot model src/pdf/write.ts consumes on the way out, so a document round-trips through readPdf -> writePdf structurally even though neither claims byte- or content-fidelity.
//
// This module is also the package's read-only entry point: package.json's explicit `./read` export maps here, so a consumer that only reads PDFs imports 'pdf-codec/read' and gets a module graph that provably excludes the write path and the vendored font assets (src/read-graph.test.ts walks this file's static imports and fails if write.ts, math-font.ts, font-registry.ts, or an asset module becomes reachable — on runtimes with a bundle budget, e.g. Cloudflare Workers' 3 MB gzipped free-plan cap, that exclusion is the difference between adoptable and not). It is deliberately a real owning module rather than a curated re-export barrel: the family's barrel policy keeps re-exports in src/index.ts alone, and the wildcard `./*` export already deep-serves every read-adjacent module the surface here does not itself own — diagnostics (pdf-codec/diagnostics), the Layout family (pdf-codec/layout), standard-14 resolution and AFM metrics (pdf-codec/fonts, pdf-codec/afm-widths), and the text-run grouping every reader needs to turn this module's output back into lines and words (pdf-codec/text-group), all of which carry no asset imports either. Nothing in this file may import the write half; the one symbol the two pipelines genuinely share (NOTES_ANNOTATION_AUTHOR) lives in its own leaf module for exactly that reason.

export interface ReadPdfOptions {
  readonly sink?: PdfDiagnosticSink;
  readonly signal?: AbortSignal;
}

const PDF_HEADER_BYTES = new TextEncoder().encode("%PDF-");
// Real producers occasionally prepend a small amount of junk (a UTF-8 BOM, blank lines) before the header — ISO 32000-1 7.5.2 itself permits leading bytes before "%PDF-", so this scans a window rather than requiring it at offset 0.
const HEADER_SEARCH_WINDOW = 1024;
// US Letter (ISO 32000-1's own example default, and the overwhelming common fallback in practice): used only when a page has no /MediaBox at all, even after page-tree inheritance — a genuinely malformed file.
const DEFAULT_PAGE_WIDTH_PT = 612;
const DEFAULT_PAGE_HEIGHT_PT = 792;

function hasPdfHeader(bytes: Uint8Array<ArrayBuffer>): boolean {
  const window = bytes.subarray(
    0,
    Math.min(HEADER_SEARCH_WINDOW, bytes.length),
  );
  outer: for (let i = 0; i <= window.length - PDF_HEADER_BYTES.length; i++) {
    for (let j = 0; j < PDF_HEADER_BYTES.length; j++) {
      if (window[i + j] !== PDF_HEADER_BYTES[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

export function readPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options?: ReadPdfOptions,
): LayoutDocument {
  const sink = options?.sink ?? NOOP_DIAGNOSTIC_SINK;
  const signal = options?.signal;
  if (!hasPdfHeader(bytes)) {
    throw new PdfParseError(
      "pdf/no-header",
      'no "%PDF-" header found within the first bytes of the file; this does not look like a PDF at all',
    );
  }
  // Checked before openPdfDocument rather than relying solely on the page loop's per-iteration check below: the document-open phase (xref resolution, object parsing) runs before any page, and a document with an empty page tree never enters the loop at all — without this check, an already-aborted signal on such a file would return a parsed document instead of throwing.
  throwIfAborted(signal);
  const doc = openPdfDocument(bytes, sink);
  const fontResolver = createFontResolver({ resolver: doc, sink });
  const images: Record<string, LayoutImageAsset> = {};
  const imageIdCache = new Map<PdfDict, string | null>();

  // The page tree is walked first (materialising the page-index map a destination's page reference resolves against), then the navigation surfaces: page interpretation interns direct destination arrays into the registry as it meets them, so links on page N can name a destination minted by nothing but themselves.
  const pageDicts = doc.pages();
  const destinationRegistry = createDestinationRegistry(
    doc.catalog,
    doc,
    (obj) => doc.pageIndex(obj),
    sink,
  );
  const outline = readOutline(doc.catalog, destinationRegistry, doc, sink);
  const attachments = readAttachments(doc.catalog, pageDicts, doc, sink);
  const optionalContent = readOptionalContent(doc.catalog, doc, sink);
  const form = readAcroForm(
    doc.catalog,
    doc,
    (obj) => doc.pageIndex(obj),
    sink,
  );
  const structure = readStructure(doc.catalog, pageDicts, doc, sink);
  const source = readDocumentResidue(doc, sink);
  const pageBoxRows: PdfObject[] = [];

  const pages = pageDicts.map((pageDict, index) => {
    throwIfAborted(signal);
    const read = readPage(
      index,
      pageDict,
      doc,
      fontResolver,
      images,
      imageIdCache,
      destinationRegistry,
      optionalContent.layerNameOf,
      structure.ownerOf,
      sink,
    );
    if (read.boxRow !== undefined) {
      pageBoxRows.push(read.boxRow);
    }
    return read.page;
  });

  // The per-page boundary declarations a distinct crop box or a print-production box left behind, quarantined with the other package-level residue rows.
  if (pageBoxRows.length > 0) {
    source["page-boxes"] = {
      format: "pdf",
      xml: serializeObjectToText(pdfArray(pageBoxRows)),
    };
  }

  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: readMetadata(doc.trailer, doc, doc.catalog, sink),
    pages,
    images,
    ...(destinationRegistry.entries.length > 0
      ? { destinations: [...destinationRegistry.entries] }
      : {}),
    ...(outline.length > 0 ? { outline } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(optionalContent.layers.length > 0
      ? { layers: [...optionalContent.layers] }
      : {}),
    ...(form.length > 0 ? { form } : {}),
    ...(structure.tree.length > 0 ? { structure: [...structure.tree] } : {}),
    ...(Object.keys(source).length > 0 ? { source } : {}),
  };
}

// --- Page geometry: MediaBox origin shift + /Rotate, composed into one matrix applied to every extracted item on the page. ---

interface PageBoxRect {
  readonly llx: number;
  readonly lly: number;
  readonly urx: number;
  readonly ury: number;
}

// One of the five page-boundary rectangles (ISO 32000-1 14.11.2), normalised to lower-left/upper-right corners — a producer may write either corner order. Undefined when the page does not declare the entry; only /MediaBox has a fallback (the malformed-file letter default below).
function readDeclaredPageBox(
  page: PdfDict,
  key: string,
): PageBoxRect | undefined {
  const arr = asArray(dictGet(page, key));
  if (arr === undefined) {
    return undefined;
  }
  const a = asNumber(arr[0]) ?? 0;
  const b = asNumber(arr[1]) ?? 0;
  const c = asNumber(arr[2]) ?? 0;
  const d = asNumber(arr[3]) ?? 0;
  return {
    llx: Math.min(a, c),
    lly: Math.min(b, d),
    urx: Math.max(a, c),
    ury: Math.max(b, d),
  };
}

function readMediaBox(page: PdfDict): PageBoxRect {
  return (
    readDeclaredPageBox(page, "MediaBox") ?? {
      llx: 0,
      lly: 0,
      urx: DEFAULT_PAGE_WIDTH_PT,
      ury: DEFAULT_PAGE_HEIGHT_PT,
    }
  );
}

// The axis-aligned bounds of a page rectangle after a rotation transform — all four corners transformed, then min/max, because a rotation that is not about the box's own corner does not preserve which corner is lower-left (and /Rotate's matrix is built for the media box's frame, not the crop box's).
interface RotatedRectBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function rotatedRectBounds(
  rect: PageBoxRect,
  matrix: Matrix,
): RotatedRectBounds {
  const corners: readonly (readonly [number, number])[] = [
    [rect.llx, rect.lly],
    [rect.urx, rect.lly],
    [rect.llx, rect.ury],
    [rect.urx, rect.ury],
  ];
  const transformed = corners.map(([x, y]) => applyMatrix(matrix, { x, y }));
  const xs = transformed.map((point) => point.x);
  const ys = transformed.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

type PageRotation = 0 | 90 | 180 | 270;
type NonZeroPageRotation = 90 | 180 | 270;

// The three non-zero values ISO 32000-1 7.7.3.3's /Rotate can normalize to.
const QUARTER_TURN_DEG = 90;
const HALF_TURN_DEG = 180;
const THREE_QUARTER_TURN_DEG = 270;
const DEGREES_PER_TURN = 360;

// A user-defined type guard, rather than a plain boolean check, because `PageRotation` needs `normalized` narrowed to `NonZeroPageRotation` below: comparing against QUARTER_TURN_DEG/HALF_TURN_DEG/THREE_QUARTER_TURN_DEG (typed as plain `number`, since that is what a bare `const` initializer widens to) would not narrow the way comparing against inline literals does, and this predicate's own declared return type supplies that narrowing instead.
function isNonZeroPageRotation(n: number): n is NonZeroPageRotation {
  return (
    n === QUARTER_TURN_DEG ||
    n === HALF_TURN_DEG ||
    n === THREE_QUARTER_TURN_DEG
  );
}

export function normalizeRotation(rotate: number | undefined): PageRotation {
  if (rotate === undefined) {
    return 0;
  }
  const normalized =
    (((Math.round(rotate / QUARTER_TURN_DEG) * QUARTER_TURN_DEG) %
      DEGREES_PER_TURN) +
      DEGREES_PER_TURN) %
    DEGREES_PER_TURN;
  return isNonZeroPageRotation(normalized) ? normalized : 0;
}

interface PageRotationResult {
  readonly matrix: Matrix;
  readonly widthPt: number;
  readonly heightPt: number;
}

// Each case derived and verified independently by tracking where all four MediaBox corners land after physically rotating the rendered page clockwise by the given angle (ISO 32000-1 7.7.3.3's own definition of /Rotate) — e.g. for 90, the original bottom-left corner (0,0) becomes the new page's top-left corner (0, w), and solving the resulting four-corner system gives (x,y) -> (y, w-x).
export function pageRotationTransform(
  rotation: PageRotation,
  w: number,
  h: number,
): PageRotationResult {
  if (rotation === QUARTER_TURN_DEG) {
    return { matrix: [0, -1, 1, 0, 0, w], widthPt: h, heightPt: w };
  }
  if (rotation === HALF_TURN_DEG) {
    return { matrix: [-1, 0, 0, -1, w, h], widthPt: w, heightPt: h };
  }
  if (rotation === THREE_QUARTER_TURN_DEG) {
    return { matrix: [0, 1, -1, 0, h, 0], widthPt: h, heightPt: w };
  }
  return { matrix: [1, 0, 0, 1, 0, 0], widthPt: w, heightPt: h };
}

// --- Page content: /Contents (single stream or array), interpretation, and per-item conversion into LayoutItem. ---

// ISO 32000-1 7.8.2: when /Contents is an array, readers must treat the concatenation of the referenced streams as if they were one stream, "as though they were preceded and followed by white-space characters". Inserted here as a defensive LINE FEED, so a token straddling the end of one chunk and the start of the next can never merge into one, even when a producer omitted trailing whitespace of its own.
const CONTENT_STREAM_JOIN_BYTE = 0x0a;

function readPageContentBytes(
  page: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
): Uint8Array<ArrayBuffer> {
  const contentsObj = resolver.resolve(dictGet(page, "Contents"));
  if (contentsObj?.kind === "stream") {
    return decodeStream(contentsObj.raw, contentsObj.dict, sink).bytes;
  }
  if (contentsObj?.kind === "array") {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    for (const item of contentsObj.items) {
      const streamObj = resolver.resolve(item);
      if (streamObj?.kind === "stream") {
        chunks.push(
          decodeStream(streamObj.raw, streamObj.dict, sink).bytes,
          new Uint8Array([CONTENT_STREAM_JOIN_BYTE]),
        );
      }
    }
    return concatBytes(chunks);
  }
  return new Uint8Array(0);
}

// A content item's axis-aligned bounds in output page space — the crop-visibility filter's input. Link and internalLink kinds report undefined: an annotation is an anchored construct, not painted stream content, so the visibility filter must not claim it (the same line the optional-content filter draws, treating annotation kinds as not layer-governed content).
function contentItemBounds(item: LayoutItem): RotatedRectBounds | undefined {
  if (item.kind === "link" || item.kind === "internalLink") {
    return undefined;
  }
  const frameBounds = (
    xPt: number,
    yPt: number,
    widthPt: number,
    heightPt: number,
  ): RotatedRectBounds => ({
    minX: xPt,
    minY: yPt,
    maxX: xPt + widthPt,
    maxY: yPt + heightPt,
  });
  if (
    item.kind === "text" ||
    item.kind === "image" ||
    item.kind === "rect" ||
    item.kind === "ellipse"
  ) {
    if (
      item.kind !== "text" ||
      item.rotationDeg === undefined ||
      item.rotationDeg % HALF_TURN_DEG === 0
    ) {
      // widthPt is optional on text (reported, not measured, on some paths) — a missing width still bounds the run to its anchor plus size, never an unbounded extent.
      return frameBounds(
        item.xPt,
        item.yPt,
        item.widthPt ?? 0,
        item.kind === "text" ? item.sizePt : item.heightPt,
      );
    }
    // An obliquely rotated run's frame no longer bounds it: rotate the (width x size) frame's corners about the run's own anchor, which the conversion places invariantly, and take the hull. Generous by construction (the glyph ink stays within the em box), which errs toward keeping an edge-straddling run — the right direction for a visibility filter.
    const rotationDeg = item.rotationDeg;
    const anchorX = item.xPt;
    const anchorY = item.yPt;
    const corners: readonly (readonly [number, number])[] = [
      [0, 0],
      [item.widthPt ?? 0, 0],
      [0, item.sizePt],
      [item.widthPt ?? 0, item.sizePt],
    ];
    const rotated = corners.map(([dx, dy]) =>
      rotatePointAboutCenter(
        { x: anchorX + dx, y: anchorY + dy },
        { x: anchorX, y: anchorY },
        rotationDeg,
      ),
    );
    const xs = rotated.map((point) => point.x);
    const ys = rotated.map((point) => point.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }
  if (item.kind === "line") {
    return {
      minX: Math.min(item.x1Pt, item.x2Pt),
      minY: Math.min(item.y1Pt, item.y2Pt),
      maxX: Math.max(item.x1Pt, item.x2Pt),
      maxY: Math.max(item.y1Pt, item.y2Pt),
    };
  }
  // A path's bounds cover every subpath's start point, every segment endpoint, and every cubic control point — a Bezier can extend beyond its endpoint hull, and a visibility filter errs towards keeping, never towards inventing a tighter box the geometry does not state.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const subpath of item.subpaths) {
    include(subpath.startXPt, subpath.startYPt);
    for (const segment of subpath.segments) {
      include(segment.xPt, segment.yPt);
      if (segment.kind === "cubic") {
        include(segment.c1xPt, segment.c1yPt);
        include(segment.c2xPt, segment.c2yPt);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

// Whether an item's bounds touch the visible page rectangle at all — touching the boundary counts as visible (a hairline rule exactly on the crop edge shows); only an item whose whole extent lies strictly beyond the edge is not visible.
function itemIntersectsVisibleRegion(
  item: LayoutItem,
  widthPt: number,
  heightPt: number,
): boolean {
  if (item.kind === "link" || item.kind === "internalLink") {
    return true;
  }
  const bounds = contentItemBounds(item);
  if (bounds === undefined) {
    return true;
  }
  return (
    bounds.maxX >= 0 &&
    bounds.minX <= widthPt &&
    bounds.maxY >= 0 &&
    bounds.minY <= heightPt
  );
}

// One page's contribution to the package-level page-boxes residue row: the declared boundary rectangles that carry a fact beyond the visible one. A page contributes when a declared /CropBox differs from the media box (the outer region and the crop's own absolute position are both left behind by reading the visible box alone) or when any of /BleedBox /TrimBox /ArtBox is declared (print-production facts with no field in the layout model). Values are the parsed source arrays, serialised verbatim, so a same-format restorer re-emits exactly what the producer wrote. Undefined when the page's declarations carry nothing beyond the visible box.
function pageBoxResidueEntry(
  pageIndex: number,
  page: PdfDict,
  mediaBox: PageBoxRect,
  cropBox: PageBoxRect,
): PdfObject | undefined {
  const declaredBoxes: readonly (readonly [string, PdfObject | undefined])[] = [
    ["MediaBox", dictGet(page, "MediaBox")],
    ["CropBox", dictGet(page, "CropBox")],
    ["BleedBox", dictGet(page, "BleedBox")],
    ["TrimBox", dictGet(page, "TrimBox")],
    ["ArtBox", dictGet(page, "ArtBox")],
  ];
  const cropDeclared = dictGet(page, "CropBox") !== undefined;
  const productionBoxDeclared = declaredBoxes
    .slice(2)
    .some(([, value]) => value !== undefined);
  const cropDiffersFromMedia =
    cropDeclared &&
    (cropBox.llx !== mediaBox.llx ||
      cropBox.lly !== mediaBox.lly ||
      cropBox.urx !== mediaBox.urx ||
      cropBox.ury !== mediaBox.ury);
  if (!cropDiffersFromMedia && !productionBoxDeclared) {
    return undefined;
  }
  const entries: Record<string, PdfObject> = { Page: pdfNum(pageIndex) };
  for (const [key, value] of declaredBoxes) {
    if (value !== undefined) {
      entries[key] = value;
    }
  }
  return pdfDict(entries);
}

// A page as read, plus the boundary-declaration residue row it left behind, if any. The row is handed back rather than appended to a shared list so the residue is assembled where it is reported.
interface ReadPage {
  readonly page: LayoutPage;
  readonly boxRow: PdfObject | undefined;
}

function readPage(
  pageIndex: number,
  page: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  fontResolver: FontResolverService,
  images: Record<string, LayoutImageAsset>,
  imageIdCache: Map<PdfDict, string | null>,
  destinationRegistry: DestinationRegistry,
  layerNameOf: (obj: PdfObject | undefined) => string | undefined,
  structureOwnerOf: (pageIndex: number, mcid: number) => string | undefined,
  sink: PdfDiagnosticSink,
): ReadPage {
  const resources = resolver.resolveDict(dictGet(page, "Resources"));
  const mediaBox = readMediaBox(page);
  // The crop box is the visible region (ISO 32000-1 14.11.2: a viewer displays and prints it, and it defaults to the media box), so it — not the media box — is the page geometry this package reports, and content outside it is not visible at all. Inherited through the page tree like /MediaBox (one of 7.7.3.4's four inheritable attributes); /BleedBox /TrimBox /ArtBox are ordinary page-direct entries and are quarantined as residue, never clipped to.
  let cropBox = readDeclaredPageBox(page, "CropBox") ?? mediaBox;
  if (cropBox.urx - cropBox.llx <= 0 || cropBox.ury - cropBox.lly <= 0) {
    sink({
      code: "pdf/invalid-crop-box",
      severity: "warning",
      pageIndex,
      message:
        "page /CropBox is degenerate (zero width or height); falling back to the /MediaBox as the visible region",
    });
    cropBox = mediaBox;
  }
  const rotation = normalizeRotation(asNumber(dictGet(page, "Rotate")));
  // Only rotationResult.matrix is used below, never its own widthPt/heightPt fields — and the matrix's rotation/reflection component (a, b, c, d) never depends on the w/h arguments at all, only its translation component (e, f) does. That translation is provably canceled by the origin renormalization two lines down (translationMatrix(-visibleRect.minX, -visibleRect.minY) subtracts out exactly the offset any w/h value would have introduced), so the real mediaBox width/height computed here would produce a byte-identical pageMatrix and visibleRect to passing 0 for both — confirmed directly against an asymmetric MediaBox/CropBox pair under every rotation, not merely the aligned case. Passing 0 rather than the real (but unobservable) mediaBox dimensions removes an arithmetic expression whose result genuinely never reaches any output.
  const rotationResult = pageRotationTransform(rotation, 0, 0);
  // The crop rect rotated into output space, then used as the origin: every item position is relative to the visible region's own lower-left corner, exactly as a viewer presents it.
  const visibleRect = rotatedRectBounds(cropBox, rotationResult.matrix);
  const widthPt = visibleRect.maxX - visibleRect.minX;
  const heightPt = visibleRect.maxY - visibleRect.minY;
  const pageMatrix = multiplyMatrices(
    rotationResult.matrix,
    translationMatrix(-visibleRect.minX, -visibleRect.minY),
  );

  const boxRow = pageBoxResidueEntry(pageIndex, page, mediaBox, cropBox);

  const items: LayoutItem[] = [];
  if (resources !== undefined) {
    const contentBytes = readPageContentBytes(page, resolver, sink);
    const extracted = interpretContentStream(contentBytes, resources, {
      fontMetrics: fontResolver.metrics,
      resolver,
      sink,
      layerNameOf,
    });
    for (const item of extracted) {
      const converted = convertExtractedItem(
        item,
        pageMatrix,
        fontResolver,
        images,
        imageIdCache,
        resolver,
        sink,
      );
      if (
        converted === undefined ||
        !itemIntersectsVisibleRegion(converted, widthPt, heightPt)
      ) {
        continue;
      }
      // The (page, MCID) association: an item stamped with its span's MCID names the element the parent tree says owns that marked content — the one place a PDF states semantics natively rather than leaving geometry to imply it.
      const owner =
        item.mcid === undefined
          ? undefined
          : structureOwnerOf(pageIndex, item.mcid);
      items.push(
        owner === undefined ? converted : withStructure(converted, owner),
      );
    }
  } else {
    sink({
      code: "pdf/object-missing-value",
      severity: "warning",
      message:
        "page has no /Resources dict; its content stream cannot be interpreted",
    });
  }
  items.push(
    ...readLinkAnnotations(page, pageMatrix, resolver, destinationRegistry),
  );

  const notes = readPageNotes(page, resolver);
  const annotations = readPageAnnotations(page, pageMatrix, resolver, sink);

  return {
    page: {
      widthPt,
      heightPt,
      items,
      ...(notes !== undefined ? { notes } : {}),
      ...(annotations.length > 0 ? { annotations } : {}),
    },
    boxRow,
  };
}

// Stamps the owning element id onto a converted item. The link kinds carry no structure field by the same line the layer filter draws — an annotation is an anchored construct, not painted stream content — and they never reach here with an owner anyway (they are not extracted from a content stream), so the guard is pure narrowing.
function withStructure(item: LayoutItem, structure: string): LayoutItem {
  if (item.kind === "link" || item.kind === "internalLink") {
    return item;
  }
  return { ...item, structure };
}

// --- PDF string decoding and /Info metadata: the scalar decoders themselves live in pdf-text.ts (shared with the other read-side modules; deep-importable as pdf-codec/pdf-text through the wildcard export). ---

function readMetadata(
  trailer: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  catalog: PdfDict,
  sink: PdfDiagnosticSink,
): LayoutMetadata {
  const info = resolver.resolveDict(dictGet(trailer, "Info"));
  if (info === undefined) {
    return {};
  }
  const stringField = (key: string): string | undefined => {
    const obj: PdfObject | undefined = dictGet(info, key);
    return obj?.kind === "string" ? decodePdfString(obj.bytes) : undefined;
  };
  const keywordsRaw = stringField("Keywords");
  const keywords = keywordsRaw
    ?.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  const langObj = dictGet(catalog, "Lang");
  // The XMP mirror fills ONLY the fields /Info does not carry: in an ordinary file the two agree, and in a PDF/A file the fields live only in XMP — either way /Info, the structured original, wins where it speaks.
  const xmp = xmpPacket(catalog, resolver, sink);
  const mirrored = readXmpMetadata(xmp ?? "");
  return {
    title: stringField("Title") ?? mirrored.title,
    author: stringField("Author") ?? mirrored.author,
    subject: stringField("Subject") ?? mirrored.subject,
    keywords:
      (keywords !== undefined && keywords.length > 0 ? keywords : undefined) ??
      mirrored.keywords,
    creator: stringField("Creator") ?? mirrored.creator,
    producer: stringField("Producer") ?? mirrored.producer,
    createdIso:
      parsePdfDate(stringField("CreationDate")) ?? mirrored.createdIso,
    modifiedIso: parsePdfDate(stringField("ModDate")) ?? mirrored.modifiedIso,
    ...(langObj?.kind === "string"
      ? { language: decodePdfString(langObj.bytes) }
      : {}),
  };
}

function xmpPacket(
  catalog: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
): string | undefined {
  const metadataObj = resolver.resolve(dictGet(catalog, "Metadata"));
  if (metadataObj?.kind !== "stream") {
    return undefined;
  }
  const decoded = decodeStream(metadataObj.raw, metadataObj.dict, sink);
  return new TextDecoder().decode(decoded.bytes);
}

// The package-level residue rows: whole-document PDF facts no content node owns, serialised in their own syntax and quarantined per the channel's contract — a consumer never derives semantics from them, and only a same-format writer may re-emit them.
function readDocumentResidue(
  doc: PdfDocument,
  sink: PdfDiagnosticSink,
): Record<string, SourceResidue> {
  const source: Record<string, SourceResidue> = {};
  const residue = (key: string, obj: PdfObject | undefined): void => {
    if (obj !== undefined) {
      source[key] = { format: "pdf", xml: serializeObjectToText(obj) };
    }
  };
  const catalog = doc.catalog;
  const packet = xmpPacket(catalog, doc, sink);
  if (packet !== undefined) {
    source.xmp = { format: "pdf", xml: packet };
  }
  residue("viewer-preferences", dictGet(catalog, "ViewerPreferences"));
  residue("page-mode", dictGet(catalog, "PageMode"));
  residue("page-layout", dictGet(catalog, "PageLayout"));
  residue("open-action", dictGet(catalog, "OpenAction"));
  // /OutputIntents is an array of references — the residue that is worth quarantining is the intent dictionaries themselves, so each element resolves before serialising.
  const outputIntents = asArray(dictGet(catalog, "OutputIntents"));
  if (outputIntents !== undefined) {
    residue(
      "output-intents",
      pdfArray(outputIntents.map((intent) => doc.resolve(intent) ?? pdfNull())),
    );
  }
  residue("piece-info", dictGet(catalog, "PieceInfo"));
  residue("legal", dictGet(catalog, "Legal"));
  residue("collection", dictGet(catalog, "Collection"));
  residue("trailer-id", dictGet(doc.trailer, "ID"));
  return source;
}
