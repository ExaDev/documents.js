// A1-style cell reference computation for ODF spreadsheet reading. The pure algorithms (columnIndexToLetters, columnLettersToIndex, parseCellReference, cellReference) now live in document-schema.js's canonical, format-agnostic, row-first a1 module -- this file preserves odf.js's own column-first public API and its stricter validation (throws on negative indices, uppercase-only parsing) as thin back-compat shims that delegate to the schema. TableCursor stays here: it is an ODF-reader concern (tracking position across table:number-columns-repeated/table:number-rows-repeated), not a model-level utility.
//
// For why TableCursor exists at all: unlike xlsx, where every c (cell) element carries its own explicit r="B7" attribute, an ODF table:table-cell carries NO cell-reference attribute -- a reader computes "B7" from a running cursor. A real ODF spreadsheet compresses long runs of identical trailing cells (table:number-columns-repeated, confirmed against real LibreOffice .ots templates: a single row+cell pair standing in for over a million empty rows), and TableCursor advances PAST a repeat count in O(1), reading off only the reference(s) it needs, never materializing the cells in between.

import {
  columnIndexToLetters as schemaColumnIndexToLetters,
  columnLettersToIndex as schemaColumnLettersToIndex,
  cellReference as schemaCellReference,
  parseCellReference as schemaParseCellReference,
} from "document-schema.js";

export function columnIndexToLetters(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(
      `columnIndexToLetters: index must be a non-negative integer, got ${index}`,
    );
  }
  return schemaColumnIndexToLetters(index);
}

export function cellReference(columnIndex: number, rowIndex: number): string {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    throw new Error(
      `cellReference: rowIndex must be a non-negative integer, got ${rowIndex}`,
    );
  }
  // document-schema.js's canonical cellReference is row-first (row, column); odf.js's public API is column-first (columnIndex, rowIndex) -- swap the args.
  return schemaCellReference(rowIndex, columnIndex);
}

export function columnLettersToIndex(letters: string): number | undefined {
  if (!/^[A-Z]+$/.test(letters)) {
    return undefined;
  }
  return schemaColumnLettersToIndex(letters);
}

export function parseCellReference(
  reference: string,
): { column: number; row: number } | undefined {
  return schemaParseCellReference(reference);
}

function validateRepeatCount(repeatCount: number, caller: string): void {
  if (!Number.isInteger(repeatCount) || repeatCount < 1) {
    throw new Error(
      `${caller}: repeatCount must be a positive integer, got ${repeatCount}`,
    );
  }
}

export class TableCursor {
  private columnCursor = 0;
  private rowCursor = 0;

  get columnIndex(): number {
    return this.columnCursor;
  }

  get rowIndex(): number {
    return this.rowCursor;
  }

  nextCell(repeatCount = 1): string {
    validateRepeatCount(repeatCount, "TableCursor.nextCell");
    const reference = cellReference(this.columnCursor, this.rowCursor);
    this.columnCursor += repeatCount;
    return reference;
  }

  nextRow(repeatCount = 1): void {
    validateRepeatCount(repeatCount, "TableCursor.nextRow");
    this.rowCursor += repeatCount;
    this.columnCursor = 0;
  }
}
