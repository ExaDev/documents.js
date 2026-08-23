import type { Box, ContentDocument, ContentDrawPage, ContentPathPoint, ContentVector, PageSize } from 'document-schema.js';
import { flipY } from '../model/geometry';
import { mergeByPaintOrder } from '../model/paint-order';
import type { Point, TextMeasurer } from 'document-schema.js';
import { rotatePointAboutCenter } from '../model/geometry';
import { convertShape } from './slides';
import { layoutDocumentOf, packagePagesOf, stampFrame } from './shared';
import type { LayoutDocument, LayoutImageAsset, LayoutItem, LayoutPage, LayoutPathSegment, LayoutSubpath } from 'pdf-codec';

export interface DrawingLayoutResult {
  readonly document: LayoutDocument;
  // The DocumentTree's own pages array (each rendered page's size, indexed to match every content node's own frames[].pageIndex) -- the input `doc` argument itself comes back with frames stamped in place, which together with this array is the fused unified DocumentTree a conversion reports through onDocument.
  readonly pages: readonly PageSize[];
}

// The axis-aligned PDF-space bounding box of one emitted vector item, the geometry a content node's own frame records for it. An unrotated rect/ellipse is its own box exactly; a rotated vector (emitted as a path) and a freeform path bound by the tight hull of all their points INCLUDING cubic controls -- the identical hull convention reconstruct.ts's own pathBoundingFrame documents (a cubic lies within the convex hull of its control points, so the frame contains the rendered curve).
function boundsOfPoints(points: readonly Point[]): Box {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY };
}

function vectorItemBounds(item: Extract<LayoutItem, { kind: 'rect' | 'ellipse' | 'line' | 'path' }>): Box {
  if (item.kind === 'rect' || item.kind === 'ellipse') {
    return { xPt: item.xPt, yPt: item.yPt, widthPt: item.widthPt, heightPt: item.heightPt };
  }
  if (item.kind === 'line') {
    return boundsOfPoints([{ x: item.x1Pt, y: item.y1Pt }, { x: item.x2Pt, y: item.y2Pt }]);
  }
  const points: Point[] = [];
  for (const subpath of item.subpaths) {
    points.push({ x: subpath.startXPt, y: subpath.startYPt });
    for (const segment of subpath.segments) {
      if (segment.kind === 'cubic') {
        points.push({ x: segment.c1xPt, y: segment.c1yPt });
        points.push({ x: segment.c2xPt, y: segment.c2yPt });
      }
      points.push({ x: segment.xPt, y: segment.yPt });
    }
  }
  return boundsOfPoints(points);
}

// Emits the vector's item(s) and stamps the vector node's own frame from the item that was emitted -- one frame per vector per page, at the exact placement the item carries (rotation already resolved into the geometry for rotated kinds).
function emitVector(vector: ContentVector, pageIndex: number, pageHeightPt: number, out: LayoutItem[]): void {
  const before = out.length;
  convertVector(vector, pageHeightPt, out);
  const emitted = out.length > before ? out[out.length - 1] : undefined;
  if (emitted !== undefined && (emitted.kind === 'rect' || emitted.kind === 'ellipse' || emitted.kind === 'line' || emitted.kind === 'path')) {
    stampFrame(vector, pageIndex, vectorItemBounds(emitted));
  }
}

// ContentDocument (the drawing variant, odf.js's .odg target) -> LayoutDocument: structurally the same shape as slides.ts's own pptx/odp direction (one ContentDrawPage per PDF page, direct placement, no pagination), extended with one new emission path -- ContentVector, the vector-primitive vocabulary a drawing carries that a slide typically doesn't. rect/ellipse/line vectors map onto the LayoutRect/LayoutEllipse/LayoutLine kinds documents.js already had before this module existed; 'path' is the one genuinely new LayoutItem kind (document-schema.js's LayoutPathSchema), constructed here as a plain value -- writePath (pdf-codec's content-write.ts) is what later turns that value into PDF content-stream operators, a separate, downstream concern from building it. ContentShape content (draw:frame text/image/table, and salvaged custom-shape text) reuses convertShape verbatim from slides.ts, which is what makes odg free-riding on odp's/pptx's own already-correct paragraph flow, image placement, and table layout, not a second reimplementation of any of it.
//
// PAINT ORDER: ContentDrawPageSchema (document-schema.js's content.ts) still keeps `shapes` and `vectors` as two separate arrays, but both ContentVector and ContentShape now carry a shared `paintOrder` -- one monotonically increasing per-page document index odf.js's own reader stamps on every element it walks (typed/draw/shapes.ts's walkDrawPageContent/paintOrderKey, honouring a real draw:z-index when a producer wrote one, falling back to document position otherwise). convertPage merges the two arrays back into one true-paint-order walk through that field (src/model/paint-order.ts), so a page that genuinely interleaves the two mid-stack -- a text label between two rectangles, a rectangle over a picture -- paints in the order its author actually built it. This replaces the fixed "every vector first, every shape after" choice this module used to make when the schema had no shared ordering field at all; that order survives only as the documented fallback for a page missing paintOrder anywhere (see mergeByPaintOrder's own note).

export interface DrawingLayoutOptions {
  readonly measurer: TextMeasurer;
}

type DrawingContentDocument = Extract<ContentDocument, { kind: 'drawing' }>;
type RectVector = Extract<ContentVector, { kind: 'rect' }>;
type EllipseVector = Extract<ContentVector, { kind: 'ellipse' }>;
type LineVector = Extract<ContentVector, { kind: 'line' }>;
type PathVector = Extract<ContentVector, { kind: 'path' }>;

// ROTATION, and why a rotated vector becomes a LayoutPath rather than a rotated LayoutRect/LayoutEllipse: LayoutRectSchema and LayoutEllipseSchema (document-schema.js's layout.ts) carry no rotation field at all -- only LayoutText and LayoutImage do, because pdf-codec's own content-write.ts rotates those two by emitting a text/image transformation matrix, a mechanism a path-painting operator sequence has no equivalent of. Rather than widen the shared layout schema for it, a rotated vector is resolved HERE into the one layout kind that can already express arbitrary rotated geometry exactly: a LayoutPath whose own points are the shape's own corners/curve controls after rotation. Nothing is approximated by this -- an affine rotation maps a straight edge to a straight edge and a cubic Bezier to a cubic Bezier exactly -- so a rotated rect is a genuine four-point closed subpath and a rotated ellipse is its own four cubics rotated, not a polygon stand-in for either.
//
// The rotation itself reuses pdf-codec's rotatePointAboutCenter, in PDF space, about the FLIPPED frame's own centre, with the same `-rotationDeg` clockwise-to-counter-clockwise negation src/layout/slides.ts's own shapePlacement already applies (see that function's comment for how the two conventions were reconciled) -- so a rotated vector and a rotated shape on the same page rotate identically rather than through two independently-derived rotation conventions.
function isRotated(rotationDeg: number | undefined): rotationDeg is number {
  return rotationDeg !== undefined && rotationDeg !== 0;
}

function boxCenter(box: Box): Point {
  return { x: box.xPt + box.widthPt / 2, y: box.yPt + box.heightPt / 2 };
}

function rotator(flipped: Box, rotationDeg: number): (point: Point) => Point {
  const center = boxCenter(flipped);
  const ccwDeg = -rotationDeg;
  return (point) => rotatePointAboutCenter(point, center, ccwDeg);
}

// The four corners of a PDF-space box, in the order a closed subpath walks them: bottom-left, bottom-right, top-right, top-left.
function boxCorners(box: Box): Point[] {
  return [
    { x: box.xPt, y: box.yPt },
    { x: box.xPt + box.widthPt, y: box.yPt },
    { x: box.xPt + box.widthPt, y: box.yPt + box.heightPt },
    { x: box.xPt, y: box.yPt + box.heightPt },
  ];
}

function convertRectVector(vector: RectVector, pageHeightPt: number, out: LayoutItem[]): void {
  const flipped = flipY(vector.frame, pageHeightPt);
  if (!isRotated(vector.rotationDeg)) {
    out.push({ kind: 'rect', xPt: flipped.xPt, yPt: flipped.yPt, widthPt: flipped.widthPt, heightPt: flipped.heightPt, fill: vector.fill, stroke: vector.stroke, sourcePath: vector.sourcePath });
    return;
  }
  const rotate = rotator(flipped, vector.rotationDeg);
  const [start, ...rest] = boxCorners(flipped).map(rotate);
  const subpath: LayoutSubpath = {
    startXPt: start!.x,
    startYPt: start!.y,
    closed: true,
    segments: rest.map((corner) => ({ kind: 'line' as const, xPt: corner.x, yPt: corner.y })),
  };
  out.push({ kind: 'path', subpaths: [subpath], fill: vector.fill, stroke: vector.stroke, sourcePath: vector.sourcePath });
}

// The circle-to-cubic control-point ratio: the distance, as a fraction of the radius, from an axis endpoint to its own adjacent Bezier control point that makes a single cubic segment best approximate a quarter arc. Derived, not a transcribed literal -- 4/3 * (sqrt(2) - 1) is the exact value obtained by forcing the cubic through the quarter arc's own 45-degree midpoint.
const CIRCLE_CUBIC_RATIO = (4 / 3) * (Math.SQRT2 - 1);

// One ellipse as four cubic quarter-arcs, walked counter-clockwise from the rightmost axis point -- the same four-arc construction pdf-codec's own writeEllipse emits for an unrotated LayoutEllipse, restated here in explicit point form so every one of its control points can be run through the rotation before being written out.
function ellipseCubicPoints(flipped: Box): { readonly start: Point; readonly arcs: readonly { readonly c1: Point; readonly c2: Point; readonly to: Point }[] } {
  const cx = flipped.xPt + flipped.widthPt / 2;
  const cy = flipped.yPt + flipped.heightPt / 2;
  const rx = flipped.widthPt / 2;
  const ry = flipped.heightPt / 2;
  const kx = rx * CIRCLE_CUBIC_RATIO;
  const ky = ry * CIRCLE_CUBIC_RATIO;
  return {
    start: { x: cx + rx, y: cy },
    arcs: [
      { c1: { x: cx + rx, y: cy + ky }, c2: { x: cx + kx, y: cy + ry }, to: { x: cx, y: cy + ry } },
      { c1: { x: cx - kx, y: cy + ry }, c2: { x: cx - rx, y: cy + ky }, to: { x: cx - rx, y: cy } },
      { c1: { x: cx - rx, y: cy - ky }, c2: { x: cx - kx, y: cy - ry }, to: { x: cx, y: cy - ry } },
      { c1: { x: cx + kx, y: cy - ry }, c2: { x: cx + rx, y: cy - ky }, to: { x: cx + rx, y: cy } },
    ],
  };
}

function convertEllipseVector(vector: EllipseVector, pageHeightPt: number, out: LayoutItem[]): void {
  const flipped = flipY(vector.frame, pageHeightPt);
  if (!isRotated(vector.rotationDeg)) {
    out.push({ kind: 'ellipse', xPt: flipped.xPt, yPt: flipped.yPt, widthPt: flipped.widthPt, heightPt: flipped.heightPt, fill: vector.fill, stroke: vector.stroke, sourcePath: vector.sourcePath });
    return;
  }
  const rotate = rotator(flipped, vector.rotationDeg);
  const { start, arcs } = ellipseCubicPoints(flipped);
  const rotatedStart = rotate(start);
  const segments: LayoutPathSegment[] = arcs.map((arc) => {
    const c1 = rotate(arc.c1);
    const c2 = rotate(arc.c2);
    const to = rotate(arc.to);
    return { kind: 'cubic' as const, c1xPt: c1.x, c1yPt: c1.y, c2xPt: c2.x, c2yPt: c2.y, xPt: to.x, yPt: to.y };
  });
  // closed: true even though the four arcs already return exactly to their own start -- see the README's own writeEllipse gotcha: readPdf only marks a subpath closed when it sees a real `h` operator, and an ODF/SVG consumer refuses to fill an unclosed path.
  out.push({ kind: 'path', subpaths: [{ startXPt: rotatedStart.x, startYPt: rotatedStart.y, closed: true, segments }], fill: vector.fill, stroke: vector.stroke, sourcePath: vector.sourcePath });
}

function convertLineVector(vector: LineVector, pageHeightPt: number, out: LayoutItem[]): void {
  out.push({
    kind: 'line',
    x1Pt: vector.from.xPt,
    y1Pt: pageHeightPt - vector.from.yPt,
    x2Pt: vector.to.xPt,
    y2Pt: pageHeightPt - vector.to.yPt,
    color: vector.stroke.color,
    widthPt: vector.stroke.widthPt,
    sourcePath: vector.sourcePath,
  });
}

// A path's own subpath/segment points are in the path's LOCAL coordinate space -- top-left origin, y down, sized to frame.widthPt x frame.heightPt (ContentVectorSchema's own 'path' variant contract, document-schema.js's content.ts) -- distinct from frame's own PAGE-space placement. Resolving one point to absolute PDF user space is therefore two steps in one: add the frame's own offset (placing the local point into page-space, still y-down), then flip that page-space y-down point into PDF's bottom-left/y-up space -- the same flipY math LayoutRect/LayoutEllipse use above, just applied to a bare point rather than a whole box.
function placePathPoint(frame: Box, point: ContentPathPoint, pageHeightPt: number): { readonly xPt: number; readonly yPt: number } {
  return { xPt: frame.xPt + point.xPt, yPt: pageHeightPt - frame.yPt - point.yPt };
}

// A rotated path needs no separate emission branch the way a rotated rect/ellipse does -- it was already becoming a LayoutPath regardless -- so rotation is folded straight into the same per-point placement step, applied after placePathPoint has resolved each point into PDF space and about the same flipped-frame centre every other rotated vector kind uses.
function convertPathVector(vector: PathVector, pageHeightPt: number, out: LayoutItem[]): void {
  const rotate = isRotated(vector.rotationDeg) ? rotator(flipY(vector.frame, pageHeightPt), vector.rotationDeg) : undefined;
  const place = (point: ContentPathPoint): { readonly xPt: number; readonly yPt: number } => {
    const placed = placePathPoint(vector.frame, point, pageHeightPt);
    if (rotate === undefined) {
      return placed;
    }
    const rotated = rotate({ x: placed.xPt, y: placed.yPt });
    return { xPt: rotated.x, yPt: rotated.y };
  };
  const subpaths: LayoutSubpath[] = vector.subpaths.map((subpath) => {
    const start = place(subpath.start);
    return {
      startXPt: start.xPt,
      startYPt: start.yPt,
      closed: subpath.closed,
      segments: subpath.segments.map((segment) => {
        if (segment.kind === 'line') {
          const to = place(segment.to);
          return { kind: 'line' as const, xPt: to.xPt, yPt: to.yPt };
        }
        const control1 = place(segment.control1);
        const control2 = place(segment.control2);
        const to = place(segment.to);
        return { kind: 'cubic' as const, c1xPt: control1.xPt, c1yPt: control1.yPt, c2xPt: control2.xPt, c2yPt: control2.yPt, xPt: to.xPt, yPt: to.yPt };
      }),
    };
  });
  out.push({ kind: 'path', subpaths, fill: vector.fill, fillRule: vector.fillRule, stroke: vector.stroke, sourcePath: vector.sourcePath });
}

// Exported for reuse by src/convert/from-package.ts's frames-to-layout inverse: re-running the ONE vector-to-item conversion (against a package's own recorded page height) is what keeps a rebuilt LayoutDocument's vector geometry identical to what a fresh layout pass would emit, rather than a second, drifting reimplementation of the same placements.
export function convertVector(vector: ContentVector, pageHeightPt: number, out: LayoutItem[]): void {
  if (vector.kind === 'rect') {
    convertRectVector(vector, pageHeightPt, out);
  } else if (vector.kind === 'ellipse') {
    convertEllipseVector(vector, pageHeightPt, out);
  } else if (vector.kind === 'line') {
    convertLineVector(vector, pageHeightPt, out);
  } else {
    convertPathVector(vector, pageHeightPt, out);
  }
}

function convertPage(page: ContentDrawPage, pageIndex: number, measurer: TextMeasurer, images: Record<string, LayoutImageAsset>): LayoutPage {
  const items: LayoutItem[] = [];
  // One merged walk in true paint order, rather than the two sequential arrays the page stores them in -- see src/model/paint-order.ts for how the merge resolves, and for what a page missing the field anywhere falls back to.
  for (const entry of mergeByPaintOrder(page.vectors, page.shapes)) {
    if (entry.kind === 'vector') {
      emitVector(entry.value, pageIndex, page.size.heightPt, items);
    } else {
      convertShape(entry.value, page.size.heightPt, pageIndex, measurer, images, items);
    }
  }
  return { widthPt: page.size.widthPt, heightPt: page.size.heightPt, items };
}

// BREAKING (documents.js 2.0.0): returns a DrawingLayoutResult ({ document, pages }) rather than a bare LayoutDocument, matching the shape the other three engines already return -- the pages half of the fused DocumentTree, alongside the frames stamped in place on `doc`'s own nodes.
export function convertDrawingToLayout(doc: DrawingContentDocument, options: DrawingLayoutOptions): DrawingLayoutResult {
  const images: Record<string, LayoutImageAsset> = {};
  const pages = doc.pages.map((page, pageIndex) => convertPage(page, pageIndex, options.measurer, images));
  // `doc` itself now carries every placement this pass computed, stamped in place on its own nodes (frames); the returned pages array plus that mutated content is the fused unified DocumentTree a conversion reports through onDocument.
  return { document: layoutDocumentOf(doc.metadata, pages, images), pages: packagePagesOf(pages) };
}
