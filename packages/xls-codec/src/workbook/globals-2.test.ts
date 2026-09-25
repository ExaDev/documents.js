// The second half of the globals suite, split at a case boundary.

import { describe, expect, it } from "vitest";

import {
  RECORD_BOUNDSHEET8,
  RECORD_EXTERNSHEET,
  RECORD_FORMAT,
  RECORD_SUPBOOK,
  RECORD_XF,
} from "../biff/record-types";
import { readRecords } from "../biff/records";
import { groupRecords, type RecordGroup } from "../biff/substreams";

import {
  cellXfTrailer,
  concat,
  record,
  shortXlUnicodeString,
  u16,
  u32,
  xlUnicodeString,
  xlUnicodeStringNoCch,
} from "../test-support/biff";
import {
  fileNameFromVirtPath,
  formatCodeOf,
  readSupBook,
  readWorkbookGlobals,
  resolveXti,
  type SupBookInfo,
} from "./globals";

/** The low bytes of an ASCII string, as a compressed (fHighByte = 0) rgb holds them. Indexed rather than spread, since spreading a string iterates code points and this needs UTF-16 units. */

/** Runs the given records through the real framing and grouping passes, so a test exercises the same path a file does. */
function groupsOf(
  ...records: readonly Uint8Array<ArrayBuffer>[]
): readonly RecordGroup[] {
  return groupRecords(readRecords(concat(...records)));
}
describe("readWorkbookGlobals (continued)", () => {
  it("declines an unbalanced bracket with no directory separator at all, rather than passing it through as part of the file name", () => {
    const virtPath = "abc[def";
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

    expect(globals.sheetRanges).toStrictEqual([
      { label: "[EXTERNAL]Sheet1", diagnostic: true },
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
          ...u16(0), // itabFirst — rgst[0] "Jan"
          ...u16(2), // itabLast — rgst[2] "Mar"
        ]),
      ),
    );

    expect(globals.sheetRanges).toStrictEqual([
      { label: "[Book.xlsx]Jan:Mar", diagnostic: false },
    ]);
  });

  it("shows a known sheet name against a placeholder workbook label when virtPath's own form is not one this reader decodes", () => {
    // An absolute drive volume ([MS-XLS] 480c3d2a: "%x0001 %x0001 volume-character file-path") needs more of the VirtualPath grammar than a trailing path segment to reproduce faithfully — fileNameFromVirtPath declines rather than guessing, but rgst's own sheet name is still fully resolvable and is not discarded along with it.
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

    expect(globals.sheetRanges).toStrictEqual([
      { label: "[EXTERNAL]Sheet1", diagnostic: true },
    ]);
  });

  it("carries a diagnostic label for an add-in-referencing SupBook rather than dropping the reference", () => {
    // [MS-XLS] 2.4.271: cch 0x3A01 marks an add-in-referencing supporting link, which names XLL/COM add-in functions this reader has no workbook or sheet to resolve a name from. [MS-XLS] 2.5.344's own itabFirst/itabLast table gives an add-in reference -2 ("not used") for both fields — not 0 — since there is no sheet scope for this kind of supporting link at all.
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

    expect(globals.sheetRanges).toStrictEqual([
      { label: "#REF!(add-in function reference)", diagnostic: true },
    ]);
  });

  it("carries a diagnostic label for a DDE- or OLE-referencing SupBook rather than dropping the reference", () => {
    // [MS-XLS] 2.4.271: a supporting link whose ctab is reserved-zero and whose virtPath matches neither the same-sheet nor the unused single-character sentinel is a DDE or OLE data source reference — and, like an add-in reference, gets -2 for both itabFirst and itabLast, since neither has a sheet scope to name.
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

    expect(globals.sheetRanges).toStrictEqual([
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

    expect(globals.sheetRanges).toStrictEqual([
      { label: "#REF!(sheet not found)", diagnostic: true },
    ]);
  });

  it("defaults sheetRanges to empty when the substream carries no EXTERNSHEET record", () => {
    expect(readWorkbookGlobals(groupsOf()).sheetRanges).toStrictEqual([]);
  });

  it("degrades a SupBook whose rgst is shorter than its own declared ctab to a diagnostic, rather than aborting the whole workbook read", () => {
    // ctab claims 5 sheet names but not one XLUnicodeString actually follows virtPath — reading the first would run past the end of the record. This must not propagate past readWorkbookGlobals: a malformed SupBook degrades to its own diagnostic, and every OTHER record in the substream (here, a BoundSheet8 after it) still reads normally.
    const virtPath = "Budget.xlsx";
    const globals = readWorkbookGlobals(
      groupsOf(
        record(RECORD_SUPBOOK, [
          ...u16(5), // ctab: claims five sheet names
          ...u16(virtPath.length),
          ...xlUnicodeStringNoCch(virtPath),
          // no rgst entries actually follow
        ]),
        record(RECORD_EXTERNSHEET, [
          ...u16(1),
          ...u16(0),
          ...u16(0),
          ...u16(0),
        ]),
        record(RECORD_BOUNDSHEET8, [
          ...u32(0x0200),
          0x00,
          0x00,
          ...shortXlUnicodeString("Summary"),
        ]),
      ),
    );

    expect(globals.sheetRanges).toStrictEqual([
      { label: "#REF!(malformed supporting link)", diagnostic: true },
    ]);
    expect(globals.sheets).toStrictEqual([
      { name: "Summary", hidden: false, sheetType: 0, bofPosition: 0x0200 },
    ]);
  });
});

describe("readSupBook", () => {
  function supBookGroup(bytes: readonly number[]): RecordGroup {
    const group = groupsOf(record(RECORD_SUPBOOK, bytes))[0];
    if (group === undefined) {
      throw new Error("expected a SupBook record group");
    }
    return group;
  }

  it("refuses a cch one below the smallest genuine virtPath length (0), naming the exact hex value", () => {
    expect(readSupBook(supBookGroup([...u16(0), ...u16(0)]))).toStrictEqual({
      kind: "unresolvable",
      diagnostic: "supporting link of unrecognised type (cch=0x0000)",
    });
  });

  it("accepts a cch of exactly 1, the smallest genuine virtPath length", () => {
    expect(
      readSupBook(
        supBookGroup([...u16(0), ...u16(1), ...xlUnicodeStringNoCch("X")]),
      ),
    ).toStrictEqual({
      kind: "unresolvable",
      diagnostic: "DDE or OLE data source reference",
    });
  });

  it("accepts a cch of exactly 255, the largest genuine virtPath length", () => {
    const text = "X".repeat(255);
    expect(
      readSupBook(
        supBookGroup([...u16(0), ...u16(255), ...xlUnicodeStringNoCch(text)]),
      ),
    ).toStrictEqual({
      kind: "unresolvable",
      diagnostic: "DDE or OLE data source reference",
    });
  });

  it("refuses a cch one past the largest genuine virtPath length (256), naming the exact hex value", () => {
    expect(readSupBook(supBookGroup([...u16(0), ...u16(256)]))).toStrictEqual({
      kind: "unresolvable",
      diagnostic: "supporting link of unrecognised type (cch=0x0100)",
    });
  });

  it("resolves a same-sheet reference from its own exact single-character virtPath", () => {
    expect(
      readSupBook(
        supBookGroup([
          ...u16(0),
          ...u16(1),
          ...xlUnicodeStringNoCch(String.fromCharCode(0)),
        ]),
      ),
    ).toStrictEqual({
      kind: "unresolvable",
      diagnostic: "same-sheet reference",
    });
  });

  it("resolves an unused supporting link from its own exact single-character virtPath", () => {
    expect(
      readSupBook(
        supBookGroup([...u16(0), ...u16(1), ...xlUnicodeStringNoCch(" ")]),
      ),
    ).toStrictEqual({
      kind: "unresolvable",
      diagnostic: "unused supporting link",
    });
  });
});

describe("fileNameFromVirtPath", () => {
  it("declines a path that is empty once its own lone marker byte is stripped", () => {
    expect(fileNameFromVirtPath(String.fromCharCode(1))).toBeUndefined();
  });

  it("isolates a plain trailing file name with no marker at all", () => {
    expect(fileNameFromVirtPath(`dir${String.fromCharCode(3)}Book.xlsx`)).toBe(
      "Book.xlsx",
    );
  });

  it("declines a final segment reached through a directory separator that itself carries a bracket", () => {
    expect(
      fileNameFromVirtPath(`sub${String.fromCharCode(3)}[Book.xlsx]Sheet1`),
    ).toBeUndefined();
  });

  it("declines a path ending in a trailing directory separator, an empty-but-defined final segment rather than a missing one", () => {
    expect(
      fileNameFromVirtPath(`dir${String.fromCharCode(3)}`),
    ).toBeUndefined();
  });
});

describe("resolveXti", () => {
  const SELF: SupBookInfo = { kind: "self" };
  const UNRESOLVABLE: SupBookInfo = {
    kind: "unresolvable",
    diagnostic: "add-in function reference",
  };
  const EXTERNAL: SupBookInfo = {
    kind: "external-workbook",
    fileName: "Book.xlsx",
    sheetNames: ["Sheet1", "Sheet2"],
  };
  const EXTERNAL_UNNAMED: SupBookInfo = {
    kind: "external-workbook",
    fileName: undefined,
    sheetNames: ["Sheet1", "Sheet2"],
  };

  it("refuses an XTI whose own iSupBook index named no SupBook record at all", () => {
    expect(resolveXti(undefined, 0, 0)).toStrictEqual({
      label: "#REF!(supporting link index out of range)",
      diagnostic: true,
    });
  });

  it("carries an unresolvable SupBook's own diagnostic through unchanged", () => {
    expect(resolveXti(UNRESOLVABLE, 0, 0)).toStrictEqual({
      label: "#REF!(add-in function reference)",
      diagnostic: true,
    });
  });

  it("treats itabFirst alone being -2 as a workbook-level reference, even with a genuinely real itabLast", () => {
    expect(resolveXti(SELF, -2, 0)).toStrictEqual({
      label: "#REF!(workbook-level reference)",
      diagnostic: true,
    });
  });

  it("treats itabLast alone being -2 as a workbook-level reference too, even with a genuinely real itabFirst", () => {
    expect(resolveXti(SELF, 0, -2)).toStrictEqual({
      label: "#REF!(workbook-level reference)",
      diagnostic: true,
    });
  });

  it("resolves a self-referencing SheetRange when both indices are real", () => {
    expect(resolveXti(SELF, 1, 3)).toStrictEqual({
      firstSheetIndex: 1,
      lastSheetIndex: 3,
    });
  });

  it("refuses a self-referencing XTI whose own itabFirst alone is the -1 not-found sentinel", () => {
    expect(resolveXti(SELF, -1, 0)).toStrictEqual({
      label: "#REF!(sheet not found)",
      diagnostic: true,
    });
  });

  it("refuses a self-referencing XTI whose own itabLast alone is the -1 not-found sentinel", () => {
    expect(resolveXti(SELF, 0, -1)).toStrictEqual({
      label: "#REF!(sheet not found)",
      diagnostic: true,
    });
  });

  it("refuses an external-workbook XTI whose own itabFirst names no real sheet, even with a genuinely real itabLast", () => {
    expect(resolveXti(EXTERNAL, 9, 0)).toStrictEqual({
      label: "[Book.xlsx]#REF!(sheet not found)",
      diagnostic: true,
    });
  });

  it("refuses an external-workbook XTI whose own itabLast names no real sheet, even with a genuinely real itabFirst", () => {
    expect(resolveXti(EXTERNAL, 0, 9)).toStrictEqual({
      label: "[Book.xlsx]#REF!(sheet not found)",
      diagnostic: true,
    });
  });

  it("labels an external-workbook's own unresolved sheet under the EXTERNAL placeholder when the workbook's own name was not recovered either", () => {
    expect(resolveXti(EXTERNAL_UNNAMED, 9, 0)).toStrictEqual({
      label: "[EXTERNAL]#REF!(sheet not found)",
      diagnostic: true,
    });
  });

  it("resolves a single-sheet external reference without a range separator when both indices name the identical sheet", () => {
    expect(resolveXti(EXTERNAL, 0, 0)).toStrictEqual({
      label: "[Book.xlsx]Sheet1",
      diagnostic: false,
    });
  });

  it("resolves a genuine external sheet range, first:last, when the two indices differ", () => {
    expect(resolveXti(EXTERNAL, 0, 1)).toStrictEqual({
      label: "[Book.xlsx]Sheet1:Sheet2",
      diagnostic: false,
    });
  });

  it("resolves an external reference under the EXTERNAL placeholder, still marked diagnostic, when only the workbook's own name was not recovered", () => {
    expect(resolveXti(EXTERNAL_UNNAMED, 0, 1)).toStrictEqual({
      label: "[EXTERNAL]Sheet1:Sheet2",
      diagnostic: true,
    });
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
