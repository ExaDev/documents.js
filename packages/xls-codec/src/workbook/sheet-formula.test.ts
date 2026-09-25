// The formula-cell suites, split from sheet.test.ts, restating its harness verbatim.

import { describe, expect, it, vi } from "vitest";

import { BlockCursor } from "../biff/cursor";
import * as ptgModule from "../biff/ptg";
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

  it("never forms a shared-formula group from a non-Formula record immediately followed by a ShrFmla, even though the two share the identical leading Cell-header layout", () => {
    // A Number record's own base cell (3, 3) happens to parse through readCellHeader exactly like a Formula record's would — collectFormulaGroups' own record.type check is the only thing distinguishing "this is a real base cell" from "this happens to precede a ShrFmla by coincidence."
    const ptgInt = (value: number) => [0x1e, ...u16(value)];
    const ptgExpTo = (row: number, column: number) => [
      0x01,
      ...u16(row),
      ...u16(column),
    ];
    const cells = readCells(
      record(RECORD_NUMBER, [...cell(3, 3), ...f64(9)]),
      record(RECORD_SHRFMLA, [
        ...u16(3),
        ...u16(3),
        3,
        3,
        0,
        2,
        ...u16(ptgInt(999).length),
        ...ptgInt(999),
      ]),
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        ...f64(1),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpTo(3, 3).length),
        ...ptgExpTo(3, 3),
      ]),
    );

    expect(cells[1]?.formula).toBeUndefined();
  });

  it("never forms an array-formula group from a Formula record followed by anything other than ShrFmla or Array, even a record shaped just like a well-formed Array group", () => {
    // Table shares the identical layout an Array record's own group-reading would expect (12-byte header, then a two-byte cce and that many rgce bytes) — only next.type distinguishes "this really is this Formula's own Array companion" from "the next record just happens to be shaped the same way."
    const ptgInt = (value: number) => [0x1e, ...u16(value)];
    const ptgExpTo = (row: number, column: number) => [
      0x01,
      ...u16(row),
      ...u16(column),
    ];
    const arrayShapedRgce = ptgInt(77);
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(2, 2),
        ...f64(1),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpTo(2, 2).length),
        ...ptgExpTo(2, 2),
      ]),
      record(RECORD_TABLE, [
        ...new Array<number>(12).fill(0), // the identical 12-byte header ARRAY_HEADER_BYTES skips
        ...u16(arrayShapedRgce.length),
        ...arrayShapedRgce,
      ]),
      record(RECORD_FORMULA, [
        ...cell(5, 5),
        ...f64(1),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpTo(2, 2).length),
        ...ptgExpTo(2, 2),
      ]),
    );

    expect(cells[1]?.formula).toBeUndefined();
  });

  it("propagates a genuine bug out of collectFormulaGroup rather than absorbing it as just another malformed base cell", () => {
    // A well-formed Formula+ShrFmla pair, the very first thing readSheetRecords touches — the injected bug is a plain Error a spy forces the base cell's own very first field read to throw, not anything a file could ever produce, proving collectFormulaGroup's own catch only recovers from a genuine BiffFormatError (recoverFromFormatError's own re-throw for anything else), not silently swallowing every exception reading a base cell or its group could throw.
    const bug = new TypeError("a genuine bug, not a malformed record");
    const spy = vi
      .spyOn(BlockCursor.prototype, "u16")
      .mockImplementationOnce(() => {
        throw bug;
      });
    try {
      expect(() =>
        readCells(
          record(RECORD_FORMULA, [
            ...cell(0, 1),
            ...f64(1),
            ...u16(0),
            ...u32(0),
            ...u16(0),
          ]),
          record(RECORD_SHRFMLA, [...u16(0), ...u16(0), 1, 1, 0, 2, ...u16(0)]),
        ),
      ).toThrow(bug);
    } finally {
      spy.mockRestore();
    }
  });

  it("expands a shared formula mixing an absolute PtgRef with a relative PtgRefN, a real on-disk shape per [MS-XLS]", () => {
    // "=$A$1+A<row>" filled down: the absolute half never changes with the referencing cell, only the relative half does. SharedParsedFormula's own grammar permits ordinary (non-N) Ptg tokens alongside PtgRefN/PtgAreaN in the same rgce — only the relative ones expand per cell.
    const shrFmlaRgce = [
      0x44,
      ...u16(0),
      ...u16(0), // PtgRef $A$1 — row 0, column field 0 (both absolute)
      0x4c,
      ...u16(0),
      ...u16(0xffff), // PtgRefN — row delta 0, column delta -1
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
    // A2:A3 entered as one array formula "=A1*2" — the base cell A2 and its sibling A3 both carry just a PtgExp pointing back at A2 (row 1, column 0); the real, position-independent expression lives once in the Array record. Excel's own `{...}` CSE bracing is formula-bar display syntax, never written into the formula itself, so this matches ooxml.js's own xlsx convention rather than adding it.
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
        0, // ref: rwFirst=1, rwLast=2, colFirst=0, colLast=0 — not interpreted by this reader
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
    // =SUM({1;2;3}) — a plain formula containing a literal array constant is unrelated to a CSE array formula: PtgArray/PtgExtraArray sit directly in one Formula record's own rgce/rgcb, with no Array record involved at all.
    const rgce = [
      0x40,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // PtgArray (value class) — 7 bytes this reader never inspects
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

  it("leaves formula absent for a PtgArray with genuinely zero trailing bytes, the record ending exactly at rgce's own end", () => {
    const rgce = [0x40, 0, 0, 0, 0, 0, 0, 0]; // PtgArray, needing an rgcb this record carries none of
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        ...f64(6),
        ...u16(0),
        ...u32(0),
        ...u16(rgce.length),
        ...rgce,
        // no trailing bytes at all: rgcbLength is exactly 0
      ]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 6 });
  });

  it("keeps the cell's cached value when its own rgcb trailer is too short for the PtgExtraArray it claims to hold", () => {
    // rgcb's own byte length is never declared anywhere in the file — this reader infers it by subtraction from the record's total length — so a PtgExtraArray whose row/column counts overrun what's actually there is a real malformation risk, not a hypothetical one. This must degrade to an absent formula for this one cell, exactly like any other unresolved construct, rather than throwing and losing every other cell's read along with it.
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
    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 6 });
  });

  it("leaves formula absent for a PtgExp whose base cell has no matching ShrFmla/Array group", () => {
    // A PtgExp pointing at a cell that is never followed by ShrFmla/Array — a dangling or malformed reference this reader declines to guess at, exactly like any other unresolved construct.
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
    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 1 });
  });

  it("does not abort the whole sheet read when a ShrFmla record's own cce overruns the record", () => {
    // A ShrFmla whose own cce claims far more rgce bytes than the record actually carries must degrade to no group recovered for this base cell, not throw out of collectFormulaGroups — that would abort readSheetRecords before its own cell-reading loop ever runs, losing every OTHER cell on the sheet along with this one's formula text, not just this one's.
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
        ...u16(1000), // cce claims 1000 bytes of rgce — far more than this record actually carries
        0x4c,
        ...u16(0),
        ...u16(0xffff), // a couple of real bytes, nowhere near 1000
      ]),
      record(RECORD_NUMBER, [...cell(9, 9), ...f64(42)]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 1 });
    expect(cells[1]?.value).toStrictEqual({ kind: "number", value: 42 });
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
        ...u16(1000), // cce claims 1000 bytes of rgce — far more than this record actually carries
        0x44,
        ...u16(0),
        ...u16(0xc000), // a couple of real bytes, nowhere near 1000
      ]),
      record(RECORD_NUMBER, [...cell(9, 9), ...f64(99)]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 2 });
    expect(cells[1]?.value).toStrictEqual({ kind: "number", value: 99 });
  });

  it("resolves an array-formula group's own PtgArray token against its Array record's real rgcb trailer", () => {
    // The Array record's rgce is a bare PtgArray (needing an rgcb to resolve at all), and rgcb — inferred from the record's own remaining byte length, never declared directly — carries exactly the PtgExtraArray for a single-element array constant. If the byte arithmetic deriving rgcbLength were wrong, this either reads the wrong bytes as rgcb (a corrupted array constant) or fails to see any rgcb at all (formula absent), rather than resolving to the real "{5}" text.
    const ptgArrayToken = [0x40, 0, 0, 0, 0, 0, 0, 0];
    const ptgExtraArraySingleElement = [
      0, // columns - 1 = 0
      ...u16(0), // rows - 1 = 0
      0x01,
      ...f64(5), // SerNum 5
    ];
    const ptgExpToBase = [0x01, ...u16(3), ...u16(3)];
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(3, 3),
        ...f64(5),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpToBase.length),
        ...ptgExpToBase,
      ]),
      record(RECORD_ARRAY, [
        ...u16(3),
        ...u16(3),
        3,
        3, // ref: rwFirst=rwLast=colFirst=colLast=3
        ...u16(0), // flags word
        ...u32(0), // unused
        ...u16(ptgArrayToken.length),
        ...ptgArrayToken,
        ...ptgExtraArraySingleElement,
      ]),
    );

    expect(cells[0]?.formula).toBe("{5}");
  });

  it("resolves an array-formula group whose own rgce carries no PtgArray at all, needing no rgcb trailer — the record ends exactly at rgce's own end, rgcbLength genuinely zero rather than negative or overrun", () => {
    const rgce = [0x1e, ...u16(42)]; // PtgInt 42
    const ptgExpToBase = [0x01, ...u16(4), ...u16(4)];
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(4, 4),
        ...f64(42),
        ...u16(0),
        ...u32(0),
        ...u16(ptgExpToBase.length),
        ...ptgExpToBase,
      ]),
      record(RECORD_ARRAY, [
        ...u16(4),
        ...u16(4),
        4,
        4,
        ...u16(0),
        ...u32(0),
        ...u16(rgce.length),
        ...rgce,
        // no trailing bytes at all: rgcbLength is exactly 0, not merely small
      ]),
    );

    expect(cells[0]?.formula).toBe("42");
  });

  it("does not abort the whole sheet read when a shared group's own rgce carries a token with a lying embedded length", () => {
    // The ShrFmla record itself is perfectly well-formed here — its own cce (4) correctly bounds the 4 bytes of rgce that follow, so collectFormulaGroup's cursor reads all succeed and a group IS recovered for this base cell. The malformed part is inside that already-correctly-bounded rgce: a PtgStr token (0x17) whose own ShortXLUnicodeString cch claims 200 characters when only one byte of character data actually follows. Joining this group against the base cell's PtgExp runs parseFormulaText's cursor past the end of that 4-byte buffer for reasons that are pure file-controlled malformed input (a lying token-internal length), not a bug in this reader's own token walking — so it must degrade this one cell's formula to absent, not abort the whole sheet the way an uncaught BiffFormatError would.
    const shrFmlaRgce = [0x17, 200, 0, 0x41];
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
        ...u16(0), // rwLast
        1, // colFirst
        1, // colLast
        0, // reserved
        1, // cUse
        ...u16(shrFmlaRgce.length),
        ...shrFmlaRgce,
      ]),
      record(RECORD_NUMBER, [...cell(9, 9), ...f64(42)]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 1 });
    expect(cells[1]?.value).toStrictEqual({ kind: "number", value: 42 });
  });

  it("does not abort the whole sheet read when an array group's own rgce carries a token with a lying embedded length", () => {
    // The same malformed-token-length hazard as the ShrFmla case above, joined through an Array group instead: the Array record's own cce (4) correctly bounds the 4 bytes of rgce that follow, so collectFormulaGroup's cursor reads all succeed and a group IS recovered for this base cell. The malformed part is inside that already-correctly-bounded rgce: a PtgStr token (0x17) whose own ShortXLUnicodeString cch claims 200 characters when only one byte of character data actually follows.
    const arrayRgce = [0x17, 200, 0, 0x41];
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
        ...u16(arrayRgce.length),
        ...arrayRgce,
      ]),
      record(RECORD_NUMBER, [...cell(9, 9), ...f64(99)]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 2 });
    expect(cells[1]?.value).toStrictEqual({ kind: "number", value: 99 });
  });

  it("does not abort the whole sheet read when an ordinary (non-shared) Formula record's own rgce carries a token with a lying embedded length", () => {
    // The same malformed-token-length hazard as the two group-joining cases above, but reached with no PtgExp at all — this record's own rgce is handed to parseFormulaText directly (resolveFormulaText's `base === undefined` branch). The record's own cce (4) correctly bounds the 4 bytes of rgce that follow; the malformed part is inside that already-correctly-bounded rgce, the identical PtgStr (0x17) whose own ShortXLUnicodeString cch claims 200 characters when only one byte of character data actually follows. This degrades only this one cell's formula to absent rather than throwing an uncaught BiffFormatError out of readSheetRecords and aborting every other cell (and every other sheet) in the workbook.
    const rgce = [0x17, 200, 0, 0x41];
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        ...f64(1),
        ...u16(0),
        ...u32(0),
        ...u16(rgce.length),
        ...rgce,
      ]),
      record(RECORD_NUMBER, [...cell(9, 9), ...f64(42)]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 1 });
    expect(cells[1]?.value).toStrictEqual({ kind: "number", value: 42 });
  });

  it("does not abort the whole sheet read when a Formula record's own cce overruns the record", () => {
    // The one remaining unguarded overrun path: unlike ShrFmla/Array (collectFormulaGroup's own try/catch) and unlike a lying token-internal length inside an already-correctly-bounded rgce (resolveFormulaText's own try/catch), an ordinary Formula record's own cce declaring more rgce bytes than the record actually carries throws BiffFormatError straight out of `cursor.take(cce)`, before resolveFormulaText is ever reached — and readFormula is called with no try/catch of its own from readSheetRecords' per-record loop, so that error would otherwise abort the whole sheet read (and every other sheet in the workbook), not just this one cell.
    const rgce = [0x41, 0, 0]; // only 3 bytes actually present
    const cells = readCells(
      record(RECORD_FORMULA, [
        ...cell(0, 0),
        ...f64(1),
        ...u16(0),
        ...u32(0),
        ...u16(1000), // cce claims 1000 bytes of rgce — far more than this record actually carries
        ...rgce,
      ]),
      record(RECORD_NUMBER, [...cell(9, 9), ...f64(42)]),
    );

    expect(cells[0]?.formula).toBeUndefined();
    expect(cells[0]?.value).toStrictEqual({ kind: "number", value: 1 });
    expect(cells[1]?.value).toStrictEqual({ kind: "number", value: 42 });
  });

  it("propagates a genuine bug out of readFormula's own rgce/rgcb read rather than absorbing it as just another malformed record", () => {
    // BlockCursor.prototype.take is shared by every take() call this cursor makes — readCellHeader's own fields use u16/u32 rather than take, so the FormulaValue's own take(8) is the first call, and rgce's own take(cce) inside readFormula's try block is the second — forcing that second call specifically to throw a plain bug proves the surrounding catch only recovers from a genuine BiffFormatError (recoverFromFormatError's own re-throw for anything else), not silently swallowing every exception a malformed record's own reader could throw.
    // Read through Object.getOwnPropertyDescriptor, not a plain BlockCursor.prototype.take property access: the latter is exactly the "unbound method reference" shape @typescript-eslint/unbound-method exists to catch, even though it is in fact rebound immediately via .call() below — the descriptor lookup carries the identical function value through a shape the rule does not pattern-match on.
    const originalTake = Object.getOwnPropertyDescriptor(
      BlockCursor.prototype,
      "take",
    )?.value as (this: BlockCursor, count: number) => Uint8Array<ArrayBuffer>;
    const bug = new TypeError("a genuine bug, not a malformed record");
    let calls = 0;
    const spy = vi
      .spyOn(BlockCursor.prototype, "take")
      .mockImplementation(function (this: BlockCursor, count: number) {
        calls += 1;
        if (calls === 2) throw bug;
        return originalTake.call(this, count);
      });
    try {
      expect(() =>
        readCells(
          record(RECORD_FORMULA, [
            ...cell(0, 0),
            ...f64(1),
            ...u16(0),
            ...u32(0),
            ...u16(0),
          ]),
        ),
      ).toThrow(bug);
    } finally {
      spy.mockRestore();
    }
  });

  it("propagates a genuine bug out of resolveFormulaText rather than absorbing it as just another malformed token", () => {
    // The rgce here is perfectly well-formed — the injected bug is a plain Error a spy forces parseFormulaText itself to throw, not anything a file could ever produce, proving resolveFormulaText's own catch only recovers from a genuine BiffFormatError (recoverFromFormatError's own re-throw for anything else), not silently swallowing every exception parseFormulaText could throw.
    const bug = new TypeError("a genuine bug, not a malformed record");
    const spy = vi
      .spyOn(ptgModule, "parseFormulaText")
      .mockImplementation(() => {
        throw bug;
      });
    try {
      expect(() =>
        readCells(
          record(RECORD_FORMULA, [
            ...cell(0, 0),
            ...f64(1),
            ...u16(0),
            ...u32(0),
            ...u16(1),
            0x1e, // an opcode readPtgExpBase does not recognise as a PtgExp, so resolveFormulaText's own parseFormulaText branch is the one reached — only 1 byte of a 3-byte PtgInt, but the bug fires before that would ever matter
          ]),
        ),
      ).toThrow(bug);
    } finally {
      spy.mockRestore();
    }
  });
});
