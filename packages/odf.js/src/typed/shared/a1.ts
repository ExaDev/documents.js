// A1-style cell reference computation for the future ods reader. Unlike xlsx, where every c (cell) element carries its own explicit r="B7" attribute, an ODF table:table-cell carries NO cell-reference attribute at all -- a reader has to compute "B7" itself from a running column/row cursor as it walks table:table-row/table:table-cell elements in document order.
//
// The other structural difference from xlsx: a real ODF spreadsheet compresses long runs of identical trailing cells/rows with table:number-columns-repeated / table:number-rows-repeated rather than writing each one out. This is not a rare edge case -- confirmed directly against real LibreOffice-shipped .ots templates (`/Applications/LibreOffice.app/Contents/Resources/template/common/wizard/styles/*.ots`), whose content.xml ends its used sheet area with rows such as `<table:table-row table:number-rows-repeated="1016575"><table:table-cell table:number-columns-repeated="256"/></table:table-row>` -- a single row+cell pair standing in for over a million actual empty rows. A reader that materialized an object per repeated cell would attempt to allocate billions of objects on an ordinary file; TableCursor below exists so a caller can advance PAST a repeat count in O(1), reading off only the reference(s) it actually needs, never materializing the cells in between.

const ALPHABET_SIZE = 26; // The number of letters A-Z, i.e. spreadsheet column-letter encoding's base.
const ALPHABET_START_CODE = 'A'.charCodeAt(0);

// Converts a 0-based column index to its spreadsheet column-letter form: 0 -> "A", 25 -> "Z", 26 -> "AA", 701 -> "ZZ", 702 -> "AAA" -- the same bijective base-26 (no zero digit) scheme every spreadsheet format uses.
export function columnIndexToLetters(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`columnIndexToLetters: index must be a non-negative integer, got ${index}`);
  }
  let remaining = index + 1; // Shift to 1-based: the bijective base-26 algorithm has no representation for "zero".
  let letters = '';
  while (remaining > 0) {
    const digit = (remaining - 1) % ALPHABET_SIZE;
    letters = String.fromCharCode(ALPHABET_START_CODE + digit) + letters;
    remaining = Math.floor((remaining - 1) / ALPHABET_SIZE);
  }
  return letters;
}

// Builds an A1-style reference ("B7") from 0-based column/row indices.
export function cellReference(columnIndex: number, rowIndex: number): string {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    throw new Error(`cellReference: rowIndex must be a non-negative integer, got ${rowIndex}`);
  }
  return `${columnIndexToLetters(columnIndex)}${rowIndex + 1}`;
}

function validateRepeatCount(repeatCount: number, caller: string): void {
  if (!Number.isInteger(repeatCount) || repeatCount < 1) {
    throw new Error(`${caller}: repeatCount must be a positive integer, got ${repeatCount}`);
  }
}

// Tracks a spreadsheet reader's current (column, row) position while it walks table:table-row/table:table-cell elements in document order, advancing across table:number-columns-repeated/table:number-rows-repeated in O(1) without ever materializing the repeated cells -- see this module's own top-of-file note on why that matters for a real-world file. Intended usage for a future ods reader, one TableCursor per sheet: construct one cursor per sheet, then for each table:table-row element in document order call nextCell(repeatCount) once per table:table-cell child (in order) to obtain that cell's own reference before recording it, and finally call nextRow(repeatCount) once the row's cells are exhausted, before moving on to the next table:table-row.
export class TableCursor {
  private columnCursor = 0;
  private rowCursor = 0;

  get columnIndex(): number {
    return this.columnCursor;
  }

  get rowIndex(): number {
    return this.rowCursor;
  }

  // The reference for the CURRENT cursor position (the first cell of this table:table-cell's repeat group), then advances the column cursor by repeatCount (table:number-columns-repeated, default 1) without materializing the repeatCount-1 cells in between. A repeated NON-empty cell (legal but rare in practice -- e.g. an identical formula result repeated across a row) is represented by exactly this one reference; a caller that needs every individual repeated cell's own address can still derive them (this.columnIndex before vs. after the call bounds the range), but the common case -- and the only one real-world files actually stress -- is a huge repeat count over empty cells, which this deliberately never expands.
  nextCell(repeatCount = 1): string {
    validateRepeatCount(repeatCount, 'TableCursor.nextCell');
    const reference = cellReference(this.columnCursor, this.rowCursor);
    this.columnCursor += repeatCount;
    return reference;
  }

  // Advances to the next table:table-row, honouring table:number-rows-repeated (default 1) and resetting the column cursor to 0 for the new row -- matching how every table:table-row's own table:table-cell children are always addressed from column A again.
  nextRow(repeatCount = 1): void {
    validateRepeatCount(repeatCount, 'TableCursor.nextRow');
    this.rowCursor += repeatCount;
    this.columnCursor = 0;
  }
}
