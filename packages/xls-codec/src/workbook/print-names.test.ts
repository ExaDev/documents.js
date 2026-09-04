import { describe, expect, it } from "vitest";

import { readRecords } from "../biff/records";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import { concat } from "../test-support/biff";
import {
  printNameEntriesFor,
  readPrintNames,
  writePrintNameRecords,
} from "./print-names";

// The two fixtures below are the exact Lbl records, byte for byte, out of a .xls LibreOffice produced from a hand-authored .fods declaring a print range of B2:D6, one repeated header column, and two repeated header rows. They are stated as literal bytes rather than built by this package's own writer so that what the reader is checked against is a real producer's encoding, not this package's agreement with itself.

// Field offsets into those fixtures, counted from the front of the record INCLUDING its own four-byte type/size framing, so a test can mutate one field of a real producer's record and leave the rest of it exactly as that producer wrote it.
const OFFSET_GRBIT = 4;
const OFFSET_ITAB = 12;
const OFFSET_BUILTIN_NAME = 19;
const OFFSET_RGCE = 20;

/** Lbl for Print_Area: fBuiltin, cch 1, cce 11, itab 1, name character 0x06, then one PtgArea3d naming rows 1-5 and columns 1-3 (B2:D6). */
const LIBREOFFICE_PRINT_AREA = new Uint8Array([
  0x18, 0x00, 0x1b, 0x00, 0x20, 0x00, 0x00, 0x01, 0x0b, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x3b, 0x00, 0x00, 0x01, 0x00, 0x05,
  0x00, 0x01, 0x00, 0x03, 0x00,
]);

/** Lbl for Print_Titles: the same prefix with name character 0x07 and cce 27, whose rgce is a PtgMemFunc wrapping a column band ($A:$A -- every row, column 0) and a row band ($1:$2 -- rows 0-1, every column) joined by PtgUnion, with a trailing PtgParen. */
const LIBREOFFICE_PRINT_TITLES = new Uint8Array([
  0x18, 0x00, 0x2b, 0x00, 0x20, 0x00, 0x00, 0x01, 0x1b, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x29, 0x17, 0x00, 0x3b, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x3b, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0xff, 0x00, 0x10, 0x15,
]);

/** What this package writes for the same pair of repeated bands: the record above with its trailing PtgParen dropped, and its own size and cce each one byte shorter to match. PtgParen is a pure display token restating parentheses a formula's author typed, which this writer has no reason to emit. */
const PRINT_TITLES_WITHOUT_PAREN = new Uint8Array([
  0x18, 0x00, 0x2a, 0x00, 0x20, 0x00, 0x00, 0x01, 0x1a, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x29, 0x17, 0x00, 0x3b, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x3b, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0xff, 0x00, 0x10,
]);

function groupsOf(
  ...records: readonly Uint8Array<ArrayBuffer>[]
): readonly RecordGroup[] {
  return groupRecords(readRecords(concat(...records)));
}

describe("readPrintNames", () => {
  it("reads a real LibreOffice-written Print_Area into the range it names", () => {
    expect(readPrintNames(groupsOf(LIBREOFFICE_PRINT_AREA))).toEqual(
      new Map([
        [
          0,
          {
            printRange: {
              startRow: 1,
              startColumn: 1,
              endRow: 5,
              endColumn: 3,
            },
          },
        ],
      ]),
    );
  });

  it("reads a real LibreOffice-written Print_Titles into both repeated bands", () => {
    expect(readPrintNames(groupsOf(LIBREOFFICE_PRINT_TITLES))).toEqual(
      new Map([
        [
          0,
          {
            repeatRows: { start: 0, end: 1 },
            repeatColumns: { start: 0, end: 0 },
          },
        ],
      ]),
    );
  });

  it("joins both names for the same sheet into one entry", () => {
    expect(
      readPrintNames(
        groupsOf(LIBREOFFICE_PRINT_AREA, LIBREOFFICE_PRINT_TITLES),
      ).get(0),
    ).toEqual({
      printRange: { startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 },
      repeatRows: { start: 0, end: 1 },
      repeatColumns: { start: 0, end: 0 },
    });
  });

  it("keys a name by its own itab, one-based in the record and zero-based here", () => {
    const onSheetThree = new Uint8Array(LIBREOFFICE_PRINT_AREA);
    onSheetThree[OFFSET_ITAB] = 0x03;
    expect([...readPrintNames(groupsOf(onSheetThree)).keys()]).toEqual([2]);
  });

  it("ignores a name that is not built in", () => {
    const userDefined = new Uint8Array(LIBREOFFICE_PRINT_AREA);
    userDefined[OFFSET_GRBIT] = 0x00; // fBuiltin clear
    expect(readPrintNames(groupsOf(userDefined)).size).toBe(0);
  });

  it("ignores a workbook-scoped name, which a print area never is", () => {
    const workbookScoped = new Uint8Array(LIBREOFFICE_PRINT_AREA);
    workbookScoped[OFFSET_ITAB] = 0x00;
    expect(readPrintNames(groupsOf(workbookScoped)).size).toBe(0);
  });

  it("ignores a built-in name that is neither Print_Area nor Print_Titles", () => {
    const consolidateArea = new Uint8Array(LIBREOFFICE_PRINT_AREA);
    consolidateArea[OFFSET_BUILTIN_NAME] = 0x00; // built-in name index 0x00, Consolidate_Area
    expect(readPrintNames(groupsOf(consolidateArea)).size).toBe(0);
  });

  it("ignores a name whose token stream holds a construct outside this vocabulary", () => {
    // Half a print range would be a wrong print range, not a smaller one, so an unrecognised token abandons the whole name.
    const withPtgInt = new Uint8Array(LIBREOFFICE_PRINT_AREA);
    withPtgInt[OFFSET_RGCE] = 0x1e; // PtgInt in place of the PtgArea3d opcode
    expect(readPrintNames(groupsOf(withPtgInt)).size).toBe(0);
  });
});

describe("printNameEntriesFor and writePrintNameRecords", () => {
  it("writes a print range as the byte-for-byte Lbl a real producer writes for it", () => {
    const entries = printNameEntriesFor(0, 0, {
      printRange: { startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 },
    });
    expect(writePrintNameRecords(entries)).toEqual([LIBREOFFICE_PRINT_AREA]);
  });

  it("writes both repeated bands as one Print_Titles name, mem-wrapped and union-joined", () => {
    const entries = printNameEntriesFor(0, 0, {
      repeatRows: { start: 0, end: 1 },
      repeatColumns: { start: 0, end: 0 },
    });
    expect(writePrintNameRecords(entries)).toEqual([
      PRINT_TITLES_WITHOUT_PAREN,
    ]);
  });

  it("plans no name at all for a sheet declaring neither a range nor a band", () => {
    expect(printNameEntriesFor(0, 0, {})).toEqual([]);
  });

  it("round-trips every combination of range and bands back through the reader", () => {
    const settings = {
      printRange: { startRow: 2, startColumn: 4, endRow: 40, endColumn: 9 },
      repeatRows: { start: 3, end: 7 },
      repeatColumns: { start: 1, end: 2 },
    };
    const records = writePrintNameRecords(printNameEntriesFor(5, 5, settings));
    expect(readPrintNames(groupsOf(...records)).get(5)).toEqual(settings);
  });

  it("round-trips a repeated row band on its own, without inventing a column band", () => {
    const records = writePrintNameRecords(
      printNameEntriesFor(0, 0, { repeatRows: { start: 0, end: 0 } }),
    );
    expect(readPrintNames(groupsOf(...records)).get(0)).toEqual({
      repeatRows: { start: 0, end: 0 },
    });
  });
});
