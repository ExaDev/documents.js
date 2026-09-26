import type {
  Color as LayoutColor,
  ContentStrokeStyle,
} from "document-schema.js";
import { openPdfDocument } from "./document";
import type { GlyfTable } from "./glyf";
import type { SfntFont } from "./sfnt";
import { drawTextRun, type TextOutlineFace } from "./raster-text";
import type { PdfDiagnosticSink } from "./diagnostics";
import { NOOP_DIAGNOSTIC_SINK, PdfParseError } from "./diagnostics";
import { decodeStream } from "./filters";
import { createFontResolver } from "./font-read";
import type { FontResolverService } from "./font-read";
import { readImageXObject } from "./images-read";
import type {
  ExtractedEllipse,
  ExtractedImage,
  ExtractedInlineImage,
  ExtractedItem,
  ExtractedLine,
  ExtractedPath,
  ExtractedRect,
  PdfObjectResolver,
} from "./interpret";
import { interpretContentStream } from "./interpret";
import type { Matrix } from "./matrix";
import {
  BEZIER_KAPPA,
  applyMatrix,
  multiplyMatrices,
  translationMatrix,
} from "./matrix";
import { normalizeRotation, pageRotationTransform } from "./read";
import type { PdfDict } from "./objects";
import { asArray, asNumber, dictGet } from "./objects";
import { readOptionalContent } from "./optional-content";
import { concatBytes } from "./bytes/writer";
import { throwIfAborted } from "./util/abort";

// The rasterisation port: the contract a consumer's canvas implements, plus renderPdfPage, the driver that walks one page's content through this package's existing read machinery (openPdfDocument + interpretContentStream, the same interpreter readPdf itself runs) and drives the rasteriser with positioned draw operations. pdf-codec deliberately does NOT pick a rasteriser, embed one, or depend on any canvas API (ExaDev/documents.js#1198): a runtime with no canvas at all (Cloudflare Workers has neither canvas nor OffscreenCanvas) and a runtime with a free hardware-accelerated one (a browser) both consume the same port, and the weight of an actual raster backend lands only in whichever backend package a consumer installs — pdf-raster-cpu is this family's pure-software reference backend. The port mirrors the font-port precedent of document-schema.js (the types a caller implements are pure data plus callbacks; the implementation machinery stays behind the interface), with the one difference that the contract lives here rather than in the shared schema package because its vocabulary — page points, PDF matrices, item paint semantics — is this codec's own: no second codec could implement it.
//
// Everything here is Worker-isomorphic pure data: no canvas, no DOM, no node:* builtins, no network, and no OCR or vision anywhere — the port hands a caller pixels, exactly as the issue's "what we are NOT asking for" section requires. Glyphs arrive as filled outline paths rather than bitmaps or font references, so a backend needs no font machinery at all: pdf-codec resolves each run's embedded sfnt outlines through its own glyf/cmap readers (the same tables the write path's embedder builds) and hands the backend closed subpaths in device space. Text whose font carries no sfnt outlines (a standard-14 face with nothing embedded, a CFF program, a Type3 glyph procedure) is refused through a named diagnostic rather than approximated with a substitute shape.

// --- The port: device space and the draw-op vocabulary. ---

// All coordinates every draw op carries are DEVICE PIXELS: origin top-left at the rendered region's own top-left corner, x increasing right, y increasing down — the convention of every raster buffer and 2D canvas API, rather than PDF's own bottom-left/y-up user space, so a backend never flips anything. renderPdfPage performs the one flip itself when it composes the page-space-to-device-space transform, which is also what makes clipPt (expressed in PDF user space, y up) line up with the top-left-origin image a consumer expects for OCR.
export type RasterMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export type RasterPathSegment =
  | { readonly kind: "line"; readonly xPx: number; readonly yPx: number }
  | {
      readonly kind: "cubic";
      readonly c1xPx: number;
      readonly c1yPx: number;
      readonly c2xPx: number;
      readonly c2yPx: number;
      readonly xPx: number;
      readonly yPx: number;
    };

export interface RasterSubpath {
  readonly startXPx: number;
  readonly startYPx: number;
  readonly segments: readonly RasterPathSegment[];
  readonly closed: boolean;
}

export interface RasterFillSpec {
  readonly color: LayoutColor;
  readonly fillRule: "nonzero" | "evenodd";
}

export interface RasterStrokeSpec {
  readonly color: LayoutColor;
  readonly widthPx: number;
  // Dash on/off lengths in device pixels. Absent means solid. A dotted style never arrives here as a zero-length dash array (which paints nothing under a butt cap — PDF's own Table 52 behaviour): renderPdfPage converts recovered dotted strokes into small filled squares before the port, so a backend needs no round-cap primitive.
  readonly dashPx?: readonly number[];
}

// An axis-aligned rectangle fill — the single most common painted item on real pages (table rules, cell shading, redaction bars) and the one op a backend can implement with a plain row loop.
export interface RasterFillRectOp {
  readonly kind: "fillRect";
  readonly xPx: number;
  readonly yPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly color: LayoutColor;
}

// A general vector path: rect and ellipse strokes, lines, charts' arbitrary curves, and every glyph outline. At least one of fill/stroke is always set, mirroring interpret.ts's own ExtractedPaint invariant. A fill treats an open subpath as implicitly closed (PDF's own fill semantics, ISO 32000-1 8.5.3.1), so a backend must not skip open subpaths when filling.
export interface RasterPathOp {
  readonly kind: "path";
  readonly subpaths: readonly RasterSubpath[];
  readonly fill?: RasterFillSpec;
  readonly stroke?: RasterStrokeSpec;
}

// An image placed by affine transform. `matrix` maps the unit image square — origin at the image's TOP-LEFT corner, x right across source columns, y down across source rows — into device pixels, in PDF's own [a b c d e f] cm convention (row-vector: [x' y'] = [x y] x M). Carrying the full affine rather than a destination rectangle is what lets a rotated page or a rotated Do-placement render exactly; the axis-aligned case is just b = c = 0. `bytes`/`format`/`sourceWidthPx`/`sourceHeightPx` are exactly what images-read.ts recovers (PNG for every decoded filter, JPEG passed through verbatim), so a backend with a native JPEG decoder (a browser canvas) draws DCTDecode scans directly while a backend without one can refuse by name rather than re-encode.
export interface RasterImageOp {
  readonly kind: "image";
  readonly format: "png" | "jpeg";
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly sourceWidthPx: number;
  readonly sourceHeightPx: number;
  readonly matrix: RasterMatrix;
}

export type RasterDrawOp = RasterFillRectOp | RasterPathOp | RasterImageOp;

// What one rendered page looks like: the rasteriser sizes its canvas from this and can otherwise ignore it. widthPx/heightPx are the canvas; widthPt/heightPt are the rendered region's own extent in page points (clipPt's, or the page's visible region when no clip was requested); scale is the device-pixels-per-point factor actually applied.
export interface RasterPageGeometry {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly scale: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

// The contract a consumer's canvas implements. beginPage, then a document-order sequence of draw calls (the same order the page's content stream paints in, so later draws overlap earlier ones), then finish, which returns the rendered PNG bytes — synchronously or as a promise, whichever the backend's own encoder needs, so an async-encoding backend (a canvas convertToBlob, say) implements the same interface as a synchronous buffer writer. Ops may extend outside the canvas (page content straddling the clip boundary keeps its original geometry in the item layer, and rendering clips rather than truncates, exactly as a viewer does); a backend must bounds-check, never assume.
export interface PageRasteriser {
  beginPage: (geometry: RasterPageGeometry) => void;
  draw: (op: RasterDrawOp) => void;
  finish: () => Uint8Array<ArrayBuffer> | Promise<Uint8Array<ArrayBuffer>>;
}

// --- The entry point's options. ---

// A page region in the same point coordinates LayoutFrame (and LayoutPage items, and document-outline.js's segmentPdfRegions region bounds) use: PDF user space relative to the visible region's own lower-left corner, y increasing upward, unit = point. A caller that located a figure via segmentPdfRegions passes region.bounds here directly and renders just that figure.
export interface RasterRegionPt {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

export interface RenderPdfPageOptions {
  // Device pixels per page point. Exactly one of scale/dpi may be given (they name the same factor in different units); the default is scale 1, one pixel per point.
  readonly scale?: number;
  // Resolution in dots per inch (a PDF point is 1/72 inch, so dpi 72 is scale 1). The OCR-friendly band is 150-300.
  readonly dpi?: number;
  readonly clipPt?: RasterRegionPt;
  readonly sink?: PdfDiagnosticSink;
  readonly signal?: AbortSignal;
}

// Absorbs float fuzz in regionPixels below (an exact 100pt at scale 2 computing 200.00000000000003 must be 200, not 201).
const PIXEL_ROUNDING_EPSILON = 1e-9;

// A PDF point is defined as 1/72 inch (ISO 32000-1 8.3), the conversion between the dpi option and the scale factor it names.
const POINTS_PER_INCH = 72;

// Below this, a text run's raw device-space advance is treated as zero rather than divided by, guarding drawTextRun's own glyph-spacing correction against a near-zero-but-nonzero float result.
export const EXTENT_ZERO_EPSILON = 1e-9;

// Canvas dimensions round UP, so the region's whole point extent always covers its last pixel row/column (a round-half rule could drop a right-edge sliver), and a hairline-but-valid clip that scales below one pixel still yields a one-pixel canvas rather than a zero-sized PNG no encoder accepts. The epsilon absorbs float fuzz (an exact 100pt at scale 2 computing 200.00000000000003 must be 200, not 201).
function regionPixels(extentPt: number, scale: number): number {
  return Math.max(1, Math.ceil(extentPt * scale - PIXEL_ROUNDING_EPSILON));
}

// The %PDF- header scan readPdf performs (a junk-prefixed file is legal per ISO 32000-1 7.5.2, so a window is searched rather than offset 0 required): re-derived here because read.ts's own copy is not exported, with raster.test.ts holding the observable behaviour to the same pdf/no-header error readPdf throws for a non-PDF input. A latin1 decode maps each byte 0-255 to the identical code point one-for-one, so String.prototype.includes over it is exactly a byte-sequence search — the language's own substring search, rather than a hand-written double loop whose own bounds arithmetic would just be re-deriving what indexOf already guarantees correct.
const HEADER_SEARCH_WINDOW = 1024;

// US Letter, the same malformed-file fallback read.ts applies when a page declares no /MediaBox at all even after page-tree inheritance.
const DEFAULT_PAGE_WIDTH_PT = 612;

const DEFAULT_PAGE_HEIGHT_PT = 792;

interface PageBoxRect {
  readonly llx: number;
  readonly lly: number;
  readonly urx: number;
  readonly ury: number;
}

const NEWLINE_BYTE = 0x0a;

function hasPdfHeader(bytes: Uint8Array<ArrayBuffer>): boolean {
  const window = bytes.subarray(
    0,
    Math.min(HEADER_SEARCH_WINDOW, bytes.length),
  );
  return new TextDecoder("latin1").decode(window).includes("%PDF-");
}

// /MediaBox, /CropBox and their kin, normalised to lower-left/upper-right corners — read.ts's own readDeclaredPageBox, re-derived here (see the geometry comment inside renderPdfPage for why the duplication is deliberate and test-pinned).
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

// The axis-aligned bounds of a page rectangle after a rotation transform — read.ts's own rotatedRectBounds: all four corners transformed, then min/max, because a rotation that is not about the box's own corner does not preserve which corner is lower-left.
function rotatedRectBounds(
  rect: PageBoxRect,
  matrix: Matrix,
): { minX: number; minY: number; maxX: number; maxY: number } {
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

// A page's decoded content bytes: its /Contents stream, or the concatenation of the /Contents array's streams separated by a newline (the same separator read.ts uses, so an operator split across array entries parses identically in both walks).
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
    for (const entry of contentsObj.items) {
      const streamObj = resolver.resolve(entry);
      if (streamObj?.kind === "stream") {
        chunks.push(
          decodeStream(streamObj.raw, streamObj.dict, sink).bytes,
          new Uint8Array([NEWLINE_BYTE]),
        );
      }
    }
    return concatBytes(chunks);
  }
  return new Uint8Array(0);
}

export function renderPdfPage(
  pdfBytes: Uint8Array<ArrayBuffer>,
  pageIndex: number,
  options: RenderPdfPageOptions,
  rasteriser: Readonly<PageRasteriser>,
): Uint8Array<ArrayBuffer> | Promise<Uint8Array<ArrayBuffer>> {
  const sink = options.sink ?? NOOP_DIAGNOSTIC_SINK;
  if (options.scale !== undefined && options.dpi !== undefined) {
    throw new Error(
      "renderPdfPage accepts at most one of scale and dpi; they name the same factor in different units (dpi = 72 x scale)",
    );
  }
  const scale =
    options.dpi !== undefined ? options.dpi / POINTS_PER_INCH : options.scale;
  if (scale !== undefined && !(scale > 0)) {
    throw new Error(
      `renderPdfPage requires a positive scale factor (received scale ${options.scale}, dpi ${options.dpi})`,
    );
  }
  const pixelsPerPt = scale ?? 1;
  if (
    options.clipPt !== undefined &&
    (!(options.clipPt.widthPt > 0) || !(options.clipPt.heightPt > 0))
  ) {
    throw new Error(
      "renderPdfPage clipPt must carry positive widthPt and heightPt; a zero-extent region has no pixels to render",
    );
  }

  throwIfAborted(options.signal);
  if (!hasPdfHeader(pdfBytes)) {
    throw new PdfParseError(
      "pdf/no-header",
      'no "%PDF-" header found within the first bytes of the file; this does not look like a PDF at all',
    );
  }
  const doc = openPdfDocument(pdfBytes, sink);
  const pages = doc.pages();
  if (pageIndex < 0 || pageIndex >= pages.length) {
    throw new PdfParseError(
      "pdf/page-index-out-of-range",
      `page index ${pageIndex} is outside this document's page tree (it declares ${pages.length} page${pages.length === 1 ? "" : "s"})`,
    );
  }
  const page = pages[pageIndex]!;

  // --- Page geometry: the same visible-region computation read.ts's readPage performs (crop box, /Rotate, visible-rect origin), re-derived here because readPdf's own copy is module-private. This is the one deliberately duplicated block in the module, and raster.test.ts pins it: a rotated, cropped fixture must place rendered ink exactly where readPdf reports the corresponding item, so the clipPt contract (the same point coordinates LayoutFrame uses) is a tested fact rather than a hope — an edit to read.ts's geometry that drifts from this copy fails that test rather than shipping a renderer that disagrees with the reader about where anything is.
  const mediaBox = readMediaBox(page);
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
  const visibleRect = rotatedRectBounds(cropBox, rotationResult.matrix);
  const pageWidthPt = visibleRect.maxX - visibleRect.minX;
  const pageHeightPt = visibleRect.maxY - visibleRect.minY;
  const pageMatrix = multiplyMatrices(
    rotationResult.matrix,
    translationMatrix(-visibleRect.minX, -visibleRect.minY),
  );

  // The rendered region: the requested clip intersected with the page's visible region. An empty intersection is a caller error (segmentPdfRegions bounds are item bounds and always intersect the page that produced them), reported with both rectangles rather than silently clamped to something the caller did not ask for.
  const requested = options.clipPt ?? {
    xPt: 0,
    yPt: 0,
    widthPt: pageWidthPt,
    heightPt: pageHeightPt,
  };
  const clipLeft = Math.max(0, requested.xPt);
  const clipBottom = Math.max(0, requested.yPt);
  const clipRight = Math.min(pageWidthPt, requested.xPt + requested.widthPt);
  const clipTop = Math.min(pageHeightPt, requested.yPt + requested.heightPt);
  if (clipRight - clipLeft <= 0 || clipTop - clipBottom <= 0) {
    throw new Error(
      `renderPdfPage clipPt does not intersect the page's visible region (clip x ${requested.xPt}..${requested.xPt + requested.widthPt}, y ${requested.yPt}..${requested.yPt + requested.heightPt}; page 0..${pageWidthPt} x 0..${pageHeightPt})`,
    );
  }
  const regionWidthPt = clipRight - clipLeft;
  const regionHeightPt = clipTop - clipBottom;
  const widthPx = regionPixels(regionWidthPt, pixelsPerPt);
  const heightPx = regionPixels(regionHeightPt, pixelsPerPt);

  // Page points (bottom-left origin, y up) to device pixels (top-left origin, y down): uniform scale, one flip, one translation onto the region's own top-left corner. Composed with pageMatrix this is the single transform every item's geometry passes through, built once per page.
  const pageToDeviceMatrix: Matrix = [
    pixelsPerPt,
    0,
    0,
    -pixelsPerPt,
    -clipLeft * pixelsPerPt,
    (clipBottom + regionHeightPt) * pixelsPerPt,
  ];
  const interpretToDeviceMatrix = multiplyMatrices(
    pageMatrix,
    pageToDeviceMatrix,
  );

  const resources = doc.resolveDict(dictGet(page, "Resources"));
  rasteriser.beginPage({
    widthPx,
    heightPx,
    scale: pixelsPerPt,
    widthPt: regionWidthPt,
    heightPt: regionHeightPt,
  });
  if (resources === undefined) {
    sink({
      code: "pdf/object-missing-value",
      severity: "warning",
      message:
        "page has no /Resources dict; its content stream cannot be interpreted",
    });
    return rasteriser.finish();
  }

  const fontResolver = createFontResolver({ resolver: doc, sink });
  const { layers, layerNameOf } = readOptionalContent(doc.catalog, doc, sink);
  // Optional-content visibility is applied here, where a render must take a side (readPdf deliberately stamps layer names and lets each consumer decide): items in a layer the default configuration leaves OFF are not drawn, because that is what a viewer displays — the same line read.ts's own crop filter draws between source data and rendering facts.
  const hiddenLayers = new Set(
    layers.filter((layer) => !layer.visible).map((layer) => layer.name),
  );

  const extracted = interpretContentStream(
    readPageContentBytes(page, doc, sink),
    resources,
    {
      fontMetrics: fontResolver.metrics,
      resolver: doc,
      sink,
      layerNameOf,
    },
  );
  const outlineFaces = new Map<PdfDict, TextOutlineFace | undefined>();
  for (const item of extracted) {
    throwIfAborted(options.signal);
    if (item.layerName !== undefined && hiddenLayers.has(item.layerName)) {
      continue;
    }
    drawExtractedItem(
      item,
      doc,
      fontResolver,
      outlineFaces,
      interpretToDeviceMatrix,
      pixelsPerPt,
      rasteriser,
      sink,
    );
  }
  return rasteriser.finish();
}

// --- The item walk: one ExtractedItem to its draw ops, in content-stream order. ---

function drawExtractedItem(
  item: ExtractedItem,
  resolver: Readonly<PdfObjectResolver>,
  fontResolver: FontResolverService,
  outlineFaces: Map<PdfDict, TextOutlineFace | undefined>,
  interpretToDeviceMatrix: Matrix,
  pixelsPerPt: number,
  rasteriser: Readonly<PageRasteriser>,
  sink: PdfDiagnosticSink,
): void {
  if (item.kind === "text") {
    drawTextRun(
      item,
      fontResolver,
      resolver,
      outlineFaces,
      interpretToDeviceMatrix,
      rasteriser,
      sink,
    );
    return;
  }
  if (item.kind === "rect") {
    drawRect(item, interpretToDeviceMatrix, pixelsPerPt, rasteriser);
    return;
  }
  if (item.kind === "ellipse") {
    drawEllipse(item, interpretToDeviceMatrix, pixelsPerPt, rasteriser);
    return;
  }
  if (item.kind === "line") {
    drawLine(item, interpretToDeviceMatrix, pixelsPerPt, rasteriser);
    return;
  }
  if (item.kind === "path") {
    drawPath(item, interpretToDeviceMatrix, pixelsPerPt, rasteriser);
    return;
  }
  if (item.kind === "image") {
    drawImageXObjectItem(
      item,
      resolver,
      interpretToDeviceMatrix,
      rasteriser,
      sink,
    );
    return;
  }
  drawInlineImageItem(
    item,
    resolver,
    interpretToDeviceMatrix,
    rasteriser,
    sink,
  );
}

// A recovered rect: the fill arrives as the port's dedicated fillRect op (a backend's cheapest primitive), the stroke as a path op around the same rectangle. Both arms transform all four corners and take min/max rather than assuming which corner lands bottom-left, because a /Rotate 90/270 page matrix maps the rect's own corner order onto different device corners.
function drawRect(
  item: ExtractedRect,
  matrix: Matrix,
  pixelsPerPt: number,
  rasteriser: Readonly<PageRasteriser>,
): void {
  const corners = [
    applyMatrix(matrix, { x: item.xPt, y: item.yPt }),
    applyMatrix(matrix, { x: item.xPt + item.widthPt, y: item.yPt }),
    applyMatrix(matrix, { x: item.xPt, y: item.yPt + item.heightPt }),
    applyMatrix(matrix, {
      x: item.xPt + item.widthPt,
      y: item.yPt + item.heightPt,
    }),
  ];
  const minX = Math.min(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const maxY = Math.max(...corners.map((corner) => corner.y));
  if (item.fill !== undefined) {
    rasteriser.draw({
      kind: "fillRect",
      xPx: minX,
      yPx: minY,
      widthPx: maxX - minX,
      heightPx: maxY - minY,
      color: item.fill,
    });
  }
  if (item.stroke !== undefined) {
    rasteriser.draw({
      kind: "path",
      subpaths: [
        {
          startXPx: minX,
          startYPx: minY,
          segments: [
            { kind: "line", xPx: maxX, yPx: minY },
            { kind: "line", xPx: maxX, yPx: maxY },
            { kind: "line", xPx: minX, yPx: maxY },
          ],
          closed: true,
        },
      ],
      stroke: strokeSpec(item.stroke, undefined, pixelsPerPt),
    });
  }
}

// An ellipse is approximated by four cubic Bezier segments, one per quadrant, the same construction BEZIER_KAPPA is defined for.
const ELLIPSE_QUADRANT_COUNT = 4;

// A recovered ellipse, rebuilt as the same four-cubic kappa construction every ellipse-as-Beziers writer emits (BEZIER_KAPPA, shared with content-write.ts's writer and interpret.ts's detector): quarter arcs from the bounding box's cardinal points. Cubic segments transform point-wise under an affine matrix, so the control points transform individually and the curve remains exact.
function drawEllipse(
  item: ExtractedEllipse,
  matrix: Matrix,
  pixelsPerPt: number,
  rasteriser: Readonly<PageRasteriser>,
): void {
  const cx = item.xPt + item.widthPt / 2;
  const cy = item.yPt + item.heightPt / 2;
  const rx = item.widthPt / 2;
  const ry = item.heightPt / 2;
  const dx = rx * BEZIER_KAPPA;
  const dy = ry * BEZIER_KAPPA;
  const cardinalPoints: readonly (readonly [number, number])[] = [
    [cx + rx, cy],
    [cx, cy + ry],
    [cx - rx, cy],
    [cx, cy - ry],
  ];
  const controls: readonly (readonly [number, number])[] = [
    [cx + rx, cy + dy],
    [cx + dx, cy + ry],
    [cx - dx, cy + ry],
    [cx - rx, cy + dy],
    [cx - rx, cy - dy],
    [cx - dx, cy - ry],
    [cx + dx, cy - ry],
    [cx + rx, cy - dy],
  ];
  const transformed = (point: readonly [number, number]) =>
    applyMatrix(matrix, { x: point[0], y: point[1] });
  const start = transformed(cardinalPoints[0]!);
  const segments: RasterPathSegment[] = [];
  for (let i = 0; i < ELLIPSE_QUADRANT_COUNT; i++) {
    const end = transformed(cardinalPoints[(i + 1) % ELLIPSE_QUADRANT_COUNT]!);
    const c1 = transformed(controls[i * 2]!);
    const c2 = transformed(controls[i * 2 + 1]!);
    segments.push({
      kind: "cubic",
      c1xPx: c1.x,
      c1yPx: c1.y,
      c2xPx: c2.x,
      c2yPx: c2.y,
      xPx: end.x,
      yPx: end.y,
    });
  }
  rasteriser.draw({
    kind: "path",
    subpaths: [
      { startXPx: start.x, startYPx: start.y, segments, closed: true },
    ],
    ...(item.fill !== undefined
      ? { fill: { color: item.fill, fillRule: "nonzero" as const } }
      : {}),
    ...(item.stroke !== undefined
      ? { stroke: strokeSpec(item.stroke, undefined, pixelsPerPt) }
      : {}),
  });
}

// A recovered line: one open two-point subpath, stroked. A dotted style never reaches the port as a dash array (a zero on-length paints nothing under a butt cap — PDF's own Table 52 behaviour): it becomes a run of small filled squares along the segment, the closest axis-aligned approximation of the round-cap dot the writer's own dotted convention paints.
function drawLine(
  item: ExtractedLine,
  matrix: Matrix,
  pixelsPerPt: number,
  rasteriser: Readonly<PageRasteriser>,
): void {
  const p1 = applyMatrix(matrix, { x: item.x1Pt, y: item.y1Pt });
  const p2 = applyMatrix(matrix, { x: item.x2Pt, y: item.y2Pt });
  if (item.style === "dotted") {
    drawDottedSegment(
      p1,
      p2,
      item.widthPt * pixelsPerPt,
      item.color,
      rasteriser,
    );
    return;
  }
  rasteriser.draw({
    kind: "path",
    subpaths: [
      {
        startXPx: p1.x,
        startYPx: p1.y,
        segments: [{ kind: "line", xPx: p2.x, yPx: p2.y }],
        closed: false,
      },
    ],
    stroke: strokeSpec(
      { color: item.color, widthPt: item.widthPt },
      item.style,
      pixelsPerPt,
    ),
  });
}

// A recovered general path: every point of every subpath transformed individually (line endpoints and cubic control points alike — affine-exact), paint specs passed through with the fill rule the paint operator itself used. A dotted stroke draws as dot trains instead (see drawLine), so it never reaches the port as a dash array.
function drawPath(
  item: ExtractedPath,
  matrix: Matrix,
  pixelsPerPt: number,
  rasteriser: Readonly<PageRasteriser>,
): void {
  if (item.stroke !== undefined && item.style === "dotted") {
    const widthPx = item.stroke.widthPt * pixelsPerPt;
    for (const subpath of item.subpaths) {
      let prev = applyMatrix(matrix, {
        x: subpath.startXPt,
        y: subpath.startYPt,
      });
      const emitTo = (end: Readonly<{ x: number; y: number }>): void => {
        drawDottedSegment(prev, end, widthPx, item.stroke!.color, rasteriser);
        prev = end;
      };
      for (const segment of subpath.segments) {
        if (segment.kind === "line") {
          emitTo(applyMatrix(matrix, { x: segment.xPt, y: segment.yPt }));
        } else {
          const flattened = flattenCubic(
            prev,
            applyMatrix(matrix, { x: segment.c1xPt, y: segment.c1yPt }),
            applyMatrix(matrix, { x: segment.c2xPt, y: segment.c2yPt }),
            applyMatrix(matrix, { x: segment.xPt, y: segment.yPt }),
          );
          for (const point of flattened) {
            emitTo(point);
          }
        }
      }
    }
    return;
  }
  const subpaths: RasterSubpath[] = item.subpaths.map((subpath) => ({
    startXPx: applyMatrix(matrix, {
      x: subpath.startXPt,
      y: subpath.startYPt,
    }).x,
    startYPx: applyMatrix(matrix, {
      x: subpath.startXPt,
      y: subpath.startYPt,
    }).y,
    segments: subpath.segments.map((segment) => {
      if (segment.kind === "line") {
        const end = applyMatrix(matrix, { x: segment.xPt, y: segment.yPt });
        return { kind: "line" as const, xPx: end.x, yPx: end.y };
      }
      const c1 = applyMatrix(matrix, { x: segment.c1xPt, y: segment.c1yPt });
      const c2 = applyMatrix(matrix, { x: segment.c2xPt, y: segment.c2yPt });
      const end = applyMatrix(matrix, { x: segment.xPt, y: segment.yPt });
      return {
        kind: "cubic" as const,
        c1xPx: c1.x,
        c1yPx: c1.y,
        c2xPx: c2.x,
        c2yPx: c2.y,
        xPx: end.x,
        yPx: end.y,
      };
    }),
    closed: subpath.closed,
  }));
  rasteriser.draw({
    kind: "path",
    subpaths,
    ...(item.fill !== undefined
      ? { fill: { color: item.fill, fillRule: item.fillRule } }
      : {}),
    ...(item.stroke !== undefined
      ? { stroke: strokeSpec(item.stroke, item.style, pixelsPerPt) }
      : {}),
  });
}

function drawImageXObjectItem(
  item: ExtractedImage,
  resolver: Readonly<PdfObjectResolver>,
  interpretToDeviceMatrix: Matrix,
  rasteriser: Readonly<PageRasteriser>,
  sink: PdfDiagnosticSink,
): void {
  const xobjects = resolver.resolveDict(dictGet(item.resources, "XObject"));
  const stream =
    xobjects !== undefined
      ? resolver.resolve(dictGet(xobjects, item.resourceName))
      : undefined;
  if (stream?.kind !== "stream") {
    return; // an unresolvable XObject reference is already diagnosed inside interpretation
  }
  const image = readImageXObject(stream.dict, stream.raw, resolver, sink);
  if (image === undefined) {
    return; // readImageXObject has reported its own diagnostic for why these pixels are unavailable
  }
  drawImage(image, item.matrix, interpretToDeviceMatrix, rasteriser);
}

function drawInlineImageItem(
  item: ExtractedInlineImage,
  resolver: Readonly<PdfObjectResolver>,
  interpretToDeviceMatrix: Matrix,
  rasteriser: Readonly<PageRasteriser>,
  sink: PdfDiagnosticSink,
): void {
  const image = readImageXObject(item.dict, item.data, resolver, sink);
  if (image === undefined) {
    return;
  }
  drawImage(image, item.matrix, interpretToDeviceMatrix, rasteriser);
}

// Composes the image placement: PDF places an image XObject's unit square (origin BOTTOM-left in its own space, ISO 32000-1 8.5.3) through the Do CTM, while the port's image space is top-left/y-down (row 0 at the top) — so the composed matrix begins with that one flip and ends in device pixels.
function drawImage(
  image: {
    readonly format: "png" | "jpeg";
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly widthPx: number;
    readonly heightPx: number;
  },
  ctm: Matrix,
  interpretToDeviceMatrix: Matrix,
  rasteriser: Readonly<PageRasteriser>,
): void {
  // (u, v) in the port's top-left unit square -> (u, 1 - v) in PDF's bottom-left unit square.
  const flipImageSpace: Matrix = [1, 0, 0, -1, 0, 1];
  const matrix = multiplyMatrices(
    flipImageSpace,
    multiplyMatrices(ctm, interpretToDeviceMatrix),
  );
  rasteriser.draw({
    kind: "image",
    format: image.format,
    bytes: image.bytes,
    sourceWidthPx: image.widthPx,
    sourceHeightPx: image.heightPx,
    matrix,
  });
}

// content-write.ts's own dash-length convention: both the dash and the gap are this many multiples of the stroke width.
const DASHED_STROKE_WIDTH_MULTIPLE = 3;

// The port's stroke spec, mapping the recovered dash-style hint to a dash array with the same stroke-width multiples content-write.ts emits (dashed = [3w, 3w]), so a rendered dashed rule and a written one share one convention. `double` needs no case of its own: interpret.ts recovers it as the two genuinely separate offset strokes it was drawn as, never as a style on one stroke.
function strokeSpec(
  stroke: { readonly color: LayoutColor; readonly widthPt: number },
  style: ContentStrokeStyle | undefined,
  pixelsPerPt: number,
): RasterStrokeSpec {
  const widthPx = stroke.widthPt * pixelsPerPt;
  if (style === "dashed") {
    return {
      color: stroke.color,
      widthPx,
      dashPx: [
        widthPx * DASHED_STROKE_WIDTH_MULTIPLE,
        widthPx * DASHED_STROKE_WIDTH_MULTIPLE,
      ],
    };
  }
  return { color: stroke.color, widthPx };
}

// A dotted stroke as small filled squares of the stroke's own width, centred on the segment at 2w intervals (the writer's own dotted off-length): the axis-aligned approximation of a round-cap dot that a backend with no cap primitives can still draw recognisably.
function drawDottedSegment(
  p1: Readonly<{ x: number; y: number }>,
  p2: Readonly<{ x: number; y: number }>,
  widthPx: number,
  color: Readonly<LayoutColor>,
  rasteriser: Readonly<PageRasteriser>,
): void {
  const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (length === 0) {
    return;
  }
  const spacing = Math.max(widthPx * 2, 1);
  const dotHalf = widthPx / 2;
  for (let distance = 0; distance <= length; distance += spacing) {
    const t = distance / length;
    rasteriser.draw({
      kind: "fillRect",
      xPx: p1.x + (p2.x - p1.x) * t - dotHalf,
      yPx: p1.y + (p2.y - p1.y) * t - dotHalf,
      widthPx,
      heightPx: widthPx,
      color,
    });
  }
}

// De Casteljau subdivision of one device-space cubic into a polyline, splitting recursively until every piece's control points sit within STROKE_FLATTEN_TOLERANCE_PX of its chord — the standard tolerance-driven flattening every stroker applies before offsetting segments. Deterministic (identical inputs produce identical pieces), which the pixel-asserting tests rely on; the depth cap keeps a pathological curve finite even for a tolerance it never quite meets.
const STROKE_FLATTEN_TOLERANCE_PX = 0.05;
const MAX_FLATTEN_DEPTH = 16;

// Exported solely so raster.test.ts can drive its own subdivision arithmetic and depth cap directly with hand-computed control points — every caller reaches it only through curves recovered from real PDF content streams, which offers no way to pin an exact subdivision count or force the depth cap deterministically.
export function flattenCubic(
  p0: Readonly<{ x: number; y: number }>,
  c1: Readonly<{ x: number; y: number }>,
  c2: Readonly<{ x: number; y: number }>,
  p1: Readonly<{ x: number; y: number }>,
): readonly { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const flatten = (
    a: Readonly<{ x: number; y: number }>,
    b: Readonly<{ x: number; y: number }>,
    c: Readonly<{ x: number; y: number }>,
    d: Readonly<{ x: number; y: number }>,
    depth: number,
  ): void => {
    const chordX = d.x - a.x;
    const chordY = d.y - a.y;
    const chordLength = Math.hypot(chordX, chordY) || 1;
    const dist1 =
      Math.abs((b.x - a.x) * chordY - (b.y - a.y) * chordX) / chordLength;
    const dist2 =
      Math.abs((c.x - a.x) * chordY - (c.y - a.y) * chordX) / chordLength;
    if (
      depth >= MAX_FLATTEN_DEPTH ||
      Math.max(dist1, dist2) <= STROKE_FLATTEN_TOLERANCE_PX
    ) {
      points.push(d);
      return;
    }
    const ab = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const bc = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    const cd = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
    const abc = { x: (ab.x + bc.x) / 2, y: (ab.y + bc.y) / 2 };
    const bcd = { x: (bc.x + cd.x) / 2, y: (bc.y + cd.y) / 2 };
    const mid = { x: (abc.x + bcd.x) / 2, y: (abc.y + bcd.y) / 2 };
    flatten(a, ab, abc, mid, depth + 1);
    flatten(mid, bcd, cd, d, depth + 1);
  };
  flatten(p0, c1, c2, p1, 0);
  return points;
}

// --- Text: resolving a run's embedded sfnt outlines into filled outline paths. ---

// What an embedded font program turned out to carry, as resolved from a /FontDescriptor. The "glyf" case's own face carries only what every caller actually reads off it (glyf/unitsPerEm) — composite-ness and the shown-code -> glyph-ID mapping are per-font-dictionary facts a Type0 or TrueType caller derives for itself, never read back off this intermediate value.
export type EmbeddedProgram =
  | {
      readonly kind: "glyf";
      readonly sfnt: SfntFont;
      readonly face: { readonly glyf: GlyfTable; readonly unitsPerEm: number };
    }
  | { readonly kind: "cff" }
  | { readonly kind: "absent" };
