import { describe, expect, it } from "vitest";

import {
  RECORD_BLANK,
  RECORD_BOOLERR,
  RECORD_COLINFO,
  RECORD_DIMENSIONS,
  RECORD_FORMULA,
  RECORD_LABEL,
  RECORD_LABELSST,
  RECORD_MERGECELLS,
  RECORD_MULBLANK,
  RECORD_MULRK,
  RECORD_NUMBER,
  RECORD_RK,
  RECORD_ROW,
  RECORD_STRING,
} from "../biff/record-types";
import { BiffFormatError, readRecords } from "../biff/records";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import {
  cell,
  concat,
  f64,
  record,
  rkDouble,
  rkInteger,
  u16,
  u32,
  xlUnicodeString,
} from "../test-support/biff";
import { readSheetRecords } from "./sheet";

function groupsOf(
  ...records: readonly Uint8Array<ArrayBuffer>[]
): readonly RecordGroup[] {
  return groupRecords(readRecords(concat(...records)));
}

function readCells(...records: readonly Uint8Array<ArrayBuffer>[]) {
  return readSheetRecords(groupsOf(...records), []).cells;
}

describe("readSheetRecords cell records", () => {
  it("reads a Number cell as its IEEE 754 double", () => {
    // [MS-XLS] 2.4.180: a Cell then an Xnum. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/a40c74c6-3df4-4e81-9a43-85521cc92c0a
    expect(
      readCells(record(RECORD_NUMBER, [...cell(2, 3), ...f64(1.25)])),
    ).toEqual([
      {
        row: 2,
        column: 3,
        xfIndex: 15,
        value: { kind: "number", value: 1.25 },
        fromFormula: false,
      },
    ]);
  });

  it("reads an RK cell", () => {
    // [MS-XLS] 2.4.220: a row, a column, then a six-byte RkRec of a format index and the packed number.
    const cells = readCells(
      record(RECORD_RK, [...u16(0), ...u16(0), ...u16(15), ...rkInteger(42)]),
    );

    expect(cells[0]?.value).toEqual({ kind: "number", value: 42 });
  });

  it("reads an RK cell holding a truncated double", () => {
    const cells = readCells(
      record(RECORD_RK, [...u16(0), ...u16(0), ...u16(15), ...rkDouble(1.5)]),
    );

    expect(cells[0]?.value).toEqual({ kind: "number", value: 1.5 });
  });

  it("reads a MulRk record as one cell per column in its run", () => {
    // [MS-XLS] 2.4.175: rw, colFirst, N RkRecs, then colLast -- the count following from the record's own length, since colLast sits after the variable-length array.
    const cells = readCells(
      record(RECORD_MULRK, [
        ...u16(4),
        ...u16(1),
        ...u16(15),
        ...rkInteger(10),
        ...u16(15),
        ...rkInteger(20),
        ...u16(15),
        ...rkInteger(30),
        ...u16(3),
      ]),
    );

    expect(
      cells.map((entry) => [entry.row, entry.column, entry.value]),
    ).toEqual([
      [4, 1, { kind: "number", value: 10 }],
      [4, 2, { kind: "number", value: 20 }],
      [4, 3, { kind: "number", value: 30 }],
    ]);
  });

  it("carries each MulRk entry's own format index", () => {
    const cells = readCells(
      record(RECORD_MULRK, [
        ...u16(0),
        ...u16(0),
        ...u16(15),
        ...rkInteger(1),
        ...u16(16),
        ...rkInteger(2),
        ...u16(1),
      ]),
    );

    expect(cells.map((entry) => entry.xfIndex)).toEqual([15, 16]);
  });

  it("rejects a MulRk record whose length holds no whole number of entries", () => {
    expect(() =>
      readCells(
        record(RECORD_MULRK, [...u16(0), ...u16(0), 0x01, 0x02, ...u16(1)]),
      ),
    ).toThrow(BiffFormatError);
  });

  it("reads a Blank cell", () => {
    const cells = readCells(record(RECORD_BLANK, cell(1, 1)));

    expect(cells[0]?.value).toEqual({ kind: "blank" });
  });

  it("reads a MulBlank record as one cell per column in its run", () => {
    // [MS-XLS] 2.4.174: rw, colFirst, N two-byte format indices, then colLast.
    const cells = readCells(
      record(RECORD_MULBLANK, [
        ...u16(7),
        ...u16(2),
        ...u16(15),
        ...u16(16),
        ...u16(3),
      ]),
    );

    expect(cells.map((entry) => [entry.column, entry.xfIndex])).toEqual([
      [2, 15],
      [3, 16],
    ]);
  });

  it("reads a boolean cell", () => {
    // [MS-XLS] 2.4.24 and 2.5.10: the second byte of Bes is 0 for a boolean.
    const cells = readCells(
      record(RECORD_BOOLERR, [...cell(0, 0), 0x01, 0x00]),
    );

    expect(cells[0]?.value).toEqual({ kind: "boolean", value: true });
  });

  it("reads a false boolean cell", () => {
    const cells = readCells(
      record(RECORD_BOOLERR, [...cell(0, 0), 0x00, 0x00]),
    );

    expect(cells[0]?.value).toEqual({ kind: "boolean", value: false });
  });

  it("reads an error cell as the spelling a user sees", () => {
    const cells = readCells(
      record(RECORD_BOOLERR, [...cell(0, 0), 0x07, 0x01]),
    );

    expect(cells[0]?.value).toEqual({ kind: "error", value: "#DIV/0!" });
  });

  it("drops a cell whose error code the specification does not define", () => {
    // Inventing a spelling would put a value in the document no producer wrote.
    expect(
      readCells(record(RECORD_BOOLERR, [...cell(0, 0), 0x99, 0x01])),
    ).toEqual([]);
  });

  it("reads a LabelSst cell through the shared string table", () => {
    const sheet = readSheetRecords(
      groupsOf(record(RECORD_LABELSST, [...cell(0, 0), ...u32(1)])),
      ["Alpha", "Beta"],
    );

    expect(sheet.cells[0]?.value).toEqual({ kind: "string", value: "Beta" });
  });

  it("reads a LabelSst whose index the table does not hold as an empty string", () => {
    // One dangling index should not fail a whole workbook.
    const sheet = readSheetRecords(
      groupsOf(record(RECORD_LABELSST, [...cell(0, 0), ...u32(9)])),
      ["Alpha"],
    );

    expect(sheet.cells[0]?.value).toEqual({ kind: "string", value: "" });
  });

  it("reads a Label cell's inline string", () => {
    const cells = readCells(
      record(RECORD_LABEL, [...cell(0, 0), ...xlUnicodeString("Inline")]),
    );

    expect(cells[0]?.value).toEqual({ kind: "string", value: "Inline" });
  });
});

describe("readSheetRecords formula cells", () => {
  // [MS-XLS] 2.4.127 and 2.5.133: an eight-byte FormulaValue whose last two bytes being 0xFFFF mean the first byte is a type tag rather than part of an Xnum. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/39a0757a-c7bb-4e85-b144-3e7837b059d7

  /** A Formula record's trailing fields: the flags, the calculation cache, and an empty parsed expression. */
  const formulaTail = [...u16(0), ...u32(0), ...u16(0)];

  it("reads a numeric cached result", () => {
    const cells = readCells(
      record(RECORD_FORMULA, [...cell(1, 1), ...f64(3.5), ...formulaTail]),
    );

    expect(cells[0]).toMatchObject({
      value: { kind: "number", value: 3.5 },
      fromFormula: true,
    });
  });

  it("reads a boolean cached result from its tag byte", () => {
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        0x01,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0xff,
        0xff,
        ...formulaTail,
      ]),
    );

    expect(cells[0]?.value).toEqual({ kind: "boolean", value: true });
  });

  it("reads an error cached result from its tag byte", () => {
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        0x02,
        0x00,
        0x17,
        0x00,
        0x00,
        0x00,
        0xff,
        0xff,
        ...formulaTail,
      ]),
    );

    expect(cells[0]?.value).toEqual({ kind: "error", value: "#REF!" });
  });

  it("reads a string cached result from the String record that follows", () => {
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xff,
        0xff,
        ...formulaTail,
      ]),
      record(RECORD_STRING, xlUnicodeString("Result")),
    );

    expect(cells[0]?.value).toEqual({ kind: "string", value: "Result" });
  });

  it("reads a string cached result as empty when no String record follows", () => {
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xff,
        0xff,
        ...formulaTail,
      ]),
    );

    expect(cells[0]?.value).toEqual({ kind: "string", value: "" });
  });

  it("reads a blank-string cached result", () => {
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        0x03,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xff,
        0xff,
        ...formulaTail,
      ]),
    );

    expect(cells[0]?.value).toEqual({ kind: "string", value: "" });
  });
});

describe("readSheetRecords grid geometry", () => {
  it("reads the used range from Dimensions, converting its past-the-end bounds to inclusive ones", () => {
    // [MS-XLS] 2.4.90: rwMac and colMac are the index AFTER the last used row and column.
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_DIMENSIONS, [
          ...u32(1),
          ...u32(5),
          ...u16(2),
          ...u16(4),
          ...u16(0),
        ]),
      ),
      [],
    );

    expect(sheet.usedRange).toEqual({
      startRow: 1,
      startColumn: 2,
      endRow: 4,
      endColumn: 3,
    });
  });

  it("reads a Dimensions record declaring no used cells as no range at all", () => {
    // Both past-the-end fields being zero is the spec's own spelling of an empty sheet, not a range ending at row and column zero.
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_DIMENSIONS, [
          ...u32(0),
          ...u32(0),
          ...u16(0),
          ...u16(0),
          ...u16(0),
        ]),
      ),
      [],
    );

    expect(sheet.usedRange).toBeUndefined();
  });

  it("reads a row's manually set height as points", () => {
    // miyRw is in twips; fUnsynced (0x40) marks the height as genuinely declared rather than a restatement of the sheet default.
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_ROW, [
          ...u16(3),
          ...u16(0),
          ...u16(1),
          ...u16(300),
          ...u16(0),
          ...u16(0),
          0x40,
          0x01,
          ...u16(0),
        ]),
      ),
      [],
    );

    expect(sheet.rows).toEqual([{ index: 3, heightPt: 15, hidden: false }]);
  });

  it("omits a height the producer did not mark as declared", () => {
    // ContentSheetRow documents an absent height as "no declared size, use the application default" rather than a fabricated one.
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_ROW, [
          ...u16(0),
          ...u16(0),
          ...u16(1),
          ...u16(300),
          ...u16(0),
          ...u16(0),
          0x00,
          0x01,
          ...u16(0),
        ]),
      ),
      [],
    );

    expect(sheet.rows[0]).toEqual({ index: 0, hidden: false });
  });

  it("reads a hidden row", () => {
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_ROW, [
          ...u16(0),
          ...u16(0),
          ...u16(1),
          ...u16(300),
          ...u16(0),
          ...u16(0),
          0x20,
          0x01,
          ...u16(0),
        ]),
      ),
      [],
    );

    expect(sheet.rows[0]?.hidden).toBe(true);
  });

  it("expands a ColInfo record across every column of its inclusive range", () => {
    // [MS-XLS] 2.4.53 records one width for a RANGE of columns, where the schema wants one entry per column.
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_COLINFO, [
          ...u16(1),
          ...u16(3),
          ...u16(2560),
          ...u16(15),
          ...u16(0),
          ...u16(0),
        ]),
      ),
      [],
    );

    expect(sheet.columns.map((column) => column.index)).toEqual([1, 2, 3]);
    expect(new Set(sheet.columns.map((column) => column.widthPt))).toHaveLength(
      1,
    );
  });

  it("reads a hidden column", () => {
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_COLINFO, [
          ...u16(0),
          ...u16(0),
          ...u16(2560),
          ...u16(15),
          ...u16(1),
          ...u16(0),
        ]),
      ),
      [],
    );

    expect(sheet.columns[0]?.hidden).toBe(true);
  });

  it("reads merged ranges as inclusive bounds", () => {
    // [MS-XLS] 2.4.168 then 2.5.208: a count, then Ref8 structures ordered rwFirst, rwLast, colFirst, colLast.
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_MERGECELLS, [
          ...u16(2),
          ...u16(0),
          ...u16(1),
          ...u16(0),
          ...u16(2),
          ...u16(5),
          ...u16(5),
          ...u16(3),
          ...u16(4),
        ]),
      ),
      [],
    );

    expect(sheet.merges).toEqual([
      { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 },
      { startRow: 5, endRow: 5, startColumn: 3, endColumn: 4 },
    ]);
  });

  it("ignores records it has no use for", () => {
    const sheet = readSheetRecords(
      groupsOf(
        record(0x023e, [...u16(0), ...u16(0)]),
        record(RECORD_BLANK, cell(0, 0)),
      ),
      [],
    );

    expect(sheet.cells).toHaveLength(1);
  });
});
