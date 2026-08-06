// A1-style cell and range reference parsing/formatting — the canonical, format-agnostic module shared by odf.js, ooxml.js, documents.js, document-cli, and document-mcp. Row/column indices throughout are 0-based, matching ContentSheetCell/ContentSheetColumn/ContentSheetRow's own convention — A1 references in both ODF and SpreadsheetML are 1-based, so every parse subtracts one and every format adds one back. The row-first argument order (cellReference(row, column), parseCellReference → { row, column }) matches ContentSheetCell's own field order, which is what makes this a model-level concern rather than a format-specific one.

const CELL_REFERENCE_RE = /^([A-Za-z]+)(\d+)$/;
const ALPHABET_SIZE = 26;
const ALPHABET_START_CODE = 65;

export function columnLettersToIndex(letters: string): number | undefined {
  if (letters.length === 0) {
    return undefined;
  }
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < ALPHABET_START_CODE || code >= ALPHABET_START_CODE + ALPHABET_SIZE) {
      return undefined;
    }
    index = index * ALPHABET_SIZE + (code - ALPHABET_START_CODE + 1);
  }
  return index - 1;
}

export function columnIndexToLetters(index: number): string {
  let remaining = index + 1;
  let letters = '';
  while (remaining > 0) {
    const digit = (remaining - 1) % ALPHABET_SIZE;
    letters = String.fromCharCode(ALPHABET_START_CODE + digit) + letters;
    remaining = Math.trunc((remaining - 1) / ALPHABET_SIZE);
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
