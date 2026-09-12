import type { Pt } from "./geometry";

// Area coverage, accumulated per pixel as a count of covered subsamples -- the one quantity every painted shape reduces to here. A fill computes the fraction of each pixel the shape covers; a blend then lerps the canvas toward the paint colour by that fraction, which is what makes edges antialiased (a half-covered boundary pixel lands halfway between background and paint) and overlaps order-independent within one shape.

// Subsamples per pixel axis: 4, so 16 subsamples per pixel and a coverage quantum of 1/16. Fixed rather than configurable so output pixels are a deterministic function of the draw ops alone -- two renders of the same page through this backend produce byte-identical PNGs on every runtime, which the workerd suite pins.
export const SUPERSAMPLE_PER_AXIS = 4;

// The denominator every blend divides a subsample count by; exported for the tests' expected-value arithmetic so a supersample change updates both together.
export const COVERAGE_DENOMINATOR = SUPERSAMPLE_PER_AXIS * SUPERSAMPLE_PER_AXIS;

export type FillRule = "nonzero" | "evenodd";

// The first subsample index along one axis whose own centre falls at or after `coordinate`, clamped to the grid's own first index. Subsample index k samples at (k + 0.5) / SUPERSAMPLE_PER_AXIS, so the first index at or past a coordinate is ceil(coordinate * SUPERSAMPLE_PER_AXIS - 0.5). Shared by the scanline's row range and the span walk's column range rather than written out twice: both bounds mean the same thing on their own axis, and stating it once is what makes the span walk's own pixel-level assertions cover the row range's arithmetic too.
function firstSampleAtOrAfter(coordinate: number): number {
  return Math.max(0, Math.ceil(coordinate * SUPERSAMPLE_PER_AXIS - 0.5));
}

// The last subsample index along one axis whose own centre falls strictly before `coordinate`, clamped to the last index a `sizePx`-pixel axis has -- the inclusive counterpart of firstSampleAtOrAfter, and shared by the same two callers.
function lastSampleBefore(coordinate: number, sizePx: number): number {
  return Math.min(
    SUPERSAMPLE_PER_AXIS * sizePx - 1,
    Math.floor(coordinate * SUPERSAMPLE_PER_AXIS - 0.5),
  );
}

// One scanline pass over a set of closed polygons, accumulating subsample counts. The polygons of one call are walked together, not one at a time: a path op's fill rule spans all of its subpaths (the winding that decides whether the inner ring of an "O" glyph is a hole is accumulated across contours), and a stroke's constituent quads and join wedges rely on the same property to union -- overlapping consistently-wound polygons sum their winding, and nonzero keeps the union rather than double-painting it.
export class CoverageMask {
  readonly widthPx: number;
  readonly heightPx: number;
  private readonly counts: Uint16Array;
  // The inclusive pixel-index range every mark since the last reset has landed in. Seeded to an empty range (a first past the last valid index, a last at the very first one) so a mask nothing has marked walks no pixels at all, and grown by markSpan as it writes.
  private markedFirst: number;
  private markedLast: number;

  constructor(widthPx: number, heightPx: number) {
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.counts = new Uint16Array(widthPx * heightPx);
    this.markedFirst = this.counts.length;
    this.markedLast = 0;
  }

  reset(): void {
    this.counts.fill(0);
    this.markedFirst = this.counts.length;
    this.markedLast = 0;
  }

  countAt(pixelIndex: number): number {
    return this.counts[pixelIndex] ?? 0;
  }

  // The inclusive pixel-index range this mask may hold a nonzero count in, as { first, last } -- empty when last is below first, which is how a mask nothing has marked reads. Every pixel outside it is guaranteed zero, so a blend pass walks this range rather than the whole canvas: for a small shape on a large page that is the difference between the shape's own pixels and every pixel of the page.
  markedRange(): { readonly first: number; readonly last: number } {
    return { first: this.markedFirst, last: this.markedLast };
  }

  // The sub-scanline fill: for each subsample row, find every polygon edge crossing it, sort the crossings by x, and derive the covered x-spans from the winding rule. The half-open crossing test ((a.y <= y) !== (b.y <= y)) counts an edge whose endpoint sits exactly on the row exactly once rather than twice, and a polygon's implied closing edge is walked like any other, so an open subpath handed in as a polygon is filled as implicitly closed -- the port's own fill semantics (ISO 32000-1 8.5.3.1).
  fillPolygons(polygons: readonly (readonly Pt[])[], fillRule: FillRule): void {
    // The y-coordinates of every point that bounds area, collected first so the scan range below reduces over a real list rather than over a pair of infinite sentinels: an input that bounds no area at all leaves this empty, which is the one state that needs its own answer.
    const boundedYs: number[] = [];
    for (const polygon of polygons) {
      if (polygon.length < 3) {
        continue; // a degenerate polygon (a point or a segment) bounds no area, and coverage.test.ts's "does not let a degenerate two-point polygon influence the bounding box" pins why this filter earns its keep despite the two-point case's crossings mostly cancelling on their own: floating-point rounding between an edge and its own reverse traversal can leave a hairline residual that is not otherwise nothing
      }
      for (const point of polygon) {
        boundedYs.push(point.y);
      }
    }
    if (boundedYs.length === 0) {
      return; // nothing here bounds any area, so no scanline can cross anything
    }
    // No separate all-horizontal guard: a polygon set whose every point shares one y gives a rowMin at or above its own rowMax (ceil never falls below floor), and even the one row they can coincide on samples at exactly that shared y, where the half-open crossing test below reads both ends of every edge as on the same side and takes none of them.
    const rowMin = firstSampleAtOrAfter(
      boundedYs.reduce((lowest, y) => Math.min(lowest, y)),
    );
    const rowMax = lastSampleBefore(
      boundedYs.reduce((highest, y) => Math.max(highest, y)),
      this.heightPx,
    );
    const crossings: { x: number; downward: boolean }[] = [];
    for (let row = rowMin; row <= rowMax; row++) {
      const y = (row + 0.5) / SUPERSAMPLE_PER_AXIS;
      crossings.length = 0;
      for (const polygon of polygons) {
        // entries() bounds the walk by the polygon itself rather than by an index comparison of its own, and hands back a point the type system already knows is there; the modulo wraps the last edge back to the first point, closing the ring.
        for (const [i, a] of polygon.entries()) {
          const b = polygon[(i + 1) % polygon.length];
          if (b === undefined) {
            continue; // unreachable: the modulo keeps the index inside the polygon
          }
          const aAtOrAboveRow = a.y <= y;
          const bAtOrAboveRow = b.y <= y;
          if (aAtOrAboveRow === bAtOrAboveRow) {
            continue; // no crossing, or a horizontal edge
          }
          const t = (y - a.y) / (b.y - a.y);
          crossings.push({
            x: a.x + t * (b.x - a.x),
            // The edge crosses this row downward exactly when its own start point is the one at or above the row -- the check just above has already established that its two ends sit on opposite sides of it, so no second comparison of the two y values is needed (or wanted: the two ends are known to differ, which would leave such a comparison's own boundary case unreachable).
            downward: aAtOrAboveRow,
          });
        }
      }
      // No explicit empty-crossings guard: crossings.sort and the for-of loop below are both no-ops on an empty array, so this row falls through to the next one on its own without needing to say so.
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
        const wasZero = winding === 0;
        // A downward-crossing edge and an upward-crossing one must move the winding number in opposite directions -- that's what lets a reverse-wound inner contour cancel the outer one back to zero and read as a hole under nonzero. Branching on crossing.downward to choose ++ versus -- (rather than accumulating a single signed step, e.g. `winding += crossing.downward ? 1 : -1`) means a mutation to either branch alone breaks that cancellation for one crossing direction but not the other, so it shows up as a real painted-pixel difference instead of the uniform sign flip a single shared addition would let cancel out.
        if (crossing.downward) {
          winding++;
        } else {
          winding--;
        }
        // wasZero && winding !== 0, simplified: winding always moves by exactly 1 (see above), never 0, so winding (== previous +/- 1) can only equal the previous value when that step is 0, which never happens -- whenever the previous value was zero, winding is therefore already guaranteed nonzero, making the second clause redundant.
        if (wasZero) {
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
    const columnFirst = firstSampleAtOrAfter(startX);
    const columnLast = lastSampleBefore(endX, this.widthPx);
    for (let c = columnFirst; c <= columnLast; c++) {
      const cellIndex = pixelRowBase + Math.floor(c / SUPERSAMPLE_PER_AXIS);
      const cell = this.counts[cellIndex];
      if (cell !== undefined) {
        this.counts[cellIndex] = cell + 1;
        this.markedFirst = Math.min(this.markedFirst, cellIndex);
        this.markedLast = Math.max(this.markedLast, cellIndex);
      }
    }
  }
}
