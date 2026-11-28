import type {
  ContentSheet,
  ContentSheetCell,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";

// A column no ContentSheetColumn declares a width for is laid out at a spreadsheet application's own default column width (one inch).
const DEFAULT_COLUMN_WIDTH_PT = 72;

/** One sheet flattened into a table, with the number of hidden rows and columns the sheet declares, so a caller can report what it left out. */
export interface SheetTable {
  readonly table: ContentTable;
  readonly hiddenRowCount: number;
  readonly hiddenColumnCount: number;
}

// A single spreadsheet cell, wrapped as a one-run table-cell paragraph. Absent (a position no ContentSheetCell occupies inside the table) becomes an empty paragraph, exactly as an unfilled spreadsheet cell renders as blank in any spreadsheet application, not a placeholder marker, since there is nothing noteworthy about an empty cell.
function spreadsheetCellToTableCell(
  cell: ContentSheetCell | undefined,
): ContentTableCell {
  if (cell === undefined) {
    return { blocks: [{ kind: "paragraph", runs: [{ text: "" }] }] };
  }
  return {
    blocks: [
      {
        kind: "paragraph",
        runs: cell.runs ?? [{ text: cell.displayText }],
        alignment: cell.alignment,
      },
    ],
  };
}

function ascending(values: Iterable<number>): number[] {
  return [...values].sort((left, right) => left - right);
}

/**
 * Flattens one sheet's cells into a table whose rows and columns are exactly the rows and columns holding at least one visible cell, in sheet order, so the table's size is bounded by the sheet's cells rather than by how far from A1 its furthest cell lies: a workbook holding only A1 and a cell at XFD1048576 is a 2x2 table, not a 17-billion-cell one. A row or column holding no visible cell (a blank spacer row, an empty leading column, a hidden row or column) carries no text a table could show, so it is left out; the cells that remain keep their relative order. Hidden rows and columns (a ContentSheetRow or ContentSheetColumn with `hidden: true`) are excluded with their cells, since neither a GFM table nor a wordprocessing table has a per-row or per-column visibility flag to carry them on. Returns `undefined` for a sheet with no visible cell at all (every cell hidden, or a genuinely empty sheet), which has no table to show.
 */
export function sheetToTable(sheet: ContentSheet): SheetTable | undefined {
  const hiddenRows = new Set(
    sheet.rows.filter((row) => row.hidden === true).map((row) => row.index),
  );
  const hiddenColumns = new Set(
    sheet.columns
      .filter((column) => column.hidden === true)
      .map((column) => column.index),
  );

  const cellByPosition = new Map<string, ContentSheetCell>();
  const occupiedRows = new Set<number>();
  const occupiedColumns = new Set<number>();
  for (const cell of sheet.cells) {
    if (hiddenRows.has(cell.row) || hiddenColumns.has(cell.column)) {
      continue;
    }
    cellByPosition.set(`${String(cell.row)}:${String(cell.column)}`, cell);
    occupiedRows.add(cell.row);
    occupiedColumns.add(cell.column);
  }
  if (cellByPosition.size === 0) {
    return undefined;
  }

  const tableRows = ascending(occupiedRows);
  const tableColumns = ascending(occupiedColumns);
  const columnWidthByIndex = new Map(
    sheet.columns.map((column) => [column.index, column.widthPt] as const),
  );
  const columns = tableColumns.map((column) => ({
    widthPt: columnWidthByIndex.get(column) ?? DEFAULT_COLUMN_WIDTH_PT,
  }));
  const rows: ContentTableRow[] = tableRows.map((row) => ({
    cells: tableColumns.map((column) =>
      spreadsheetCellToTableCell(
        cellByPosition.get(`${String(row)}:${String(column)}`),
      ),
    ),
  }));

  return {
    table: { kind: "table", rows, columns },
    hiddenRowCount: hiddenRows.size,
    hiddenColumnCount: hiddenColumns.size,
  };
}
