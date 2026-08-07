import { COLOR_BLACK, type Color as LayoutColor, type Point } from 'document-schema.js';
import { decodeStream } from './filters';
import type { Matrix } from './matrix';
import { BEZIER_KAPPA, IDENTITY_MATRIX, applyMatrix, multiplyMatrices, translationMatrix } from './matrix';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asName, asNumber, dictGet } from './objects';
import { readContentStream } from './content-read';
import type { PdfDiagnosticSink } from './diagnostics';

// The graphics/text state machine: walks a page's (or a recursed form XObject's) content-stream operations, tracking exactly the state v1 needs to recover -- CTM, fill/stroke colour, line width, and text position/font/size -- and emits one ExtractedItem per meaningful paint operation. Everything else (clipping, shadings, patterns) is deliberately not modelled; see the implementation plan's v1 scope for the reasoning. General path construction (m/l/c/v/y/h/re) and stroking ARE modelled, recovered as ExtractedPath below -- or, when the recovered geometry matches one of the three characteristic simple-shape patterns classifyShape recognises, as the more specific ExtractedRect/ExtractedEllipse/ExtractedLine instead.

export interface ExtractedTextRun {
  readonly kind: 'text';
  readonly codes: Uint8Array<ArrayBuffer>; // raw show-string bytes, undecoded -- font-read.ts/cmap.ts turn these into Unicode
  readonly fontResourceName: string;
  readonly resources: PdfDict;
  readonly startMatrix: Matrix; // the text rendering matrix (Trm) at the run's first glyph
  readonly endMatrix: Matrix; // Trm at the position the *next* glyph would start -- lets a caller derive the run's on-page width as the device-space distance between the two baseline points, with no separate unit bookkeeping
  readonly sizePt: number;
  readonly color: LayoutColor;
}

// The paint a recovered shape carries, shared by every extracted item that can be filled and/or stroked. At least one of the two is always set: `n` (the clip-only, paints-nothing operator) never emits an item at all, and every other path-painting operator fills, strokes, or does both.
export interface ExtractedPaint {
  readonly fill: LayoutColor | undefined;
  readonly stroke: { readonly color: LayoutColor; readonly widthPt: number } | undefined;
}

// An axis-aligned rectangle, recovered from a single closed four-corner all-straight-line subpath under any CTM that leaves those corners axis-aligned -- so a bare `re` under a non-rotated CTM (by far the common case), a `re` under a 90-degree-multiple rotation (a rotated rectangle is still a rectangle), and a hand-constructed m/l/l/l/h rectangle all reach it, with any combination of fill and stroke. Anything else (a non-90-degree rotation, curves, multiple subpaths) falls through to ExtractedPath below instead.
export interface ExtractedRect extends ExtractedPaint {
  readonly kind: 'rect';
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

// An axis-aligned ellipse, recovered from the four-cubic-Bezier-quadrant construction every ellipse-as-Beziers writer emits (this package's own content-write.ts writeEllipse included) -- see detectEllipse for the exact pattern matched and the honest false-positive caveat. Geometry is the ellipse's bounding box, matching ExtractedRect's own convention and document-schema.js's LayoutEllipse.
export interface ExtractedEllipse extends ExtractedPaint {
  readonly kind: 'ellipse';
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

// A single straight stroked segment, recovered from an open one-line-segment stroke-only subpath. No fill variant exists because a filled two-point path encloses no area and paints nothing -- a fill on this shape would be a producer error, not a line.
export interface ExtractedLine {
  readonly kind: 'line';
  readonly x1Pt: number;
  readonly y1Pt: number;
  readonly x2Pt: number;
  readonly y2Pt: number;
  readonly color: LayoutColor;
  readonly widthPt: number;
}

// One line or cubic-Bezier segment of a subpath, device-space (CTM-applied, not yet page-matrix-applied -- matching ExtractedRect's own convention), mirroring document-schema.js's LayoutPathSegment shape exactly so read.ts's conversion is a pure per-point transform.
export type ExtractedPathSegment =
  | { readonly kind: 'line'; readonly xPt: number; readonly yPt: number }
  | { readonly kind: 'cubic'; readonly c1xPt: number; readonly c1yPt: number; readonly c2xPt: number; readonly c2yPt: number; readonly xPt: number; readonly yPt: number };

export interface ExtractedSubpath {
  readonly startXPt: number;
  readonly startYPt: number;
  readonly segments: readonly ExtractedPathSegment[];
  readonly closed: boolean;
}

// General vector-path recovery: anything painted by a path-construction sequence too general for the three characteristic-shape detections above -- a skewed or non-90-degree-rotated CTM, an arbitrary curve, a polygon that isn't a rectangle, multiple subpaths, or a `re` mixed with other path operators in the same sequence. `fillRule` always reflects which paint operator actually ran (nonzero for the plain family, evenodd for the starred family) even when `fill` is undefined, since it costs nothing to record accurately here; read.ts's convertPath is the layer that decides whether it's worth keeping in the minimal LayoutPath it builds.
export interface ExtractedPath extends ExtractedPaint {
  readonly kind: 'path';
  readonly subpaths: readonly ExtractedSubpath[];
  readonly fillRule: 'nonzero' | 'evenodd';
}

export interface ExtractedImage {
  readonly kind: 'image';
  readonly resourceName: string;
  readonly resources: PdfDict;
  readonly matrix: Matrix; // the CTM at the moment of Do -- placement is x=ctm[4], y=ctm[5], width=|ctm[0]|, height=|ctm[3]| for the axis-aligned case
}

export interface ExtractedInlineImage {
  readonly kind: 'inlineImage';
  readonly dict: PdfDict; // BI dict, keys possibly abbreviated (/W /H /CS /BPC /F /DP /IM) -- images-read.ts normalises
  readonly data: Uint8Array<ArrayBuffer>;
  readonly matrix: Matrix;
}

export type ExtractedItem = ExtractedTextRun | ExtractedRect | ExtractedEllipse | ExtractedLine | ExtractedPath | ExtractedImage | ExtractedInlineImage;

export interface GlyphAdvance {
  readonly widthPer1000: number; // 1000ths of text space, matching PDF's own /Widths convention
  readonly byteLengthConsumed: number; // 1 for a simple font's single-byte codes, 2 for an Identity-H composite font
}

// interpret.ts knows nothing about font dictionaries, /ToUnicode CMaps, or embedded-font tables -- it only needs "how wide is the next glyph and how many bytes did it consume" to advance the text matrix correctly. font-read.ts implements this against a real PdfDocument; tests here use a fake.
export interface FontMetricsPort {
  glyphAdvance(fontResourceName: string, resources: PdfDict, codes: Uint8Array<ArrayBuffer>, byteOffset: number): GlyphAdvance | undefined;
}

// The minimal reference-resolution surface interpret.ts needs (looking up /XObject and /Font resources, and recursing into a resolved Form XObject) -- a structural subset of PdfDocument, not a dependency on document.ts itself.
export interface PdfObjectResolver {
  resolve(obj: PdfObject | undefined): PdfObject | undefined;
  resolveDict(obj: PdfObject | undefined): PdfDict | undefined;
}

export interface InterpretContext {
  readonly fontMetrics: FontMetricsPort;
  readonly resolver: PdfObjectResolver;
  readonly sink: PdfDiagnosticSink;
}

// Guards a self-referential or runaway chain of nested form XObjects -- a corrupt or adversarial file, not something a real producer emits.
const MAX_FORM_XOBJECT_DEPTH = 12;
// An unremarkable mid-range glyph advance (half an em) used only when a shown font resource can't be resolved to any width table at all -- purely to stop subsequent glyphs collapsing onto the same point; the position is already degraded at that point regardless, and is reported via a diagnostic.
const FALLBACK_GLYPH_WIDTH_PER_1000 = 500;
// ISO 32000-1 Table 52: the graphics state's own line width parameter defaults to 1.0 (user-space units) until a `w` operator sets it explicitly.
const DEFAULT_LINE_WIDTH_PT = 1;

interface GraphicsState {
  readonly ctm: Matrix;
  readonly fillColor: LayoutColor;
  readonly strokeColor: LayoutColor;
  readonly lineWidth: number;
}

interface TextState {
  tm: Matrix;
  tlm: Matrix;
  fontResourceName: string | undefined;
  fontSizePt: number;
  charSpace: number;
  wordSpace: number;
  horizScale: number; // Tz / 100
  leading: number;
  rise: number;
}

function defaultTextState(): TextState {
  return { tm: IDENTITY_MATRIX, tlm: IDENTITY_MATRIX, fontResourceName: undefined, fontSizePt: 0, charSpace: 0, wordSpace: 0, horizScale: 1, leading: 0, rise: 0 };
}

function computeTrm(ctm: Matrix, ts: TextState): Matrix {
  const fontMatrix: Matrix = [ts.fontSizePt * ts.horizScale, 0, 0, ts.fontSizePt, 0, ts.rise];
  return multiplyMatrices(multiplyMatrices(fontMatrix, ts.tm), ctm);
}

function numAt(operands: readonly PdfObject[], index: number): number {
  return asNumber(operands[index]) ?? 0;
}

function grayColor(value: number): LayoutColor {
  return { r: value, g: value, b: value };
}

function rgbColor(operands: readonly PdfObject[]): LayoutColor {
  return { r: numAt(operands, 0), g: numAt(operands, 1), b: numAt(operands, 2) };
}

function cmykColor(operands: readonly PdfObject[]): LayoutColor {
  const c = numAt(operands, 0);
  const m = numAt(operands, 1);
  const y = numAt(operands, 2);
  const k = numAt(operands, 3);
  return { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) };
}

// The generic sc/SC/scn/SCN operators set a colour in whatever space a prior `cs`/`CS` selected, which can be an arbitrary ICC/Indexed/Separation/Pattern resource -- fully resolving that is out of v1 scope. This heuristic (dispatch purely on operand count) covers the overwhelming common case where the selected space is in fact DeviceGray/RGB/CMYK; a trailing pattern-name operand (SCN's own Pattern form) is left as `undefined`, meaning "leave the current colour unchanged," which is honest given a pattern fill has no single flat colour to report anyway.
function genericColor(operands: readonly PdfObject[]): LayoutColor | undefined {
  const numericOperands = operands.filter((o) => o.kind === 'number');
  if (numericOperands.length === 1) {
    return grayColor(numAt(numericOperands, 0));
  }
  if (numericOperands.length === 3) {
    return rgbColor(numericOperands);
  }
  if (numericOperands.length === 4) {
    return cmykColor(numericOperands);
  }
  return undefined;
}

function matrixFromOperands(operands: readonly PdfObject[]): Matrix {
  return [numAt(operands, 0), numAt(operands, 1), numAt(operands, 2), numAt(operands, 3), numAt(operands, 4), numAt(operands, 5)];
}

// --- Characteristic-shape detection over a recovered general path ---
//
// PDF's content-stream vocabulary has exactly one shape primitive, `re`, and no ellipse or line operator at all: an ellipse is written as four cubic Bezier arcs, a line as a two-point stroked path, and even a rectangle stops being a `re` the moment its producer chooses to draw it corner by corner. Recovering all four as an undifferentiated LayoutPath is truthful but lossy in a way that matters downstream -- a caller reconstructing an ODF drawing wants draw:rect/draw:ellipse/draw:line back, not a path approximating each. These detectors recover the specific kind whenever the geometry unambiguously matches the characteristic pattern that kind is always written as.
//
// This is a deliberate, bounded heuristic, not a certainty, and the false-positive risk is real in both directions of the ellipse case in particular: a hand-authored freeform path that happens to consist of four cubic segments meeting at the four cardinal points of its own bounding box, with control points at the kappa ratio, is indistinguishable from a "real" ellipse in the PDF bytes -- because at that point it geometrically IS one, whatever the author called it. The rect and line detections carry the same character (a four-corner axis-aligned polygon is a rectangle; a single stroked segment is a line) but far less risk, since neither has a tolerance-sensitive constant to match. What the heuristic cannot do is misreport geometry: every detected shape reproduces its source path's own points exactly, so a false positive changes an item's KIND, never where or how big it is.

// Every coordinate reaching these detectors has been through PDF's own number formatting (serialize.ts's formatNumber rounds to 4 decimal places), so it carries up to 5e-5pt of quantisation error before any geometry is derived from it. The absolute floor is twenty times that -- still three orders of magnitude below any real output device's resolution -- and the relative term scales it with the shape's own size, which is what lets a large ellipse from a producer that rounded its kappa constant to fewer digits than BEZIER_KAPPA (0.5523, say) still match.
const SHAPE_ABS_TOLERANCE_PT = 1e-3;
const SHAPE_REL_TOLERANCE = 1e-4;

function shapeTolerance(extentPt: number): number {
  return Math.max(SHAPE_ABS_TOLERANCE_PT, Math.abs(extentPt) * SHAPE_REL_TOLERANCE);
}

function nearlyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function nearlyEqualPoints(a: Point, b: Point, tolerance: number): boolean {
  return nearlyEqual(a.x, b.x, tolerance) && nearlyEqual(a.y, b.y, tolerance);
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function boundsOf(points: readonly Point[]): Bounds {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// A closed subpath's corner points, when every one of its segments is a straight line. A producer may close a polygon either by relying on `h` alone (ISO 32000-1's own `re` expansion does exactly this, emitting three `l` segments for four corners) or by drawing the closing edge explicitly and then closing anyway -- the redundant final point is dropped here so both spellings yield the same corner list.
function closedPolygonCorners(subpath: ExtractedSubpath): Point[] | undefined {
  if (!subpath.closed) {
    return undefined;
  }
  const corners: Point[] = [{ x: subpath.startXPt, y: subpath.startYPt }];
  for (const segment of subpath.segments) {
    if (segment.kind !== 'line') {
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
  const tolerance = shapeTolerance(Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY));
  if (nearlyEqualPoints(first, last, tolerance)) {
    corners.pop();
  }
  return corners;
}

// A single closed four-corner straight-line subpath is an axis-aligned rectangle exactly when every corner sits on both an x extreme and a y extreme AND every edge moves along exactly one axis. The second condition is what rejects a bowtie -- four points that individually sit on the right extremes but are traversed in an order that crosses the middle -- which the first alone would happily accept. Both winding directions and either starting corner satisfy this equally, so no normalisation is needed.
function detectRect(subpath: ExtractedSubpath, paint: ExtractedPaint): ExtractedRect | undefined {
  const corners = closedPolygonCorners(subpath);
  if (corners?.length !== 4) {
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
    if (!nearlyEqual(corner.x, minX, tolX) && !nearlyEqual(corner.x, maxX, tolX)) {
      return undefined;
    }
    if (!nearlyEqual(corner.y, minY, tolY) && !nearlyEqual(corner.y, maxY, tolY)) {
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
  return { kind: 'rect', xPt: minX, yPt: minY, widthPt, heightPt, fill: paint.fill, stroke: paint.stroke };
}

// Which cardinal extreme of its own bounding box an ellipse's on-curve point sits at. Every quadrant arc of the four-Bezier construction runs from one horizontal extreme to one vertical extreme (or back), so classifying each on-curve point this way is what lets the control-point check below be written once, direction-agnostically.
type CardinalExtreme = 'right' | 'top' | 'left' | 'bottom';

function cardinalExtremeOf(point: Point, center: Point, rx: number, ry: number, tolX: number, tolY: number): CardinalExtreme | undefined {
  if (nearlyEqual(point.y, center.y, tolY)) {
    if (nearlyEqual(point.x, center.x + rx, tolX)) {
      return 'right';
    }
    if (nearlyEqual(point.x, center.x - rx, tolX)) {
      return 'left';
    }
    return undefined;
  }
  if (nearlyEqual(point.x, center.x, tolX)) {
    if (nearlyEqual(point.y, center.y + ry, tolY)) {
      return 'top';
    }
    if (nearlyEqual(point.y, center.y - ry, tolY)) {
      return 'bottom';
    }
  }
  return undefined;
}

// The control point an arc places next to a horizontal extreme lies directly above or below that extreme, kappa*ry along the vertical direction the arc is heading in; the one next to a vertical extreme lies kappa*rx horizontally beside it. That single rule, applied to whichever end of the arc is which, covers all four quadrants in both winding directions with no per-quadrant table.
function expectedEllipseControl(atExtreme: Point, atExtremeKind: CardinalExtreme, otherEnd: Point, center: Point, kx: number, ky: number): Point {
  if (atExtremeKind === 'right' || atExtremeKind === 'left') {
    return { x: atExtreme.x, y: center.y + Math.sign(otherEnd.y - center.y) * ky };
  }
  return { x: center.x + Math.sign(otherEnd.x - center.x) * kx, y: atExtreme.y };
}

// A closed subpath of exactly four cubic segments whose on-curve points are the four cardinal extremes of its bounding box, and whose eight control points all sit at the kappa offset those extremes imply, is the four-quadrant Bezier ellipse -- the only way an axis-aligned ellipse is ever expressible in PDF. A rotated ellipse deliberately does not match: its on-curve points are no longer at its bounding box's cardinal extremes, and document-schema.js's LayoutEllipse carries no rotation to report one with, so leaving it as a general path is the honest outcome rather than a silently unrotated ellipse.
function detectEllipse(subpath: ExtractedSubpath, paint: ExtractedPaint): ExtractedEllipse | undefined {
  const segments = subpath.segments;
  if (!subpath.closed || segments.length !== 4 || segments.some((segment) => segment.kind !== 'cubic')) {
    return undefined;
  }
  const start: Point = { x: subpath.startXPt, y: subpath.startYPt };
  const onCurve: Point[] = [start];
  for (const segment of segments.slice(0, 3)) {
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
  if (finalSegment === undefined || !nearlyEqualPoints({ x: finalSegment.xPt, y: finalSegment.yPt }, start, Math.max(tolX, tolY))) {
    return undefined;
  }
  const extremes = onCurve.map((point) => cardinalExtremeOf(point, center, rx, ry, tolX, tolY));
  if (extremes.some((extreme) => extreme === undefined) || new Set(extremes).size !== 4) {
    return undefined;
  }
  const kx = rx * BEZIER_KAPPA;
  const ky = ry * BEZIER_KAPPA;
  const controlTolerance = Math.max(tolX, tolY);
  for (let i = 0; i < 4; i += 1) {
    const segment = segments[i];
    const from = onCurve[i];
    const fromKind = extremes[i];
    const to = onCurve[(i + 1) % 4];
    const toKind = extremes[(i + 1) % 4];
    if (segment?.kind !== 'cubic' || from === undefined || to === undefined || fromKind === undefined || toKind === undefined) {
      return undefined;
    }
    const expectedC1 = expectedEllipseControl(from, fromKind, to, center, kx, ky);
    const expectedC2 = expectedEllipseControl(to, toKind, from, center, kx, ky);
    if (!nearlyEqualPoints({ x: segment.c1xPt, y: segment.c1yPt }, expectedC1, controlTolerance)) {
      return undefined;
    }
    if (!nearlyEqualPoints({ x: segment.c2xPt, y: segment.c2yPt }, expectedC2, controlTolerance)) {
      return undefined;
    }
  }
  return { kind: 'ellipse', xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY, fill: paint.fill, stroke: paint.stroke };
}

// An open subpath of exactly one straight segment, stroked and not filled, is a line -- the only shape a `m ... l S` sequence can be. A fill disqualifies it because a two-point path encloses no area, so a producer that filled one meant something this detector should not guess at.
function detectLine(subpath: ExtractedSubpath, paint: ExtractedPaint): ExtractedLine | undefined {
  const segment = subpath.segments[0];
  if (subpath.closed || subpath.segments.length !== 1 || segment?.kind !== 'line') {
    return undefined;
  }
  if (paint.fill !== undefined || paint.stroke === undefined) {
    return undefined;
  }
  return { kind: 'line', x1Pt: subpath.startXPt, y1Pt: subpath.startYPt, x2Pt: segment.xPt, y2Pt: segment.yPt, color: paint.stroke.color, widthPt: paint.stroke.widthPt };
}

// The three detections are mutually exclusive by construction (rect needs all-line closed, ellipse all-cubic closed, line a single open segment), so the order below is cheapest-first rather than a priority. Only a single-subpath path is ever considered: a multi-subpath path is a compound shape -- a hole construction, a glyph outline, a diagram drawn in one go -- which no single LayoutRect/LayoutEllipse/LayoutLine can represent without losing part of it.
function classifyShape(subpaths: readonly ExtractedSubpath[], paint: ExtractedPaint): ExtractedRect | ExtractedEllipse | ExtractedLine | undefined {
  const subpath = subpaths[0];
  if (subpaths.length !== 1 || subpath === undefined) {
    return undefined;
  }
  return detectRect(subpath, paint) ?? detectEllipse(subpath, paint) ?? detectLine(subpath, paint);
}

export function interpretContentStream(bytes: Uint8Array<ArrayBuffer>, resources: PdfDict, context: InterpretContext): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const initialState: GraphicsState = { ctm: IDENTITY_MATRIX, fillColor: COLOR_BLACK, strokeColor: COLOR_BLACK, lineWidth: DEFAULT_LINE_WIDTH_PT };
  runContentStream(bytes, resources, initialState, context, items, 0);
  return items;
}

// A subpath still being accumulated within one runContentStream call -- `segments` is mutable (pushed to as l/c/v/y arrive) and `closed` flips true on `h` (or the implicit closepath s/b/b* perform); once finalized it is pushed as-is into pathSubpaths, which is exactly ExtractedSubpath's own shape (a mutable segments array satisfies the readonly array field type).
interface MutableSubpath {
  readonly startXPt: number;
  readonly startYPt: number;
  readonly segments: ExtractedPathSegment[];
  closed: boolean;
}

// The device-space point a `v` operator's implicit first control point equals: the subpath's last segment endpoint, or its own start point if no segment has been added yet.
function lastPointOf(subpath: MutableSubpath): Point {
  const last = subpath.segments[subpath.segments.length - 1];
  return last === undefined ? { x: subpath.startXPt, y: subpath.startYPt } : { x: last.xPt, y: last.yPt };
}

function runContentStream(bytes: Uint8Array<ArrayBuffer>, resources: PdfDict, initialState: GraphicsState, context: InterpretContext, items: ExtractedItem[], depth: number): void {
  const operations = readContentStream(bytes, context.sink);
  const gsStack: GraphicsState[] = [];
  let gs = initialState;
  let ts = defaultTextState();
  let pathSubpaths: MutableSubpath[] = [];
  let currentSubpath: MutableSubpath | undefined;

  // `m` starts a new subpath, finalizing whatever was previously open into pathSubpaths -- `re`'s own implicit leading `m` (see appendRectSubpath) reuses this too. Both a real paint operator and the very next `m` are the only two things that ever finalize a subpath.
  const finalizeCurrentSubpath = (): void => {
    if (currentSubpath !== undefined) {
      pathSubpaths.push(currentSubpath);
      currentSubpath = undefined;
    }
  };

  // Clears every scrap of path state after a paint operator.
  const resetPath = (): void => {
    pathSubpaths = [];
    currentSubpath = undefined;
  };

  // ISO 32000-1 8.5.2.1: `re` is defined as exactly the sequence "x y m (x+w) y l (x+w)(y+h) l x (y+h) l h", so that is precisely what it appends -- one 4-point closed subpath, its corners through the current CTM. There is no separate rectangle bookkeeping alongside it: classifyShape recovers the rectangle back out of exactly these four corners, which is what lets a hand-constructed m/l/l/l/h rectangle and a `re` be recognised by one code path rather than two.
  const appendRectSubpath = (operands: readonly PdfObject[], ctm: Matrix): void => {
    finalizeCurrentSubpath();
    const x = numAt(operands, 0);
    const y = numAt(operands, 1);
    const w = numAt(operands, 2);
    const h = numAt(operands, 3);
    const p1 = applyMatrix(ctm, { x, y });
    const p2 = applyMatrix(ctm, { x: x + w, y });
    const p3 = applyMatrix(ctm, { x: x + w, y: y + h });
    const p4 = applyMatrix(ctm, { x, y: y + h });
    pathSubpaths.push({
      startXPt: p1.x,
      startYPt: p1.y,
      segments: [
        { kind: 'line', xPt: p2.x, yPt: p2.y },
        { kind: 'line', xPt: p3.x, yPt: p3.y },
        { kind: 'line', xPt: p4.x, yPt: p4.y },
      ],
      closed: true,
    });
  };

  // f/F/S/B/b use the nonzero winding rule; the starred variants (f*/B*/b*) use even-odd -- ISO 32000-1 Table 60. `s`/`n` have no fill at all, so their nonzero default is never actually consulted (convertPath in read.ts only keeps fillRule when fill is set).
  const paintFillRuleFor = (operator: string): 'nonzero' | 'evenodd' => (operator.endsWith('*') ? 'evenodd' : 'nonzero');

  // Every path-painting operator (f/F/f*/S/s/B/B*/b/b*/n) funnels through here. `n` never emits (a clip-only path has no ink); everything else that actually constructed a path is offered to classifyShape first, and emits the specific rect/ellipse/line it matched or one general ExtractedPath if it matched none. The even-odd fill rule is deliberately not a barrier to shape classification: for the single closed subpath every detector requires, even-odd and nonzero winding select exactly the same interior, so a rectangle painted with `f*` is the same rectangle `f` would have painted -- and LayoutRect/LayoutEllipse carry no fill rule to lose in the first place.
  const emitPaint = (operator: string): void => {
    if (operator === 'n') {
      resetPath();
      return;
    }
    if ((operator === 's' || operator === 'b' || operator === 'b*') && currentSubpath !== undefined) {
      currentSubpath.closed = true; // s/b/b* are each defined as "h" followed by their non-close counterpart.
    }
    finalizeCurrentSubpath();
    if (pathSubpaths.length > 0) {
      const isFillOp = operator === 'f' || operator === 'F' || operator === 'f*' || operator === 'B' || operator === 'B*' || operator === 'b' || operator === 'b*';
      const isStrokeOp = operator === 'S' || operator === 's' || operator === 'B' || operator === 'B*' || operator === 'b' || operator === 'b*';
      const paint: ExtractedPaint = {
        fill: isFillOp ? gs.fillColor : undefined,
        stroke: isStrokeOp ? { color: gs.strokeColor, widthPt: gs.lineWidth } : undefined,
      };
      items.push(classifyShape(pathSubpaths, paint) ?? { kind: 'path', subpaths: pathSubpaths, fillRule: paintFillRuleFor(operator), ...paint });
    }
    resetPath();
  };

  const advanceThroughString = (codes: Uint8Array<ArrayBuffer>): void => {
    if (ts.fontResourceName === undefined) {
      return;
    }
    let offset = 0;
    while (offset < codes.length) {
      const glyph = context.fontMetrics.glyphAdvance(ts.fontResourceName, resources, codes, offset);
      if (glyph === undefined) {
        context.sink({ code: 'pdf/font-not-resolved', severity: 'warning', message: `could not resolve font resource /${ts.fontResourceName} to compute a glyph advance; assuming a fallback width` });
      }
      const widthPer1000 = glyph?.widthPer1000 ?? FALLBACK_GLYPH_WIDTH_PER_1000;
      const byteLength = glyph?.byteLengthConsumed ?? 1;
      const isSingleByteSpace = byteLength === 1 && codes[offset] === 0x20;
      const tx = ((widthPer1000 / 1000) * ts.fontSizePt + ts.charSpace + (isSingleByteSpace ? ts.wordSpace : 0)) * ts.horizScale;
      ts.tm = multiplyMatrices(translationMatrix(tx, 0), ts.tm);
      offset += byteLength;
    }
  };

  const showTextArray = (elements: readonly PdfObject[]): void => {
    if (ts.fontResourceName === undefined) {
      return;
    }
    const startMatrix = computeTrm(gs.ctm, ts);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let totalLength = 0;
    for (const el of elements) {
      if (el.kind === 'string') {
        chunks.push(el.bytes);
        totalLength += el.bytes.length;
        advanceThroughString(el.bytes);
      } else if (el.kind === 'number') {
        const adjustment = -(el.value / 1000) * ts.fontSizePt * ts.horizScale;
        ts.tm = multiplyMatrices(translationMatrix(adjustment, 0), ts.tm);
      }
    }
    if (totalLength === 0) {
      return;
    }
    const combined = new Uint8Array(totalLength);
    let at = 0;
    for (const chunk of chunks) {
      combined.set(chunk, at);
      at += chunk.length;
    }
    const endMatrix = computeTrm(gs.ctm, ts);
    items.push({ kind: 'text', codes: combined, fontResourceName: ts.fontResourceName, resources, startMatrix, endMatrix, sizePt: ts.fontSizePt, color: gs.fillColor });
  };

  const showText = (bytes: Uint8Array<ArrayBuffer>): void => {
    showTextArray([{ kind: 'string', bytes, hex: false }]);
  };

  const nextLine = (): void => {
    ts.tlm = multiplyMatrices(translationMatrix(0, -ts.leading), ts.tlm);
    ts.tm = ts.tlm;
  };

  const handleDo = (name: string | undefined): void => {
    if (name === undefined) {
      return;
    }
    const xobjects = context.resolver.resolveDict(dictGet(resources, 'XObject'));
    const xobj = xobjects !== undefined ? context.resolver.resolve(dictGet(xobjects, name)) : undefined;
    if (xobj?.kind !== 'stream') {
      context.sink({ code: 'pdf/xobject-not-resolved', severity: 'warning', message: `XObject resource /${name} did not resolve to a stream` });
      return;
    }
    const subtype = asName(dictGet(xobj.dict, 'Subtype'));
    if (subtype === 'Image') {
      items.push({ kind: 'image', resourceName: name, resources, matrix: gs.ctm });
      return;
    }
    if (subtype === 'Form') {
      if (depth >= MAX_FORM_XOBJECT_DEPTH) {
        context.sink({ code: 'pdf/form-recursion-limit', severity: 'warning', message: 'form XObject recursion exceeded the depth limit; skipping further nesting' });
        return;
      }
      const formMatrixArr = asArray(dictGet(xobj.dict, 'Matrix'));
      const formMatrix = formMatrixArr !== undefined ? matrixFromOperands(formMatrixArr) : IDENTITY_MATRIX;
      const formResources = context.resolver.resolveDict(dictGet(xobj.dict, 'Resources')) ?? resources;
      const decoded = decodeStream(xobj.raw, xobj.dict, context.sink);
      const formState: GraphicsState = { ...gs, ctm: multiplyMatrices(formMatrix, gs.ctm) };
      runContentStream(decoded.bytes, formResources, formState, context, items, depth + 1);
    }
  };

  for (const token of operations) {
    if (token.kind === 'inlineImage') {
      items.push({ kind: 'inlineImage', dict: token.image.dict, data: token.image.data, matrix: gs.ctm });
      continue;
    }
    const { operands, operator } = token.operation;
    switch (operator) {
      case 'q':
        gsStack.push(gs);
        break;
      case 'Q':
        gs = gsStack.pop() ?? gs;
        break;
      case 'cm':
        gs = { ...gs, ctm: multiplyMatrices(matrixFromOperands(operands), gs.ctm) };
        break;
      case 'g':
        gs = { ...gs, fillColor: grayColor(numAt(operands, 0)) };
        break;
      case 'G':
        gs = { ...gs, strokeColor: grayColor(numAt(operands, 0)) };
        break;
      case 'rg':
        gs = { ...gs, fillColor: rgbColor(operands) };
        break;
      case 'RG':
        gs = { ...gs, strokeColor: rgbColor(operands) };
        break;
      case 'k':
        gs = { ...gs, fillColor: cmykColor(operands) };
        break;
      case 'K':
        gs = { ...gs, strokeColor: cmykColor(operands) };
        break;
      case 'sc':
      case 'scn': {
        const color = genericColor(operands);
        if (color !== undefined) {
          gs = { ...gs, fillColor: color };
        }
        break;
      }
      case 'SC':
      case 'SCN': {
        const color = genericColor(operands);
        if (color !== undefined) {
          gs = { ...gs, strokeColor: color };
        }
        break;
      }
      case 're':
        appendRectSubpath(operands, gs.ctm);
        break;
      case 'm': {
        finalizeCurrentSubpath();
        const p = applyMatrix(gs.ctm, { x: numAt(operands, 0), y: numAt(operands, 1) });
        currentSubpath = { startXPt: p.x, startYPt: p.y, segments: [], closed: false };
        break;
      }
      case 'l': {
        const p = applyMatrix(gs.ctm, { x: numAt(operands, 0), y: numAt(operands, 1) });
        currentSubpath?.segments.push({ kind: 'line', xPt: p.x, yPt: p.y });
        break;
      }
      case 'c': {
        const c1 = applyMatrix(gs.ctm, { x: numAt(operands, 0), y: numAt(operands, 1) });
        const c2 = applyMatrix(gs.ctm, { x: numAt(operands, 2), y: numAt(operands, 3) });
        const p = applyMatrix(gs.ctm, { x: numAt(operands, 4), y: numAt(operands, 5) });
        currentSubpath?.segments.push({ kind: 'cubic', c1xPt: c1.x, c1yPt: c1.y, c2xPt: c2.x, c2yPt: c2.y, xPt: p.x, yPt: p.y });
        break;
      }
      case 'v': {
        // Shorthand cubic: the first control point is the current point, only the second control point and the endpoint are given as operands.
        if (currentSubpath !== undefined) {
          const cur = lastPointOf(currentSubpath);
          const c2 = applyMatrix(gs.ctm, { x: numAt(operands, 0), y: numAt(operands, 1) });
          const p = applyMatrix(gs.ctm, { x: numAt(operands, 2), y: numAt(operands, 3) });
          currentSubpath.segments.push({ kind: 'cubic', c1xPt: cur.x, c1yPt: cur.y, c2xPt: c2.x, c2yPt: c2.y, xPt: p.x, yPt: p.y });
        }
        break;
      }
      case 'y': {
        // Shorthand cubic: the second control point equals the endpoint, only the first control point and the endpoint are given as operands.
        const c1 = applyMatrix(gs.ctm, { x: numAt(operands, 0), y: numAt(operands, 1) });
        const p = applyMatrix(gs.ctm, { x: numAt(operands, 2), y: numAt(operands, 3) });
        currentSubpath?.segments.push({ kind: 'cubic', c1xPt: c1.x, c1yPt: c1.y, c2xPt: p.x, c2yPt: p.y, xPt: p.x, yPt: p.y });
        break;
      }
      case 'h':
        if (currentSubpath !== undefined) {
          currentSubpath.closed = true;
        }
        break;
      case 'w':
        gs = { ...gs, lineWidth: numAt(operands, 0) };
        break;
      case 'f':
      case 'F':
      case 'f*':
      case 'S':
      case 's':
      case 'B':
      case 'B*':
      case 'b':
      case 'b*':
      case 'n':
        emitPaint(operator);
        break;
      case 'BT':
        ts = defaultTextState();
        break;
      case 'Tf':
        ts.fontResourceName = asName(operands[0]);
        ts.fontSizePt = numAt(operands, 1);
        break;
      case 'Tc':
        ts.charSpace = numAt(operands, 0);
        break;
      case 'Tw':
        ts.wordSpace = numAt(operands, 0);
        break;
      case 'Tz':
        ts.horizScale = numAt(operands, 0) / 100;
        break;
      case 'TL':
        ts.leading = numAt(operands, 0);
        break;
      case 'Ts':
        ts.rise = numAt(operands, 0);
        break;
      case 'Td':
        ts.tlm = multiplyMatrices(translationMatrix(numAt(operands, 0), numAt(operands, 1)), ts.tlm);
        ts.tm = ts.tlm;
        break;
      case 'TD':
        ts.leading = -numAt(operands, 1);
        ts.tlm = multiplyMatrices(translationMatrix(numAt(operands, 0), numAt(operands, 1)), ts.tlm);
        ts.tm = ts.tlm;
        break;
      case 'Tm':
        ts.tlm = matrixFromOperands(operands);
        ts.tm = ts.tlm;
        break;
      case 'T*':
        nextLine();
        break;
      case 'Tj': {
        const str = operands[0];
        if (str?.kind === 'string') {
          showText(str.bytes);
        }
        break;
      }
      case "'": {
        nextLine();
        const str = operands[0];
        if (str?.kind === 'string') {
          showText(str.bytes);
        }
        break;
      }
      case '"': {
        ts.wordSpace = numAt(operands, 0);
        ts.charSpace = numAt(operands, 1);
        nextLine();
        const str = operands[2];
        if (str?.kind === 'string') {
          showText(str.bytes);
        }
        break;
      }
      case 'TJ': {
        const array = asArray(operands[0]);
        if (array !== undefined) {
          showTextArray(array);
        }
        break;
      }
      case 'Do':
        handleDo(asName(operands[0]));
        break;
      default:
        break; // every other operator (marked content, shading, clipping, ExtGState, dash pattern, line cap/join) is outside v1's extraction scope
    }
  }
}
