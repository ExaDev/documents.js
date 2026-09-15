import { describe, expect, it } from "vitest";

import type { ContentDefinedName } from "document-schema.js";

import { RecordBuilder } from "../biff/builder";
import type { FormulaSheetContext } from "../biff/ptg";
import { RECORD_LBL } from "../biff/record-types";
import { writeRecord } from "../biff/record-writer";
import { readRecords } from "../biff/records";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import { BiffWriteError } from "../biff/write-errors";
import { concat, f64, u16, xlUnicodeStringNoCch } from "../test-support/biff";
import {
  definedNameEntriesFor,
  readDefinedNames,
  requiredCaptureGroup,
  writeDefinedNameRecord,
  writeDefinedNameRecords,
} from "./defined-names";

/** A single-sheet workbook, ixti 0 resolving to Sheet1 alone -- every read-side fixture below names a reference on this one sheet. */
const ONE_SHEET: FormulaSheetContext = {
  sheets: [{ name: "Sheet1" }],
  sheetRanges: [{ firstSheetIndex: 0, lastSheetIndex: 0 }],
};

/** PtgArea3d, reference class ([MS-XLS] 2.5.198.28): opcode 0x3b, the ixti, then an RgceArea -- a well-formed "the rest of the token stream parses fine" rgce for tests that are really probing an earlier field. */
function area3dToken(
  ixti: number,
  rowFirst: number,
  rowLast: number,
  colFirst: number,
  colLast: number,
): Uint8Array<ArrayBuffer> {
  return new RecordBuilder()
    .u8(0x3b)
    .u16(ixti)
    .u16(rowFirst)
    .u16(rowLast)
    .u16(colFirst)
    .u16(colLast)
    .build();
}

const VALID_REF_RGCE = area3dToken(0, 0, 0, 0, 0);

/** PtgArray (value class, [MS-XLS] 61167ac8): opcode 0x40, then seven bytes this reader never inspects -- the real values live in the RgbExtra trailer's own PtgExtraArray, at the same position in the token sequence. */
function ptgArrayToken(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x40, 0, 0, 0, 0, 0, 0, 0]);
}

/** SerNum ([MS-XLS] 7a876271): reserved 0x01 then an Xnum. */
function serNum(value: number): number[] {
  return [0x01, ...f64(value)];
}

/** PtgExtraArray ([MS-XLS] 70f743b2): columns-1, rows-1, then each SerAr element in row-major order. */
function ptgExtraArray(rows: readonly (readonly number[])[][]): number[] {
  const columnCount = rows[0]?.length ?? 0;
  const elements = rows.flatMap((row) => row.flatMap((element) => element));
  return [(columnCount - 1) & 0xff, ...u16(rows.length - 1), ...elements];
}

/** The Lbl record's own body ([MS-XLS] 2.4.150), independent of this package's own writer -- so a test can put an EARLIER field into a shape the real writer never produces (a builtin index instead of a spelled name, a mismatched cch) while keeping every later field well-formed. */
function lblBody(options: {
  readonly builtin?: boolean;
  readonly cch?: number;
  readonly nameHighByte?: boolean;
  readonly builtinIndex?: number;
  readonly name?: string;
  readonly itab?: number;
  readonly rgce?: Uint8Array<ArrayBuffer>;
  readonly rgcb?: Uint8Array<ArrayBuffer>;
}): Uint8Array<ArrayBuffer> {
  const rgce = options.rgce ?? VALID_REF_RGCE;
  const rgcb = options.rgcb ?? new Uint8Array(0);
  const nameBytes =
    options.builtin === true
      ? new Uint8Array([
          options.nameHighByte === true ? 1 : 0,
          options.builtinIndex ?? 0x0d, // _xlnm._FilterDatabase: a non-print builtin
        ])
      : new Uint8Array(xlUnicodeStringNoCch(options.name ?? "MyRange"));
  return new RecordBuilder()
    .u16(options.builtin === true ? 0x0020 : 0x0000) // grbit: fBuiltin, or no flags at all
    .u8(0) // chKey: no macro shortcut key
    .u8(
      options.cch ??
        (options.builtin === true ? 1 : (options.name ?? "MyRange").length),
    )
    .u16(rgce.length) // cce
    .u16(0) // reserved3
    .u16(options.itab ?? 0)
    .u32(0) // reserved4 through reserved7
    .bytes(nameBytes)
    .bytes(rgce)
    .bytes(rgcb)
    .build();
}

function lblRecord(
  options: Parameters<typeof lblBody>[0],
): Uint8Array<ArrayBuffer> {
  return writeRecord(RECORD_LBL, lblBody(options));
}

function groupsOf(
  ...records: readonly Uint8Array<ArrayBuffer>[]
): readonly RecordGroup[] {
  return groupRecords(readRecords(concat(...records)));
}

describe("readDefinedNames", () => {
  it("reads a workbook-scoped user-defined name and its single-cell range reference", () => {
    expect(
      readDefinedNames(
        groupsOf(lblRecord({ name: "MyRange", itab: 0 })),
        ONE_SHEET,
      ),
    ).toStrictEqual([
      { name: "MyRange", refersTo: "Sheet1!$A$1:$A$1", sheetIndex: undefined },
    ]);
  });

  it("skips a record whose type is not RECORD_LBL, even though its own bytes would otherwise decode as a perfectly valid one", () => {
    // Not a NoCoverage/Survived-only distinction: an implementation that dropped the type filter entirely would still (in this specific case) decode the imposter record without throwing, so a raw byte-shape check is what actually tells the two apart, not merely a crash.
    const imposter = writeRecord(0x9999, lblBody({ name: "Ghost" }));
    const real = lblRecord({ name: "Real" });
    const names = readDefinedNames(groupsOf(imposter, real), ONE_SHEET);
    expect(names.map((entry) => entry.name)).toStrictEqual(["Real"]);
  });

  it("skips a malformed Lbl record whose own bytes run out before its declared fields, without aborting the names read from every other record", () => {
    const truncated = writeRecord(
      RECORD_LBL,
      new RecordBuilder().u16(0x0000).build(), // only grbit -- chKey/cch/cce/itab/reserved4-7 are all missing
    );
    const real = lblRecord({ name: "Real" });
    const names = readDefinedNames(groupsOf(truncated, real), ONE_SHEET);
    expect(names.map((entry) => entry.name)).toStrictEqual(["Real"]);
  });

  it("skips a built-in name whose Name field's own cch is not exactly 1", () => {
    const twoCharacterName = lblRecord({ builtin: true, cch: 2 });
    expect(
      readDefinedNames(groupsOf(twoCharacterName), ONE_SHEET),
    ).toStrictEqual([]);
  });

  it("skips a built-in name whose Name field's high byte is set", () => {
    const uncompressed = lblRecord({ builtin: true, nameHighByte: true });
    expect(readDefinedNames(groupsOf(uncompressed), ONE_SHEET)).toStrictEqual(
      [],
    );
  });

  it("skips the two print built-ins, which print-names.ts owns end to end rather than stating twice", () => {
    const printArea = lblRecord({ builtin: true, builtinIndex: 0x06 });
    const printTitles = lblRecord({ builtin: true, builtinIndex: 0x07 });
    expect(
      readDefinedNames(groupsOf(printArea, printTitles), ONE_SHEET),
    ).toStrictEqual([]);
  });

  it("reads a genuine non-print built-in name via its single-character built-in index", () => {
    const filterDatabase = lblRecord({ builtin: true, builtinIndex: 0x0d });
    expect(readDefinedNames(groupsOf(filterDatabase), ONE_SHEET)).toStrictEqual(
      [
        {
          name: "_xlnm._FilterDatabase",
          refersTo: "Sheet1!$A$1:$A$1",
          sheetIndex: undefined,
        },
      ],
    );
  });

  it("passes the name's own trailing bytes as parseFormulaText's rgcb, resolving a PtgArray token against its PtgExtraArray trailer", () => {
    const arrayConstant = lblRecord({
      name: "Consts",
      rgce: ptgArrayToken(),
      rgcb: new Uint8Array(ptgExtraArray([[serNum(1), serNum(2), serNum(3)]])),
    });
    expect(readDefinedNames(groupsOf(arrayConstant), ONE_SHEET)).toStrictEqual([
      { name: "Consts", refersTo: "{1,2,3}", sheetIndex: undefined },
    ]);
  });

  it("keys a sheet-scoped name by its own itab, one-based in the record and zero-based here", () => {
    const scoped = lblRecord({ name: "Local", itab: 1 });
    expect(readDefinedNames(groupsOf(scoped), ONE_SHEET)).toStrictEqual([
      { name: "Local", refersTo: "Sheet1!$A$1:$A$1", sheetIndex: 0 },
    ]);
  });
});

describe("definedNameEntriesFor", () => {
  const ONE_SHEET_NAMES = [{ name: "Sheet1" }];

  function entryFor(
    name: ContentDefinedName,
  ): ReturnType<typeof definedNameEntriesFor>[number] {
    const [entry] = definedNameEntriesFor([name], ONE_SHEET_NAMES);
    if (entry === undefined) {
      throw new Error("definedNameEntriesFor returned no entry");
    }
    return entry;
  }

  it("refuses an _xlnm-prefixed name that is not in [MS-XLS] 2.4.150's own built-in name table", () => {
    expect(() =>
      entryFor({ name: "_xlnm.Not_A_Real_Builtin", refersTo: "Sheet1!$A$1" }),
    ).toThrow(
      /the "_xlnm\." prefix is reserved for built-in names, and this one is not in \[MS-XLS\] 2\.4\.150's own built-in name table/,
    );
  });

  it("refuses the Print_Area built-in by name, not only Print_Titles", () => {
    expect(() =>
      entryFor({ name: "_xlnm.Print_Area", refersTo: "Sheet1!$A$1" }),
    ).toThrow(
      /the print built-ins are print-settings facts, stated through a sheet's printSettings/,
    );
  });

  it("refuses the Print_Titles built-in by name too, not only Print_Area", () => {
    expect(() =>
      entryFor({ name: "_xlnm.Print_Titles", refersTo: "Sheet1!$A$1" }),
    ).toThrow(
      /the print built-ins are print-settings facts, stated through a sheet's printSettings/,
    );
  });

  it("refuses an empty name, one character short of Lbl's own 1-255 range", () => {
    expect(() => entryFor({ name: "", refersTo: "Sheet1!$B$2" })).toThrow(
      /Lbl's own cch field is one byte, so a name must be 1-255 UTF-16 code units/,
    );
  });

  it("accepts a name exactly one character long, the other edge of Lbl's own 1-255 range", () => {
    expect(() =>
      entryFor({ name: "x", refersTo: "Sheet1!$B$2" }),
    ).not.toThrow();
  });

  it("refuses a name past Lbl's own 255-character cch field, naming the exact offending length", () => {
    expect(() =>
      entryFor({ name: "x".repeat(256), refersTo: "Sheet1!$A$1" }),
    ).toThrow(/xls-codec cannot write a defined name of 256 characters/);
  });

  it("refuses a name shaped like a cell reference, naming the offending name itself", () => {
    expect(() => entryFor({ name: "A1", refersTo: "Sheet1!$A$1" })).toThrow(
      /the defined name "A1": a name shaped like a cell reference is forbidden/,
    );
  });

  it("refuses a scopeSheetIndex past the end of the document's own sheets, naming both the index and the sheet count", () => {
    expect(() =>
      entryFor({
        name: "Bad",
        refersTo: "Sheet1!$A$1",
        scopeSheetIndex: 1,
      }),
    ).toThrow(
      /its scopeSheetIndex 1 is past the end of the document's own 1-sheet array/,
    );
  });

  it("refuses a refersTo outside the sheet-qualified reference vocabulary, naming the offending text", () => {
    expect(() =>
      entryFor({ name: "Total", refersTo: "SUM(Sheet1!$A$1:$A$9)" }),
    ).toThrow(
      /its refersTo "SUM\(Sheet1!\$A\$1:\$A\$9\)" is not a sheet-qualified cell or range reference/,
    );
  });

  it("refuses a refersTo naming a sheet the document's own sheets do not carry", () => {
    expect(() =>
      entryFor({ name: "Missing", refersTo: "Sheet9!$A$1" }),
    ).toThrow(
      /its refersTo names the sheet "Sheet9", which the document's own sheets do not carry/,
    );
  });

  it("refuses a row of 0, which is not a valid one-based A1 row and so parses to no corner at all", () => {
    expect(() =>
      entryFor({ name: "ZeroRow", refersTo: "Sheet1!$A$0" }),
    ).toThrow(
      /its refersTo "Sheet1!\$A\$0" does not name an A1-style reference this writer can compile/,
    );
  });

  it("refuses a reference reaching past BIFF8's own grid, naming the exact ceiling", () => {
    expect(() =>
      entryFor({ name: "PastEdge", refersTo: "Sheet1!$A$65537" }),
    ).toThrow(
      /reaches outside BIFF8's own grid \(rows 0-65535, columns 0-255\)/,
    );
  });

  it("isolates a range's own FIRST row from its last, refusing when only the first exceeds BIFF8's grid", () => {
    expect(() =>
      entryFor({ name: "Bad", refersTo: "Sheet1!$A$65537:$A$1" }),
    ).toThrow(BiffWriteError);
  });

  it("isolates a range's own LAST row from its first, refusing when only the last exceeds BIFF8's grid", () => {
    expect(() =>
      entryFor({ name: "Bad", refersTo: "Sheet1!$A$1:$A$65537" }),
    ).toThrow(BiffWriteError);
  });

  it("isolates a range's own FIRST column from its last, refusing when only the first exceeds BIFF8's grid", () => {
    expect(() =>
      entryFor({ name: "Bad", refersTo: "Sheet1!$IW$1:$A$1" }),
    ).toThrow(BiffWriteError);
  });

  it("isolates a range's own LAST column from its first, refusing when only the last exceeds BIFF8's grid", () => {
    expect(() =>
      entryFor({ name: "Bad", refersTo: "Sheet1!$A$1:$IW$1" }),
    ).toThrow(BiffWriteError);
  });

  it("accepts a reference exactly at BIFF8's own last column, IV, not just its last row", () => {
    expect(() =>
      entryFor({ name: "AtEdge", refersTo: "Sheet1!$IV$1:$IV$1" }),
    ).not.toThrow();
  });

  it("takes an unquoted sheet-name prefix verbatim, resolving it against the document's own sheets", () => {
    expect(() =>
      entryFor({ name: "N", refersTo: "Sheet1!$A$1" }),
    ).not.toThrow();
  });

  it("unwraps a quoted sheet-name prefix that both starts and ends with a single quote", () => {
    const [entry] = definedNameEntriesFor(
      [{ name: "N", refersTo: "'My Sheet'!$A$1" }],
      [{ name: "My Sheet" }],
    );
    expect(entry?.name).toBe("N");
  });

  it("leaves a sheet-name prefix that starts with a quote but does not end with one, rather than mis-slicing it as if it were properly quoted", () => {
    const [entry] = definedNameEntriesFor(
      [{ name: "N", refersTo: "'Bad!$A$1" }],
      [{ name: "'Bad" }],
    );
    expect(entry?.name).toBe("N");
  });

  it("leaves a sheet-name prefix that ends with a quote but does not start with one, rather than mis-slicing it as if it were properly quoted", () => {
    const [entry] = definedNameEntriesFor(
      [{ name: "N", refersTo: "Bad'!$A$1" }],
      [{ name: "Bad'" }],
    );
    expect(entry?.name).toBe("N");
  });

  it("leaves a single stray quote character as-is, one character short of the two quotes unwrapping requires", () => {
    const [entry] = definedNameEntriesFor(
      [{ name: "N", refersTo: "'!$A$1" }],
      [{ name: "'" }],
    );
    expect(entry?.name).toBe("N");
  });

  it("unwraps a doubly-quoted empty sheet name to the empty string, the two-character edge unwrapping requires", () => {
    const [entry] = definedNameEntriesFor(
      [{ name: "N", refersTo: "''!$A$1" }],
      [{ name: "" }],
    );
    expect(entry?.name).toBe("N");
  });

  it("unescapes a doubled single quote inside a quoted sheet name back to one literal quote", () => {
    const [entry] = definedNameEntriesFor(
      [{ name: "N", refersTo: "'It''s Mine'!$A$1" }],
      [{ name: "It's Mine" }],
    );
    expect(entry?.name).toBe("N");
  });
});

describe("requiredCaptureGroup", () => {
  it("returns the group unchanged when it is present", () => {
    expect(requiredCaptureGroup("A1")).toBe("A1");
  });

  it("throws for an undefined group -- the one case this module's own regexes never actually produce, verified directly since none of its real callers can construct it", () => {
    expect(() => requiredCaptureGroup(undefined)).toThrow(BiffWriteError);
  });
});

describe("writeDefinedNameRecord / writeDefinedNameRecords", () => {
  it("writes every planned entry as its own Lbl record, in the order given", () => {
    const entries = definedNameEntriesFor(
      [
        { name: "First", refersTo: "Sheet1!$A$1" },
        { name: "Second", refersTo: "Sheet1!$B$2" },
      ],
      [{ name: "Sheet1" }],
    );
    const records = writeDefinedNameRecords(entries);
    expect(records).toHaveLength(2);
    const [firstEntry, secondEntry] = entries;
    if (firstEntry === undefined || secondEntry === undefined) {
      throw new Error("definedNameEntriesFor returned fewer than 2 entries");
    }
    expect(records[0]).toStrictEqual(writeDefinedNameRecord(firstEntry));
    expect(records[1]).toStrictEqual(writeDefinedNameRecord(secondEntry));
  });
});
