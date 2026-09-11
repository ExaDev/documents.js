// A point in the port's device space: pixels, origin at the rendered region's own top-left corner, x right, y down -- the one coordinate system every RasterDrawOp already carries, so nothing here flips anything.
export interface Pt {
  readonly x: number;
  readonly y: number;
}

// The flattening tolerance every cubic in a fill or stroke outline is subdivided to meet, in device pixels, and the depth cap that keeps a pathological curve finite even for a tolerance it never quite meets. These mirror the constants pdf-codec's own raster walk flattens dotted strokes with (src/raster.ts there), so a dotted line this backend draws and the geometry the port computes agree about where a curve's polyline runs -- the two constants are deliberately the same number on both sides of the port rather than independently chosen ones that could drift.
export const FLATTEN_TOLERANCE_PX = 0.05;
export const MAX_FLATTEN_DEPTH = 16;

// De Casteljau subdivision of one cubic into a polyline, splitting recursively until every piece's control points sit within FLATTEN_TOLERANCE_PX of its chord. Deterministic (identical inputs produce identical pieces), which the pixel-asserting tests rely on; returns the interior points only, so a caller walking p0 -> result -> p1 traverses the whole curve.
export function flattenCubic(p0: Pt, c1: Pt, c2: Pt, p1: Pt): readonly Pt[] {
  const points: Pt[] = [];
  const flatten = (a: Pt, b: Pt, c: Pt, d: Pt, depth: number): void => {
    const chordX = d.x - a.x;
    const chordY = d.y - a.y;
    const chordLength = Math.hypot(chordX, chordY) || 1;
    const dist1 =
      Math.abs((b.x - a.x) * chordY - (b.y - a.y) * chordX) / chordLength;
    const dist2 =
      Math.abs((c.x - a.x) * chordY - (c.y - a.y) * chordX) / chordLength;
    if (
      depth >= MAX_FLATTEN_DEPTH ||
      Math.max(dist1, dist2) <= FLATTEN_TOLERANCE_PX
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
