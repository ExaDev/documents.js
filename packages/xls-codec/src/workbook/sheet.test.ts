import { describe, expect, it } from "vitest";

import {
  RECORD_ARRAY,
  RECORD_BLANK,
  RECORD_BOOLERR,
  RECORD_BOTTOMMARGIN,
  RECORD_COLINFO,
  RECORD_DIMENSIONS,
  RECORD_FORMULA,
  RECORD_HORIZONTALPAGEBREAKS,
  RECORD_LABEL,
  RECORD_LABELSST,
  RECORD_LEFTMARGIN,
  RECORD_MERGECELLS,
  RECORD_MULBLANK,
  RECORD_MULRK,
  RECORD_NUMBER,
  RECORD_PRINTGRID,
  RECORD_PRINTROWCOL,
  RECORD_RIGHTMARGIN,
  RECORD_RK,
  RECORD_ROW,
  RECORD_SETUP,
  RECORD_SHRFMLA,
  RECORD_STRING,
  RECORD_TOPMARGIN,
  RECORD_VERTICALPAGEBREAKS,
  RECORD_WSBOOL,
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

  it("finds a string cached result past the ShrFmla record of a shared formula", () => {
    // The FORMULA production of [MS-XLS] 2.1.7.20.6 is `[Uncalced] Formula [Array / Table / ShrFmla / SUB] [String *Continue]`, so a member of a shared-formula run puts a record between the Formula and its String -- checking only the immediately following record would read the result as empty.
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
      // ShrFmla ([MS-XLS] 984826cc): a RefU (rwFirst u16, rwLast u16, colFirst u8, colLast u8), a reserved byte, a cUse byte, then a SharedParsedFormula (cce u16, rgce) -- cce=0 here since this test only cares about finding the String past it, not about the shared expression itself.
      record(RECORD_SHRFMLA, [...u16(0), ...u16(0), 0, 0, 0, 0, ...u16(0)]),
      record(RECORD_STRING, xlUnicodeString("Shared")),
    );

    expect(cells[0]?.value).toEqual({ kind: "string", value: "Shared" });
  });

  it("does not reach past an unrelated record into the next cell's own String", () => {
    // A Formula with no string result must not adopt a String belonging to a later formula, so anything outside the production's own optional middle ends the search.
    const cells = readCells(
      record(RECORD_FORMULA, [...cell(0, 0), ...f64(1), ...formulaTail]),
      record(RECORD_NUMBER, [...cell(0, 1), ...f64(2)]),
      record(RECORD_STRING, xlUnicodeString("NotMine")),
    );

    expect(cells[0]?.value).toEqual({ kind: "number", value: 1 });
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
  });

  it("leaves formula absent for a token this reader does not resolve", () => {
    // PtgExp ([MS-XLS] 2.5.198.58), a shared formula's own placeholder -- the cached value is still read correctly, only the text stays absent.
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
    expect(cells[0]?.value).toEqual({ kind: "number", value: 4 });
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
    // A column filled down with "=A<row>": B1 (the base cell) holds =A1, B2 holds =A2 -- both stored on disk as just a PtgExp pointing back at B1's own coordinates (row 0, column 1). The real expression -- a single fully-relative PtgRefN one column to the left, same row -- lives once in the ShrFmla record that follows B1's own Formula record. PtgRefN's row field carries a plain delta (0 here); its column field packs both flag bits (0xC000) and the signed 14-bit delta (-1, i.e. 0x3FFF) into one word, which happens to equal 0xFFFF for exactly this delta.
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

  it("expands a shared formula mixing an absolute PtgRef with a relative PtgRefN, a real on-disk shape per [MS-XLS]", () => {
    // "=$A$1+A<row>" filled down: the absolute half never changes with the referencing cell, only the relative half does. SharedParsedFormula's own grammar permits ordinary (non-N) Ptg tokens alongside PtgRefN/PtgAreaN in the same rgce -- only the relative ones expand per cell.
    const shrFmlaRgce = [
      0x44,
      ...u16(0),
      ...u16(0), // PtgRef $A$1 -- row 0, column field 0 (both absolute)
      0x4c,
      ...u16(0),
      ...u16(0xffff), // PtgRefN -- row delta 0, column delta -1
      0x03, // PtgAdd
    ];
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
        ...u16(0),
        ...u16(1),
        1,
        1,
        0,
        2,
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

    expect(cells[0]?.formula).toBe("$A$1+A1");
    expect(cells[1]?.formula).toBe("$A$1+A2");
  });

  it("resolves an array (CSE) formula's expanded text with no formula-bar bracing, identical for every cell in the range", () => {
    // A2:A3 entered as one array formula "=A1*2" -- the base cell A2 and its sibling A3 both carry just a PtgExp pointing back at A2 (row 1, column 0); the real, position-independent expression lives once in the Array record. Excel's own `{...}` CSE bracing is formula-bar display syntax, never written into the formula itself, so this matches ooxml.js's own xlsx convention rather than adding it.
    const arrayRgce = [
      0x44,
      ...u16(0),
      ...u16(0xc000), // PtgRef A1
      0x1e,
      ...u16(2), // PtgInt 2
      0x05, // PtgMul
    ];
    const ptgExpToBase = [0x01, ...u16(1), ...u16(0)];
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(1, 0),
        ...f64(2),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpToBase.length),
        ...ptgExpToBase,
      ]),
      record(RECORD_ARRAY, [
        ...u16(1),
        ...u16(2),
        0,
        0, // ref: rwFirst=1, rwLast=2, colFirst=0, colLast=0 -- not interpreted by this reader
        ...u16(0), // flags word (fAlwaysCalc + reserved)
        ...u32(0), // unused
        ...u16(arrayRgce.length),
        ...arrayRgce,
      ]),
      record(RECORD_FORMULA, [
        ...cell(2, 0),
        ...f64(4),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpToBase.length),
        ...ptgExpToBase,
      ]),
    );

    expect(cells[0]?.formula).toBe("A1*2");
    expect(cells[1]?.formula).toBe("A1*2");
  });

  it("resolves an array-constant literal inside an ordinary, non-array-entered formula from its own rgcb trailer", () => {
    // =SUM({1;2;3}) -- a plain formula containing a literal array constant is unrelated to a CSE array formula: PtgArray/PtgExtraArray sit directly in one Formula record's own rgce/rgcb, with no Array record involved at all.
    const rgce = [
      0x40,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // PtgArray (value class) -- 7 bytes this reader never inspects
      0x42,
      0x01,
      ...u16(0x0004), // PtgFuncVar SUM, cparams=1
    ];
    const rgcb = [
      0, // cols - 1 = 0 (one column)
      ...u16(2), // rows - 1 = 2 (three rows)
      0x01,
      ...f64(1), // SerNum 1
      0x01,
      ...f64(2), // SerNum 2
      0x01,
      ...f64(3), // SerNum 3
    ];
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        ...f64(6),
        ...u16(0),
        ...u32(0),
        ...u16(rgce.length),
        ...rgce,
        ...rgcb,
      ]),
    );

    expect(cells[0]?.formula).toBe("SUM({1;2;3})");
  });

  it("keeps the cell's cached value when its own rgcb trailer is too short for the PtgExtraArray it claims to hold", () => {
    // rgcb's own byte length is never declared anywhere in the file -- this reader infers it by subtraction from the record's total length -- so a PtgExtraArray whose row/column counts overrun what's actually there is a real malformation risk, not a hypothetical one. This must degrade to an absent formula for this one cell, exactly like any other unresolved construct, rather than throwing and losing every other cell's read along with it.
    const rgce = [
      0x40,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // PtgArray
      0x42,
      0x01,
      ...u16(0x0004), // PtgFuncVar SUM, cparams=1
    ];
    const rgcb = [
      0, // cols - 1 = 0
      ...u16(2), // rows - 1 = 2 (claims three rows)
      0x01,
      ...f64(1), // only one SerNum actually supplied
    ];
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        ...f64(6),
        ...u16(0),
        ...u32(0),
        ...u16(rgce.length),
        ...rgce,
        ...rgcb,
      ]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toEqual({ kind: "number", value: 6 });
  });

  it("leaves formula absent for a PtgExp whose base cell has no matching ShrFmla/Array group", () => {
    // A PtgExp pointing at a cell that is never followed by ShrFmla/Array -- a dangling or malformed reference this reader declines to guess at, exactly like any other unresolved construct.
    const ptgExpToNowhere = [0x01, ...u16(5), ...u16(5)];
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        ...f64(1),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpToNowhere.length),
        ...ptgExpToNowhere,
      ]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toEqual({ kind: "number", value: 1 });
  });

  it("does not abort the whole sheet read when a ShrFmla record's own cce overruns the record", () => {
    // A ShrFmla whose own cce claims far more rgce bytes than the record actually carries must degrade to no group recovered for this base cell, not throw out of collectFormulaGroups -- that would abort readSheetRecords before its own cell-reading loop ever runs, losing every OTHER cell on the sheet along with this one's formula text, not just this one's.
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
        ...u16(1000), // cce claims 1000 bytes of rgce -- far more than this record actually carries
        0x4c,
        ...u16(0),
        ...u16(0xffff), // a couple of real bytes, nowhere near 1000
      ]),
      record(RECORD_NUMBER, [...cell(9, 9), ...f64(42)]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toEqual({ kind: "number", value: 1 });
    expect(cells[1]?.value).toEqual({ kind: "number", value: 42 });
  });

  it("does not abort the whole sheet read when an Array record's own cce overruns the record", () => {
    // The same malformed-length risk as the ShrFmla case above, on the OTHER record collectFormulaGroups reads without a bounds guard: an Array record's own cce claiming far more rgce bytes than it actually carries.
    const ptgExpToBase = [0x01, ...u16(1), ...u16(0)];
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(1, 0),
        ...f64(2),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpToBase.length),
        ...ptgExpToBase,
      ]),
      record(RECORD_ARRAY, [
        ...u16(1),
        ...u16(2),
        0,
        0, // ref: rwFirst=1, rwLast=2, colFirst=0, colLast=0
        ...u16(0), // flags word
        ...u32(0), // unused
        ...u16(1000), // cce claims 1000 bytes of rgce -- far more than this record actually carries
        0x44,
        ...u16(0),
        ...u16(0xc000), // a couple of real bytes, nowhere near 1000
      ]),
      record(RECORD_NUMBER, [...cell(9, 9), ...f64(99)]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toEqual({ kind: "number", value: 2 });
    expect(cells[1]?.value).toEqual({ kind: "number", value: 99 });
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

describe("readSheetRecords print settings", () => {
  it("reads the Setup record's own paper, scale, fit-to-page counts, and flags", () => {
    // [MS-XLS] 2.4.257: iPaperSize, iScale, iPageStart, iFitWidth, iFitHeight, the flags word, iRes, iVRes, numHdr, numFtr, iCopies. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/23642d03-de0e-4a7f-94da-c2e594020bf2
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_SETUP, [
          ...u16(9), // iPaperSize: A4
          ...u16(80), // iScale
          ...u16(1), // iPageStart
          ...u16(2), // iFitWidth
          ...u16(3), // iFitHeight
          ...u16(0x0001), // fLeftToRight set, fPortrait clear
          ...u16(300), // iRes
          ...u16(300), // iVRes
          ...f64(0.3), // numHdr
          ...f64(0.3), // numFtr
          ...u16(1), // iCopies
        ]),
      ),
      [],
    );

    expect(sheet.print.setup).toEqual({
      paperCode: 9,
      scalePercent: 80,
      fitWidth: 2,
      fitHeight: 3,
      leftToRight: true,
      portrait: false,
      noPls: false,
      noOrientation: false,
    });
  });

  it("reads each of the four margin records as points", () => {
    // Each is a single Xnum of INCHES ([MS-XLS] 2.4.151, 2.4.219, 2.4.328, 2.4.27), so half an inch reads as 36pt.
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_LEFTMARGIN, f64(0.5)),
        record(RECORD_RIGHTMARGIN, f64(0.75)),
        record(RECORD_TOPMARGIN, f64(1)),
        record(RECORD_BOTTOMMARGIN, f64(1.25)),
      ),
      [],
    );

    expect(sheet.print.marginsPt).toEqual({
      left: 36,
      right: 54,
      top: 72,
      bottom: 90,
    });
  });

  it("leaves a margin absent when the sheet carries no record for that side", () => {
    // [MS-XLS] 2.1.7.20.6's PAGESETUP production brackets each margin individually, so a sheet stating one and not the others is well-formed -- and "states nothing" has to stay distinguishable from "states the default".
    const sheet = readSheetRecords(
      groupsOf(record(RECORD_LEFTMARGIN, f64(0.5))),
      [],
    );

    expect(sheet.print.marginsPt).toEqual({ left: 36 });
  });

  it("reads PrintGrid and PrintRowCol as the booleans they are", () => {
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_PRINTGRID, u16(1)),
        record(RECORD_PRINTROWCOL, u16(0)),
      ),
      [],
    );

    expect(sheet.print.printGridlines).toBe(true);
    expect(sheet.print.printHeaders).toBe(false);
  });

  it("reads PrintGrid's fPrintGrid bit alone, ignoring the 15 bits [MS-XLS] 2.4.202 documents as undefined", () => {
    // Unlike PrintRowCol's own genuinely 16-bit Boolean field, PrintGrid packs its one real bit into a 16-bit record with 15 undefined bits alongside it -- a bare `!== 0` test would read any of them set as gridlines-on.
    const sheet = readSheetRecords(
      groupsOf(record(RECORD_PRINTGRID, u16(0xfffe))),
      [],
    );

    expect(sheet.print.printGridlines).toBe(false);
  });

  it("reads WsBool's fFitToPage bit and no other", () => {
    // Field G of [MS-XLS] 2.4.351's single 16-bit field, the ninth bit. 0x04c1 is the value a real LibreOffice-written non-fit-to-page sheet carries; 0x05c1 is the same sheet with fit-to-page on.
    expect(
      readSheetRecords(groupsOf(record(RECORD_WSBOOL, u16(0x04c1))), []).print
        .fitToPage,
    ).toBe(false);
    expect(
      readSheetRecords(groupsOf(record(RECORD_WSBOOL, u16(0x05c1))), []).print
        .fitToPage,
    ).toBe(true);
  });

  it("reads both page-break records, taking each break's own index and not its extent", () => {
    // [MS-XLS] 2.4.142/2.4.343: a count then that many six-byte structures -- a HorzBrk's row plus its colStart/colEnd, a VertBrk's col plus its rowStart/rowEnd.
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_HORIZONTALPAGEBREAKS, [
          ...u16(2),
          ...u16(10),
          ...u16(0),
          ...u16(0xff),
          ...u16(4),
          ...u16(0),
          ...u16(0xff),
        ]),
        record(RECORD_VERTICALPAGEBREAKS, [
          ...u16(1),
          ...u16(3),
          ...u16(0),
          ...u16(0xffff),
        ]),
      ),
      [],
    );

    expect(sheet.print.rowBreaks).toEqual([4, 10]);
    expect(sheet.print.columnBreaks).toEqual([3]);
  });

  it("collapses two breaks naming the same index, which the schema models only once", () => {
    // A BIFF8 page break carries an extent along the perpendicular axis, so one row can legitimately carry two partial breaks; ContentSheetPrintSettings names a break by index alone.
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_HORIZONTALPAGEBREAKS, [
          ...u16(2),
          ...u16(7),
          ...u16(0),
          ...u16(3),
          ...u16(7),
          ...u16(4),
          ...u16(0xff),
        ]),
      ),
      [],
    );

    expect(sheet.print.rowBreaks).toEqual([7]);
  });

  it("states nothing at all for a sheet carrying none of the print records", () => {
    const sheet = readSheetRecords(
      groupsOf(record(RECORD_BLANK, cell(0, 0))),
      [],
    );

    expect(sheet.print).toEqual({
      marginsPt: {},
      rowBreaks: [],
      columnBreaks: [],
    });
  });
});
