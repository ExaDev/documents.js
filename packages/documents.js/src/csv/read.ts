import type { ContentDocument, ContentSheet, ContentSheetCell, ContentSheetColumn, ContentSheetPrintSettings, ContentSheetRow } from 'document-schema.js';
import{ PAGE_SIZE_A4 } from 'document-schema.js';
import type { CellTypeInferenceSink } from '../layout/cell-typing';
import { inferCellValue } from '../layout/cell-typing';
import { DEFAULT_CSV_DELIMITER, parseCsvRecords } from './records';

// The csv read half: RFC 4180 records -> one spreadsheet ContentDocument, on the identical pattern src/odb/spreadsheet.ts's own odbTablesToSpreadsheetDocument/tableToSheet already established for another untyped tabular source (.odb tables). The first record is the header row, written as verbatim string cells at row 0 -- headers are labels, never data to re-type, so inferCellValue never sees them. Every data cell runs through the SAME cell-typing heuristic the pdf->ods reconstructor uses (src/layout/cell-typing.ts's inferCellValue), with the identical confidence bar and the identical guarantee: displayText carries the raw field text verbatim independent of what value.kind was inferred, so a part number printed as "007" stays recoverable even though its value stays a string.
//
// A csv file is one sheet by construction -- there is no second table in the format -- so the sheet is named 'Sheet1', matching the name both Excel and LibreOffice give a lone spreadsheet sheet.

export interface ReadCsvContentOptions {
  // The single-character field delimiter the text is parsed with -- DEFAULT_CSV_DELIMITER (',') for csv proper, '\t' (records.ts's TSV_DELIMITER) for TSV.
  readonly delimiter?: string;
  // The same audit channel the pdf->ods reconstructor exposes: fires once per DATA cell where inferCellValue reached a decision (retyped or declined), carrying { sheetIndex: 0, row, column, displayText } merged with the decision. Header cells never fire -- they are not re-typed at all.
  readonly onCellTypeInference?: CellTypeInferenceSink;
}

const HEADER_ROW_INDEX = 0;
const SHEET_NAME = 'Sheet1';
// Fallback sizing only -- csv records carry no column-width/row-height information at all. Mirrors src/layout/sheets.ts's own DEFAULT_COLUMN_WIDTH_PT/DEFAULT_ROW_HEIGHT_PT fallback values exactly, the same values src/odb/spreadsheet.ts restates locally for the identical reason (that module keeps them private).
const COLUMN_WIDTH_PT = 64;
const ROW_HEIGHT_PT = 15;
// 2cm margins on an A4 page -- the identical src/odb/spreadsheet.ts fallback, for the identical reason: a table built from nothing but text fields has no real page layout to read a margin from.
const MARGIN_PT = 56.69291338582677;
const DEFAULT_PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: PAGE_SIZE_A4,
  margins: { topPt: MARGIN_PT, rightPt: MARGIN_PT, bottomPt: MARGIN_PT, leftPt: MARGIN_PT },
  gridlines: true,
  headers: true,
  pageOrder: 'downThenOver',
};

// One data field to a typed cell: empty text is the empty cell (kind 'empty' has no value field), anything inferCellValue re-types carries the inferred value, and everything else -- declines and plain text alike -- stays a string. displayText is the raw field text in every branch, matching the cell-typing module's own contract.
function dataCell(rowIndex: number, columnIndex: number, field: string, onCellTypeInference: CellTypeInferenceSink | undefined): ContentSheetCell {
  const inference = field === '' ? undefined : inferCellValue(field);
  if (inference !== undefined) {
    onCellTypeInference?.({ sheetIndex: 0, row: rowIndex, column: columnIndex, displayText: field, ...inference });
  }
  const value = field === '' ? { kind: 'empty' as const } : inference?.outcome === 'retyped' ? inference.value : { kind: 'string' as const, value: field };
  return { row: rowIndex, column: columnIndex, value, displayText: field };
}

export function readCsvContent(text: string, options?: ReadCsvContentOptions): ContentDocument {
  const records = parseCsvRecords(text, options?.delimiter ?? DEFAULT_CSV_DELIMITER);
  const onCellTypeInference = options?.onCellTypeInference;
  // The header record may be shorter or longer than a data record (trailing empty fields are unrepresentable in csv text and dropped by producers); the grid is the widest record, and every shorter row pads with empty cells so the sheet stays a uniform rectangle -- the shape every ContentSheet consumer (layout engine, ods/xlsx builders) already expects.
  const columnCount = records.reduce((max, record) => Math.max(max, record.length), 0);

  const cells: ContentSheetCell[] = [];
  records.forEach((record, rowIndex) => {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      // An absent field at a trailing grid position is an empty cell, not a hole: a record shorter than the grid means its authoring row simply ended there.
      const field = record[columnIndex] ?? '';
      if (rowIndex === HEADER_ROW_INDEX) {
        cells.push({ row: rowIndex, column: columnIndex, value: { kind: 'string', value: field }, displayText: field });
      } else {
        cells.push(dataCell(rowIndex, columnIndex, field, onCellTypeInference));
      }
    }
  });

  const columns: ContentSheetColumn[] = Array.from({ length: columnCount }, (_unused, index) => ({ index, widthPt: COLUMN_WIDTH_PT }));
  const rows: ContentSheetRow[] = Array.from({ length: records.length }, (_unused, index) => ({ index, heightPt: ROW_HEIGHT_PT }));
  const sheet: ContentSheet = { name: SHEET_NAME, cells, columns, rows, images: [], printSettings: DEFAULT_PRINT_SETTINGS };

  return { kind: 'spreadsheet', metadata: {}, sheets: [sheet] };
}
