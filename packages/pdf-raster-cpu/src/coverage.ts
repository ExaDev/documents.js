import type { Pt } from "./geometry";

// Area coverage, accumulated per pixel as a count of covered subsamples -- the one quantity every painted shape reduces to here. A fill computes the fraction of each pixel the shape covers; a blend then lerps the canvas toward the paint colour by that fraction, which is what makes edges antialiased (a half-covered boundary pixel lands halfway between background and paint) and overlaps order-independent within one shape.

// Subsamples per pixel axis: 4, so 16 subsamples per pixel and a coverage quantum of 1/16. Fixed rather than configurable so output pixels are a deterministic function of the draw ops alone -- two renders of the same page through this backend produce byte-identical PNGs on every runtime, which the workerd suite pins.
export const SUPERSAMPLE_PER_AXIS = 4;

// The denominator every blend divides a subsample count by; exported for the tests' expected-value arithmetic so a supersample change updates both together.
export const COVERAGE_DENOMINATOR = SUPERSAMPLE_PER_AXIS * SUPERSAMPLE_PER_AXIS;

export type FillRule = "nonzero" | "evenodd";

// One scanline pass over a set of closed polygons, accumulating subsample counts. The polygons of one call are walked together, not one at a time: a path op's fill rule spans all of its subpaths (the winding that decides whether the inner ring of an "O" glyph is a hole is accumulated across contours), and a stroke's constituent quads and join wedges rely on the same property to union -- overlapping consistently-wound polygons sum their winding, and nonzero keeps the union rather than double-painting it.
export class CoverageMask {
  readonly widthPx: number;
  readonly heightPx: number;
  private readonly counts: Uint16Array;

  constructor(widthPx: number, heightPx: number) {
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.counts = new Uint16Array(widthPx * heightPx);
  }

  reset(): void {
    this.counts.fill(0);
  }

  countAt(pixelIndex: number): number {
    return this.counts[pixelIndex] ?? 0;
  }

  // The sub-scanline fill: for each subsample row, find every polygon edge crossing it, sort the crossings by x, and derive the covered x-spans from the winding rule. The half-open crossing test ((a.y <= y) !== (b.y <= y)) counts an edge whose endpoint sits exactly on the row exactly once rather than twice, and a polygon's implied closing edge is walked like any other, so an open subpath handed in as a polygon is filled as implicitly closed -- the port's own fill semantics (ISO 32000-1 8.5.3.1).
  fillPolygons(polygons: readonly (readonly Pt[])[], fillRule: FillRule): void {
    if (polygons.length === 0) {
      return;
    }
    let minY = Infinity;
    let maxY = -Infinity;
    for (const polygon of polygons) {
      if (polygon.length < 3) {
        continue; // a degenerate polygon (a point or a segment) bounds no area
      }
      for (const point of polygon) {
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }
    if (maxY <= minY) {
      return; // every polygon is horizontal: no scanline crosses anything
    }
    const rowMin = Math.max(0, Math.ceil(minY * SUPERSAMPLE_PER_AXIS - 0.5));
    const rowMax = Math.min(
      SUPERSAMPLE_PER_AXIS * this.heightPx - 1,
      Math.floor(maxY * SUPERSAMPLE_PER_AXIS - 0.5),
    );
    const crossings: { x: number; dir: number }[] = [];
    for (let row = rowMin; row <= rowMax; row++) {
      const y = (row + 0.5) / SUPERSAMPLE_PER_AXIS;
      crossings.length = 0;
      for (const polygon of polygons) {
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i];
          const b = polygon[(i + 1) % polygon.length];
          if (a === undefined || b === undefined) {
            continue; // unreachable: i is bounded by the polygon's own length
          }
          if (a.y <= y === b.y <= y) {
            continue; // no crossing, or a horizontal edge
          }
          const t = (y - a.y) / (b.y - a.y);
          crossings.push({
            x: a.x + t * (b.x - a.x),
            dir: b.y > a.y ? 1 : -1,
          });
        }
      }
      if (crossings.length === 0) {
        continue;
      }
      crossings.sort((p, q) => p.x - q.x);
      const pixelRowBase =
        Math.floor(row / SUPERSAMPLE_PER_AXIS) * this.widthPx;
      let spanStartX: number | undefined;
      let winding = 0;
      for (const crossing of crossings) {
        if (fillRule === "evenodd") {
          if (spanStartX === undefined) {
            spanStartX = crossing.x;
          } else {
            this.markSpan(pixelRowBase, spanStartX, crossing.x);
            spanStartX = undefined;
          }
          continue;
        }
        const previous = winding;
        winding += crossing.dir;
        if (previous === 0 && winding !== 0) {
          spanStartX = crossing.x;
        } else if (spanStartX !== undefined && winding === 0) {
          this.markSpan(pixelRowBase, spanStartX, crossing.x);
          spanStartX = undefined;
        }
      }
    }
  }

  // Marks the subsample columns whose centres fall inside one covered span [startX, endX) of one subsample row: subsample column c has centre (c + 0.5) / SUPERSAMPLE_PER_AXIS, so c runs from the first centre at or past startX to the last centre before endX.
  private markSpan(pixelRowBase: number, startX: number, endX: number): void {
    if (endX <= startX) {
      return;
    }
    const columnFirst = Math.max(
      0,
      Math.ceil(startX * SUPERSAMPLE_PER_AXIS - 0.5),
    );
    const columnLast = Math.min(
      SUPERSAMPLE_PER_AXIS * this.widthPx - 1,
      Math.floor(endX * SUPERSAMPLE_PER_AXIS - 0.5),
    );
    for (let c = columnFirst; c <= columnLast; c++) {
      const cellIndex = pixelRowBase + Math.floor(c / SUPERSAMPLE_PER_AXIS);
      const cell = this.counts[cellIndex];
      if (cell !== undefined) {
        this.counts[cellIndex] = cell + 1;
      }
    }
  }
}
