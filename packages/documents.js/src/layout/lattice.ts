import type { LayoutItem } from "pdf-codec";

// Gridline-lattice detection over a page's recovered geometry: the one place this package decides that a set of drawn strokes genuinely IS a printed grid rather than a scatter of unrelated rules. Lives in its own module because THREE reconstruction directions now share it -- reconstructSpreadsheet (where the lattice's own line positions become cell boundaries directly), and reconstructWordprocessing/reconstructPresentation (where an unambiguously detected lattice is the ONLY signal permitted to synthesize a ContentTable; see reconstruct.ts's own table-recovery note for why text alignment alone deliberately is not).
//
// Every threshold here is a deliberately conservative one: a false negative leaves content as ordinary paragraphs/cells, which is merely a missed improvement, while a false positive invents a structure the source never had. The bar is therefore "unambiguously a grid", not "plausibly a grid".

export interface LineSegment {
  readonly item: LayoutItem;
  readonly x1Pt: number;
  readonly y1Pt: number;
  readonly x2Pt: number;
  readonly y2Pt: number;
}

// A stroke reaches this function as either of two genuinely different LayoutItem shapes, and both must be accepted for detection to behave identically across producers. pdf-codec's own interpret.ts recovers an open, single-straight-segment, stroke-only subpath as a real LayoutLine (its shape-pattern detection, see that package's own README), so a gridline written by src/layout/sheets.ts's renderGridlines comes back from a genuine PDF round trip as a LayoutLine -- but a stroke that misses that pattern for any reason (several segments in one subpath, a subpath that is also filled) still arrives as a generic LayoutPath, and a LayoutDocument built by hand or by a producer other than readPdf may carry either. Accepting both is what makes a hand-built fixture and a real round-tripped document detect the same way.
export function extractLineCandidates(
  items: readonly LayoutItem[],
): LineSegment[] {
  const segments: LineSegment[] = [];
  for (const item of items) {
    if (item.kind === "line") {
      segments.push({
        item,
        x1Pt: item.x1Pt,
        y1Pt: item.y1Pt,
        x2Pt: item.x2Pt,
        y2Pt: item.y2Pt,
      });
      continue;
    }
    if (
      item.kind === "path" &&
      item.stroke !== undefined &&
      item.subpaths.length === 1
    ) {
      const subpath = item.subpaths[0]!;
      if (
        subpath.segments.length === 1 &&
        subpath.segments[0]!.kind === "line"
      ) {
        const segment = subpath.segments[0]!;
        segments.push({
          item,
          x1Pt: subpath.startXPt,
          y1Pt: subpath.startYPt,
          x2Pt: segment.xPt,
          y2Pt: segment.yPt,
        });
      }
    }
  }
  return segments;
}

// Tolerance for treating a segment as exactly horizontal/vertical -- generous enough to absorb the sub-point rounding a real PDF content-stream number format (4 decimal places, pdf-codec's serialize.ts) introduces on a round trip, tight enough that a genuinely diagonal line (a chart axis, a decorative rule) is never misread as a gridline.
const AXIS_ALIGNMENT_TOLERANCE_PT = 0.5;

// A stray tick mark or cell-border fragment is not evidence of a page-spanning gridline lattice -- only a segment at least this long is considered a lattice candidate at all.
const MIN_GRIDLINE_LENGTH_PT = 4;

interface AxisSegment {
  readonly axis: "horizontal" | "vertical";
  readonly position: number; // y for a horizontal candidate, x for a vertical one
  readonly startPt: number; // the segment's own extent along its own axis, low end
  readonly endPt: number; // ... and high end
  readonly item: LayoutItem;
}

function classifyAxisLine(seg: LineSegment): AxisSegment | undefined {
  const dx = Math.abs(seg.x2Pt - seg.x1Pt);
  const dy = Math.abs(seg.y2Pt - seg.y1Pt);
  if (dy <= AXIS_ALIGNMENT_TOLERANCE_PT && dx >= MIN_GRIDLINE_LENGTH_PT) {
    return {
      axis: "horizontal",
      position: (seg.y1Pt + seg.y2Pt) / 2,
      startPt: Math.min(seg.x1Pt, seg.x2Pt),
      endPt: Math.max(seg.x1Pt, seg.x2Pt),
      item: seg.item,
    };
  }
  if (dx <= AXIS_ALIGNMENT_TOLERANCE_PT && dy >= MIN_GRIDLINE_LENGTH_PT) {
    return {
      axis: "vertical",
      position: (seg.x1Pt + seg.x2Pt) / 2,
      startPt: Math.min(seg.y1Pt, seg.y2Pt),
      endPt: Math.max(seg.y1Pt, seg.y2Pt),
      item: seg.item,
    };
  }
  return undefined;
}

// Positions within this of each other are the same drawn boundary, not two distinct ones -- generous enough to absorb the same sub-point PDF rounding AXIS_ALIGNMENT_TOLERANCE_PT above already accounts for. Reused as the "these two collinear segments touch" threshold in mergeSpans below, for the same reason: two cell borders meeting at a shared corner are one continuous boundary, and only rounding stands between their endpoints coinciding exactly.
const POSITION_DEDUPE_TOLERANCE_PT = 0.5;

interface AxisLine {
  readonly position: number;
  readonly spanPt: number; // the longest CONTIGUOUS run of drawn line at this position
  readonly startPt: number; // that run's own extent, low end
  readonly endPt: number; // ... and high end
  readonly items: readonly LayoutItem[];
}

// The longest contiguous run formed by a set of collinear segments, merging any two that overlap or touch. This is what makes a table whose borders are drawn PER CELL (src/layout/shared.ts's own border emission draws one segment per cell edge, not one line across the whole row) measure the same span a single full-width gridline would -- without it, a three-column table's horizontal boundary would measure only one cell's width and fail the span-consistency check below against a wider neighbouring column. Merging is pure geometry, not inference: two touching collinear strokes genuinely are one drawn boundary. A deliberately non-contiguous set (a dashed rule drawn as separate dashes with real gaps) still measures only its longest single dash, so it is not silently promoted into a page-spanning line.
function longestContiguousSpan(segments: readonly AxisSegment[]): {
  spanPt: number;
  startPt: number;
  endPt: number;
} {
  const sorted = [...segments].sort((a, b) => a.startPt - b.startPt);
  let bestStart = sorted[0]!.startPt;
  let bestEnd = sorted[0]!.endPt;
  let runStart = sorted[0]!.startPt;
  let runEnd = sorted[0]!.endPt;
  for (const segment of sorted.slice(1)) {
    if (segment.startPt <= runEnd + POSITION_DEDUPE_TOLERANCE_PT) {
      runEnd = Math.max(runEnd, segment.endPt);
    } else {
      runStart = segment.startPt;
      runEnd = segment.endPt;
    }
    if (runEnd - runStart > bestEnd - bestStart) {
      bestStart = runStart;
      bestEnd = runEnd;
    }
  }
  return { spanPt: bestEnd - bestStart, startPt: bestStart, endPt: bestEnd };
}

// Groups near-duplicate positions into one boundary each (measuring every boundary's span across all the segments drawn at it, see longestContiguousSpan) and sorts them: descending for rows (PDF y grows upward, so the FIRST row boundary is the largest y, i.e. the top of the grid), ascending for columns (left to right).
function dedupeAxisLines(
  segments: readonly AxisSegment[],
  descending: boolean,
): AxisLine[] {
  const sorted = [...segments].sort((a, b) =>
    descending ? b.position - a.position : a.position - b.position,
  );
  const groups: AxisSegment[][] = [];
  for (const candidate of sorted) {
    const last = groups[groups.length - 1];
    if (
      last !== undefined &&
      Math.abs(candidate.position - last[0]!.position) <=
        POSITION_DEDUPE_TOLERANCE_PT
    ) {
      last.push(candidate);
    } else {
      groups.push([candidate]);
    }
  }
  return groups.map((group) => {
    const { spanPt, startPt, endPt } = longestContiguousSpan(group);
    return {
      position: group[0]!.position,
      spanPt,
      startPt,
      endPt,
      items: group.map((segment) => segment.item),
    };
  });
}

// At least 2 bounded rows/columns (3 boundary lines) before this counts as a lattice at all -- fewer is a page border or a couple of decorative rules, not a printed grid.
const MIN_GRIDLINE_COUNT_PER_AXIS = 3;

// A genuine gridline lattice draws every line the identical full grid width/height (layout/sheets.ts's own renderGridlines) -- so requiring most lines on an axis to reach close to that axis's own longest observed span is what actually distinguishes "these lines form a grid" from "these are just a few horizontal and vertical strokes that happen to coexist on the page" (a chart axis, an unrelated table border, a couple of decorative rules). 0.9 is generous enough to tolerate the sub-point rounding a real round trip introduces while still rejecting a scatter of unrelated short strokes.
const GRID_SPAN_CONSISTENCY_RATIO = 0.9;

function consistentLines(lines: readonly AxisLine[]): AxisLine[] {
  if (lines.length < MIN_GRIDLINE_COUNT_PER_AXIS) {
    return [];
  }
  const maxSpanPt = Math.max(...lines.map((l) => l.spanPt));
  const consistent = lines.filter(
    (l) => l.spanPt >= maxSpanPt * GRID_SPAN_CONSISTENCY_RATIO,
  );
  return consistent.length >= MIN_GRIDLINE_COUNT_PER_AXIS ? consistent : [];
}

export interface GridLattice {
  readonly rowBoundariesDescPt: readonly number[]; // top-to-bottom, PDF y descending
  readonly columnBoundariesAscPt: readonly number[]; // left-to-right, PDF x ascending
  // Every LayoutItem that contributed a segment to a KEPT boundary. A caller recovering both a table and free-standing vector primitives from the same page needs this to avoid emitting the lattice's own strokes twice -- once as the table's structure and again as loose line vectors alongside it.
  readonly sourceItems: ReadonlySet<LayoutItem>;
}

export function detectGridLattice(
  items: readonly LayoutItem[],
): GridLattice | undefined {
  const horizontal: AxisSegment[] = [];
  const vertical: AxisSegment[] = [];
  for (const seg of extractLineCandidates(items)) {
    const classified = classifyAxisLine(seg);
    if (classified === undefined) {
      continue;
    }
    (classified.axis === "horizontal" ? horizontal : vertical).push(classified);
  }
  const rowBoundaries = consistentLines(dedupeAxisLines(horizontal, true));
  const columnBoundaries = consistentLines(dedupeAxisLines(vertical, false));
  if (rowBoundaries.length === 0 || columnBoundaries.length === 0) {
    return undefined;
  }
  const sourceItems = new Set<LayoutItem>();
  for (const line of [...rowBoundaries, ...columnBoundaries]) {
    for (const item of line.items) {
      sourceItems.add(item);
    }
  }
  return {
    rowBoundariesDescPt: rowBoundaries.map((l) => l.position),
    columnBoundariesAscPt: columnBoundaries.map((l) => l.position),
    sourceItems,
  };
}

// Only the OUTER edge of the whole lattice gets any tolerance -- generous enough to keep an item sitting just past the grid's own outermost boundary (sub-point PDF-round-trip rounding) inside it. An INTERIOR boundary gets none at all: giving one would open an ambiguous zone straddling two adjacent bands (a real, caught bug -- a column narrow enough that cell-padding-scale tolerance on both sides of its own shared boundary let a neighbouring column's own text match the WRONG band first). A cell's own text sits comfortably away from its own band's far edge under ordinary conditions (near the bottom of its own row, near the left of its own column, per sheets.ts's own vertical-bottom alignment and per-cell inset), so a bare half-open partition at every interior boundary is both correct and unambiguous.
const OUTER_EDGE_TOLERANCE_PT = 3;

export function findRowIndex(
  rowBoundariesDescPt: readonly number[],
  yPt: number,
): number | undefined {
  const lastIndex = rowBoundariesDescPt.length - 1;
  if (
    yPt > rowBoundariesDescPt[0]! + OUTER_EDGE_TOLERANCE_PT ||
    yPt < rowBoundariesDescPt[lastIndex]! - OUTER_EDGE_TOLERANCE_PT
  ) {
    return undefined;
  }
  for (let i = 0; i < lastIndex; i++) {
    if (yPt > rowBoundariesDescPt[i + 1]!) {
      return i;
    }
  }
  return lastIndex - 1;
}

export function findColumnIndex(
  columnBoundariesAscPt: readonly number[],
  xPt: number,
): number | undefined {
  const lastIndex = columnBoundariesAscPt.length - 1;
  if (
    xPt < columnBoundariesAscPt[0]! - OUTER_EDGE_TOLERANCE_PT ||
    xPt > columnBoundariesAscPt[lastIndex]! + OUTER_EDGE_TOLERANCE_PT
  ) {
    return undefined;
  }
  for (let j = 0; j < lastIndex; j++) {
    if (xPt < columnBoundariesAscPt[j + 1]!) {
      return j;
    }
  }
  return lastIndex - 1;
}
