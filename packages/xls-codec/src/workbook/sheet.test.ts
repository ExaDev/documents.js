import { describe, expect, it } from "vitest";

import {} from "../biff/cursor";

import {
  RECORD_BLANK,
  RECORD_BOOLERR,
  RECORD_LABEL,
  RECORD_LABELSST,
  RECORD_MULBLANK,
  RECORD_MULRK,
  RECORD_NUMBER,
  RECORD_RK,
} from "../biff/record-types";
import { readRecords } from "../biff/records";
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
    ).toStrictEqual([
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

    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 42 });
  });

  it("reads an RK cell holding a truncated double", () => {
    const cells = readCells(
      record(RECORD_RK, [...u16(0), ...u16(0), ...u16(15), ...rkDouble(1.5)]),
    );

    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 1.5 });
  });

  it("reads a MulRk record as one cell per column in its run", () => {
    // [MS-XLS] 2.4.175: rw, colFirst, N RkRecs, then colLast — the count following from the record's own length, since colLast sits after the variable-length array.
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
    ).toStrictEqual([
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

    expect(cells.map((entry) => entry.xfIndex)).toStrictEqual([15, 16]);
  });

  it("rejects a MulRk record whose length holds no whole number of entries, naming the exact byte counts", () => {
    expect(() =>
      readCells(
        record(RECORD_MULRK, [...u16(0), ...u16(0), 0x01, 0x02, ...u16(1)]),
      ),
    ).toThrow(
      "multiple-cell record of 8 bytes does not hold a whole number of 6-byte entries",
    );
  });

  it("rejects a MulRk record shorter than its own fixed rw/colFirst/colLast fields, a genuinely negative payload rather than merely a non-multiple one", () => {
    expect(() =>
      readCells(record(RECORD_MULRK, [...u16(0), ...u16(0)])),
    ).toThrow(
      "multiple-cell record of 4 bytes does not hold a whole number of 6-byte entries",
    );
  });

  it("rejects a MulBlank record whose negative payload is nonetheless an exact multiple of its own entry width, proving the negative check is not just standing in for the modulo one", () => {
    // MulBlank's own entry width is 2 bytes, and a 4-byte record (row + colFirst only, no colLast, no entries) gives a payload of 4 - 6 = -2 — negative, but -2 % 2 is 0 in JS's own signed modulo, so only a genuine `payload < 0` check catches this; the modulo clause alone would wrongly accept it.
    expect(() =>
      readCells(record(RECORD_MULBLANK, [...u16(0), ...u16(0)])),
    ).toThrow(
      "multiple-cell record of 4 bytes does not hold a whole number of 2-byte entries",
    );
  });

  it("accepts a MulBlank record whose payload is exactly zero, a legitimate empty run rather than a negative one", () => {
    const cells = readCells(
      record(RECORD_MULBLANK, [...u16(0), ...u16(0), ...u16(0)]),
    );
    expect(cells).toStrictEqual([]);
  });

  it("reads a Blank cell", () => {
    const cells = readCells(record(RECORD_BLANK, cell(1, 1)));

    expect(cells[0]?.value).toStrictEqual({ kind: "blank" });
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

    expect(cells.map((entry) => [entry.column, entry.xfIndex])).toStrictEqual([
      [2, 15],
      [3, 16],
    ]);
  });

  it("reads a boolean cell", () => {
    // [MS-XLS] 2.4.24 and 2.5.10: the second byte of Bes is 0 for a boolean.
    const cells = readCells(
      record(RECORD_BOOLERR, [...cell(0, 0), 0x01, 0x00]),
    );

    expect(cells[0]?.value).toStrictEqual({ kind: "boolean", value: true });
  });

  it("reads a false boolean cell", () => {
    const cells = readCells(
      record(RECORD_BOOLERR, [...cell(0, 0), 0x00, 0x00]),
    );

    expect(cells[0]?.value).toStrictEqual({ kind: "boolean", value: false });
  });

  it("reads an error cell as the spelling a user sees", () => {
    const cells = readCells(
      record(RECORD_BOOLERR, [...cell(0, 0), 0x07, 0x01]),
    );

    expect(cells[0]?.value).toStrictEqual({ kind: "error", value: "#DIV/0!" });
  });

  it("drops a cell whose error code the specification does not define", () => {
    // Inventing a spelling would put a value in the document no producer wrote.
    expect(
      readCells(record(RECORD_BOOLERR, [...cell(0, 0), 0x99, 0x01])),
    ).toStrictEqual([]);
  });

  it("reads a LabelSst cell through the shared string table", () => {
    const sheet = readSheetRecords(
      groupsOf(record(RECORD_LABELSST, [...cell(0, 0), ...u32(1)])),
      ["Alpha", "Beta"],
    );

    expect(sheet.cells[0]?.value).toStrictEqual({
      kind: "string",
      value: "Beta",
    });
  });

  it("reads a LabelSst whose index the table does not hold as an empty string", () => {
    // One dangling index should not fail a whole workbook.
    const sheet = readSheetRecords(
      groupsOf(record(RECORD_LABELSST, [...cell(0, 0), ...u32(9)])),
      ["Alpha"],
    );

    expect(sheet.cells[0]?.value).toStrictEqual({ kind: "string", value: "" });
  });

  it("reads a Label cell's inline string", () => {
    const cells = readCells(
      record(RECORD_LABEL, [...cell(0, 0), ...xlUnicodeString("Inline")]),
    );

    expect(cells[0]?.value).toStrictEqual({ kind: "string", value: "Inline" });
  });

  it("marks every non-formula cell record's own reading as fromFormula: false, not just Number's own", () => {
    const cells = readCells(
      record(RECORD_BLANK, cell(0, 0)),
      record(RECORD_MULBLANK, [...u16(1), ...u16(0), ...u16(15), ...u16(1)]),
      record(RECORD_RK, [...cell(2, 0), ...rkInteger(1)]),
      record(RECORD_MULRK, [
        ...u16(3),
        ...u16(0),
        ...u16(15),
        ...rkInteger(1),
        ...u16(1),
      ]),
      record(RECORD_BOOLERR, [...cell(4, 0), 0x01, 0x00]),
      record(RECORD_BOOLERR, [...cell(5, 0), 0x07, 0x01]),
      record(RECORD_LABELSST, [...cell(6, 0), ...u32(0)]),
      record(RECORD_LABEL, [...cell(7, 0), ...xlUnicodeString("x")]),
    );
    expect(cells).toHaveLength(8);
    expect(cells.every((entry) => !entry.fromFormula)).toBe(true);
  });
});
