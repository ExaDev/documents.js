import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetPrintSettings,
  ContentSheetRow,
} from "document-schema.js";

import type { HsqldbTable } from "../hsqldb/script";
import { displayTextFor } from "../hsqldb/script";
import { PAGE_SIZE_A4 } from "document-schema.js";

// Maps the table data readOdbTables/parseHsqldbScript produces onto document-schema.js's own ContentSheetSchema pivot -- the same pivot ooxml.js's buildXlsxPackageFromContent and this package's own buildOdsPackage/convertSpreadsheetToLayout already consume -- so odbToXlsx (src/convert/convert.ts) is nothing more than odbTablesToSpreadsheetDocument(readOdbTables(pkg)) fed straight into buildXlsxPackageFromContent. One sheet per table: a header row of the table's own column names, then one data row per HsqldbTable row, each cell already carrying the typed ContentCellValue the SQL parser produced.

const HEADER_ROW_INDEX = 0;
// Fallback sizing only -- this table never had a real ODF column-width/row-height style to read from, unlike every other ContentSheet producer in this package (readOdsContent, reconstructSpreadsheet). Mirrors src/layout/sheets.ts's own DEFAULT_COLUMN_WIDTH_PT/DEFAULT_ROW_HEIGHT_PT fallback values exactly, restated locally rather than imported since that module keeps them private.
const COLUMN_WIDTH_PT = 64;
const ROW_HEIGHT_PT = 15;
// 2cm margins on an A4 page -- the same odf.js/readOdtContent fallback src/convert/convert.ts's own INLINE_SECTION_MARGIN_PT documents, reused here for the identical reason: a table built from nothing has no real page-layout to read a margin from either.
const MARGIN_PT = 56.69291338582677;
const DEFAULT_PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: PAGE_SIZE_A4,
  margins: {
    topPt: MARGIN_PT,
    rightPt: MARGIN_PT,
    bottomPt: MARGIN_PT,
    leftPt: MARGIN_PT,
  },
  gridlines: true,
  headers: true,
  pageOrder: "downThenOver",
};

function tableToSheet(table: HsqldbTable): ContentSheet {
  const cells: ContentSheetCell[] = table.columns.map(
    (column, columnIndex) => ({
      row: HEADER_ROW_INDEX,
      column: columnIndex,
      value: { kind: "string", value: column.name },
      displayText: column.name,
    }),
  );

  table.rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      cells.push({
        row: rowIndex + 1,
        column: columnIndex,
        value,
        displayText: displayTextFor(value),
      });
    });
  });

  const columns: ContentSheetColumn[] = table.columns.map((_, index) => ({
    index,
    widthPt: COLUMN_WIDTH_PT,
  }));
  const rows: ContentSheetRow[] = Array.from(
    { length: table.rows.length + 1 },
    (_unused, index) => ({ index, heightPt: ROW_HEIGHT_PT }),
  );

  return {
    name: table.tableName,
    cells,
    columns,
    rows,
    images: [],
    printSettings: DEFAULT_PRINT_SETTINGS,
  };
}

export function odbTablesToSpreadsheetDocument(
  tables: readonly HsqldbTable[],
): ContentDocument {
  return {
    kind: "spreadsheet",
    metadata: {},
    sheets: tables.map(tableToSheet),
  };
}
