import { describe, expect, it } from 'vitest';
import { columnIndexToLetters, cellReference, TableCursor } from './a1';

describe('columnIndexToLetters', () => {
  it('converts single-letter columns', () => {
    expect(columnIndexToLetters(0)).toBe('A');
    expect(columnIndexToLetters(1)).toBe('B');
    expect(columnIndexToLetters(25)).toBe('Z');
  });

  it('converts double-letter columns at the A/Z boundary', () => {
    expect(columnIndexToLetters(26)).toBe('AA');
    expect(columnIndexToLetters(27)).toBe('AB');
    expect(columnIndexToLetters(51)).toBe('AZ');
    expect(columnIndexToLetters(52)).toBe('BA');
    expect(columnIndexToLetters(701)).toBe('ZZ');
  });

  it('converts triple-letter columns', () => {
    expect(columnIndexToLetters(702)).toBe('AAA');
    expect(columnIndexToLetters(16383)).toBe('XFD'); // the real Calc/Excel maximum column index (16384 columns).
  });

  it('throws for a negative or non-integer index', () => {
    expect(() => columnIndexToLetters(-1)).toThrow(/non-negative integer/);
    expect(() => columnIndexToLetters(1.5)).toThrow(/non-negative integer/);
  });
});

describe('cellReference', () => {
  it('builds an A1-style reference from 0-based column/row indices', () => {
    expect(cellReference(0, 0)).toBe('A1');
    expect(cellReference(1, 6)).toBe('B7');
    expect(cellReference(26, 0)).toBe('AA1');
  });

  it('throws for a negative row index', () => {
    expect(() => cellReference(0, -1)).toThrow(/non-negative integer/);
  });
});

describe('TableCursor', () => {
  it('starts at A1', () => {
    const cursor = new TableCursor();
    expect(cursor.columnIndex).toBe(0);
    expect(cursor.rowIndex).toBe(0);
  });

  it('advances one column per nextCell() call with no repeat count', () => {
    const cursor = new TableCursor();
    expect(cursor.nextCell()).toBe('A1');
    expect(cursor.nextCell()).toBe('B1');
    expect(cursor.nextCell()).toBe('C1');
    expect(cursor.columnIndex).toBe(3);
  });

  it('nextRow() resets the column cursor to 0 and advances the row', () => {
    const cursor = new TableCursor();
    cursor.nextCell();
    cursor.nextCell();
    cursor.nextRow();
    expect(cursor.columnIndex).toBe(0);
    expect(cursor.rowIndex).toBe(1);
    expect(cursor.nextCell()).toBe('A2');
  });

  it('advances by table:number-columns-repeated without materializing intermediate cells', () => {
    const cursor = new TableCursor();
    const first = cursor.nextCell(1024); // a real trailing-repeated-cell block, e.g. table:number-columns-repeated="1024"
    expect(first).toBe('A1');
    expect(cursor.columnIndex).toBe(1024); // asserted on the cursor's own position, never on an array length -- nothing was allocated per repeated cell.
    expect(cursor.nextCell()).toBe(columnIndexToLetters(1024) + '1'); // the very next cell after the repeat block.
  });

  it('advances by table:number-rows-repeated (a real, huge repeat count) without materializing intermediate rows', () => {
    const cursor = new TableCursor();
    cursor.nextRow(1016575); // the exact repeat count confirmed from a real LibreOffice-shipped .ots template's trailing empty rows.
    expect(cursor.rowIndex).toBe(1016575);
    expect(cursor.columnIndex).toBe(0);
    expect(cursor.nextCell()).toBe('A1016576');
  });

  it('composes column and row repeats across many rows the way a real sparse sheet does', () => {
    const cursor = new TableCursor();
    expect(cursor.nextCell()).toBe('A1'); // a header cell
    cursor.nextCell(255); // the rest of a 256-wide header row, repeated/empty
    cursor.nextRow();
    expect(cursor.nextCell()).toBe('A2'); // one populated data cell on row 2
    cursor.nextCell(255);
    cursor.nextRow(31983); // a huge block of empty rows
    expect(cursor.rowIndex).toBe(31984);
    expect(cursor.nextCell()).toBe('A31985');
  });

  it('throws for a zero or negative repeat count on either advance method', () => {
    const cursor = new TableCursor();
    expect(() => cursor.nextCell(0)).toThrow(/positive integer/);
    expect(() => cursor.nextCell(-1)).toThrow(/positive integer/);
    expect(() => cursor.nextRow(0)).toThrow(/positive integer/);
  });

  it('throws for a non-integer repeat count', () => {
    const cursor = new TableCursor();
    expect(() => cursor.nextCell(1.5)).toThrow(/positive integer/);
  });
});
