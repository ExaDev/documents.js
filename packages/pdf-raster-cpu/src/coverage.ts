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
    // No explicit empty-input guard: an empty polygons array leaves minY at +Infinity and maxY at -Infinity below, and the maxY <= minY check just past the loop already returns for exactly that state, so a dedicated early return here would only ever repeat a decision the next check already makes for this specific input.
    let minY = Infinity;
    // Stryker disable next-line UnaryOperator: flipping this to +Infinity only ever widens the rowMax computed below to include extra rows past the real shape's bottom edge (or past the canvas, which CoverageMask silently ignores) -- see the ArithmeticOperator/MethodExpression disable comments on the rowMax computation for the full argument, which applies identically here since this initial value only ever feeds that same clamp.
    let maxY = -Infinity;
    for (const polygon of polygons) {
      if (polygon.length < 3) {
        continue; // a degenerate polygon (a point or a segment) bounds no area, and coverage.test.ts's "does not let a degenerate two-point polygon influence the bounding box" pins why this filter earns its keep despite the two-point case's crossings mostly cancelling on their own: floating-point rounding between an edge and its own reverse traversal can leave a hairline residual that is not otherwise nothing
      }
      for (const point of polygon) {
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }
    // Stryker disable next-line ConditionalExpression,EqualityOperator,BlockStatement: every edge below is skipped by the `a.y <= y === b.y <= y` horizontal check whenever a.y === b.y, independently of this guard -- so an all-horizontal polygon set (the only way maxY can equal minY here) already contributes zero crossings at every row on its own. Loosening, removing, or emptying this check only means scanning extra rows that were always going to find nothing; it cannot change a single painted pixel.
    if (maxY <= minY) {
      return; // every polygon is horizontal: no scanline crosses anything
    }
    // Stryker disable next-line MethodExpression,ArithmeticOperator: swapping this Math.max for Math.min, or the multiply for a divide, can only ever pull rowMin to something at or below the correct value (proof: for minY <= 0 both the correct and the divided term floor to a clamped 0; for minY > 0 the divided term is strictly smaller than the multiplied one, so Math.max(0, ...) on it is never larger). Extra rows above the real shape's own top edge fall outside every one of its edges' own y-spans, so the per-edge crossing test above already excludes them -- there is nothing there for a wider range to reveal.
    const rowMin = Math.max(0, Math.ceil(minY * SUPERSAMPLE_PER_AXIS - 0.5));
    // Stryker disable next-line MethodExpression: swapping this Math.min for Math.max can only ever raise rowMax, and the two ways it can rise -- past the canvas's own last pixel row, or past the real shape's own bottom edge -- are each covered by their own disable comment on the two arguments just below.
    const rowMax = Math.min(
      // Stryker disable next-line ArithmeticOperator: a +1 here only raises this clamp two subsample rows past the canvas's real last pixel row; CoverageMask (a fixed-size Uint16Array) silently drops any write at an index that far out of range, so the extra rows this could ever admit paint nothing.
      SUPERSAMPLE_PER_AXIS * this.heightPx - 1,
      // Stryker disable next-line ArithmeticOperator: shifting this by +0.5 instead of -0.5 always raises the floored value by exactly 1 (the two terms differ by the constant 1, and floor(x + 1) === floor(x) + 1 for any real x), so this can only ever admit one extra row past the shape's real bottom edge -- past every edge's own y-span, hence crossing-free, by the same argument as the rowMin clamp above.
      Math.floor(maxY * SUPERSAMPLE_PER_AXIS - 0.5),
    );
    const crossings: { x: number; dir: number }[] = [];
    for (let row = rowMin; row <= rowMax; row++) {
      const y = (row + 0.5) / SUPERSAMPLE_PER_AXIS;
      crossings.length = 0;
      for (const polygon of polygons) {
        // Stryker disable next-line EqualityOperator: an off-by-one i <= polygon.length runs one further iteration with a === polygon[polygon.length] === undefined, which the very next line's own undefined guard already discards -- that guard exists for exactly this shape of out-of-range access, so loosening the loop bound by one cannot reach any code the guard does not already catch.
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
            // Stryker disable next-line EqualityOperator: this line's own preceding guard already forces a.y !== b.y whenever this ternary runs (a.y <= y === b.y <= y is only false, i.e. only reaches here, when the two sides disagree, which for two booleans compared against the same y is only possible when a.y and b.y fall strictly on opposite sides of it), so b.y > a.y and b.y >= a.y agree here always; and every crossing.dir this produces feeds only into a running sum compared against zero (winding !== 0 / winding === 0), where negating every dir in the sum uniformly -- which is what a b.y <= a.y swap would do here instead, since > and <= are the two exhaustive, mutually exclusive outcomes once a.y !== b.y is guaranteed -- preserves every point at which that sum crosses zero, so neither rewrite can change which spans get painted.
            dir: b.y > a.y ? 1 : -1,
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
        const previous = winding;
        // Stryker disable next-line AssignmentOperator: crossing.dir is always exactly 1 or -1 (see the ternary above), never 0, so accumulating with -= instead of += only ever negates every term of this running sum uniformly. A sum and its uniform negation cross zero at exactly the same crossings (S = 0 iff -S = 0), so the spans this loop opens and closes are identical either way.
        winding += crossing.dir;
        // previous === 0 && winding !== 0, simplified: crossing.dir is always 1 or -1 (never 0), so winding (== previous + crossing.dir) can only equal previous when crossing.dir is 0, which never happens -- whenever previous is 0, winding is therefore already guaranteed nonzero, making the second clause redundant.
        if (previous === 0) {
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
