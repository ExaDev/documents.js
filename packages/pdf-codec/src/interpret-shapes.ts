// The characteristic-shape detection family, split from interpret.ts: tolerance helpers, polygon-corner and rect/ellipse detection from Bezier subpaths, stroke-style recovery, and classifyShape deciding which Extracted* family a painted path belongs to.
import type { ContentStrokeStyle, Point } from "document-schema.js";
import { BEZIER_KAPPA } from "./matrix";
import type {
  MarkedContentProps,
  ExtractedEllipse,
  ExtractedLine,
  ExtractedPaint,
  ExtractedRect,
  ExtractedSubpath,
} from "./interpret";
// Every coordinate reaching these detectors has been through PDF's own number formatting (serialize.ts's formatNumber rounds to 4 decimal places), so it carries up to 5e-5pt of quantisation error before any geometry is derived from it. The absolute floor is twenty times that — still three orders of magnitude below any real output device's resolution — and the relative term scales it with the shape's own size, which is what lets a large ellipse from a producer that rounded its kappa constant to fewer digits than BEZIER_KAPPA (0.5523, say) still match.
const SHAPE_ABS_TOLERANCE_PT = 1e-3;
const SHAPE_REL_TOLERANCE = 1e-4;

export function shapeTolerance(extentPt: number): number {
  return Math.max(
    SHAPE_ABS_TOLERANCE_PT,
    Math.abs(extentPt) * SHAPE_REL_TOLERANCE,
  );
}

export function nearlyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function nearlyEqualPoints(
  a: Point,
  b: Point,
  tolerance: number,
): boolean {
  return nearlyEqual(a.x, b.x, tolerance) && nearlyEqual(a.y, b.y, tolerance);
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function boundsOf(points: readonly Point[]): Bounds {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

// A closed subpath's corner points, when every one of its segments is a straight line. A producer may close a polygon either by relying on `h` alone (ISO 32000-1's own `re` expansion does exactly this, emitting three `l` segments for four corners) or by drawing the closing edge explicitly and then closing anyway — the redundant final point is dropped here so both spellings yield the same corner list.
export function closedPolygonCorners(
  subpath: ExtractedSubpath,
): Point[] | undefined {
  if (!subpath.closed) {
    return undefined;
  }
  const corners: Point[] = [{ x: subpath.startXPt, y: subpath.startYPt }];
  for (const segment of subpath.segments) {
    if (segment.kind !== "line") {
      return undefined;
    }
    corners.push({ x: segment.xPt, y: segment.yPt });
  }
  const first = corners[0];
  const last = corners[corners.length - 1];
  if (first === undefined || last === undefined || corners.length < 2) {
    return undefined;
  }
  const bounds = boundsOf(corners);
  const tolerance = shapeTolerance(
    Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY),
  );
  if (nearlyEqualPoints(first, last, tolerance)) {
    corners.pop();
  }
  return corners;
}

// A single closed four-corner straight-line subpath is an axis-aligned rectangle exactly when every corner sits on both an x extreme and a y extreme AND every edge moves along exactly one axis. The second condition is what rejects a bowtie — four points that individually sit on the right extremes but are traversed in an order that crosses the middle — which the first alone would happily accept. Both winding directions and either starting corner satisfy this equally, so no normalisation is needed.
// A closed four-corner straight-line subpath, per the detectRect comment above.
const RECTANGLE_CORNER_COUNT = 4;

export function detectRect(
  subpath: ExtractedSubpath,
  paint: ExtractedPaint,
): ExtractedRect | undefined {
  const corners = closedPolygonCorners(subpath);
  if (corners?.length !== RECTANGLE_CORNER_COUNT) {
    return undefined;
  }
  const { minX, minY, maxX, maxY } = boundsOf(corners);
  const widthPt = maxX - minX;
  const heightPt = maxY - minY;
  const tolX = shapeTolerance(widthPt);
  const tolY = shapeTolerance(heightPt);
  // A degenerate zero-extent "rectangle" is geometrically a line or a point, so it stays a general path rather than being reported as a rect with a zero side.
  if (widthPt <= tolX || heightPt <= tolY) {
    return undefined;
  }
  for (const corner of corners) {
    if (
      !nearlyEqual(corner.x, minX, tolX) &&
      !nearlyEqual(corner.x, maxX, tolX)
    ) {
      return undefined;
    }
    if (
      !nearlyEqual(corner.y, minY, tolY) &&
      !nearlyEqual(corner.y, maxY, tolY)
    ) {
      return undefined;
    }
  }
  for (let i = 0; i < corners.length; i += 1) {
    const from = corners[i];
    const to = corners[(i + 1) % corners.length];
    if (from === undefined || to === undefined) {
      return undefined;
    }
    const sameX = nearlyEqual(from.x, to.x, tolX);
    const sameY = nearlyEqual(from.y, to.y, tolY);
    if (sameX === sameY) {
      return undefined; // both: a duplicated corner; neither: a diagonal edge. Either way it is not a rectangle traversed edge by edge.
    }
  }
  return {
    kind: "rect",
    xPt: minX,
    yPt: minY,
    widthPt,
    heightPt,
    fill: paint.fill,
    stroke: paint.stroke,
  };
}

// Which cardinal extreme of its own bounding box an ellipse's on-curve point sits at. Every quadrant arc of the four-Bezier construction runs from one horizontal extreme to one vertical extreme (or back), so classifying each on-curve point this way is what lets the control-point check below be written once, direction-agnostically.
type CardinalExtreme = "right" | "top" | "left" | "bottom";

export function cardinalExtremeOf(
  point: Point,
  center: Point,
  rx: number,
  ry: number,
  tolX: number,
  tolY: number,
): CardinalExtreme | undefined {
  if (nearlyEqual(point.y, center.y, tolY)) {
    if (nearlyEqual(point.x, center.x + rx, tolX)) {
      return "right";
    }
    if (nearlyEqual(point.x, center.x - rx, tolX)) {
      return "left";
    }
    return undefined;
  }
  if (nearlyEqual(point.x, center.x, tolX)) {
    if (nearlyEqual(point.y, center.y + ry, tolY)) {
      return "top";
    }
    if (nearlyEqual(point.y, center.y - ry, tolY)) {
      return "bottom";
    }
  }
  return undefined;
}

// The control point an arc places next to a horizontal extreme lies directly above or below that extreme, kappa*ry along the vertical direction the arc is heading in; the one next to a vertical extreme lies kappa*rx horizontally beside it. That single rule, applied to whichever end of the arc is which, covers all four quadrants in both winding directions with no per-quadrant table.
export function expectedEllipseControl(
  atExtreme: Point,
  atExtremeKind: CardinalExtreme,
  otherEnd: Point,
  center: Point,
  kx: number,
  ky: number,
): Point {
  if (atExtremeKind === "right" || atExtremeKind === "left") {
    return {
      x: atExtreme.x,
      y: center.y + Math.sign(otherEnd.y - center.y) * ky,
    };
  }
  return {
    x: center.x + Math.sign(otherEnd.x - center.x) * kx,
    y: atExtreme.y,
  };
}

// A closed subpath of exactly four cubic segments whose on-curve points are the four cardinal extremes of its bounding box, and whose eight control points all sit at the kappa offset those extremes imply, is the four-quadrant Bezier ellipse — the only way an axis-aligned ellipse is ever expressible in PDF. A rotated ellipse deliberately does not match: its on-curve points are no longer at its bounding box's cardinal extremes, and document-schema.js's LayoutEllipse carries no rotation to report one with, so leaving it as a general path is the honest outcome rather than a silently unrotated ellipse.
// A four-quadrant Bezier ellipse (per the detectEllipse comment above) always has exactly four cubic segments, four cardinal on-curve extremes, and four control-point pairs.
const ELLIPSE_SEGMENT_COUNT = 4;

export function detectEllipse(
  subpath: ExtractedSubpath,
  paint: ExtractedPaint,
): ExtractedEllipse | undefined {
  const segments = subpath.segments;
  if (
    !subpath.closed ||
    segments.length !== ELLIPSE_SEGMENT_COUNT ||
    segments.some((segment) => segment.kind !== "cubic")
  ) {
    return undefined;
  }
  const start: Point = { x: subpath.startXPt, y: subpath.startYPt };
  const onCurve: Point[] = [start];
  for (const segment of segments.slice(0, ELLIPSE_SEGMENT_COUNT - 1)) {
    onCurve.push({ x: segment.xPt, y: segment.yPt });
  }
  const { minX, minY, maxX, maxY } = boundsOf(onCurve);
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  const center: Point = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const tolX = shapeTolerance(rx);
  const tolY = shapeTolerance(ry);
  if (rx <= tolX || ry <= tolY) {
    return undefined;
  }
  // The fourth arc must land back on the starting point; `closed` alone would let a subpath that ends elsewhere be closed by an implicit straight edge, which is a five-sided shape, not an ellipse.
  const finalSegment = segments[3];
  if (
    finalSegment === undefined ||
    !nearlyEqualPoints(
      { x: finalSegment.xPt, y: finalSegment.yPt },
      start,
      Math.max(tolX, tolY),
    )
  ) {
    return undefined;
  }
  const extremes = onCurve.map((point) =>
    cardinalExtremeOf(point, center, rx, ry, tolX, tolY),
  );
  if (
    extremes.some((extreme) => extreme === undefined) ||
    new Set(extremes).size !== ELLIPSE_SEGMENT_COUNT
  ) {
    return undefined;
  }
  const kx = rx * BEZIER_KAPPA;
  const ky = ry * BEZIER_KAPPA;
  const controlTolerance = Math.max(tolX, tolY);
  for (let i = 0; i < ELLIPSE_SEGMENT_COUNT; i += 1) {
    const segment = segments[i];
    const from = onCurve[i];
    const fromKind = extremes[i];
    const to = onCurve[(i + 1) % ELLIPSE_SEGMENT_COUNT];
    const toKind = extremes[(i + 1) % ELLIPSE_SEGMENT_COUNT];
    if (
      segment?.kind !== "cubic" ||
      from === undefined ||
      to === undefined ||
      fromKind === undefined ||
      toKind === undefined
    ) {
      return undefined;
    }
    const expectedC1 = expectedEllipseControl(
      from,
      fromKind,
      to,
      center,
      kx,
      ky,
    );
    const expectedC2 = expectedEllipseControl(to, toKind, from, center, kx, ky);
    if (
      !nearlyEqualPoints(
        { x: segment.c1xPt, y: segment.c1yPt },
        expectedC1,
        controlTolerance,
      )
    ) {
      return undefined;
    }
    if (
      !nearlyEqualPoints(
        { x: segment.c2xPt, y: segment.c2yPt },
        expectedC2,
        controlTolerance,
      )
    ) {
      return undefined;
    }
  }
  return {
    kind: "ellipse",
    xPt: minX,
    yPt: minY,
    widthPt: maxX - minX,
    heightPt: maxY - minY,
    fill: paint.fill,
    stroke: paint.stroke,
  };
}

// An open subpath of exactly one straight segment, stroked and not filled, is a line — the only shape a `m ... l S` sequence can be. A fill disqualifies it because a two-point path encloses no area, so a producer that filled one meant something this detector should not guess at.
// The inverse of content-write.ts's writeStrokeStyleState: that module emits a two-element dash array for both styles it writes — a nonzero on-length ('dashed', `[3w 3w] 0 d`) or a zero on-length under a round cap ('dotted', `[0 2w] 0 d`) — so the on-length alone (present or zero) is what distinguishes them on the way back in, and any other non-empty dash array a third-party producer wrote collapses to 'dashed', the closer of the two words this package's ContentStrokeStyleSchema models. An empty array (the PDF default, and what resetStrokeStyleState restores after a styled stroke) reads back as 'solid', i.e. the field left absent — matching ContentStrokeStyleSchema's own documented default.
export function strokeStyleFromDashArray(
  dashArray: readonly number[],
): ContentStrokeStyle | undefined {
  if (dashArray.length === 0) {
    return undefined;
  }
  return dashArray.length === 2 && dashArray[0] === 0 ? "dotted" : "dashed";
}

export function detectLine(
  subpath: ExtractedSubpath,
  paint: ExtractedPaint,
  style: ContentStrokeStyle | undefined,
): ExtractedLine | undefined {
  const segment = subpath.segments[0];
  if (
    subpath.closed ||
    subpath.segments.length !== 1 ||
    segment?.kind !== "line"
  ) {
    return undefined;
  }
  if (paint.fill !== undefined || paint.stroke === undefined) {
    return undefined;
  }
  return {
    kind: "line",
    x1Pt: subpath.startXPt,
    y1Pt: subpath.startYPt,
    x2Pt: segment.xPt,
    y2Pt: segment.yPt,
    color: paint.stroke.color,
    widthPt: paint.stroke.widthPt,
    ...(style !== undefined ? { style } : {}),
  };
}

// The three detections are mutually exclusive by construction (rect needs all-line closed, ellipse all-cubic closed, line a single open segment), so the order below is cheapest-first rather than a priority. Only a single-subpath path is ever considered: a multi-subpath path is a compound shape — a hole construction, a glyph outline, a diagram drawn in one go — which no single LayoutRect/LayoutEllipse/LayoutLine can represent without losing part of it.
export function classifyShape(
  subpaths: readonly ExtractedSubpath[],
  paint: ExtractedPaint,
  style: ContentStrokeStyle | undefined,
): ExtractedRect | ExtractedEllipse | ExtractedLine | undefined {
  const subpath = subpaths[0];
  if (subpaths.length !== 1 || subpath === undefined) {
    return undefined;
  }
  return (
    detectRect(subpath, paint) ??
    detectEllipse(subpath, paint) ??
    detectLine(subpath, paint, style)
  );
}

// The marked-content spans open at a point in a content stream. A class rather than a bare array because a stream pushes and pops it as it runs, and because an invoked form XObject starts from its own seeded copy rather than sharing the enclosing stream's.
export class MarkedContentStack {
  readonly #frames: MarkedContentProps[];

  constructor(seed: readonly MarkedContentProps[] = []) {
    this.#frames = [...seed];
  }

  open(frame: MarkedContentProps): void {
    this.#frames.push(frame);
  }

  close(): void {
    this.#frames.pop();
  }

  // The innermost span that states the property: a frame carrying the key at all ends the search, including one that explicitly voids it, like a form-stream MCID opened as `mcid: undefined`, while a span that simply lacks the key falls through to the enclosing one (ISO 32000-1 14.10's nested-span model).
  inScope<K extends keyof MarkedContentProps>(
    key: K,
  ): MarkedContentProps[K] | undefined {
    for (let i = this.#frames.length - 1; i >= 0; i--) {
      const frame = this.#frames[i];
      if (frame !== undefined && key in frame) {
        return frame[key];
      }
    }
    return undefined;
  }
}
