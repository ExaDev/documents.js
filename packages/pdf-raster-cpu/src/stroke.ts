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
    for (let i = 0; i + 1 < piece.length; i++) {
      const p = piece[i];
      const q = piece[i + 1];
      if (p === undefined || q === undefined) {
        continue; // unreachable: the loop bound keeps both indices inside the piece
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
    // Join wedges at interior vertices. The wedge sits on the outside of the turn: with the left normals of the incoming and outgoing directions, the outside is the side the cross product names (the two offset edges diverge there, leaving a notch; on the inside they cross and the quads already overlap).
    for (let i = 1; i + 1 < piece.length; i++) {
      const vertex = piece[i];
      const before = piece[i - 1];
      const after = piece[i + 1];
      if (vertex === undefined || before === undefined || after === undefined) {
        continue; // unreachable: the loop bound keeps all three indices inside the piece
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
      if (subpath.closed && subpath.points.length >= 3) {
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
  const side = cross > 0 ? -1 : 1;
  const n1 = { x: -d1.y * side, y: d1.x * side };
  const n2 = { x: -d2.y * side, y: d2.x * side };
  const a1 = { x: vertex.x + n1.x * half, y: vertex.y + n1.y * half };
  const a2 = { x: vertex.x + n2.x * half, y: vertex.y + n2.y * half };
  const dot = n1.x * n2.x + n1.y * n2.y;
  const denominator = 1 + dot;
  let wedge: readonly Pt[];
  if (denominator > 1e-12 && miterRatio(dot) <= DEFAULT_MITER_LIMIT) {
    const scale = half / denominator;
    const miter = {
      x: vertex.x + (n1.x + n2.x) * scale,
      y: vertex.y + (n1.y + n2.y) * scale,
    };
    wedge = [a1, miter, a2, vertex];
  } else {
    wedge = [a1, vertex, a2];
  }
  polygons.push(
    polygonSignedArea(wedge) < 0 ? [...wedge] : [...wedge].reverse(),
  );
}

// The miter length as a multiple of the half-width, from the dot product of the two outer normals: |n1 + n2| / (1 + n1 . n2) = 1 / cos(theta / 2), where theta is the angle between them -- straight continuation 1, right angle sqrt(2), reversal unbounded.
function miterRatio(dot: number): number {
  return Math.sqrt(2 + 2 * dot) / (1 + dot);
}

// Twice the signed area of a polygon (the shoelace sum), negative when wound the same way as the offset quads, whose fixed vertex order gives them a constant negative sign by construction.
function polygonSignedArea(polygon: readonly Pt[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a === undefined || b === undefined) {
      continue; // unreachable: i is bounded by the polygon's own length
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

// Splits one polyline (with its closing segment when the subpath is closed) into its dash pattern's "on" pieces, phase 0 -- the port's dash arrays always start on ([3w, 3w] for a recovered dashed style), matching the writer's own convention. Whether the walk is currently emitting is not separate state: dash entries alternate on/off by position (entry 0 on, entry 1 off, and so on), so emission is exactly "the pattern index is even". An all-zero pattern paints nothing, exactly as PDF's own Table 52 note describes for a zero on-length under a butt cap.
function dashPolyline(
  subpath: FlattenedSubpath,
  dashPx: readonly number[],
): readonly (readonly Pt[])[] {
  if (!dashPx.some((length) => length > 0)) {
    return [];
  }
  // ISO 32000-1 8.4.3.6: an odd-length array is treated as if repeated twice ([3] behaves as [3, 3]), so the walk always cycles an even number of entries and parity keeps naming emission.
  const pattern = dashPx.length % 2 === 1 ? [...dashPx, ...dashPx] : dashPx;
  const points = subpath.closed
    ? [...subpath.points, subpath.points[0]]
    : subpath.points;
  const start = points[0];
  if (start === undefined) {
    return [];
  }
  const pieces: Pt[][] = [];
  const endOnPiece = (): void => {
    if (current.length >= 2) {
      pieces.push(current);
    }
    current = [];
  };
  // Advances past the entry just exhausted (and past any further zero-length entries -- the all-zero pattern was rejected on entry, so this always terminates), then opens a fresh on-piece when the walk lands on an even index.
  const atBoundary = (): void => {
    if (index % 2 === 0) {
      endOnPiece();
    }
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
  const firstEntry = pattern[0];
  if (firstEntry !== undefined && firstEntry > 0) {
    remaining = firstEntry;
    current = [cursor];
  } else {
    atBoundary(); // a zero-length first entry emits nothing; run one boundary transition from the path's start point
  }
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (from === undefined || to === undefined) {
      continue; // unreachable: the loop bound keeps both indices inside points
    }
    const direction = unitDirection(from, to);
    if (direction === undefined) {
      continue; // a repeated point contributes no length to dash or stroke geometry
    }
    cursor = from;
    let segmentRemaining = Math.hypot(to.x - from.x, to.y - from.y);
    while (segmentRemaining > 0 && remaining > 0) {
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
  if (current.length > 0) {
    endOnPiece();
  }
  return pieces;
}
