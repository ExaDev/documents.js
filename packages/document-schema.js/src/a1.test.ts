import { describe, expect, it } from 'vitest';
import { cellReference, columnIndexToLetters, columnLettersToIndex, parseCellReference, parseRangeReference, rangeReference } from './a1';

describe('columnLettersToIndex / columnIndexToLetters', () => {
  it('round-trips single and double letters through the base-26 (no zero digit) conversion', () => {
    expect(columnLettersToIndex('A')).toBe(0);
    expect(columnLettersToIndex('Z')).toBe(25);
    expect(columnLettersToIndex('AA')).toBe(26);
    expect(columnLettersToIndex('AZ')).toBe(51);
    expect(columnLettersToIndex('BA')).toBe(52);
    expect(columnLettersToIndex('XFD')).toBe(16383);
  });

  it('is a genuine round trip in both directions', () => {
    for (const index of [0, 1, 25, 26, 51, 52, 701, 702, 16383]) {
      expect(columnLettersToIndex(columnIndexToLetters(index))).toBe(index);
    }
  });

  it('is case-insensitive on the way in', () => {
    expect(columnLettersToIndex('aa')).toBe(26);
  });

  it('rejects a non-letter input', () => {
    expect(columnLettersToIndex('A1')).toBeUndefined();
    expect(columnLettersToIndex('')).toBeUndefined();
  });
});

describe('parseCellReference / cellReference', () => {
  it('parses a well-formed A1-style reference into 0-based row/column', () => {
    expect(parseCellReference('A1')).toEqual({ row: 0, column: 0 });
    expect(parseCellReference('B2')).toEqual({ row: 1, column: 1 });
    expect(parseCellReference('AA10')).toEqual({ row: 9, column: 26 });
  });

  it('round-trips through cellReference (row-first: cellReference(row, column))', () => {
    expect(cellReference(0, 0)).toBe('A1');
    expect(cellReference(1, 1)).toBe('B2');
    expect(cellReference(9, 26)).toBe('AA10');
  });

  it('rejects a malformed reference', () => {
    expect(parseCellReference('1A')).toBeUndefined();
    expect(parseCellReference('A0')).toBeUndefined();
    expect(parseCellReference('')).toBeUndefined();
  });
});

describe('parseRangeReference / rangeReference', () => {
  it('parses a genuine two-cell range, normalising start/end regardless of corner order', () => {
    expect(parseRangeReference('A1:B2')).toEqual({ startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 });
    expect(parseRangeReference('B2:A1')).toEqual({ startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 });
  });

  it('treats a single cell reference (no colon) as a one-cell range', () => {
    expect(parseRangeReference('C3')).toEqual({ startRow: 2, startColumn: 2, endRow: 2, endColumn: 2 });
  });

  it('round-trips through rangeReference', () => {
    expect(rangeReference({ startRow: 0, startColumn: 0, endRow: 19, endColumn: 8 })).toBe('A1:I20');
  });
});
