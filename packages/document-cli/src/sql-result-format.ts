import { hsqldbCellDisplayText, type SqlResultSet } from "documents.js";

// The one place a SqlResultSet (documents.js's own src/odb/sql/ engine output -- see odb-query's own command comment) turns into a plain-text table, mirroring odb-structure.ts's role for OdbForm/OdbReport: a pure function of the value evaluateSelect hands back, with no I/O or package knowledge of its own, so it can be unit-tested against a literal SqlResultSet with no real .odb fixture involved.
//
// Each cell renders through hsqldbCellDisplayText, the identical ContentCellValue -> display-text mapping src/hsqldb/script.ts's own displayTextFor already gives every extracted table row -- a query result column reads exactly like the same data would in odb-tables' own row dump, not a second, independently-invented rendering.

const COLUMN_GAP = "  ";

function columnWidths(
  columns: readonly string[],
  cells: readonly (readonly string[])[],
): readonly number[] {
  return columns.map((column, index) => {
    const cellWidths = cells.map((row) => row[index]?.length ?? 0);
    return Math.max(column.length, ...cellWidths);
  });
}

function formatRow(
  values: readonly string[],
  widths: readonly number[],
): string {
  return values
    .map((value, index) => value.padEnd(widths[index] ?? value.length))
    .join(COLUMN_GAP)
    .trimEnd();
}

// Header line, a rule line the same width as each column, one line per row, then a trailing "N row(s)" summary -- the same summary phrasing odb-tables already uses for a table's own row count.
export function formatSqlResultSetTable(
  result: SqlResultSet,
): readonly string[] {
  const { columns, rows } = result;
  const cells = rows.map((row) =>
    row.map((value) => hsqldbCellDisplayText(value)),
  );
  const widths = columnWidths(columns, cells);

  const lines: string[] = [
    formatRow(columns, widths),
    formatRow(
      widths.map((width) => "-".repeat(width)),
      widths,
    ),
  ];
  for (const row of cells) {
    lines.push(formatRow(row, widths));
  }
  lines.push(`${rows.length} row${rows.length === 1 ? "" : "s"}`);
  return lines;
}
