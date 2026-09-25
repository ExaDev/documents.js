// The formula-cell suites, split from sheet.test.ts, restating its harness verbatim.

import { describe, expect, it } from "vitest";

import {
  RECORD_ARRAY,
  RECORD_FORMULA,
  RECORD_NUMBER,
  RECORD_SHRFMLA,
  RECORD_STRING,
  RECORD_TABLE,
} from "../biff/record-types";
import { readRecords } from "../biff/records";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import {
  cell,
  concat,
  f64,
  record,
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

    expect(cells[0]?.value).toStrictEqual({ kind: "boolean", value: true });
  });

  it("reads a false boolean cached result from its tag byte, not just true", () => {
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        0x01,
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

    expect(cells[0]?.value).toStrictEqual({ kind: "boolean", value: false });
  });

  it("treats byte 6 alone being 0xff, with byte 7 genuinely not, as an untagged numeric FormulaValue — both bytes must be 0xff, not just one", () => {
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        0x01, // would read as a boolean tag if this FormulaValue were actually tagged
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xff,
        0x00, // byte 7 is genuinely not 0xff
        ...formulaTail,
      ]),
    );

    expect(cells[0]?.value.kind).toBe("number");
  });

  it("treats byte 7 alone being 0xff, with byte 6 genuinely not, as an untagged numeric FormulaValue too", () => {
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        0x01,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00, // byte 6 is genuinely not 0xff
        0xff,
        ...formulaTail,
      ]),
    );

    expect(cells[0]?.value.kind).toBe("number");
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

    expect(cells[0]?.value).toStrictEqual({ kind: "error", value: "#REF!" });
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

    expect(cells[0]?.value).toStrictEqual({ kind: "string", value: "Result" });
  });

  it("finds a string cached result past an Array record sitting between the Formula and its String, an array formula's own FORMULA production shape", () => {
    const arrayFiller = record(RECORD_ARRAY, [
      ...u16(0),
      ...u16(0),
      0,
      0, // ref
      ...u16(0), // flags
      ...u32(0), // unused
      ...u16(0), // cce
    ]);
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
      arrayFiller,
      record(RECORD_STRING, xlUnicodeString("Result")),
    );

    expect(cells[0]?.value).toStrictEqual({ kind: "string", value: "Result" });
  });

  it("finds a string cached result past a Table record sitting between the Formula and its String, a data table's own FORMULA production shape", () => {
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
      record(RECORD_TABLE, [...u16(0), ...u16(0)]),
      record(RECORD_STRING, xlUnicodeString("Result")),
    );

    expect(cells[0]?.value).toStrictEqual({ kind: "string", value: "Result" });
  });

  it("stops the search and leaves the cached string empty when the record after the Formula is none of String/Array/Table/ShrFmla", () => {
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
      record(RECORD_NUMBER, [...cell(9, 9), ...f64(1)]),
      record(RECORD_STRING, xlUnicodeString("Result")),
    );

    expect(cells[0]?.value).toStrictEqual({ kind: "string", value: "" });
  });

  it("finds a string cached result past the ShrFmla record of a shared formula", () => {
    // The FORMULA production of [MS-XLS] 2.1.7.20.6 is `[Uncalced] Formula [Array / Table / ShrFmla / SUB] [String *Continue]`, so a member of a shared-formula run puts a record between the Formula and its String — checking only the immediately following record would read the result as empty.
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
      // ShrFmla ([MS-XLS] 984826cc): a RefU (rwFirst u16, rwLast u16, colFirst u8, colLast u8), a reserved byte, a cUse byte, then a SharedParsedFormula (cce u16, rgce) — cce=0 here since this test only cares about finding the String past it, not about the shared expression itself.
      record(RECORD_SHRFMLA, [...u16(0), ...u16(0), 0, 0, 0, 0, ...u16(0)]),
      record(RECORD_STRING, xlUnicodeString("Shared")),
    );

    expect(cells[0]?.value).toStrictEqual({ kind: "string", value: "Shared" });
  });

  it("does not reach past an unrelated record into the next cell's own String", () => {
    // A Formula with no string result must not adopt a String belonging to a later formula, so anything outside the production's own optional middle ends the search.
    const cells = readCells(
      record(RECORD_FORMULA, [...cell(0, 0), ...f64(1), ...formulaTail]),
      record(RECORD_NUMBER, [...cell(0, 1), ...f64(2)]),
      record(RECORD_STRING, xlUnicodeString("NotMine")),
    );

    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 1 });
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

    expect(cells[0]?.value).toStrictEqual({ kind: "string", value: "" });
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

    expect(cells[0]?.value).toStrictEqual({ kind: "string", value: "" });
  });

  it("recovers the formula's own text from its compiled Ptg token stream", () => {
    // A1+B1: PtgRef(A1) PtgRef(B1) PtgAdd, [MS-XLS] 2.5.198.84/2.5.198.26.
    const rgce = [
      0x44,
      ...u16(0),
      ...u16(0xc000),
      0x44,
      ...u16(0),
      ...u16(0xc001),
      0x03,
    ];
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 2),
        ...f64(3),
        ...u16(0),
        ...u32(0),
        ...u16(rgce.length),
        ...rgce,
      ]),
    );

    expect(cells[0]?.formula).toBe("A1+B1");
    expect(cells[0]?.fromFormula).toBe(true);
  });

  it("leaves formula absent for a token this reader does not resolve", () => {
    // PtgExp ([MS-XLS] 2.5.198.58), a shared formula's own placeholder — the cached value is still read correctly, only the text stays absent.
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        ...f64(4),
        ...u16(0),
        ...u32(0),
        ...u16(5),
        0x01,
        ...u16(0),
        ...u16(0),
      ]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 4 });
  });

  it("resolves a 3D reference using the formulaSheets context readSheetRecords is given", () => {
    // PtgRef3d (value class, [MS-XLS] 2.5.198.85): opcode 0x5A, ixti, then a row and column field.
    const rgce = [0x5a, ...u16(0), ...u16(0), ...u16(0xc000)];
    const formulaSheets = {
      sheets: [{ name: "Sheet1" }, { name: "Data" }],
      sheetRanges: [{ firstSheetIndex: 1, lastSheetIndex: 1 }],
    };
    const cells = readSheetRecords(
      groupsOf(
        record(RECORD_FORMULA, [
          ...cell(0, 0),
          ...f64(1),
          ...u16(0),
          ...u32(0),
          ...u16(rgce.length),
          ...rgce,
        ]),
      ),
      [],
      formulaSheets,
    ).cells;

    expect(cells[0]?.formula).toBe("Data!A1");
  });

  it("expands a shared formula's ShrFmla text relative to each referencing cell's own position", () => {
    // A column filled down with "=A<row>": B1 (the base cell) holds =A1, B2 holds =A2 — both stored on disk as just a PtgExp pointing back at B1's own coordinates (row 0, column 1). The real expression — a single fully-relative PtgRefN one column to the left, same row — lives once in the ShrFmla record that follows B1's own Formula record. PtgRefN's row field carries a plain delta (0 here); its column field packs both flag bits (0xC000) and the signed 14-bit delta (-1, i.e. 0x3FFF) into one word, which happens to equal 0xFFFF for exactly this delta.
    const shrFmlaRgce = [0x4c, ...u16(0), ...u16(0xffff)];
    const ptgExpToBase = [0x01, ...u16(0), ...u16(1)];
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 1),
        ...f64(1),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpToBase.length),
        ...ptgExpToBase,
      ]),
      record(RECORD_SHRFMLA, [
        ...u16(0), // rwFirst
        ...u16(1), // rwLast
        1, // colFirst
        1, // colLast
        0, // reserved
        2, // cUse
        ...u16(shrFmlaRgce.length),
        ...shrFmlaRgce,
      ]),
      record(RECORD_FORMULA, [
        ...cell(1, 1),
        ...f64(2),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpToBase.length),
        ...ptgExpToBase,
      ]),
    );

    expect(cells[0]?.formula).toBe("A1");
    expect(cells[1]?.formula).toBe("A2");
  });

  it("keys two distinct shared-formula groups by their own separate base cells, never resolving one cell's PtgExp against the other group", () => {
    // Two independent shared-formula runs on the same sheet — base (0,1) filled with the literal 100, base (5,7) with the literal 200 — each referenced by its own cell via a PtgExp pointing back at its own base. If groupKey ever collapsed two different (row, column) pairs onto the same map key, the second group recorded would silently overwrite the first, and the cell referencing the first base would wrongly resolve to the second group's own text instead.
    const ptgInt = (value: number) => [0x1e, ...u16(value)];
    const ptgExpTo = (row: number, column: number) => [
      0x01,
      ...u16(row),
      ...u16(column),
    ];
    const shrFmlaOf = (
      rwFirst: number,
      colFirst: number,
      rgce: readonly number[],
    ) =>
      record(RECORD_SHRFMLA, [
        ...u16(rwFirst),
        ...u16(rwFirst),
        colFirst,
        colFirst,
        0,
        2,
        ...u16(rgce.length),
        ...rgce,
      ]);
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 1),
        ...f64(100),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpTo(0, 1).length),
        ...ptgExpTo(0, 1),
      ]),
      shrFmlaOf(0, 1, ptgInt(100)),
      record(RECORD_FORMULA, [
        ...cell(5, 7),
        ...f64(200),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpTo(5, 7).length),
        ...ptgExpTo(5, 7),
      ]),
      shrFmlaOf(5, 7, ptgInt(200)),
      record(RECORD_FORMULA, [
        ...cell(2, 2),
        ...f64(100),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpTo(0, 1).length),
        ...ptgExpTo(0, 1),
      ]),
      record(RECORD_FORMULA, [
        ...cell(8, 9),
        ...f64(200),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpTo(5, 7).length),
        ...ptgExpTo(5, 7),
      ]),
    );

    expect(cells[2]?.formula).toBe("100");
    expect(cells[3]?.formula).toBe("200");
  });
});
