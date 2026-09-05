import { describe, expect, it } from "vitest";

import {
  RECORD_BOUNDSHEET8,
  RECORD_CONTINUE,
  RECORD_DATE1904,
  RECORD_EXTERNSHEET,
  RECORD_FORMAT,
  RECORD_PALETTE,
  RECORD_SST,
  RECORD_SUPBOOK,
  RECORD_XF,
} from "../biff/record-types";
import { BiffFormatError, readRecords } from "../biff/records";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import { PALETTE_ENTRY_COUNT, UNDECORATED_XF_FIELDS } from "../biff/xf-colors";
import {
  cellXfTrailer,
  concat,
  record,
  richExtendedString,
  shortXlUnicodeString,
  u16,
  u32,
  xlUnicodeString,
  xlUnicodeStringNoCch,
} from "../test-support/biff";
import { formatCodeOf, readWorkbookGlobals } from "./globals";

/** The low bytes of an ASCII string, as a compressed (fHighByte = 0) rgb holds them. Indexed rather than spread, since spreading a string iterates code points and this needs UTF-16 units. */
function lowBytes(text: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    out.push(text.charCodeAt(index));
  }
  return out;
}

/** Runs the given records through the real framing and grouping passes, so a test exercises the same path a file does. */
function groupsOf(
  ...records: readonly Uint8Array<ArrayBuffer>[]
): readonly RecordGroup[] {
  return groupRecords(readRecords(concat(...records)));
}

describe("readWorkbookGlobals", () => {
  it("reads each sheet's name, order, and stream position from BoundSheet8", () => {
    // [MS-XLS] 2.4.28: lbPlyPos, hsState, dt, then stName. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/b9ec509a-235d-424e-871d-f8e721106501
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_BOUNDSHEET8, [
          ...u32(0x0200),
          0x00,
          0x00,
          ...shortXlUnicodeString("Summary"),
        ]),
        record(RECORD_BOUNDSHEET8, [
          ...u32(0x0400),
          0x00,
          0x00,
          ...shortXlUnicodeString("Detail"),
        ]),
      ),
    );

    expect(globals.sheets).toEqual([
      { name: "Summary", hidden: false, sheetType: 0, bofPosition: 0x0200 },
      { name: "Detail", hidden: false, sheetType: 0, bofPosition: 0x0400 },
    ]);
  });

  it("reads a hidden sheet's state", () => {
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_BOUNDSHEET8, [
          ...u32(0x0200),
          0x01,
          0x00,
          ...shortXlUnicodeString("Hidden"),
        ]),
      ),
    );

    expect(globals.sheets[0]?.hidden).toBe(true);
  });

  it("reads a very hidden sheet as hidden too", () => {
    // The schema's ContentSheet has no place for either state, let alone the distinction between them.
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_BOUNDSHEET8, [
          ...u32(0x0200),
          0x02,
          0x00,
          ...shortXlUnicodeString("VeryHidden"),
        ]),
      ),
    );

    expect(globals.sheets[0]?.hidden).toBe(true);
  });

  it("reads a chart sheet's own type", () => {
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_BOUNDSHEET8, [
          ...u32(0x0200),
          0x00,
          0x02,
          ...shortXlUnicodeString("Chart1"),
        ]),
      ),
    );

    expect(globals.sheets[0]?.sheetType).toBe(0x02);
  });

  it("reads a non-Latin sheet name", () => {
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_BOUNDSHEET8, [
          ...u32(0x0200),
          0x00,
          0x00,
          ...shortXlUnicodeString("集計"),
        ]),
      ),
    );

    expect(globals.sheets[0]?.name).toBe("集計");
  });

  it("reads the shared string table in index order", () => {
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_SST, [
          ...u32(3),
          ...u32(2),
          ...richExtendedString("Alpha"),
          ...richExtendedString("Beta"),
        ]),
      ),
    );

    expect(globals.sharedStrings).toEqual(["Alpha", "Beta"]);
  });

  it("reads a shared string table spanning a Continue record", () => {
    // The case the whole cursor design exists for: the second string's characters start in the base record and finish in the Continue, which re-states the fHighByte flag before resuming.
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_SST, [
          ...u32(2),
          ...u32(2),
          ...richExtendedString("Alpha"),
          ...u16(6),
          0x00,
          ...lowBytes("Abc"),
        ]),
        record(RECORD_CONTINUE, [0x00, ...lowBytes("def")]),
      ),
    );

    expect(globals.sharedStrings).toEqual(["Alpha", "Abcdef"]);
  });

  it("rejects an SST declaring more strings than its bytes could carry", () => {
    expect(() =>
      readWorkbookGlobals(
        groupsOf(record(RECORD_SST, [...u32(1000), ...u32(1000)])),
      ),
    ).toThrow(BiffFormatError);
  });

  it("reads a custom number format by its identifier", () => {
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_FORMAT, [...u16(164), ...xlUnicodeString("0.000%")]),
      ),
    );

    expect(globals.numberFormats.get(164)).toBe("0.000%");
  });

  it("lets a file's own Format record override a built-in identifier", () => {
    // A producer may redefine an identifier the built-in table also names, and its own definition is the one that applies.
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_FORMAT, [...u16(14), ...xlUnicodeString("yyyy-mm-dd")]),
      ),
    );

    expect(globals.numberFormats.get(14)).toBe("yyyy-mm-dd");
  });

  it("keeps the built-in table for identifiers the file does not redefine", () => {
    const globals = readWorkbookGlobals(groupsOf());

    expect(globals.numberFormats.get(9)).toBe("0%");
  });

  it("reads the XF table in record order", () => {
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_XF, [
          ...u16(0),
          ...u16(0),
          ...u16(0x0004),
          ...cellXfTrailer(),
        ]),
        record(RECORD_XF, [
          ...u16(1),
          ...u16(164),
          ...u16(0x0000),
          ...cellXfTrailer(),
        ]),
      ),
    );

    expect(globals.cellFormats).toEqual([
      {
        fontIndex: 0,
        formatId: 0,
        isStyle: true,
        alignment: { horizontal: undefined, vertical: undefined },
        decoration: UNDECORATED_XF_FIELDS,
      },
      {
        fontIndex: 1,
        formatId: 164,
        isStyle: false,
        alignment: { horizontal: undefined, vertical: undefined },
        decoration: UNDECORATED_XF_FIELDS,
      },
    ]);
  });

  it("reads a CellXF's own fill pattern, fill colour, and per-side border style/colour", () => {
    // [MS-XLS] 2.4.353's own CellXF field table: word2 (border) = dgLeft|dgRight<<4|dgTop<<8|dgBottom<<12|icvLeft<<16|icvRight<<23, word3 (fill pattern) = icvTop|icvBottom<<7|fls<<26, word4 (fill colour) = icvFore|icvBack<<7. Thin borders (style 1) on left/top at icv 10, a solid fill (fls 1) at icv 12.
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_XF, [
          ...u16(0),
          ...u16(0),
          ...u16(0x0000),
          ...cellXfTrailer({
            fillPattern: 1,
            fillForegroundIcv: 12,
            left: { style: 1, icv: 10 },
            top: { style: 1, icv: 10 },
          }),
        ]),
      ),
    );

    expect(globals.cellFormats[0]?.decoration).toEqual({
      fillPattern: 1,
      fillForegroundIcv: 12,
      left: { style: 1, icv: 10 },
      right: { style: 0, icv: 0 },
      top: { style: 1, icv: 10 },
      bottom: { style: 0, icv: 0 },
    });
  });

  it("reads a Palette record's own 56 colour entries", () => {
    // LongRGB: red, green, blue, then a reserved byte -- rgColor[0] red, rgColor[1] green, and the remaining entries of the 56 ccv MUST declare.
    const entries = [
      [0xff, 0x00, 0x00, 0x00],
      [0x00, 0xff, 0x00, 0x00],
      ...Array.from({ length: PALETTE_ENTRY_COUNT - 2 }, () => [
        0x00, 0x00, 0x00, 0x00,
      ]),
    ];
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_PALETTE, [...u16(entries.length), ...entries.flat()]),
      ),
    );

    expect(globals.palette?.length).toBe(PALETTE_ENTRY_COUNT);
    expect(globals.palette?.[0]).toEqual({ r: 1, g: 0, b: 0 });
    expect(globals.palette?.[1]).toEqual({ r: 0, g: 1, b: 0 });
  });

  it("refuses a Palette record declaring a ccv other than the 56 the spec requires", () => {
    // A short table is not a smaller palette: every icv from its end to 63 becomes unresolvable, so a workbook's fills and borders would all silently vanish at once rather than anything failing. 55 entries, one short of the required count.
    const entries = Array.from({ length: PALETTE_ENTRY_COUNT - 1 }, () => [
      0x00, 0x00, 0x00, 0x00,
    ]);

    expect(() =>
      readWorkbookGlobals(
        groupsOf(
          record(RECORD_PALETTE, [...u16(entries.length), ...entries.flat()]),
        ),
      ),
    ).toThrow(BiffFormatError);
  });

  it("refuses a Palette record declaring zero colour entries", () => {
    // The degenerate case the loop bound alone would have accepted silently, yielding an empty table every icv 8-63 then failed to resolve through.
    expect(() =>
      readWorkbookGlobals(groupsOf(record(RECORD_PALETTE, [...u16(0)]))),
    ).toThrow(BiffFormatError);
  });

  it("refuses a Palette record declaring a negative colour count", () => {
    // ccv is a signed field, so 0xFFFF reads back as -1: a loop bound alone would run zero times and report an empty palette as if the record had been fine.
    expect(() =>
      readWorkbookGlobals(groupsOf(record(RECORD_PALETTE, [...u16(0xffff)]))),
    ).toThrow(BiffFormatError);
  });

  it("leaves palette undefined when the substream carries no Palette record", () => {
    expect(readWorkbookGlobals(groupsOf()).palette).toBeUndefined();
  });

  it("defaults to the 1900 date system when no Date1904 record is present", () => {
    expect(readWorkbookGlobals(groupsOf()).date1904).toBe(false);
  });

  it("reads the 1904 date system flag", () => {
    const globals = readWorkbookGlobals(
      groupsOf(record(RECORD_DATE1904, u16(1))),
    );

    expect(globals.date1904).toBe(true);
  });

  it("ignores records it has no use for", () => {
    // The globals substream carries dozens of records this reader does not act on; meeting one must not disturb the tables it does build.
    const globals = readWorkbookGlobals(
      groupsOf(
        record(0x003d, [...u16(0), ...u16(0)]),
        record(RECORD_DATE1904, u16(1)),
      ),
    );

    expect(globals.date1904).toBe(true);
  });

  it("resolves a 3D reference's ixti to a sheet range through a self-referencing SupBook", () => {
    // [MS-XLS] 2.4.271: cch 0x0401 marks a SupBook as self-referencing -- this workbook itself -- so its EXTERNSHEET XTI's itabFirst/itabLast name real BoundSheet8 indices directly.
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_SUPBOOK, [...u16(3), ...u16(0x0401)]),
        record(RECORD_EXTERNSHEET, [
          ...u16(1),
          ...u16(0), // iSupBook
          ...u16(1), // itabFirst
          ...u16(2), // itabLast
        ]),
      ),
    );

    expect(globals.sheetRanges).toEqual([
      { firstSheetIndex: 1, lastSheetIndex: 2 },
    ]);
  });

  it("resolves a genuinely external workbook's own file name and sheet name through virtPath and rgst", () => {
    // rel-volume ([MS-XLS] 480c3d2a: "%x0001 %x0002 file-path" -- relative to the referencing workbook's own drive), the common real-world case of an external workbook in the same folder: virtPath is just the two-character marker followed directly by the file name.
    const virtPath = "\u0001\u0002Budget.xlsx";
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_SUPBOOK, [
          ...u16(1), // ctab: one sheet in the external workbook
          ...u16(virtPath.length), // cch
          ...xlUnicodeStringNoCch(virtPath),
          ...xlUnicodeString("Sheet1"), // rgst[0]
        ]),
        record(RECORD_EXTERNSHEET, [
          ...u16(1),
          ...u16(0), // iSupBook
          ...u16(0), // itabFirst -- rgst[0]
          ...u16(0), // itabLast -- rgst[0]
        ]),
      ),
    );

    expect(globals.sheetRanges).toEqual([
      { label: "[Budget.xlsx]Sheet1", diagnostic: false },
    ]);
  });

  it("resolves a multi-sheet external range as first:last, the same shape a local multi-sheet range takes", () => {
    const virtPath = "\u0001\u0002Book.xlsx";
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_SUPBOOK, [
          ...u16(3),
          ...u16(virtPath.length),
          ...xlUnicodeStringNoCch(virtPath),
          ...xlUnicodeString("Jan"),
          ...xlUnicodeString("Feb"),
          ...xlUnicodeString("Mar"),
        ]),
        record(RECORD_EXTERNSHEET, [
          ...u16(1),
          ...u16(0),
          ...u16(0), // itabFirst -- rgst[0] "Jan"
          ...u16(2), // itabLast -- rgst[2] "Mar"
        ]),
      ),
    );

    expect(globals.sheetRanges).toEqual([
      { label: "[Book.xlsx]Jan:Mar", diagnostic: false },
    ]);
  });

  it("shows a known sheet name against a placeholder workbook label when virtPath's own form is not one this reader decodes", () => {
    // An absolute drive volume ([MS-XLS] 480c3d2a: "%x0001 %x0001 volume-character file-path") needs more of the VirtualPath grammar than a trailing path segment to reproduce faithfully -- fileNameFromVirtPath declines rather than guessing, but rgst's own sheet name is still fully resolvable and is not discarded along with it.
    const virtPath = "\u0001\u0001CBudget.xlsx";
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_SUPBOOK, [
          ...u16(1),
          ...u16(virtPath.length),
          ...xlUnicodeStringNoCch(virtPath),
          ...xlUnicodeString("Sheet1"),
        ]),
        record(RECORD_EXTERNSHEET, [
          ...u16(1),
          ...u16(0),
          ...u16(0),
          ...u16(0),
        ]),
      ),
    );

    expect(globals.sheetRanges).toEqual([
      { label: "[EXTERNAL]Sheet1", diagnostic: true },
    ]);
  });

  it("carries a diagnostic label for an add-in-referencing SupBook rather than dropping the reference", () => {
    // [MS-XLS] 2.4.271: cch 0x3A01 marks an add-in-referencing supporting link, which names XLL/COM add-in functions this reader has no workbook or sheet to resolve a name from. [MS-XLS] 2.5.344's own itabFirst/itabLast table gives an add-in reference -2 ("not used") for both fields -- not 0 -- since there is no sheet scope for this kind of supporting link at all.
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_SUPBOOK, [...u16(1), ...u16(0x3a01)]),
        record(RECORD_EXTERNSHEET, [
          ...u16(1),
          ...u16(0), // iSupBook
          ...u16(-2), // itabFirst
          ...u16(-2), // itabLast
        ]),
      ),
    );

    expect(globals.sheetRanges).toEqual([
      { label: "#REF!(add-in function reference)", diagnostic: true },
    ]);
  });

  it("carries a diagnostic label for a DDE- or OLE-referencing SupBook rather than dropping the reference", () => {
    // [MS-XLS] 2.4.271: a supporting link whose ctab is reserved-zero and whose virtPath matches neither the same-sheet nor the unused single-character sentinel is a DDE or OLE data source reference -- and, like an add-in reference, gets -2 for both itabFirst and itabLast, since neither has a sheet scope to name.
    const virtPath = "Excel\u0003Sheet1";
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_SUPBOOK, [
          ...u16(0), // ctab: reserved zero for a DDE/OLE link
          ...u16(virtPath.length),
          ...xlUnicodeStringNoCch(virtPath),
        ]),
        record(RECORD_EXTERNSHEET, [
          ...u16(1),
          ...u16(0),
          ...u16(-2),
          ...u16(-2),
        ]),
      ),
    );

    expect(globals.sheetRanges).toEqual([
      { label: "#REF!(DDE or OLE data source reference)", diagnostic: true },
    ]);
  });

  it("carries a diagnostic label, not undefined, for an XTI whose sheet could not be found", () => {
    // [MS-XLS] 2.5.344: -1 is itabFirst/itabLast's own "the sheet could not be found" sentinel.
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_SUPBOOK, [...u16(1), ...u16(0x0401)]),
        record(RECORD_EXTERNSHEET, [
          ...u16(1),
          ...u16(0),
          0xff,
          0xff, // itabFirst = -1
          0xff,
          0xff, // itabLast = -1
        ]),
      ),
    );

    expect(globals.sheetRanges).toEqual([
      { label: "#REF!(sheet not found)", diagnostic: true },
    ]);
  });

  it("defaults sheetRanges to empty when the substream carries no EXTERNSHEET record", () => {
    expect(readWorkbookGlobals(groupsOf()).sheetRanges).toEqual([]);
  });
});

describe("formatCodeOf", () => {
  const globals = readWorkbookGlobals(
    groupsOf(
      record(RECORD_FORMAT, [...u16(164), ...xlUnicodeString("0.000%")]),
      record(RECORD_XF, [...u16(0), ...u16(9), ...u16(0), ...cellXfTrailer()]),
      record(RECORD_XF, [
        ...u16(0),
        ...u16(164),
        ...u16(0),
        ...cellXfTrailer(),
      ]),
      record(RECORD_XF, [...u16(0), ...u16(30), ...u16(0), ...cellXfTrailer()]),
    ),
  );

  it("resolves an XF index through the built-in table", () => {
    expect(formatCodeOf(globals, 0)).toBe("0%");
  });

  it("resolves an XF index through the file's own Format records", () => {
    expect(formatCodeOf(globals, 1)).toBe("0.000%");
  });

  it("returns undefined for an XF naming a reserved identifier", () => {
    // ECMA-376 leaves 23-36 reserved, so identifier 30 resolves to no code at all rather than to a fabricated one.
    expect(formatCodeOf(globals, 2)).toBeUndefined();
  });

  it("returns undefined for an XF index the table does not hold", () => {
    expect(formatCodeOf(globals, 99)).toBeUndefined();
  });
});
