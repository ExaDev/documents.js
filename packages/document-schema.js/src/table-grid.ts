// The one shared definition of a ContentTable's grid: which grid position each entry of a row's `cells` array occupies, and how a merged region's covered positions are expressed. ContentTableCell (src/content.ts) states the rule itself normatively; this module is the code every producer and consumer runs so that no reader or writer re-derives it, the same "one canonical, format-agnostic model-level module" role src/a1.ts plays for A1 references. Row and column indices throughout are 0-based, matching ContentTableRow's own array order.
//
// THE RULE, restated here because the algorithms below only make sense against it: a row's `cells` array is DENSE. It holds exactly one entry per grid column, so `row.cells[n]` is the cell at grid column n and `columnWidthsPt[n]` is that column's width -- array index IS grid column, with no accumulation of preceding spans needed to recover it. A merged region is one anchor entry carrying `colSpan`/`rowSpan` at its top-left position, plus one entry per remaining position the region covers. A covered entry is a real cell: it holds no blocks of its own (its content belongs to the anchor) but may carry the covered position's own background, borders, and residue, which is how a format that models covered cells explicitly (ODF's `table:covered-table-cell`, a pptx `a:tc` with `hMerge`/`vMerge`) round-trips their properties at all.
//
// A covered position is not marked by a field of its own: whether a position is covered follows entirely from the anchors' spans, which walkTableGrid derives. Adding a flag would be a second source of truth for a fact the spans already determine completely, and one that can contradict them.

import type {
  ContentTable,
  ContentTableCell,
  ContentTableRow,
} from "./content";
import type { TextDirection } from "./style";

/** The number of grid columns a cell occupies; an absent `colSpan` means the cell occupies its own column only. */
export function tableCellColumnSpan(cell: ContentTableCell): number {
  return cell.colSpan ?? 1;
}

/** The number of grid rows a cell occupies; an absent `rowSpan` means the cell occupies its own row only. */
export function tableCellRowSpan(cell: ContentTableCell): number {
  return cell.rowSpan ?? 1;
}

/**
 * The table's grid width. For a table obeying the dense rule this is `columnWidthsPt.length` and every row's `cells.length` alike; taking the largest of them is what lets a reader mid-construction, or a table whose source declared a grid narrower than a row actually uses, still be walked without the walk inventing a narrower grid than the rows occupy.
 */
export function tableGridColumnCount(table: ContentTable): number {
  let count = table.columnWidthsPt.length;
  for (const row of table.rows) {
    count = Math.max(count, row.cells.length);
  }
  return count;
}

/** A grid position holding a merged region's anchor, or an unmerged cell (which is its own one-position region's anchor). */
export interface TableGridAnchor {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly cell: ContentTableCell;
  readonly anchorRowIndex?: never;
  readonly anchorColumnIndex?: never;
}

/** A grid position covered by a merged region anchored elsewhere. `anchorRowIndex < rowIndex` means the region reaches this position vertically; `anchorRowIndex === rowIndex` means it reaches it horizontally along this same row. */
export interface TableGridCovered {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly cell: ContentTableCell;
  readonly anchorRowIndex: number;
  readonly anchorColumnIndex: number;
}

/** Discriminated by the presence of the anchor coordinates rather than by a tag field, since the two shapes' required fields are already mutually exclusive: `"anchorRowIndex" in position` narrows to the covered branch. */
export type TableGridPosition = TableGridAnchor | TableGridCovered;

interface AnchorFootprint {
  readonly row: number;
  readonly column: number;
  readonly rowEnd: number;
  readonly columnEnd: number;
}

// The anchors seen so far, queried before the current position is itself classified -- which is what makes "is this position covered" answerable without excluding the position from its own footprint: an anchor only ever covers positions at or after its own, so a position asking the question is never yet in the list when it asks. No `anchor.row <= rowIndex` term appears, deliberately: every anchor in the list is at or before the asking row already, so `rowIndex < anchor.rowEnd` alone decides the vertical extent.
function coveringAnchor(
  anchors: readonly AnchorFootprint[],
  rowIndex: number,
  columnIndex: number,
): AnchorFootprint | undefined {
  for (const anchor of anchors) {
    if (
      rowIndex < anchor.rowEnd &&
      anchor.column <= columnIndex &&
      columnIndex < anchor.columnEnd
    ) {
      return anchor;
    }
  }
  return undefined;
}

/**
 * Classify every entry of every row as an anchor or as covered, in row-major order, one inner array per table row.
 *
 * This is the walk a consumer runs instead of accumulating spans itself. A writer targeting a format that stores only anchors (HTML's `<td colspan>`, a docx `w:tc` with `w:gridSpan`) keeps the anchors and drops the covered positions; a writer targeting a format that stores covered positions explicitly (ODF, pptx) writes both; a reader checks its own output against it.
 */
export function walkTableGrid(table: ContentTable): TableGridPosition[][] {
  const anchors: AnchorFootprint[] = [];
  return table.rows.map((row, rowIndex) =>
    row.cells.map((cell, columnIndex): TableGridPosition => {
      const anchor = coveringAnchor(anchors, rowIndex, columnIndex);
      if (anchor !== undefined) {
        return {
          rowIndex,
          columnIndex,
          cell,
          anchorRowIndex: anchor.row,
          anchorColumnIndex: anchor.column,
        };
      }
      anchors.push({
        row: rowIndex,
        column: columnIndex,
        rowEnd: rowIndex + tableCellRowSpan(cell),
        columnEnd: columnIndex + tableCellColumnSpan(cell),
      });
      return { rowIndex, columnIndex, cell };
    }),
  );
}

/** The span of a cell that occupies its own grid position only, which is what an absent `colSpan` or `rowSpan` means. */
const UNMERGED_SPAN = 1;

/**
 * Where a table stops obeying the grid rule (ContentTableCell in src/content.ts states the rule; walkTableGrid derives the classification every check here is made against). Every variant names a position in the table's own row and column indices.
 *
 * - `raggedRow`: the row holds `cellCount` entries where the table's widest row holds `gridColumnCount`, so the rows do not all cover the same grid.
 * - `coveredContent`: the position is covered by the region anchored at `anchorRowIndex`, `anchorColumnIndex` yet carries blocks of its own; the region's content belongs to its anchor, so a second copy has nowhere to go.
 * - `coveredSpan`: the position is covered by the region anchored at `anchorRowIndex`, `anchorColumnIndex` yet carries a `colSpan` or `rowSpan` of its own. Spans are set on the anchor only and walkTableGrid never consults a covered entry's, so this is how a second anchor starting inside another's footprint shows up: the walk assigns each position to the first anchor covering it, which leaves the second entry classified as covered and its span ignored.
 * - `anchorOverrunsColumns`: the anchor at this position has a `colSpan` reaching past the last grid column.
 * - `anchorOverrunsRows`: the anchor at this position has a `rowSpan` reaching past the last row of the table.
 * - `overlappingAnchors`: the anchor at this position starts outside every other region but its footprint reaches a position already covered by the region anchored at `earlierAnchorRowIndex`, `earlierAnchorColumnIndex`, so two regions claim one position.
 *
 * A `kind` tag discriminates rather than property presence, because the variants' required fields are not mutually exclusive: several variants' fields include another's.
 */
export type TableGridFault =
  | {
      readonly kind: "raggedRow";
      readonly rowIndex: number;
      readonly cellCount: number;
      readonly gridColumnCount: number;
    }
  | {
      readonly kind: "coveredContent" | "coveredSpan";
      readonly rowIndex: number;
      readonly columnIndex: number;
      readonly anchorRowIndex: number;
      readonly anchorColumnIndex: number;
    }
  | {
      readonly kind: "anchorOverrunsColumns" | "anchorOverrunsRows";
      readonly rowIndex: number;
      readonly columnIndex: number;
    }
  | {
      readonly kind: "overlappingAnchors";
      readonly rowIndex: number;
      readonly columnIndex: number;
      readonly earlierAnchorRowIndex: number;
      readonly earlierAnchorColumnIndex: number;
    };

function widestRowLength(table: ContentTable): number {
  let width = 0;
  for (const row of table.rows) {
    width = Math.max(width, row.cells.length);
  }
  return width;
}

function coveredFault(position: TableGridCovered): TableGridFault | undefined {
  const { rowIndex, columnIndex, anchorRowIndex, anchorColumnIndex, cell } =
    position;
  if (cell.blocks.length > 0) {
    return {
      kind: "coveredContent",
      rowIndex,
      columnIndex,
      anchorRowIndex,
      anchorColumnIndex,
    };
  }
  if (
    tableCellColumnSpan(cell) > UNMERGED_SPAN ||
    tableCellRowSpan(cell) > UNMERGED_SPAN
  ) {
    return {
      kind: "coveredSpan",
      rowIndex,
      columnIndex,
      anchorRowIndex,
      anchorColumnIndex,
    };
  }
  return undefined;
}

// A region anchored on an earlier row that shares a position with this anchor's footprint necessarily reaches this anchor's own row within its column range: regions are rectangles, so a rectangle that reaches a lower row of the footprint also covers every row between its own top and there, this anchor's row included. Checking this anchor's own row is therefore enough, and its positions to the right of the anchor are covered either by this anchor or by such a region. A region anchored on this same row cannot be the other party: it would start left of this anchor and cover its start (making this entry covered rather than an anchor) or start right of it and be covered by this anchor.
function overlappedRegion(
  anchor: TableGridAnchor,
  row: readonly TableGridPosition[],
): TableGridCovered | undefined {
  const footprintEnd = anchor.columnIndex + tableCellColumnSpan(anchor.cell);
  for (const position of row.slice(anchor.columnIndex + 1, footprintEnd)) {
    if (
      position.anchorRowIndex !== undefined &&
      position.anchorRowIndex < anchor.rowIndex
    ) {
      return position;
    }
  }
  return undefined;
}

function anchorFault(
  anchor: TableGridAnchor,
  row: readonly TableGridPosition[],
  rowCount: number,
): TableGridFault | undefined {
  const { rowIndex, columnIndex, cell } = anchor;
  if (columnIndex + tableCellColumnSpan(cell) > row.length) {
    return { kind: "anchorOverrunsColumns", rowIndex, columnIndex };
  }
  if (rowIndex + tableCellRowSpan(cell) > rowCount) {
    return { kind: "anchorOverrunsRows", rowIndex, columnIndex };
  }
  const overlapped = overlappedRegion(anchor, row);
  if (overlapped !== undefined) {
    return {
      kind: "overlappingAnchors",
      rowIndex,
      columnIndex,
      earlierAnchorRowIndex: overlapped.anchorRowIndex,
      earlierAnchorColumnIndex: overlapped.anchorColumnIndex,
    };
  }
  return undefined;
}

/**
 * The first place `table` contradicts the grid rule, or `undefined` when it obeys it. It never throws: a caller decides what a fault means for it, the way findConstructMarkerImbalance leaves that decision to each consumer of a block list.
 *
 * Rows are compared with each other before any position is classified, since an anchor's footprint can only be measured against a grid every row shares; the positions are then checked in row-major order, so the fault returned is the earliest one in reading order.
 *
 * The check states the whole of the rule and nothing beyond it: a table with no rows, or whose rows are all empty, has no fault, and neither `columnWidthsPt` nor a cell's own properties other than its blocks and spans are consulted.
 */
export function findTableGridFault(
  table: ContentTable,
): TableGridFault | undefined {
  const gridColumnCount = widestRowLength(table);
  for (const [rowIndex, row] of table.rows.entries()) {
    if (row.cells.length !== gridColumnCount) {
      return {
        kind: "raggedRow",
        rowIndex,
        cellCount: row.cells.length,
        gridColumnCount,
      };
    }
  }
  const grid = walkTableGrid(table);
  for (const row of grid) {
    for (const position of row) {
      const fault =
        position.anchorRowIndex === undefined
          ? anchorFault(position, row, grid.length)
          : coveredFault(position);
      if (fault !== undefined) {
        return fault;
      }
    }
  }
  return undefined;
}

/**
 * One sentence stating a fault in words, for a writer that refuses or reports a table the grid rule does not admit: it names the fault by its position and, where the fault involves a second region, by that region's anchor. Indices are 0-based, matching every index in the descriptor. The sentence carries no entry point or format of its own, so each caller prefixes whatever names its own operation.
 */
export function describeTableGridFault(fault: TableGridFault): string {
  switch (fault.kind) {
    case "raggedRow":
      return `row ${String(fault.rowIndex)} holds ${String(fault.cellCount)} cells where the widest row holds ${String(fault.gridColumnCount)}, but every row of a table covers the same grid`;
    case "coveredContent":
      return `the cell at row ${String(fault.rowIndex)}, column ${String(fault.columnIndex)} lies inside the merged region anchored at row ${String(fault.anchorRowIndex)}, column ${String(fault.anchorColumnIndex)} but carries content of its own, and a merged region's content belongs to its anchor`;
    case "coveredSpan":
      return `the cell at row ${String(fault.rowIndex)}, column ${String(fault.columnIndex)} lies inside the merged region anchored at row ${String(fault.anchorRowIndex)}, column ${String(fault.anchorColumnIndex)} but states a span of its own, and only a region's anchor carries a span`;
    case "anchorOverrunsColumns":
      return `the merged region anchored at row ${String(fault.rowIndex)}, column ${String(fault.columnIndex)} spans past the last column of the grid`;
    case "anchorOverrunsRows":
      return `the merged region anchored at row ${String(fault.rowIndex)}, column ${String(fault.columnIndex)} spans past the last row of the table`;
    case "overlappingAnchors":
      return `the merged region anchored at row ${String(fault.rowIndex)}, column ${String(fault.columnIndex)} overlaps the region anchored at row ${String(fault.earlierAnchorRowIndex)}, column ${String(fault.earlierAnchorColumnIndex)}, but a grid position belongs to one region only`;
  }
}

/** A cell together with the grid column it starts at, for a reader whose source format states that column directly. */
export interface PositionedTableCell {
  readonly columnIndex: number;
  readonly cell: ContentTableCell;
}

/** One row's worth of positioned cells, carrying the row-level properties denseTableRows copies through unchanged. */
export interface PositionedTableRow {
  readonly cells: readonly PositionedTableCell[];
  readonly heightPt?: number;
  readonly direction?: TextDirection;
  readonly isHeader?: boolean;
}

function placedGridWidth(
  rows: readonly PositionedTableRow[],
  columnCount: number,
): number {
  let width = columnCount;
  for (const row of rows) {
    for (const { columnIndex, cell } of row.cells) {
      width = Math.max(width, columnIndex + tableCellColumnSpan(cell));
    }
  }
  return width;
}

/**
 * Build dense rows from cells a reader has already positioned, filling every position no cell was placed at with an empty covered cell.
 *
 * `columnCount` is the grid width the source declared (a docx `w:tblGrid`, an ODF `table:table-column` run). The result is that wide, or wider if some row places a cell past it, so that every returned row has the same length whatever the source's own grid declaration said.
 */
export function denseTableRows(
  rows: readonly PositionedTableRow[],
  columnCount: number,
): ContentTableRow[] {
  const width = placedGridWidth(rows, columnCount);
  return rows.map((row) => {
    const cells: ContentTableCell[] = Array.from({ length: width }, () => ({
      blocks: [],
    }));
    for (const { columnIndex, cell } of row.cells) {
      cells[columnIndex] = cell;
    }
    return { ...row, cells };
  });
}

/** One row's worth of anchor cells only, for a reader whose source format omits covered positions entirely and leaves their grid columns to be worked out from the spans around them. */
export interface AnchorTableRow {
  readonly cells: readonly ContentTableCell[];
  readonly heightPt?: number;
  readonly direction?: TextDirection;
  readonly isHeader?: boolean;
}

function occupiedColumns(
  occupied: Map<number, Set<number>>,
  rowIndex: number,
): Set<number> {
  const existing = occupied.get(rowIndex);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Set<number>();
  occupied.set(rowIndex, created);
  return created;
}

function positionAnchorRows(
  rows: readonly AnchorTableRow[],
): PositionedTableRow[] {
  const occupied = new Map<number, Set<number>>();
  return rows.map((row, rowIndex) => {
    const taken = occupiedColumns(occupied, rowIndex);
    let column = 0;
    const cells = row.cells.map((cell): PositionedTableCell => {
      while (taken.has(column)) {
        column++;
      }
      const lastRow = rowIndex + tableCellRowSpan(cell);
      const lastColumn = column + tableCellColumnSpan(cell);
      for (let r = rowIndex; r < lastRow; r++) {
        const rowTaken = occupiedColumns(occupied, r);
        for (let c = column; c < lastColumn; c++) {
          rowTaken.add(c);
        }
      }
      const positioned = { columnIndex: column, cell };
      column = lastColumn;
      return positioned;
    });
    return { ...row, cells };
  });
}

/**
 * Build dense rows from anchor cells alone, placing each at the first grid column no earlier cell already reaches -- the placement HTML's own table model needs, where a `rowspan` in one row silently consumes a column in the rows below it and nothing marks the consumed position.
 *
 * `columnCount` is the grid width the source declared, where it declares one at all; pass 0 when it does not and the width follows from the placement.
 */
export function placeAnchorTableRows(
  rows: readonly AnchorTableRow[],
  columnCount: number,
): ContentTableRow[] {
  return denseTableRows(positionAnchorRows(rows), columnCount);
}
