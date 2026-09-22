import { describe, expect, it } from "vitest";

import { RecordBuilder } from "../biff/builder";
import { RECORD_LBL } from "../biff/record-types";
import { writeRecord } from "../biff/record-writer";
import { readRecords } from "../biff/records";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import { concat } from "../test-support/biff";
import {
  printNameEntriesFor,
  readPrintNames,
  writePrintNameRecords,
} from "./print-names";

/** [MS-XLS] 2.4.150's own built-in name table: Print_Area. */
const BUILTIN_PRINT_AREA = 0x06;

/** A single-cell PtgArea3d ([MS-XLS] 2.5.198.28), reference class (0x3b): ixti 0, then RgceArea B2 (row 1, column 1) through D6 (row 5, column 3) — the same rectangle LIBREOFFICE_PRINT_AREA below carries, used here as a well-formed "the rest of the rgce parses fine" payload for tests that are really probing an earlier field. */
const VALID_AREA3D_REF_TOKEN = new Uint8Array([
  0x3b, 0x00, 0x00, 0x01, 0x00, 0x05, 0x00, 0x01, 0x00, 0x03, 0x00,
]);

/**
 * Assembles a raw Lbl record ([MS-XLS] 2.4.150) field by field, independent of this package's own writer — so a test can put the record's EARLIER fields into a shape the real writer never produces (a mismatched cch, an uncompressed built-in-name flag) while keeping every later field well-formed, to prove the reader's own guard on the earlier field is what actually stops it, not an accident of the later bytes being absent or malformed too.
 */
function lblRecord(options: {
  readonly cch?: number;
  readonly nameHighByte?: boolean;
  readonly itab?: number;
  readonly builtinName?: number;
  readonly rgce?: Uint8Array<ArrayBuffer>;
}): Uint8Array<ArrayBuffer> {
  const rgce = options.rgce ?? new Uint8Array(0);
  const data = new RecordBuilder()
    .u16(0x0020) // grbit: fBuiltin set, every other bit clear
    .u8(0) // chKey
    .u8(options.cch ?? 1)
    .u16(rgce.length) // cce
    .u16(0) // reserved3
    .u16(options.itab ?? 1)
    .u32(0) // reserved4 through reserved7
    .u8(options.nameHighByte === true ? 1 : 0) // the Name's own XLUnicodeStringNoCch flags byte
    .u8(options.builtinName ?? BUILTIN_PRINT_AREA)
    .bytes(rgce)
    .build();
  return writeRecord(RECORD_LBL, data);
}

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

/** Lbl for Print_Titles: the same prefix with name character 0x07 and cce 27, whose rgce is a PtgMemFunc wrapping a column band ($A:$A — every row, column 0) and a row band ($1:$2 — rows 0-1, every column) joined by PtgUnion, with a trailing PtgParen. */
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
    expect(readPrintNames(groupsOf(LIBREOFFICE_PRINT_AREA))).toStrictEqual(
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
    expect(readPrintNames(groupsOf(LIBREOFFICE_PRINT_TITLES))).toStrictEqual(
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
    ).toStrictEqual({
      printRange: { startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 },
      repeatRows: { start: 0, end: 1 },
      repeatColumns: { start: 0, end: 0 },
    });
  });

  it("keys a name by its own itab, one-based in the record and zero-based here", () => {
    const onSheetThree = new Uint8Array(LIBREOFFICE_PRINT_AREA);
    onSheetThree[OFFSET_ITAB] = 0x03;
    expect([...readPrintNames(groupsOf(onSheetThree)).keys()]).toStrictEqual([
      2,
    ]);
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

  it("abandons the whole name — discarding an area already parsed before the unrecognised token — rather than keeping a partial result", () => {
    // The sibling test above replaces the very FIRST opcode, so the unrecognised construct is also the only thing parsePrintAreas ever sees: an implementation that silently stopped (rather than aborted) on an unknown opcode would look identical, because there was never a valid area parsed first to keep or discard. Putting the unrecognised token AFTER one genuinely valid area is what tells the two apart.
    const areaThenUnknownOpcode = lblRecord({
      rgce: concat(VALID_AREA3D_REF_TOKEN, new Uint8Array([0x1e])),
    });
    expect(readPrintNames(groupsOf(areaThenUnknownOpcode)).size).toBe(0);
  });

  it("adds no print range at all for a Print_Area name whose token stream names zero areas", () => {
    // printRangeOf([]) is undefined for an empty area list, and the caller's own "if (range !== undefined)" guard must genuinely gate on that — an empty rgce (a Print_Area name declaring nothing) is the one input that produces it.
    const emptyPrintArea = lblRecord({ rgce: new Uint8Array(0) });
    expect(readPrintNames(groupsOf(emptyPrintArea)).size).toBe(0);
  });

  it("ignores a built-in name whose Name field is not exactly one character, even where every later field parses as a well-formed print area", () => {
    const twoCharacterName = lblRecord({
      cch: 2,
      rgce: VALID_AREA3D_REF_TOKEN,
    });
    expect(readPrintNames(groupsOf(twoCharacterName)).size).toBe(0);
  });

  it("ignores a built-in name whose Name field is stored uncompressed, even where every later field parses as a well-formed print area", () => {
    const uncompressedName = lblRecord({
      nameHighByte: true,
      rgce: VALID_AREA3D_REF_TOKEN,
    });
    expect(readPrintNames(groupsOf(uncompressedName)).size).toBe(0);
  });

  it("reads a single-cell reference written in PtgRef3d's array class the same as its reference class", () => {
    // [MS-XLS] 2.5.198.25: a reference-class token's array-class spelling (opcode + 0x40) shares its own layout exactly — this is the array-class Ptg family this reader admits alongside the reference class every other test above exercises.
    const ptgRef3dArray = lblRecord({
      rgce: new Uint8Array([
        0x7a, // PtgRef3d, array class
        0x00,
        0x00, // ixti
        0x0a,
        0x00, // row 10
        0x05,
        0x00, // column 5 (top two ColRelU bits clear)
      ]),
    });
    expect(readPrintNames(groupsOf(ptgRef3dArray)).get(0)).toStrictEqual({
      printRange: { startRow: 10, startColumn: 5, endRow: 10, endColumn: 5 },
    });
  });

  it("skips a PtgMemArea token's own unused bytes and cce, in its array-class spelling, without disturbing the area that follows it", () => {
    const ptgMemAreaArrayThenArea = lblRecord({
      rgce: concat(
        new Uint8Array([
          0x66, // PtgMemArea, array class
          0xaa,
          0xbb,
          0xcc,
          0xdd, // 4 unused bytes — never read, only skipped
          0xff,
          0xff, // cce — also skipped, not used to bound the parse
        ]),
        VALID_AREA3D_REF_TOKEN,
      ),
    });
    expect(
      readPrintNames(groupsOf(ptgMemAreaArrayThenArea)).get(0),
    ).toStrictEqual({
      printRange: { startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 },
    });
  });
});

describe("printNameEntriesFor and writePrintNameRecords", () => {
  it("writes a print range as the byte-for-byte Lbl a real producer writes for it", () => {
    const entries = printNameEntriesFor(0, 0, {
      printRange: { startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 },
    });
    expect(writePrintNameRecords(entries)).toStrictEqual([
      LIBREOFFICE_PRINT_AREA,
    ]);
  });

  it("writes both repeated bands as one Print_Titles name, mem-wrapped and union-joined", () => {
    const entries = printNameEntriesFor(0, 0, {
      repeatRows: { start: 0, end: 1 },
      repeatColumns: { start: 0, end: 0 },
    });
    expect(writePrintNameRecords(entries)).toStrictEqual([
      PRINT_TITLES_WITHOUT_PAREN,
    ]);
  });

  it("plans no name at all for a sheet declaring neither a range nor a band", () => {
    expect(printNameEntriesFor(0, 0, {})).toStrictEqual([]);
  });

  it("round-trips every combination of range and bands back through the reader", () => {
    const settings = {
      printRange: { startRow: 2, startColumn: 4, endRow: 40, endColumn: 9 },
      repeatRows: { start: 3, end: 7 },
      repeatColumns: { start: 1, end: 2 },
    };
    const records = writePrintNameRecords(printNameEntriesFor(5, 5, settings));
    expect(readPrintNames(groupsOf(...records)).get(5)).toStrictEqual(settings);
  });

  it("round-trips a repeated row band on its own, without inventing a column band", () => {
    const records = writePrintNameRecords(
      printNameEntriesFor(0, 0, { repeatRows: { start: 0, end: 0 } }),
    );
    expect(readPrintNames(groupsOf(...records)).get(0)).toStrictEqual({
      repeatRows: { start: 0, end: 0 },
    });
  });

  it("classifies neither axis for a Print_Titles area spanning the whole sheet, rather than the first branch a looser check would still match", () => {
    // A band spanning every row AND every column makes BOTH spansEveryRow and spansEveryColumn true, so `spansEveryColumn && !spansEveryRow` and `spansEveryRow && !spansEveryColumn` are each `true && false`, correctly false either way — but replacing either `&&` with `||` (or replacing the whole condition with `true`) would make one of them match anyway, wrongly turning "the whole sheet" into "a repeated row band" or "a repeated column band". This is the one area shape that tells `&&` and `||` apart here: every other test above uses an area where only one of the two spans is ever true, which cannot distinguish the two operators.
    const wholeSheet = lblRecord({
      builtinName: 0x07, // Print_Titles
      rgce: new Uint8Array([
        0x3b, // PtgArea3d, reference class
        0x00,
        0x00, // ixti
        0x00,
        0x00, // rowFirst 0
        0xff,
        0xff, // rowLast 0xffff — every row
        0x00,
        0x00, // columnFirst 0
        0xff,
        0x00, // columnLast 0x00ff — every column
      ]),
    });
    expect(readPrintNames(groupsOf(wholeSheet)).get(0)).toStrictEqual({});
  });
});
