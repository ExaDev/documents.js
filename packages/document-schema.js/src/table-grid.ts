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
