import type {
  ContentTable,
  ContentTableCell,
  PositionedTableCell,
} from "document-schema.js";
import {
  denseTableRows,
  describeTableGridFault,
  findTableGridFault,
  tableGridColumnCount,
  walkTableGrid,
} from "document-schema.js";

/**
 * One position of a live table's grid, resolved to the live cell that owns it.
 *
 * A merged region owns every position it covers, so `cell` is the region's anchor cell wherever the position lies inside the region, and `isAnchor` tells the anchor's own top-left position (the one a view draws the region's content at) from the positions it covers.
 */
export interface TableGridCell<C> {
  readonly cell: C;
  readonly isAnchor: boolean;
}

/**
 * The rows of a live table's grid: `rows[r][c]` is the position at grid row r and grid column c, and every row is as wide as the table's grid.
 *
 * An entry is `undefined` only where the source has no cell at all for a position and no merged region covers it, which is how a row shorter than its table's grid reads.
 */
export type TableGridRows<C> = readonly (readonly (
  TableGridCell<C> | undefined
)[])[];

/** A live cell as the editing layer holds it: the grid column its own element starts at, and the spans that element states (an absent span is a span of one). */
export interface PlacedLiveCell<C> {
  readonly columnIndex: number;
  readonly cell: C;
  readonly colSpan: number | undefined;
  readonly rowSpan: number | undefined;
}

/** A live table's grid: its width in columns and the resolved rows. */
export interface LiveTableGrid<C> {
  readonly columnCount: number;
  readonly rows: TableGridRows<C>;
}

function positionKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}:${columnIndex}`;
}

/**
 * Resolve the cells a live table holds into its dense grid.
 *
 * A live table stores fewer cells than it has grid positions wherever its format omits the positions a merge covers (a docx `w:tc` per `w:gridSpan` region, an ODF row's real cells beside its covered ones), so the position of a cell is not its index in its row. This lays the cells out as the content pivot would, through the same `walkTableGrid` classification, so that coverage is derived from the anchors' spans and never re-derived here.
 *
 * `declaredColumnCount` is the grid width the source states on its own (a docx `w:tblGrid`); the result is that wide, or wider if a row places a cell past it.
 */
export function resolveLiveTableGrid<C>(
  rows: readonly (readonly PlacedLiveCell<C>[])[],
  declaredColumnCount: number,
): LiveTableGrid<C> {
  const positioned = rows.map((row) => ({
    cells: row.map(
      ({ columnIndex, colSpan, rowSpan }): PositionedTableCell => ({
        columnIndex,
        cell: { blocks: [], colSpan, rowSpan },
      }),
    ),
  }));
  const skeleton: ContentTable = {
    kind: "table",
    columnWidthsPt: [],
    rows: denseTableRows(positioned, declaredColumnCount),
  };
  const liveCells = new Map<string, C>();
  rows.forEach((row, rowIndex) => {
    for (const { columnIndex, cell } of row) {
      liveCells.set(positionKey(rowIndex, columnIndex), cell);
    }
  });
  return {
    columnCount: Math.max(declaredColumnCount, tableGridColumnCount(skeleton)),
    rows: walkTableGrid(skeleton).map((positions) =>
      positions.map((position): TableGridCell<C> | undefined => {
        const cell = liveCells.get(
          positionKey(
            position.anchorRowIndex ?? position.rowIndex,
            position.anchorColumnIndex ?? position.columnIndex,
          ),
        );
        return cell === undefined
          ? undefined
          : { cell, isAnchor: position.anchorRowIndex === undefined };
      }),
    ),
  };
}

/**
 * Resolve a live table that is itself a ContentTable (an editor holding the content pivot directly rather than an XML tree) into its grid, wrapping each entry of a row in the live cell view `wrap` builds.
 *
 * A pivot table's rows are already dense, so an entry's index is its grid column and no width needs deriving; what this adds is the resolution of a covered position to the anchor that owns it, which is the same resolution the XML-backed editors need.
 */
export function resolvePivotTableGrid<C>(
  table: ContentTable,
  wrap: (cell: ContentTableCell) => C,
): LiveTableGrid<C> {
  return resolveLiveTableGrid(
    table.rows.map((row) =>
      row.cells.map((cell, columnIndex) => ({
        columnIndex,
        cell: wrap(cell),
        colSpan: cell.colSpan,
        rowSpan: cell.rowSpan,
      })),
    ),
    table.columnWidthsPt.length,
  );
}

/**
 * Throws when `table` breaks the grid rule (ContentTableCell in document-schema.js), naming `entryPoint` and the fault. The edit layer's builders write a covered position as a marker with no content of its own (a docx vertical-merge continuation, an ODF `table:covered-table-cell`, a pptx `hMerge`/`vMerge` cell), so a table whose covered positions carry blocks or spans, whose rows disagree about the grid, or whose regions run past the grid or into each other has no faithful spelling: the builder would drop what a covered position held, or guess which of two regions a position belongs to.
 */
export function assertTableObeysGridRule(
  table: ContentTable,
  entryPoint: string,
): void {
  const fault = findTableGridFault(table);
  if (fault !== undefined) {
    throw new Error(
      `${entryPoint}: table breaks the grid rule (${describeTableGridFault(fault)})`,
    );
  }
}
