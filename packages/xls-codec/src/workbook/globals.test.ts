import { describe, expect, it } from "vitest";

import {
  RECORD_BOUNDSHEET8,
  RECORD_CONTINUE,
  RECORD_DATE1904,
  RECORD_FORMAT,
  RECORD_SST,
  RECORD_XF,
} from "../biff/record-types";
import { BiffFormatError, readRecords } from "../biff/records";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import {
  concat,
  record,
  richExtendedString,
  shortXlUnicodeString,
  u16,
  u32,
  xlUnicodeString,
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
        record(RECORD_XF, [...u16(0), ...u16(0), ...u16(0x0004), ...u16(0)]),
        record(RECORD_XF, [...u16(1), ...u16(164), ...u16(0x0000), ...u16(0)]),
      ),
    );

    expect(globals.cellFormats).toEqual([
      { fontIndex: 0, formatId: 0, isStyle: true },
      { fontIndex: 1, formatId: 164, isStyle: false },
    ]);
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
});

describe("formatCodeOf", () => {
  const globals = readWorkbookGlobals(
    groupsOf(
      record(RECORD_FORMAT, [...u16(164), ...xlUnicodeString("0.000%")]),
      record(RECORD_XF, [...u16(0), ...u16(9), ...u16(0), ...u16(0)]),
      record(RECORD_XF, [...u16(0), ...u16(164), ...u16(0), ...u16(0)]),
      record(RECORD_XF, [...u16(0), ...u16(30), ...u16(0), ...u16(0)]),
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
