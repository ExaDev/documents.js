import type { LayoutItem } from "pdf-codec";

// Gridline-lattice detection over a page's recovered geometry: the one place this package decides that a set of drawn strokes genuinely IS a printed grid rather than a scatter of unrelated rules. Lives in its own module because THREE reconstruction directions now share it -- reconstructSpreadsheet (where the lattice's own line positions become cell boundaries directly), and reconstructWordprocessing/reconstructPresentation (where an unambiguously detected lattice is the ONLY signal permitted to synthesize a ContentTable; see reconstruct.ts's own table-recovery note for why text alignment alone deliberately is not).
//
// Every threshold here is a deliberately conservative one: a false negative leaves content as ordinary paragraphs/cells, which is merely a missed improvement, while a false positive invents a structure the source never had. The bar is therefore "unambiguously a grid", not "plausibly a grid".
//
// A real printed table's rows do not all have to share one uniform column layout (ExaDev/documents.js#810): a title-block or "field: value" style table routinely has some cells spanning several of the table's own columns or rows, so an individual boundary segment genuinely only needs to run as far as the cells either side of it actually require -- not the whole table's own width or height. Detection therefore works in two passes: first, does the outer perimeter close into one genuine rectangle at all (hasClosedOuterRectangle); second, for every pair of atomic cells inside that rectangle, is there an actual drawn stroke separating them (findCellRegions) -- two atomic cells with no stroke between them are one merged cell (a colSpan/rowSpan region), not two. This replaces an earlier, simpler rule that compared every candidate boundary's own span against the single longest one found anywhere on the axis, which rejected a genuine table the moment any one row or column's own cells were narrower than the table's widest row.

export interface LineSegment {
  readonly item: LayoutItem;
  readonly x1Pt: number;
  readonly y1Pt: number;
  readonly x2Pt: number;
  readonly y2Pt: number;
}

// A stroke reaches this function as either of two genuinely different LayoutItem shapes, and both must be accepted for detection to behave identically across producers. pdf-codec's own interpret.ts recovers an open, single-straight-segment, stroke-only subpath as a real LayoutLine (its shape-pattern detection, see that package's own README), so a gridline written by src/layout/sheets.ts's renderGridlines comes back from a genuine PDF round trip as a LayoutLine -- but a stroke that misses that pattern for any reason (several segments in one subpath, a subpath that is also filled) still arrives as a generic LayoutPath, and a LayoutDocument built by hand or by a producer other than readPdf may carry either. Accepting both is what makes a hand-built fixture and a real round-tripped document detect the same way.
//
// A third real shape joins these two: several production PDF generators draw a table's gridlines as a thin FILLED rectangle rather than a genuinely stroked line/path at all -- confirmed directly against real-world documents, where every observed gridline rect measured 0.12-2.30pt thick on its short axis. RECT_LINE_THICKNESS_TOLERANCE_PT (below) draws the line between "this rect IS a drawn line, just filled instead of stroked" and "this rect is a genuinely filled 2D block" (a shaded cell background, a coloured panel) -- a rect thin on exactly one axis is the former, read as one line segment along its long axis; a rect that is thin on neither axis, or equally thin/wide on both (a small square artefact, a corner joint), is neither and contributes nothing.
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
      continue;
    }
    if (item.kind === "rect") {
      const isThinEnoughToBeALine =
        Math.min(item.widthPt, item.heightPt) <=
        RECT_LINE_THICKNESS_TOLERANCE_PT;
      if (isThinEnoughToBeALine && item.widthPt > item.heightPt) {
        const midYPt = item.yPt + item.heightPt / 2;
        segments.push({
          item,
          x1Pt: item.xPt,
          y1Pt: midYPt,
          x2Pt: item.xPt + item.widthPt,
          y2Pt: midYPt,
        });
      } else if (isThinEnoughToBeALine && item.heightPt > item.widthPt) {
        const midXPt = item.xPt + item.widthPt / 2;
        segments.push({
          item,
          x1Pt: midXPt,
          y1Pt: item.yPt,
          x2Pt: midXPt,
          y2Pt: item.yPt + item.heightPt,
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

// The short-axis thickness under which a filled LayoutRect reads as a drawn line rather than a genuinely filled 2D block -- see extractLineCandidates' own module comment for the real-world producer pattern this exists for. 3pt comfortably covers the observed 0.12-2.30pt range of real gridline-rect thicknesses while still excluding an ordinary filled cell/shading block, which is wide AND tall, not thin on exactly one axis.
const RECT_LINE_THICKNESS_TOLERANCE_PT = 3;

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

// Positions within this of each other are the same drawn boundary, not two distinct ones -- generous enough to absorb the same sub-point PDF rounding AXIS_ALIGNMENT_TOLERANCE_PT above already accounts for. Reused as the "these two collinear segments touch" threshold in mergedRanges below, for the same reason: two cell borders meeting at a shared corner are one continuous boundary, and only rounding stands between their endpoints coinciding exactly.
const POSITION_DEDUPE_TOLERANCE_PT = 0.5;

interface Range {
  readonly startPt: number;
  readonly endPt: number;
}

interface AxisLine {
  readonly position: number;
  // Every maximal contiguous run formed by the segments drawn at this position, merging any two that overlap or touch (see mergedRanges) -- NOT collapsed to a single "best" span, because a boundary genuinely covering only PART of the table's own width/height (a row whose own cells are narrower than a wider neighbour, ExaDev/documents.js#810) is exactly the case this module now has to represent rather than discard.
  readonly ranges: readonly Range[];
  readonly items: readonly LayoutItem[];
}

// Every maximal contiguous run formed by a set of collinear segments, merging any two that overlap or touch. This is what makes a table whose borders are drawn PER CELL (src/layout/shared.ts's own border emission draws one segment per cell edge, not one line across the whole row) measure the same span a single full-width gridline would -- without it, a three-column table's horizontal boundary would measure only one cell's width. Merging is pure geometry, not inference: two touching collinear strokes genuinely are one drawn boundary. A deliberately non-contiguous set (a dashed rule drawn as separate dashes with real gaps, or two genuinely separate row boundaries that happen to share a dedupe bucket) keeps its own gaps rather than being silently bridged into one run.
function mergedRanges(segments: readonly AxisSegment[]): Range[] {
  const sorted = [...segments].sort((a, b) => a.startPt - b.startPt);
  const ranges: { startPt: number; endPt: number }[] = [
    { startPt: sorted[0]!.startPt, endPt: sorted[0]!.endPt },
  ];
  for (const segment of sorted.slice(1)) {
    const last = ranges[ranges.length - 1]!;
    if (segment.startPt <= last.endPt + POSITION_DEDUPE_TOLERANCE_PT) {
      last.endPt = Math.max(last.endPt, segment.endPt);
    } else {
      ranges.push({ startPt: segment.startPt, endPt: segment.endPt });
    }
  }
  return ranges;
}

// Groups near-duplicate positions into one boundary each (measuring every boundary's own drawn coverage across all the segments at it, see mergedRanges) and sorts them: descending for rows (PDF y grows upward, so the FIRST row boundary is the largest y, i.e. the top of the grid), ascending for columns (left to right).
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
  return groups.map((group) => ({
    position: group[0]!.position,
    ranges: mergedRanges(group),
    items: group.map((segment) => segment.item),
  }));
}

// At least 2 bounded rows/columns (3 boundary lines) before this counts as a lattice at all -- fewer is a page border or a couple of decorative rules, not a printed grid.
const MIN_GRIDLINE_COUNT_PER_AXIS = 3;

// How much of a target stretch (the outer perimeter's own opposite extent, or one atomic cell's own edge) a single drawn run must cover before it counts as genuinely closing/dividing there. Applied at two different scales by the two checks below -- the outer rectangle's own four sides, and every interior cell-to-cell edge -- but it is the same question at heart: is there a real, (near-)unbroken stroke across this stretch, or only a fragment of one. 0.9 is generous enough to tolerate the sub-point rounding a real round trip introduces while still rejecting a scatter of unrelated short strokes.
const EDGE_COVERAGE_RATIO = 0.9;

// The best single run's own overlap with [aPt, bPt], as a fraction of that target's length -- never the SUM of several disjoint runs, so a boundary broken by a real gap (as opposed to touching segments mergedRanges already fused) is never credited with covering more than its own longest unbroken piece.
function bestRunCoverageRatio(
  ranges: readonly Range[],
  aPt: number,
  bPt: number,
): number {
  const lo = Math.min(aPt, bPt);
  const hi = Math.max(aPt, bPt);
  if (hi <= lo) {
    return 1;
  }
  let bestPt = 0;
  for (const range of ranges) {
    const overlapLo = Math.max(range.startPt, lo);
    const overlapHi = Math.min(range.endPt, hi);
    if (overlapHi > overlapLo) {
      bestPt = Math.max(bestPt, overlapHi - overlapLo);
    }
  }
  return bestPt / (hi - lo);
}

// The lattice's own outer perimeter must be a genuinely closed rectangle: the topmost and bottommost row boundaries must each nearly fully span the columns' own outer extent, and the leftmost and rightmost column boundaries must each nearly fully span the rows' own outer extent. This is the "these are unrelated strokes that happen to coexist on the page" guard the old whole-axis span-consistency rule used to provide -- but scoped to the four edges that actually decide whether a table's own outer box exists, so an interior row or column genuinely narrower than its neighbours (ExaDev/documents.js#810) is no longer judged by the same yardstick.
function hasClosedOuterRectangle(
  rowLines: readonly AxisLine[],
  columnLines: readonly AxisLine[],
): boolean {
  const leftXPt = columnLines[0]!.position;
  const rightXPt = columnLines[columnLines.length - 1]!.position;
  const topYPt = rowLines[0]!.position;
  const bottomYPt = rowLines[rowLines.length - 1]!.position;
  return (
    bestRunCoverageRatio(rowLines[0]!.ranges, leftXPt, rightXPt) >=
      EDGE_COVERAGE_RATIO &&
    bestRunCoverageRatio(
      rowLines[rowLines.length - 1]!.ranges,
      leftXPt,
      rightXPt,
    ) >= EDGE_COVERAGE_RATIO &&
    bestRunCoverageRatio(columnLines[0]!.ranges, bottomYPt, topYPt) >=
      EDGE_COVERAGE_RATIO &&
    bestRunCoverageRatio(
      columnLines[columnLines.length - 1]!.ranges,
      bottomYPt,
      topYPt,
    ) >= EDGE_COVERAGE_RATIO
  );
}

// A rectangular region of the atomic grid (the finest grid the detected boundaries admit) that drawn strokes never actually divided -- one real ContentTableCell, spanning more than one atomic row/column exactly when colSpan/rowSpan would (see reconstruct.ts's own recoverTable, which anchors one real cell at [rowStart, colStart] and a rowSpan continuation placeholder at the same column position in every row up to rowEnd, matching how ooxml.js's own docx/pptx table writers already expect a ContentTable to be shaped).
export interface TableRegion {
  readonly rowStart: number;
  readonly rowEnd: number; // exclusive
  readonly colStart: number;
  readonly colEnd: number; // exclusive
}

function unionFind(size: number): number[] {
  return Array.from({ length: size }, (_, i) => i);
}

function findRoot(parents: number[], index: number): number {
  let root = index;
  while (parents[root] !== root) {
    root = parents[root]!;
  }
  let current = index;
  while (parents[current] !== root) {
    const next = parents[current]!;
    parents[current] = root;
    current = next;
  }
  return root;
}

function union(parents: number[], a: number, b: number): void {
  const rootA = findRoot(parents, a);
  const rootB = findRoot(parents, b);
  if (rootA !== rootB) {
    parents[rootA] = rootB;
  }
}

// Two atomic cells with no drawn stroke between them are the same real cell (a merged colSpan/rowSpan region), so this unions every adjacent pair the geometry doesn't actually separate, then reads off the resulting regions. A region that doesn't reduce to a clean rectangle -- an L-shaped or otherwise non-rectangular union, which no table cell can express -- means the detected boundaries don't actually describe a consistent grid, so the whole lattice is rejected rather than guessed at (this module's own "unambiguously a grid" bar); so is a lattice whose every interior boundary turned out undrawn, collapsing the whole rectangle into one cell with no real internal structure at all.
export function findCellRegions(
  rowLines: readonly AxisLine[],
  columnLines: readonly AxisLine[],
): TableRegion[] | undefined {
  const rowCount = rowLines.length - 1;
  const colCount = columnLines.length - 1;
  const indexOf = (row: number, col: number): number => row * colCount + col;
  const parents = unionFind(rowCount * colCount);

  for (let i = 0; i < rowCount; i++) {
    const rowTopPt = rowLines[i]!.position;
    const rowBottomPt = rowLines[i + 1]!.position;
    for (let j = 0; j < colCount - 1; j++) {
      const divider = columnLines[j + 1]!;
      if (
        bestRunCoverageRatio(divider.ranges, rowBottomPt, rowTopPt) <
        EDGE_COVERAGE_RATIO
      ) {
        union(parents, indexOf(i, j), indexOf(i, j + 1));
      }
    }
  }
  for (let j = 0; j < colCount; j++) {
    const colLeftPt = columnLines[j]!.position;
    const colRightPt = columnLines[j + 1]!.position;
    for (let i = 0; i < rowCount - 1; i++) {
      const divider = rowLines[i + 1]!;
      if (
        bestRunCoverageRatio(divider.ranges, colLeftPt, colRightPt) <
        EDGE_COVERAGE_RATIO
      ) {
        union(parents, indexOf(i, j), indexOf(i + 1, j));
      }
    }
  }

  const cellsByRoot = new Map<number, { row: number; col: number }[]>();
  for (let i = 0; i < rowCount; i++) {
    for (let j = 0; j < colCount; j++) {
      const root = findRoot(parents, indexOf(i, j));
      const cells = cellsByRoot.get(root);
      if (cells === undefined) {
        cellsByRoot.set(root, [{ row: i, col: j }]);
      } else {
        cells.push({ row: i, col: j });
      }
    }
  }
  if (cellsByRoot.size <= 1) {
    return undefined;
  }
  const regions: TableRegion[] = [];
  for (const cells of cellsByRoot.values()) {
    // A manual reduce, not Math.min/max(...cells.map(...)): spreading a large array into a function call throws "Maximum call stack size exceeded" once it exceeds the JS engine's argument-count limit (V8's is roughly 65536), and a merged region can grow arbitrarily large when a page's line detection turns up a dense or malformed grid.
    let rowStart = cells[0]!.row;
    let rowEnd = cells[0]!.row;
    let colStart = cells[0]!.col;
    let colEnd = cells[0]!.col;
    for (const cell of cells) {
      rowStart = Math.min(rowStart, cell.row);
      rowEnd = Math.max(rowEnd, cell.row);
      colStart = Math.min(colStart, cell.col);
      colEnd = Math.max(colEnd, cell.col);
    }
    rowEnd += 1;
    colEnd += 1;
    if (cells.length !== (rowEnd - rowStart) * (colEnd - colStart)) {
      return undefined;
    }
    regions.push({ rowStart, rowEnd, colStart, colEnd });
  }
  regions.sort((a, b) => a.rowStart - b.rowStart || a.colStart - b.colStart);
  return regions;
}

export interface GridLattice {
  readonly rowBoundariesDescPt: readonly number[]; // top-to-bottom, PDF y descending
  readonly columnBoundariesAscPt: readonly number[]; // left-to-right, PDF x ascending
  // The atomic grid's own cells, merged wherever no drawn stroke separates two neighbours -- a partition of every [row, column] pair the boundaries above admit, in row-major order. A caller building a ContentTable reads its own rows and colSpan/rowSpan directly off these.
  readonly regions: readonly TableRegion[];
  // Every LayoutItem that contributed a segment to a detected boundary. A caller recovering both a table and free-standing vector primitives from the same page needs this to avoid emitting the lattice's own strokes twice -- once as the table's structure and again as loose line vectors alongside it.
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
  const rowLines = dedupeAxisLines(horizontal, true);
  const columnLines = dedupeAxisLines(vertical, false);
  if (
    rowLines.length < MIN_GRIDLINE_COUNT_PER_AXIS ||
    columnLines.length < MIN_GRIDLINE_COUNT_PER_AXIS
  ) {
    return undefined;
  }
  if (!hasClosedOuterRectangle(rowLines, columnLines)) {
    return undefined;
  }
  const regions = findCellRegions(rowLines, columnLines);
  if (regions === undefined) {
    return undefined;
  }
  const sourceItems = new Set<LayoutItem>();
  for (const line of [...rowLines, ...columnLines]) {
    for (const item of line.items) {
      sourceItems.add(item);
    }
  }
  return {
    rowBoundariesDescPt: rowLines.map((l) => l.position),
    columnBoundariesAscPt: columnLines.map((l) => l.position),
    regions,
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
