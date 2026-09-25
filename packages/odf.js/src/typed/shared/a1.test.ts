import { describe, expect, it } from "vitest";
import {
  columnIndexToLetters,
  columnLettersToIndex,
  cellReference,
  TableCursor,
} from "./a1";

// The spreadsheet column alphabet has 26 letters (A-Z); every boundary below is a fact about that base-26-ish positional system, not an arbitrary choice.
const COLUMN_ALPHABET_SIZE = 26;

describe("columnLettersToIndex", () => {
  it("converts uppercase column letters back to a 0-based index", () => {
    const lastSingleLetterIndex = COLUMN_ALPHABET_SIZE - 1;

    expect(columnLettersToIndex("A")).toBe(0);
    expect(columnLettersToIndex("Z")).toBe(lastSingleLetterIndex);
    expect(columnLettersToIndex("AA")).toBe(COLUMN_ALPHABET_SIZE);
  });

  it("returns undefined for input containing anything but uppercase letters", () => {
    expect(columnLettersToIndex("a")).toBeUndefined();
    expect(columnLettersToIndex("A1")).toBeUndefined();
    expect(columnLettersToIndex("")).toBeUndefined();
  });

  it("returns undefined for mixed-case input even though every character is a letter", () => {
    // document-schema.js's own columnLettersToIndex uppercases its input before validating, so it alone can't distinguish "aA" or "Aa" from "AA" — these two cases exist specifically to pin the ^ and $ anchors in this module's own uppercase-only guard, each anchor's removal otherwise lets exactly one of these two strings reach (and be silently accepted by) the schema helper.
    expect(columnLettersToIndex("aA")).toBeUndefined();
    expect(columnLettersToIndex("Aa")).toBeUndefined();
  });
});

describe("columnIndexToLetters", () => {
  it("converts single-letter columns", () => {
    const lastSingleLetterIndex = COLUMN_ALPHABET_SIZE - 1;
    expect(columnIndexToLetters(0)).toBe("A");
    expect(columnIndexToLetters(1)).toBe("B");
    expect(columnIndexToLetters(lastSingleLetterIndex)).toBe("Z");
  });

  it("converts double-letter columns at the A/Z boundary", () => {
    const secondDoubleLetterIndex = COLUMN_ALPHABET_SIZE + 1;
    const lastAxDoubleLetterIndex = 2 * COLUMN_ALPHABET_SIZE - 1;
    const firstBxDoubleLetterIndex = 2 * COLUMN_ALPHABET_SIZE;
    const lastDoubleLetterIndex =
      COLUMN_ALPHABET_SIZE * (COLUMN_ALPHABET_SIZE + 1) - 1;
    expect(columnIndexToLetters(COLUMN_ALPHABET_SIZE)).toBe("AA");
    expect(columnIndexToLetters(secondDoubleLetterIndex)).toBe("AB");
    expect(columnIndexToLetters(lastAxDoubleLetterIndex)).toBe("AZ");
    expect(columnIndexToLetters(firstBxDoubleLetterIndex)).toBe("BA");
    expect(columnIndexToLetters(lastDoubleLetterIndex)).toBe("ZZ");
  });

  it("converts triple-letter columns", () => {
    const firstTripleLetterIndex =
      COLUMN_ALPHABET_SIZE * (COLUMN_ALPHABET_SIZE + 1);
    // The real Calc/Excel maximum column index: 16384 columns (A through XFD), 0-based.
    const excelMaxColumnCount = 16384;
    const excelMaxColumnIndex = excelMaxColumnCount - 1;
    expect(columnIndexToLetters(firstTripleLetterIndex)).toBe("AAA");
    expect(columnIndexToLetters(excelMaxColumnIndex)).toBe("XFD");
  });

  it("throws for a negative or non-integer index", () => {
    const nonIntegerIndex = 1.5;
    expect(() => columnIndexToLetters(-1)).toThrow(/non-negative integer/);
    expect(() => columnIndexToLetters(nonIntegerIndex)).toThrow(
      /non-negative integer/,
    );
  });
});

describe("cellReference", () => {
  it("builds an A1-style reference from 0-based column/row indices", () => {
    const columnIndexB = 1;
    const rowIndexSix = 6;

    expect(cellReference(0, 0)).toBe("A1");
    expect(cellReference(columnIndexB, rowIndexSix)).toBe("B7");
    expect(cellReference(COLUMN_ALPHABET_SIZE, 0)).toBe("AA1");
  });

  it("throws for a negative row index", () => {
    expect(() => cellReference(0, -1)).toThrow(/non-negative integer/);
  });
});

describe("TableCursor", () => {
  it("starts at A1", () => {
    const cursor = new TableCursor();
    expect(cursor.columnIndex).toBe(0);
    expect(cursor.rowIndex).toBe(0);
  });

  it("advances one column per nextCell() call with no repeat count", () => {
    const cursor = new TableCursor();
    const cellsAdvanced = 3;
    expect(cursor.nextCell()).toBe("A1");
    expect(cursor.nextCell()).toBe("B1");
    expect(cursor.nextCell()).toBe("C1");
    expect(cursor.columnIndex).toBe(cellsAdvanced);
  });

  it("nextRow() resets the column cursor to 0 and advances the row", () => {
    const cursor = new TableCursor();
    cursor.nextCell();
    cursor.nextCell();
    cursor.nextRow();
    expect(cursor.columnIndex).toBe(0);
    expect(cursor.rowIndex).toBe(1);
    expect(cursor.nextCell()).toBe("A2");
  });

  it("advances by table:number-columns-repeated without materializing intermediate cells", () => {
    const cursor = new TableCursor();
    // A real trailing-repeated-cell block, e.g. table:number-columns-repeated="1024".
    const repeatedColumnCount = 1024;
    const first = cursor.nextCell(repeatedColumnCount);
    expect(first).toBe("A1");
    // Asserted on the cursor's own position, never on an array length — nothing was allocated per repeated cell.
    expect(cursor.columnIndex).toBe(repeatedColumnCount);
    // The very next cell after the repeat block.
    expect(cursor.nextCell()).toBe(
      columnIndexToLetters(repeatedColumnCount) + "1",
    );
  });

  it("advances by table:number-rows-repeated (a real, huge repeat count) without materializing intermediate rows", () => {
    const cursor = new TableCursor();
    // The exact repeat count confirmed from a real LibreOffice-shipped .ots template's trailing empty rows.
    const repeatedRowCount = 1016575;
    cursor.nextRow(repeatedRowCount);
    expect(cursor.rowIndex).toBe(repeatedRowCount);
    expect(cursor.columnIndex).toBe(0);
    expect(cursor.nextCell()).toBe("A1016576");
  });

  it("composes column and row repeats across many rows the way a real sparse sheet does", () => {
    const cursor = new TableCursor();
    // The rest of a 256-wide header/data row, repeated/empty, after the one populated leading cell.
    const restOfRowWidth = 255;
    // A huge block of empty rows.
    const emptyRowBlockCount = 31983;
    const rowIndexAfterFirstRow = 1;
    expect(cursor.nextCell()).toBe("A1"); // a header cell
    cursor.nextCell(restOfRowWidth);
    cursor.nextRow();
    expect(cursor.nextCell()).toBe("A2"); // one populated data cell on row 2
    cursor.nextCell(restOfRowWidth);
    cursor.nextRow(emptyRowBlockCount);
    expect(cursor.rowIndex).toBe(rowIndexAfterFirstRow + emptyRowBlockCount);
    expect(cursor.nextCell()).toBe("A31985");
  });

  it("throws for a zero or negative repeat count on either advance method, naming its own caller in the message", () => {
    const cursor = new TableCursor();
    expect(() => cursor.nextCell(0)).toThrow("TableCursor.nextCell:");
    expect(() => cursor.nextCell(-1)).toThrow("TableCursor.nextCell:");
    expect(() => {
      cursor.nextRow(0);
    }).toThrow("TableCursor.nextRow:");
  });

  it("throws for a non-integer repeat count", () => {
    const cursor = new TableCursor();
    const nonIntegerRepeatCount = 1.5;
    expect(() => cursor.nextCell(nonIntegerRepeatCount)).toThrow(
      /positive integer/,
    );
  });
});
