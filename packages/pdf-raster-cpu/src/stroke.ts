import type { Pt } from "./geometry";
import { flattenCubic } from "./geometry";
import type { RasterSubpath } from "pdf-codec/raster";

// Stroking, as geometry rather than as a pixel-distance field: one stroked path becomes a set of consistently-wound polygons whose nonzero-winding union is the stroke's coverage. Each flattened centreline segment contributes an offset quad (the rectangle between its two perpendicular offset lines); each join contributes the wedge that fills the notch the two quads leave on the outside of the turn. Because every polygon is emitted with the same winding orientation, overlapping pieces sum their winding and nonzero keeps the union -- the property that makes one CoverageMask.fillPolygons call paint a whole stroke without double-covering overlaps.

// PDF's own default miter limit (ISO 32000-1 Table 52: M, initial value 10.0): the ratio of miter length to line width beyond which the join falls back to a bevel. The port carries no per-stroke miter limit, so this backend applies the format's default rather than inventing a knob of its own.
export const DEFAULT_MITER_LIMIT = 10;

// The port's stroke spec maps a zero-width stroke to widthPx 0, and PDF's own rule for that case ("a zero-width line shall be rendered at the thinnest possible width", ISO 32000-1 8.4.3.2) is honoured by clamping to one device pixel -- the thinnest line this canvas can render.
export const THINNEST_STROKE_PX = 1;

export interface FlattenedSubpath {
  readonly points: readonly Pt[];
  readonly closed: boolean;
}

// One port subpath to a polyline: line segments pass through, cubics flatten (deterministically -- see flattenCubic). The start point is carried as points[0] and each segment's endpoint is appended, so consecutive points are always joined by a straight device-space line.
export function flattenSubpath(subpath: RasterSubpath): FlattenedSubpath {
  const points: Pt[] = [{ x: subpath.startXPx, y: subpath.startYPx }];
  for (const segment of subpath.segments) {
    if (segment.kind === "line") {
      points.push({ x: segment.xPx, y: segment.yPx });
      continue;
    }
    const previous = points[points.length - 1];
    if (previous === undefined) {
      continue; // unreachable: points was seeded with the start point above
    }
    points.push(
      ...flattenCubic(
        previous,
        { x: segment.c1xPx, y: segment.c1yPx },
        { x: segment.c2xPx, y: segment.c2yPx },
        { x: segment.xPx, y: segment.yPx },
      ),
    );
  }
  return { points, closed: subpath.closed };
}

// The polygons of one stroked outline: dash the centrelines first (when a dash array is present), then offset. Undashed closed subpaths join at every vertex including the closure; open subpaths and every dash piece take butt ends (the port guarantees a dotted style never arrives as a zero-length dash array, so no round-cap primitive is ever needed). A join landing exactly at a dash boundary is drawn with the boundary's butt ends rather than its wedge -- at dash-boundary scale the difference is sub-stroke-width, and it is the one approximation this module makes.
export function strokeOutlinePolygons(
  subpaths: readonly FlattenedSubpath[],
  widthPx: number,
  dashPx: readonly number[] | undefined,
): readonly (readonly Pt[])[] {
  const half = Math.max(widthPx, THINNEST_STROKE_PX) / 2;
  const polygons: Pt[][] = [];
  const emitPiece = (piece: readonly Pt[]): void => {
    // entries() bounds the walk by the piece itself rather than by an index comparison of its own; q looks one past the entry(), undefined at the very last one, which the guard on the next line discards -- the walk still covers every consecutive pair.
    for (const [i, p] of piece.entries()) {
      const q = piece[i + 1];
      if (q === undefined) {
        continue; // the last point has no successor to pair with
      }
      const d = unitDirection(p, q);
      if (d === undefined) {
        continue;
      }
      // The offset quad, in a fixed vertex order relative to the segment's own direction, so every quad carries the same winding orientation whatever direction the path travels in.
      const n = { x: -d.y, y: d.x };
      polygons.push([
        { x: p.x + n.x * half, y: p.y + n.y * half },
        { x: q.x + n.x * half, y: q.y + n.y * half },
        { x: q.x - n.x * half, y: q.y - n.y * half },
        { x: p.x - n.x * half, y: p.y - n.y * half },
      ]);
    }
    // Join wedges at interior vertices, walked the same entries()-bounded way: before and after each look one index away from the entry(), undefined at the piece's own two ends, which the guard discards. The wedge sits on the outside of the turn: with the left normals of the incoming and outgoing directions, the outside is the side the cross product names (the two offset edges diverge there, leaving a notch; on the inside they cross and the quads already overlap).
    for (const [i, vertex] of piece.entries()) {
      const before = piece[i - 1];
      const after = piece[i + 1];
      if (before === undefined || after === undefined) {
        continue; // the piece's own two end points have no interior join
      }
      emitJoinWedge(polygons, vertex, before, after, half);
    }
  };
  if (dashPx === undefined) {
    for (const subpath of subpaths) {
      const first = subpath.points[0];
      if (first === undefined) {
        continue;
      }
      emitPiece(subpath.closed ? [...subpath.points, first] : subpath.points);
      // No separate length >= 3 guard: for a closed one-point subpath, `second` (points[1]) is undefined and the check just below skips it; for a closed two-point subpath, `last` and `second` are both points[1], so the direction from vertex to after is the exact negation of the direction from before to vertex and emitJoinWedge's own cross-product-near-zero guard rejects it as a straight (here, perfectly reversed) continuation -- a subpath under three points closes to a safe no-op on its own, with no need for a dedicated length check to keep it that way.
      if (subpath.closed) {
        // The closure vertex joins the last centreline segment back to the first -- the piece walk above stops one short of it.
        const last = subpath.points[subpath.points.length - 1];
        const second = subpath.points[1];
        if (last !== undefined && second !== undefined) {
          emitJoinWedge(polygons, first, last, second, half);
        }
      }
    }
    return polygons;
  }
  for (const subpath of subpaths) {
    for (const piece of dashPolyline(subpath, dashPx)) {
      emitPiece(piece);
    }
  }
  return polygons;
}

// The miter-or-bevel join at one vertex. The miter point is the standard offset-line intersection m = v + (n1 + n2) * (h / (1 + n1 . n2)), which degenerates to the offset line itself for a straight continuation; the join is the quadrilateral (a1, m, a2, v) -- outer offset point to miter point to the other offset point to the vertex itself, the full notch a mitered corner fills. Beyond DEFAULT_MITER_LIMIT half-widths of miter length the join falls back to a bevel: the triangle (a1, v, a2), the flat cut between the two outer offset points. Either polygon is emitted in whichever vertex order carries the same winding orientation as the quads -- mixed orientations could cancel to a hole inside the union.
function emitJoinWedge(
  polygons: Pt[][],
  vertex: Pt,
  before: Pt,
  after: Pt,
  half: number,
): void {
  const d1 = unitDirection(before, vertex);
  const d2 = unitDirection(vertex, after);
  if (d1 === undefined || d2 === undefined) {
    return;
  }
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-12) {
    return; // straight continuation (or exact reversal, where the format leaves the join undefined): the quads meet edge to edge and no wedge exists
  }
  // The outward normal for each direction is the left normal (-d.y, d.x) or its own negation, whichever side the cross product names as "outside" this turn. Naming the two full normals directly, one branch per side, rather than computing a shared +-1 factor and multiplying every component by it, means a mutation to one branch's own sign can no longer be absorbed as a uniform, undetectable rescaling of both normals at once -- it misdirects only that one normal, which the wedge's own exact-coordinate tests below catch as a wrong offset point.
  const outward = turnsOutwardPositive(cross);
  const n1 = outward ? { x: d1.y, y: -d1.x } : { x: -d1.y, y: d1.x };
  const n2 = outward ? { x: d2.y, y: -d2.x } : { x: -d2.y, y: d2.x };
  const a1 = { x: vertex.x + n1.x * half, y: vertex.y + n1.y * half };
  const a2 = { x: vertex.x + n2.x * half, y: vertex.y + n2.y * half };
  const dot = n1.x * n2.x + n1.y * n2.y;
  const denominator = 1 + dot;
  let wedge: readonly Pt[];
  if (takesMiterBranch(denominator)) {
    const scale = half / denominator;
    const miter = {
      x: vertex.x + (n1.x + n2.x) * scale,
      y: vertex.y + (n1.y + n2.y) * scale,
    };
    wedge = [a1, miter, a2, vertex];
  } else {
    wedge = [a1, vertex, a2];
  }
  polygons.push(withNegativeWinding(wedge));
}

// Whether cross (the two directions' own cross product) names this turn's outward side positive, deciding which of a direction's two perpendiculars is the wedge's own outward normal. Exported purely for testing: cross is a difference of products of already-rounded unit-vector components, so real corner geometry can get arbitrarily close to its zero boundary (the straight-continuation guard above stops it within 1e-12) but next to never lands exactly on it -- landing exactly on 0 here (crossing from "positive" to "negative or zero") is trivial to drive directly with a literal, the same reason takesMiterBranch below takes its own already-reduced denominator rather than a constructed dot product.
export function turnsOutwardPositive(cross: number): boolean {
  return cross > 0;
}

// The miter-vs-bevel decision, taking the two offset normals' own dot-product-derived denominator (1 + n1 . n2) directly rather than n1/n2 themselves, so a test can drive the exact boundary value with a literal instead of hunting for a real corner geometry that happens to produce it. The miter length as a multiple of the half-width is |n1 + n2| / (1 + n1 . n2) = sqrt(2 + 2 * dot) / (1 + dot) = sqrt(2 / denominator) (since 2 + 2 * dot === 2 * (1 + dot) === 2 * denominator) -- so that ratio being at most DEFAULT_MITER_LIMIT reduces algebraically, given a non-negative denominator (guaranteed for two unit vectors' own dot product, which can never fall below -1), to 2 <= DEFAULT_MITER_LIMIT ** 2 * denominator: an exact integer literal against a plain multiply, with no sqrt or division on either side to round toward or away from the other -- unlike the un-reduced ratio, whose floating-point evaluation can only ever land just short of or just past the limit, never exactly on it (the real solution point, dot === -0.98, has no exact binary representation). A zero denominator (n1 and n2 exact opposites) fails this check on its own (2 <= 0 is false), a bevel, matching the un-reduced ratio's own NaN/Infinity fallback.
export function takesMiterBranch(denominator: number): boolean {
  return 2 <= DEFAULT_MITER_LIMIT ** 2 * denominator;
}

// The polygon with a guaranteed negative signed area -- the winding orientation every offset quad already carries by construction -- reversing it first if it isn't already one. Exported purely for testing: a wedge with an exactly-zero signed area is possible only from a hand-picked, already-degenerate polygon (three collinear points), not from any real corner emitJoinWedge itself builds, so the boundary between "already negative" and "zero or positive" is driven directly here instead.
export function withNegativeWinding(polygon: readonly Pt[]): Pt[] {
  return polygonSignedArea(polygon) < 0 ? [...polygon] : [...polygon].reverse();
}

// Twice the signed area of a polygon (the shoelace sum), negative when wound the same way as the offset quads, whose fixed vertex order gives them a constant negative sign by construction.
function polygonSignedArea(polygon: readonly Pt[]): number {
  let area = 0;
  // entries() bounds the walk by the polygon itself; the modulo wraps the last edge back to the first point, closing the ring, and always resolves to a real point (never undefined) since polygon.length is never 0 for a wedge this function builds.
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length];
    if (b === undefined) {
      continue; // unreachable: the modulo keeps the index inside the polygon
    }
    area += a.x * b.y - b.x * a.y;
  }
  return area;
}

function unitDirection(p: Pt, q: Pt): Pt | undefined {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return undefined;
  }
  return { x: dx / length, y: dy / length };
}

// Splits one polyline (with its closing segment when the subpath is closed) into its dash pattern's "on" pieces, phase 0 -- the port's dash arrays always start on ([3w, 3w] for a recovered dashed style), matching the writer's own convention. Whether the walk is currently emitting is not separate state: dash entries alternate on/off by position (entry 0 on, entry 1 off, and so on), so emission is exactly "the pattern index is even". An all-zero pattern paints nothing, exactly as PDF's own Table 52 note describes for a zero on-length under a butt cap. Exported (from this module only, not from the package's own index) purely so stroke.test.ts can pin its piece boundaries directly, the same way coverage.test.ts and geometry.test.ts reach past this package's narrow public surface into CoverageMask and flattenCubic.
export function dashPolyline(
  subpath: FlattenedSubpath,
  dashPx: readonly number[],
): readonly (readonly Pt[])[] {
  if (!dashPx.some((length) => length > 0)) {
    return [];
  }
  // Always doubled, whether dashPx's own length is odd or even: an odd length must double to alternate on/off correctly (ISO 32000-1 8.4.3.6), and doubling an already-even-length array besides changes nothing observable -- indexing pattern[i % pattern.length] for i in [0, dashPx.length) is identical whether pattern is dashPx itself (mod dashPx.length) or dashPx doubled (mod 2 * dashPx.length), and for i in [dashPx.length, 2 * dashPx.length) the doubled array's own second half is a copy of the first, so (dashPx+dashPx)[i % (2 * n)] === dashPx[(i - n) % n] === dashPx[i % n] -- the two indexing schemes agree at every position, forever, for any even n. Doubling unconditionally removes the odd/even branch as something a mutation could force down the wrong path.
  const pattern = [...dashPx, ...dashPx];
  const start = subpath.points[0];
  if (start === undefined) {
    return [];
  }
  // Built from `start`, already confirmed a real point above, rather than re-reading subpath.points[0]: an indexed re-read is typed Pt | undefined regardless of this guard having already run, which would leave every point in this array (not just the appended one) typed as possibly undefined for no real reason.
  const points = subpath.closed ? [...subpath.points, start] : subpath.points;
  const pieces: Pt[][] = [];
  const endOnPiece = (): void => {
    if (current.length >= 2) {
      pieces.push(current);
    }
    current = [];
  };
  // Advances past the entry just exhausted (and past any further zero-length entries -- the all-zero pattern was rejected on entry, so this always terminates), then opens a fresh on-piece when the walk lands on an even index.
  const atBoundary = (): void => {
    // Called unconditionally, whether the phase just finished was on or off: when it was off, current is already empty (the push guard further below only ever adds to it during an on phase), and endOnPiece on an empty array is itself a no-op (its own length >= 2 check rejects it, then resets current to [] again).
    endOnPiece();
    for (;;) {
      index = (index + 1) % pattern.length;
      const entry = pattern[index];
      if (entry !== undefined && entry > 0) {
        remaining = entry;
        break;
      }
    }
    if (index % 2 === 0) {
      current = [cursor];
    }
  };
  let index = 0;
  let remaining = 0;
  let cursor: Pt = start;
  let current: Pt[] = [];
  // A zero-length first entry needs no explicit boundary transition here: remaining and current are already seeded at 0 and [] above, exactly the state atBoundary's own zero-length-entry search starts hunting forward from, and the main loop's first `remaining === 0` check (below) reaches the identical entry atBoundary would have -- one iteration later, at zero cost, since a step of length min(segmentRemaining, 0) moves nothing.
  const firstEntry = pattern[0];
  if (firstEntry !== undefined && firstEntry > 0) {
    remaining = firstEntry;
    current = [cursor];
  }
  // entries() bounds the walk by points itself; to looks one index ahead, undefined at the very last point, which the guard on the next line discards.
  for (const [i, from] of points.entries()) {
    const to = points[i + 1];
    if (to === undefined) {
      continue; // the last point has no successor segment
    }
    const direction = unitDirection(from, to);
    if (direction === undefined) {
      continue; // a repeated point contributes no length to dash or stroke geometry
    }
    cursor = from;
    let segmentRemaining = Math.hypot(to.x - from.x, to.y - from.y);
    // No separate remaining > 0 conjunct: remaining is never negative (each step subtracts at most its own current value), and the only time it can be exactly 0 at this check is the very first pass of the very first segment, when pattern[0] itself isn't a positive entry (the case the removed else branch above used to bootstrap explicitly) -- a step of length min(segmentRemaining, 0) moves nothing, and the very next line's atBoundary() call still fires (remaining is 0), finding the pattern's own first real positive entry before the next pass. Every later evaluation inherits a remaining value atBoundary has already made positive, so segmentRemaining alone is what actually bounds this loop from then on.
    while (segmentRemaining > 0) {
      const step = Math.min(segmentRemaining, remaining);
      cursor = {
        x: cursor.x + direction.x * step,
        y: cursor.y + direction.y * step,
      };
      segmentRemaining -= step;
      remaining -= step;
      if (current.length > 0) {
        current.push(cursor);
      }
      if (remaining === 0) {
        atBoundary();
      }
    }
  }
  // Called unconditionally: when current is already empty, endOnPiece's own length >= 2 check rejects it and resets current to [] again, exactly as if this call had been skipped.
  endOnPiece();
  return pieces;
}
