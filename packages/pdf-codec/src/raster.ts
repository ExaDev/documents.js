import type {
  Color as LayoutColor,
  ContentStrokeStyle,
} from "document-schema.js";
import { buildCmapLookup } from "./cmap-table";
import { decodeGlyphOutline } from "./glyf-contours";
import type { GlyphOutline } from "./glyf-contours";
import { openPdfDocument } from "./document";
import type { PdfDiagnosticSink } from "./diagnostics";
import { NOOP_DIAGNOSTIC_SINK, PdfParseError } from "./diagnostics";
import { decodeStream } from "./filters";
import { parseHead, parseMaxp } from "./font-tables";
import { createFontResolver } from "./font-read";
import type { FontResolverService } from "./font-read";
import { parseGlyf } from "./glyf";
import type { GlyfTable } from "./glyf";
import { readImageXObject } from "./images-read";
import type {
  ExtractedEllipse,
  ExtractedImage,
  ExtractedInlineImage,
  ExtractedItem,
  ExtractedLine,
  ExtractedPath,
  ExtractedRect,
  ExtractedTextRun,
  PdfObjectResolver,
} from "./interpret";
import { interpretContentStream } from "./interpret";
import type { Matrix } from "./matrix";
import {
  BEZIER_KAPPA,
  applyMatrix,
  multiplyMatrices,
  scaleMatrix,
  translationMatrix,
} from "./matrix";
import { normalizeRotation, pageRotationTransform } from "./read";
import type { PdfDict } from "./objects";
import { asArray, asName, asNumber, dictGet } from "./objects";
import { readOptionalContent } from "./optional-content";
import { parseSfnt } from "./sfnt";
import type { SfntFont } from "./sfnt";
import { concatBytes } from "./bytes/writer";
import { throwIfAborted } from "./util/abort";

// The rasterisation port: the contract a consumer's canvas implements, plus renderPdfPage, the driver that walks one page's content through this package's existing read machinery (openPdfDocument + interpretContentStream, the same interpreter readPdf itself runs) and drives the rasteriser with positioned draw operations. pdf-codec deliberately does NOT pick a rasteriser, embed one, or depend on any canvas API (ExaDev/documents.js#1198): a runtime with no canvas at all (Cloudflare Workers has neither canvas nor OffscreenCanvas) and a runtime with a free hardware-accelerated one (a browser) both consume the same port, and the weight of an actual raster backend lands only in whichever backend package a consumer installs -- pdf-raster-cpu is this family's pure-software reference backend. The port mirrors the font-port precedent of document-schema.js (the types a caller implements are pure data plus callbacks; the implementation machinery stays behind the interface), with the one difference that the contract lives here rather than in the shared schema package because its vocabulary -- page points, PDF matrices, item paint semantics -- is this codec's own: no second codec could implement it.
//
// Everything here is Worker-isomorphic pure data: no canvas, no DOM, no node:* builtins, no network, and no OCR or vision anywhere -- the port hands a caller pixels, exactly as the issue's "what we are NOT asking for" section requires. Glyphs arrive as filled outline paths rather than bitmaps or font references, so a backend needs no font machinery at all: pdf-codec resolves each run's embedded sfnt outlines through its own glyf/cmap readers (the same tables the write path's embedder builds) and hands the backend closed subpaths in device space. Text whose font carries no sfnt outlines (a standard-14 face with nothing embedded, a CFF program, a Type3 glyph procedure) is refused through a named diagnostic rather than approximated with a substitute shape.

// --- The port: device space and the draw-op vocabulary. ---

// All coordinates every draw op carries are DEVICE PIXELS: origin top-left at the rendered region's own top-left corner, x increasing right, y increasing down -- the convention of every raster buffer and 2D canvas API, rather than PDF's own bottom-left/y-up user space, so a backend never flips anything. renderPdfPage performs the one flip itself when it composes the page-space-to-device-space transform, which is also what makes clipPt (expressed in PDF user space, y up) line up with the top-left-origin image a consumer expects for OCR.
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
  // Dash on/off lengths in device pixels. Absent means solid. A dotted style never arrives here as a zero-length dash array (which paints nothing under a butt cap -- PDF's own Table 52 behaviour): renderPdfPage converts recovered dotted strokes into small filled squares before the port, so a backend needs no round-cap primitive.
  readonly dashPx?: readonly number[];
}

// An axis-aligned rectangle fill -- the single most common painted item on real pages (table rules, cell shading, redaction bars) and the one op a backend can implement with a plain row loop.
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

// An image placed by affine transform. `matrix` maps the unit image square -- origin at the image's TOP-LEFT corner, x right across source columns, y down across source rows -- into device pixels, in PDF's own [a b c d e f] cm convention (row-vector: [x' y'] = [x y] x M). Carrying the full affine rather than a destination rectangle is what lets a rotated page or a rotated Do-placement render exactly; the axis-aligned case is just b = c = 0. `bytes`/`format`/`sourceWidthPx`/`sourceHeightPx` are exactly what images-read.ts recovers (PNG for every decoded filter, JPEG passed through verbatim), so a backend with a native JPEG decoder (a browser canvas) draws DCTDecode scans directly while a backend without one can refuse by name rather than re-encode.
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

// The contract a consumer's canvas implements. beginPage, then a document-order sequence of draw calls (the same order the page's content stream paints in, so later draws overlap earlier ones), then finish, which returns the rendered PNG bytes -- synchronously or as a promise, whichever the backend's own encoder needs, so an async-encoding backend (a canvas convertToBlob, say) implements the same interface as a synchronous buffer writer. Ops may extend outside the canvas (page content straddling the clip boundary keeps its original geometry in the item layer, and rendering clips rather than truncates, exactly as a viewer does); a backend must bounds-check, never assume.
export interface PageRasteriser {
  beginPage(geometry: RasterPageGeometry): void;
  draw(op: RasterDrawOp): void;
  finish(): Uint8Array<ArrayBuffer> | Promise<Uint8Array<ArrayBuffer>>;
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

// Mirrors interpret.ts's own fallback width for a glyph whose advance cannot be resolved -- the interpreter's advance walk has already diagnosed the miss through the sink by the time the raster walk re-asks, and using the same constant keeps the two walks accumulating identical fallbacks rather than silently disagreeing about a run's internal placement.
const FALLBACK_GLYPH_WIDTH_PER_1000 = 500;

// Canvas dimensions round UP, so the region's whole point extent always covers its last pixel row/column (a round-half rule could drop a right-edge sliver), and a hairline-but-valid clip that scales below one pixel still yields a one-pixel canvas rather than a zero-sized PNG no encoder accepts. The epsilon absorbs float fuzz (an exact 100pt at scale 2 computing 200.00000000000003 must be 200, not 201).
function regionPixels(extentPt: number, scale: number): number {
  return Math.max(1, Math.ceil(extentPt * scale - 1e-9));
}

export function renderPdfPage(
  pdfBytes: Uint8Array<ArrayBuffer>,
  pageIndex: number,
  options: RenderPdfPageOptions,
  rasteriser: PageRasteriser,
): Uint8Array<ArrayBuffer> | Promise<Uint8Array<ArrayBuffer>> {
  const sink = options.sink ?? NOOP_DIAGNOSTIC_SINK;
  if (options.scale !== undefined && options.dpi !== undefined) {
    throw new Error(
      "renderPdfPage accepts at most one of scale and dpi; they name the same factor in different units (dpi = 72 x scale)",
    );
  }
  const scale = options.dpi !== undefined ? options.dpi / 72 : options.scale;
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

  // --- Page geometry: the same visible-region computation read.ts's readPage performs (crop box, /Rotate, visible-rect origin), re-derived here because readPdf's own copy is module-private. This is the one deliberately duplicated block in the module, and raster.test.ts pins it: a rotated, cropped fixture must place rendered ink exactly where readPdf reports the corresponding item, so the clipPt contract (the same point coordinates LayoutFrame uses) is a tested fact rather than a hope -- an edit to read.ts's geometry that drifts from this copy fails that test rather than shipping a renderer that disagrees with the reader about where anything is.
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
  const rotationResult = pageRotationTransform(
    rotation,
    mediaBox.urx - mediaBox.llx,
    mediaBox.ury - mediaBox.lly,
  );
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
  // Optional-content visibility is applied here, where a render must take a side (readPdf deliberately stamps layer names and lets each consumer decide): items in a layer the default configuration leaves OFF are not drawn, because that is what a viewer displays -- the same line read.ts's own crop filter draws between source data and rendering facts.
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
  resolver: PdfObjectResolver,
  fontResolver: FontResolverService,
  outlineFaces: Map<PdfDict, TextOutlineFace | undefined>,
  interpretToDeviceMatrix: Matrix,
  pixelsPerPt: number,
  rasteriser: PageRasteriser,
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
  rasteriser: PageRasteriser,
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

// A recovered ellipse, rebuilt as the same four-cubic kappa construction every ellipse-as-Beziers writer emits (BEZIER_KAPPA, shared with content-write.ts's writer and interpret.ts's detector): quarter arcs from the bounding box's cardinal points. Cubic segments transform point-wise under an affine matrix, so the control points transform individually and the curve remains exact.
function drawEllipse(
  item: ExtractedEllipse,
  matrix: Matrix,
  pixelsPerPt: number,
  rasteriser: PageRasteriser,
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
  for (let i = 0; i < 4; i++) {
    const end = transformed(cardinalPoints[(i + 1) % 4]!);
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

// A recovered line: one open two-point subpath, stroked. A dotted style never reaches the port as a dash array (a zero on-length paints nothing under a butt cap -- PDF's own Table 52 behaviour): it becomes a run of small filled squares along the segment, the closest axis-aligned approximation of the round-cap dot the writer's own dotted convention paints.
function drawLine(
  item: ExtractedLine,
  matrix: Matrix,
  pixelsPerPt: number,
  rasteriser: PageRasteriser,
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

// A recovered general path: every point of every subpath transformed individually (line endpoints and cubic control points alike -- affine-exact), paint specs passed through with the fill rule the paint operator itself used. A dotted stroke draws as dot trains instead (see drawLine), so it never reaches the port as a dash array.
function drawPath(
  item: ExtractedPath,
  matrix: Matrix,
  pixelsPerPt: number,
  rasteriser: PageRasteriser,
): void {
  if (item.stroke !== undefined && item.style === "dotted") {
    const widthPx = item.stroke.widthPt * pixelsPerPt;
    for (const subpath of item.subpaths) {
      let prev = applyMatrix(matrix, {
        x: subpath.startXPt,
        y: subpath.startYPt,
      });
      const emitTo = (end: { x: number; y: number }): void => {
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
  resolver: PdfObjectResolver,
  interpretToDeviceMatrix: Matrix,
  rasteriser: PageRasteriser,
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
  resolver: PdfObjectResolver,
  interpretToDeviceMatrix: Matrix,
  rasteriser: PageRasteriser,
  sink: PdfDiagnosticSink,
): void {
  const image = readImageXObject(item.dict, item.data, resolver, sink);
  if (image === undefined) {
    return;
  }
  drawImage(image, item.matrix, interpretToDeviceMatrix, rasteriser);
}

// Composes the image placement: PDF places an image XObject's unit square (origin BOTTOM-left in its own space, ISO 32000-1 8.5.3) through the Do CTM, while the port's image space is top-left/y-down (row 0 at the top) -- so the composed matrix begins with that one flip and ends in device pixels.
function drawImage(
  image: {
    readonly format: "png" | "jpeg";
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly widthPx: number;
    readonly heightPx: number;
  },
  ctm: Matrix,
  interpretToDeviceMatrix: Matrix,
  rasteriser: PageRasteriser,
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
      dashPx: [widthPx * 3, widthPx * 3],
    };
  }
  return { color: stroke.color, widthPx };
}

// A dotted stroke as small filled squares of the stroke's own width, centred on the segment at 2w intervals (the writer's own dotted off-length): the axis-aligned approximation of a round-cap dot that a backend with no cap primitives can still draw recognisably.
function drawDottedSegment(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  widthPx: number,
  color: LayoutColor,
  rasteriser: PageRasteriser,
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

// De Casteljau subdivision of one device-space cubic into a polyline, splitting recursively until every piece's control points sit within STROKE_FLATTEN_TOLERANCE_PX of its chord -- the standard tolerance-driven flattening every stroker applies before offsetting segments. Deterministic (identical inputs produce identical pieces), which the pixel-asserting tests rely on; the depth cap keeps a pathological curve finite even for a tolerance it never quite meets.
const STROKE_FLATTEN_TOLERANCE_PX = 0.05;
const MAX_FLATTEN_DEPTH = 16;

function flattenCubic(
  p0: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  p1: { x: number; y: number },
): readonly { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const flatten = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
    d: { x: number; y: number },
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

// Everything the glyph walk needs from one font resource: the parsed 'glyf', the design-grid size its coordinates live in, and the shown-code -> glyph-ID mapping the PDF's own font dictionary states (Identity-H's CID arithmetic, or a simple font's program cmap).
interface TextOutlineFace {
  // Whether shown codes are 2-byte CIDs (a Type0/Identity-H composite font) or 1-byte simple-font codes -- the fallback advance width the glyph walk consumes per code when the metrics port cannot resolve one.
  readonly composite: boolean;
  readonly glyf: GlyfTable;
  readonly unitsPerEm: number;
  glyphIdOf(
    codes: Uint8Array<ArrayBuffer>,
    byteOffset: number,
  ): number | undefined;
}

// What an embedded font program turned out to carry, as resolved from a /FontDescriptor.
type EmbeddedProgram =
  | {
      readonly kind: "glyf";
      readonly sfnt: SfntFont;
      readonly face: TextOutlineFace;
    }
  | { readonly kind: "cff" }
  | { readonly kind: "absent" };

// Pulls the /FontDescriptor's embedded program from whichever key it lives under (FontFile2, or FontFile3 -- an /OpenType-wrapped sfnt is a legal container for either outline flavour, and the bytes themselves, not the key, say which flavour: the same sniffing rule font-read.ts's readFontProgram applies) and classifies it. A bare CFF program (0x01 0x00 0x04 header) or an 'OTTO' sfnt carrying a 'CFF ' table is CFF; anything parseable as an sfnt with a readable glyf/head/maxp trio is fillable; anything else (no descriptor, no stream, an unparseable or table-less program) is absent.
function openEmbeddedProgram(
  descriptorOwner: PdfDict,
  resolver: PdfObjectResolver,
): EmbeddedProgram {
  const descriptor = resolver.resolveDict(
    dictGet(descriptorOwner, "FontDescriptor"),
  );
  if (descriptor === undefined) {
    return { kind: "absent" };
  }
  for (const key of ["FontFile2", "FontFile3"]) {
    const stream = resolver.resolve(dictGet(descriptor, key));
    if (stream?.kind !== "stream") {
      continue;
    }
    const bytes = decodeStream(
      stream.raw,
      stream.dict,
      NOOP_DIAGNOSTIC_SINK,
    ).bytes;
    if (
      bytes.length >= 3 &&
      bytes[0] === 0x01 &&
      bytes[1] === 0x00 &&
      bytes[2] === 0x04
    ) {
      return { kind: "cff" }; // a bare CFF program: header major 1, minor 0, hdrSize 4 (ISO 32000-1's /Type1C spelling)
    }
    const sfnt = parseSfnt(bytes);
    if (sfnt === undefined) {
      continue;
    }
    if (sfnt.tables.has("CFF ")) {
      return { kind: "cff" };
    }
    const head = parseHead(sfnt);
    const maxp = parseMaxp(sfnt);
    if (head === undefined || maxp === undefined) {
      continue;
    }
    const glyf = parseGlyf(sfnt, {
      numGlyphs: maxp.numGlyphs,
      indexToLocFormat: head.indexToLocFormat,
    });
    if (glyf === undefined) {
      continue;
    }
    return {
      kind: "glyf",
      sfnt,
      face: {
        composite: false,
        glyf,
        unitsPerEm: head.unitsPerEm,
        glyphIdOf: () => undefined,
      },
    };
  }
  return { kind: "absent" };
}

// Resolves one font resource's outline face, cached by the font dictionary's own object identity (font-read.ts's own caching convention: the resolver hands back the same dict object for repeated lookups, so a font referenced by many runs parses exactly once). Undefined means this run's text cannot be drawn as outlines -- a diagnostic naming why has already gone to the sink, once per font rather than once per run.
function resolveTextOutlineFace(
  fontResourceName: string,
  resources: PdfDict,
  resolver: PdfObjectResolver,
  fontResolver: FontResolverService,
  outlineFaces: Map<PdfDict, TextOutlineFace | undefined>,
  sink: PdfDiagnosticSink,
): TextOutlineFace | undefined {
  const fontsDict = resolver.resolveDict(dictGet(resources, "Font"));
  const fontDict =
    fontsDict !== undefined
      ? resolver.resolveDict(dictGet(fontsDict, fontResourceName))
      : undefined;
  if (fontDict === undefined) {
    return undefined; // an unresolvable font resource is already diagnosed inside interpretation
  }
  if (outlineFaces.has(fontDict)) {
    return outlineFaces.get(fontDict);
  }
  const face = buildTextOutlineFace(
    fontDict,
    resolver,
    fontResolver,
    fontResourceName,
    resources,
    sink,
  );
  outlineFaces.set(fontDict, face);
  return face;
}

function buildTextOutlineFace(
  fontDict: PdfDict,
  resolver: PdfObjectResolver,
  fontResolver: FontResolverService,
  fontResourceName: string,
  resources: PdfDict,
  sink: PdfDiagnosticSink,
): TextOutlineFace | undefined {
  const baseFontName = asName(dictGet(fontDict, "BaseFont"));
  const faceName =
    baseFontName ?? asName(dictGet(fontDict, "Subtype")) ?? "font";
  const unavailable = (reason: string): TextOutlineFace | undefined => {
    sink({
      code: "raster/text-outlines-unavailable",
      severity: "warning",
      message: `font resource /${fontResourceName} (${faceName}) has no drawable outline (${reason}); its text is not rendered`,
    });
    return undefined;
  };
  const cff = (): TextOutlineFace | undefined => {
    sink({
      code: "raster/text-cff-outlines",
      severity: "warning",
      message: `font resource /${fontResourceName} (${faceName}) carries CFF outlines; this raster surface fills sfnt (TrueType/glyf) outlines only, so its text is not rendered rather than approximated`,
    });
    return undefined;
  };
  const subtype = asName(dictGet(fontDict, "Subtype"));

  if (subtype === "Type0") {
    // The dominant embedded-font shape mainstream producers emit (and this package's own writer's): /Type0 + /Identity-H + /CIDFontType2 + /FontFile2, where CID == the 2-byte code and /CIDToGIDMap (usually /Identity) maps CID -> GID.
    const encoding = resolver.resolve(dictGet(fontDict, "Encoding"));
    if (encoding?.kind !== "name" || encoding.name !== "Identity-H") {
      unavailable(
        "a Type0 font whose /Encoding is not Identity-H (a predefined or embedded CMap this raster walk does not decode)",
      );
      return;
    }
    const descendants = asArray(dictGet(fontDict, "DescendantFonts"));
    const descendant =
      descendants !== undefined
        ? resolver.resolveDict(descendants[0])
        : undefined;
    if (descendant === undefined) {
      unavailable("a Type0 font with no readable /DescendantFonts entry");
      return;
    }
    const descendantSubtype = asName(dictGet(descendant, "Subtype"));
    if (descendantSubtype === "CIDFontType0") {
      cff();
      return;
    }
    if (descendantSubtype !== "CIDFontType2") {
      unavailable(
        `a descendant font of subtype ${descendantSubtype ?? "(none)"}`,
      );
      return;
    }
    const cidToGidMap = resolver.resolve(dictGet(descendant, "CIDToGIDMap"));
    const program = openEmbeddedProgram(descendant, resolver);
    if (program.kind === "cff") {
      cff();
      return;
    }
    if (program.kind === "absent") {
      unavailable("no readable /FontFile2 (or glyf-bearing /FontFile3) stream");
      return;
    }
    if (
      cidToGidMap !== undefined &&
      cidToGidMap.kind !== "name" &&
      cidToGidMap.kind !== "stream"
    ) {
      unavailable(
        "a /CIDToGIDMap that is neither /Identity nor a readable stream",
      );
      return;
    }
    if (cidToGidMap?.kind === "stream") {
      // An explicit mapping stream: 2-byte big-endian GID per CID (ISO 32000-1 9.7.4.2). CIDs past the stream's end have no entry, and a missing GID is skipped -- never drawn as glyph 0, which would paint .notdef ink the file never stated.
      const decodedBytes = decodeStream(
        cidToGidMap.raw,
        cidToGidMap.dict,
        NOOP_DIAGNOSTIC_SINK,
      ).bytes;
      const entries: number[] = [];
      for (let i = 0; i + 1 < decodedBytes.length; i += 2) {
        entries.push((decodedBytes[i]! << 8) | decodedBytes[i + 1]!);
      }
      return {
        composite: true,
        glyf: program.face.glyf,
        unitsPerEm: program.face.unitsPerEm,
        glyphIdOf: (codes, offset) => {
          const cid = (codes[offset]! << 8) | codes[offset + 1]!;
          return cid < entries.length ? entries[cid] : undefined;
        },
      };
    }
    // /Identity (or unstated, which defaults to Identity per 9.7.4.2): GID == CID.
    return {
      composite: true,
      glyf: program.face.glyf,
      unitsPerEm: program.face.unitsPerEm,
      glyphIdOf: (codes, offset) => (codes[offset]! << 8) | codes[offset + 1]!,
    };
  }

  if (subtype === "TrueType") {
    // A simple font's own program: code -> Unicode through the PDF's own full encoding precedence (the same decodeToUnicode font-read.ts implements), then Unicode -> GID through the program's own Unicode cmap subtable. Exact for the ordinary embedded TrueType programs simple fonts carry; a (3,0)-only subset whose cmap is keyed by its own codes rather than code points fails the lookup glyph-by-glyph and paints nothing, never a guessed glyph.
    const program = openEmbeddedProgram(fontDict, resolver);
    if (program.kind === "cff") {
      cff();
      return;
    }
    if (program.kind === "absent") {
      unavailable(
        "no /FontDescriptor or no readable embedded program (a standard-14 or otherwise unembedded face states no outlines at all)",
      );
      return;
    }
    const cmapLookup = buildCmapLookup(program.sfnt);
    if (cmapLookup === undefined) {
      unavailable("an embedded program with no usable Unicode cmap subtable");
      return;
    }
    return {
      composite: false,
      glyf: program.face.glyf,
      unitsPerEm: program.face.unitsPerEm,
      glyphIdOf: (codes, offset) => {
        const text = fontResolver
          .resolve(fontResourceName, resources)
          ?.decodeToUnicode(codes.subarray(offset, offset + 1));
        const codePoint = text?.codePointAt(0);
        return codePoint === undefined ? undefined : cmapLookup(codePoint);
      },
    };
  }

  if (subtype === "Type1" || subtype === "MMType1") {
    // A Type 1 program's outlines are PostScript charstrings, never sfnt glyf data (its /FontFile3 spelling, /Type1C, is CFF): openEmbeddedProgram classifies whichever program is embedded, so the diagnostic names the real reason rather than assuming.
    const program = openEmbeddedProgram(fontDict, resolver);
    if (program.kind === "cff") {
      return cff();
    }
    return unavailable(
      "a Type 1 PostScript program, whose outlines are charstrings rather than sfnt glyf data",
    );
  }

  return unavailable(
    `a font of subtype ${subtype ?? "(none)"} (a Type3 glyph-procedure font has no static outline at all)`,
  );
}

// The per-run glyph walk: re-walks the run's codes through the same glyphAdvance port the interpreter advanced the text matrix with, placing each glyph at its accumulated advance through the run's own start matrix, then draws each glyph's decoded outline as one filled path.
function drawTextRun(
  item: ExtractedTextRun,
  fontResolver: FontResolverService,
  resolver: PdfObjectResolver,
  outlineFaces: Map<PdfDict, TextOutlineFace | undefined>,
  interpretToDeviceMatrix: Matrix,
  rasteriser: PageRasteriser,
  sink: PdfDiagnosticSink,
): void {
  const face = resolveTextOutlineFace(
    item.fontResourceName,
    item.resources,
    resolver,
    fontResolver,
    outlineFaces,
    sink,
  );
  if (face === undefined) {
    return; // the diagnostic naming why has already gone to the sink
  }
  const composite = face.composite;
  // Per-glyph advances exactly as the interpreter accumulated them (same port, same fallback constants), without the Tc/Tw/Tz text-state adjustments that live inside the interpreter -- those are absorbed by the end-matrix correction below.
  const placements: {
    readonly glyphId: number | undefined;
    readonly advance: number;
  }[] = [];
  let offset = 0;
  let cumulative = 0;
  while (offset < item.codes.length) {
    const advance = fontResolver.metrics.glyphAdvance(
      item.fontResourceName,
      item.resources,
      item.codes,
      offset,
    );
    const widthPer1000 = advance?.widthPer1000 ?? FALLBACK_GLYPH_WIDTH_PER_1000;
    const byteLength = advance?.byteLengthConsumed ?? (composite ? 2 : 1);
    placements.push({
      glyphId: face.glyphIdOf(item.codes, offset),
      advance: cumulative,
    });
    // The same user-space displacement the interpreter accumulates ((w/1000) x fontSize -- interpret.ts's own tx formula without the Tc/Tw/Tz terms this walk cannot see, which the end-matrix correction below absorbs). Pre-composing a translation onto startMatrix is associatively identical to pre-composing onto the text matrix it was built from, so glyph k's matrix here is glyph k's Trm there.
    cumulative += (widthPer1000 / 1000) * item.sizePt;
    offset += byteLength;
  }

  // End-matrix correction: the interpreter's own walk included char/word spacing, horizontal scaling, and TJ adjustments this walk cannot see per glyph, so raw cumulative advances can drift from where the page actually placed the run's end. The run's start and end matrices ARE exact (interpret.ts stamps both), so the drift is corrected by scaling every glyph's advance by one uniform factor -- the ratio of the run's actual device-space extent to the raw accumulated extent. A run's total placement is therefore always exact; only the (bounded) distribution between its glyphs is approximate when spacing state was in play.
  const startDeviceMatrix = multiplyMatrices(
    item.startMatrix,
    interpretToDeviceMatrix,
  );
  const endDeviceMatrix = multiplyMatrices(
    item.endMatrix,
    interpretToDeviceMatrix,
  );
  const startPoint = applyMatrix(startDeviceMatrix, { x: 0, y: 0 });
  const endPoint = applyMatrix(endDeviceMatrix, { x: 0, y: 0 });
  const rawEndPoint = applyMatrix(startDeviceMatrix, { x: cumulative, y: 0 });
  const rawExtent = Math.hypot(
    rawEndPoint.x - startPoint.x,
    rawEndPoint.y - startPoint.y,
  );
  const actualExtent = Math.hypot(
    endPoint.x - startPoint.x,
    endPoint.y - startPoint.y,
  );
  const correction =
    rawExtent > 1e-9 && cumulative > 0 ? actualExtent / rawExtent : 1;

  const glyphScale = scaleMatrix(1 / face.unitsPerEm, 1 / face.unitsPerEm);
  for (const placement of placements) {
    if (placement.glyphId === undefined) {
      continue; // a code with no glyph in this face: no ink (the reader's own extraction diagnostics cover the mapping gap)
    }
    const outline = decodeGlyphOutline(face.glyf, placement.glyphId);
    if (outline === undefined || outline.contours.length === 0) {
      continue; // an empty glyph (a space) or an undecodable one: nothing to draw
    }
    const trm = multiplyMatrices(
      translationMatrix(placement.advance * correction, 0),
      item.startMatrix,
    );
    const glyphMatrix = multiplyMatrices(
      glyphScale,
      multiplyMatrices(trm, interpretToDeviceMatrix),
    );
    const subpaths = glyphOutlineSubpaths(outline, glyphMatrix);
    if (subpaths.length === 0) {
      continue;
    }
    rasteriser.draw({
      kind: "path",
      subpaths,
      fill: { color: item.color, fillRule: "nonzero" },
    });
  }
}

// TrueType contours to port subpaths: each contour's on/off-curve points walked into line and quadratic segments, each quadratic elevated to the exactly equivalent cubic (control points at 2/3 of the way from the on-curve ends toward the off-curve control -- the standard exact quadratic-to-cubic elevation, no approximation), then every point transformed as a point. A run of consecutive off-curve points implies an on-curve point at each neighbouring pair's midpoint, per the TrueType glyph specification's own contour convention.
function glyphOutlineSubpaths(
  outline: GlyphOutline,
  matrix: Matrix,
): readonly RasterSubpath[] {
  const subpaths: RasterSubpath[] = [];
  for (const contour of outline.contours) {
    if (contour.length < 3) {
      continue; // a degenerate contour (a stray point or pair) bounds no area and paints nothing
    }
    // Rotate so the walk starts on a real on-curve point where one exists; a contour with none at all (a pure-quad circle, say) starts at the implied midpoint of its last and first points.
    const firstOn = contour.findIndex((point) => point.onCurve);
    const contourPoints = contour.map((point) => ({
      x: point.x,
      y: point.y,
      onCurve: point.onCurve,
    }));
    const ordered: readonly { x: number; y: number; onCurve: boolean }[] =
      firstOn >= 0
        ? [...contourPoints.slice(firstOn), ...contourPoints.slice(0, firstOn)]
        : contourPoints;
    let current: { x: number; y: number } =
      firstOn >= 0
        ? { x: contourPoints[firstOn]!.x, y: contourPoints[firstOn]!.y }
        : {
            x:
              (contourPoints[contourPoints.length - 1]!.x +
                contourPoints[0]!.x) /
              2,
            y:
              (contourPoints[contourPoints.length - 1]!.y +
                contourPoints[0]!.y) /
              2,
          };
    const start = current;
    const segments: RasterPathSegment[] = [];
    let pendingOffCurve: { x: number; y: number } | undefined;
    const emitQuad = (
      from: { x: number; y: number },
      control: { x: number; y: number },
      to: { x: number; y: number },
    ): void => {
      const p0 = applyMatrix(matrix, from);
      const q = applyMatrix(matrix, control);
      const p1 = applyMatrix(matrix, to);
      segments.push({
        kind: "cubic",
        c1xPx: p0.x + (2 / 3) * (q.x - p0.x),
        c1yPx: p0.y + (2 / 3) * (q.y - p0.y),
        c2xPx: p1.x + (2 / 3) * (q.x - p1.x),
        c2yPx: p1.y + (2 / 3) * (q.y - p1.y),
        xPx: p1.x,
        yPx: p1.y,
      });
    };
    const emitLine = (to: { x: number; y: number }): void => {
      const p1 = applyMatrix(matrix, to);
      segments.push({ kind: "line", xPx: p1.x, yPx: p1.y });
    };
    for (const point of ordered) {
      if (point.onCurve) {
        if (pendingOffCurve === undefined) {
          emitLine(point);
        } else {
          emitQuad(current, pendingOffCurve, point);
        }
        current = point;
        pendingOffCurve = undefined;
      } else {
        if (pendingOffCurve !== undefined) {
          const implied = {
            x: (pendingOffCurve.x + point.x) / 2,
            y: (pendingOffCurve.y + point.y) / 2,
          };
          emitQuad(current, pendingOffCurve, implied);
          current = implied;
        }
        pendingOffCurve = point;
      }
    }
    if (pendingOffCurve !== undefined) {
      emitQuad(current, pendingOffCurve, start);
    }
    if (segments.length >= 2) {
      const startPx = applyMatrix(matrix, start);
      subpaths.push({
        startXPx: startPx.x,
        startYPx: startPx.y,
        segments,
        closed: true,
      });
    }
  }
  return subpaths;
}

// --- Read-side helpers whose read.ts originals are module-private. ---

// The %PDF- header scan readPdf performs (a junk-prefixed file is legal per ISO 32000-1 7.5.2, so a window is searched rather than offset 0 required): re-derived here because read.ts's own copy is not exported, with raster.test.ts holding the observable behaviour to the same pdf/no-header error readPdf throws for a non-PDF input.
const PDF_HEADER_BYTES = new TextEncoder().encode("%PDF-");
const HEADER_SEARCH_WINDOW = 1024;

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

interface PageBoxRect {
  readonly llx: number;
  readonly lly: number;
  readonly urx: number;
  readonly ury: number;
}

// /MediaBox, /CropBox and their kin, normalised to lower-left/upper-right corners -- read.ts's own readDeclaredPageBox, re-derived here (see the geometry comment inside renderPdfPage for why the duplication is deliberate and test-pinned).
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

// US Letter, the same malformed-file fallback read.ts applies when a page declares no /MediaBox at all even after page-tree inheritance.
const DEFAULT_PAGE_WIDTH_PT = 612;
const DEFAULT_PAGE_HEIGHT_PT = 792;

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

// The axis-aligned bounds of a page rectangle after a rotation transform -- read.ts's own rotatedRectBounds: all four corners transformed, then min/max, because a rotation that is not about the box's own corner does not preserve which corner is lower-left.
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
  resolver: PdfObjectResolver,
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
          new Uint8Array([0x0a]),
        );
      }
    }
    return concatBytes(chunks);
  }
  return new Uint8Array(0);
}
