// A1-style cell and range reference parsing/formatting for SpreadsheetML, shared by typed/xlsx/content.ts (read) and typed/xlsx/build.ts (write). Row/column indices throughout this module are 0-based, matching ContentSheetCell/ContentSheetColumn/ContentSheetRow's own convention -- xlsx's own A1 references and r="N" attributes are 1-based, so every parse subtracts one and every format adds one back.

const CELL_REFERENCE_RE = /^([A-Za-z]+)(\d+)$/;

// "A" -> 0, "Z" -> 25, "AA" -> 26, ... a base-26 conversion with no zero digit (there is no "column 0" letter the way base-26 normally has a zero), so each digit's place value is letter-1, not letter.
export function columnLettersToIndex(letters: string): number | undefined {
  if (letters.length === 0) {
    return undefined;
  }
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) {
      return undefined;
    }
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

export function columnIndexToLetters(index: number): string {
  let remaining = index + 1;
  let letters = '';
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = Math.trunc((remaining - 1) / 26);
  }
  return letters;
}

export interface CellPosition {
  row: number;
  column: number;
}

export function parseCellReference(ref: string): CellPosition | undefined {
  const match = CELL_REFERENCE_RE.exec(ref);
  if (match === null) {
    return undefined;
  }
  const letters = match[1];
  const digits = match[2];
  if (letters === undefined || digits === undefined) {
    return undefined;
  }
  const column = columnLettersToIndex(letters);
  const rowNumber = Number.parseInt(digits, 10);
  if (column === undefined || !Number.isInteger(rowNumber) || rowNumber < 1) {
    return undefined;
  }
  return { row: rowNumber - 1, column };
}

export function cellReference(row: number, column: number): string {
  return `${columnIndexToLetters(column)}${row + 1}`;
}

export interface CellRange {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

// Accepts both a genuine "A1:B2" range and a single-cell "A1" reference (treated as a one-cell range) -- mergeCell/printArea references are always genuine ranges in practice, but being liberal here costs nothing and matches how a defensive reader should treat a malformed single-cell mergeCell ref.
export function parseRangeReference(ref: string): CellRange | undefined {
  const separatorIndex = ref.indexOf(':');
  const startRaw = separatorIndex === -1 ? ref : ref.slice(0, separatorIndex);
  const endRaw = separatorIndex === -1 ? ref : ref.slice(separatorIndex + 1);
  const start = parseCellReference(startRaw);
  const end = parseCellReference(endRaw);
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return {
    startRow: Math.min(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endRow: Math.max(start.row, end.row),
    endColumn: Math.max(start.column, end.column),
  };
}

export function rangeReference(range: CellRange): string {
  return `${cellReference(range.startRow, range.startColumn)}:${cellReference(range.endRow, range.endColumn)}`;
}
