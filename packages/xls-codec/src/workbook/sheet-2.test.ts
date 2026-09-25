// The grid-geometry and print-settings suites, split from sheet.test.ts, restating its harness verbatim.

import { describe, expect, it } from "vitest";

import {} from "../biff/cursor";

import {
  RECORD_BLANK,
  RECORD_BOTTOMMARGIN,
  RECORD_CF,
  RECORD_CF12,
  RECORD_CFEX,
  RECORD_COLINFO,
  RECORD_CONDFMT,
  RECORD_CONDFMT12,
  RECORD_DIMENSIONS,
  RECORD_DV,
  RECORD_HORIZONTALPAGEBREAKS,
  RECORD_LEFTMARGIN,
  RECORD_MERGECELLS,
  RECORD_PRINTGRID,
  RECORD_PRINTROWCOL,
  RECORD_RIGHTMARGIN,
  RECORD_ROW,
  RECORD_SETUP,
  RECORD_TOPMARGIN,
  RECORD_VERTICALPAGEBREAKS,
  RECORD_WSBOOL,
} from "../biff/record-types";
import { readRecords } from "../biff/records";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import {
  cell,
  concat,
  f64,
  record,
  shortXlUnicodeString,
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

    expect(sheet.usedRange).toStrictEqual({
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
    // Not merely undefined-valued but genuinely absent: readSheetRecords omits the key entirely rather than including it set to undefined, so a caller spreading the result (content.ts's own fallbacks) sees "this file states no used range" rather than a present-but-empty one.
    expect("usedRange" in sheet).toBe(false);
  });

  it("includes a genuine usedRange key, not merely a truthy value, once a real Dimensions record is present", () => {
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_DIMENSIONS, [...u32(0), ...u32(5), ...u16(0), ...u16(3)]),
      ),
      [],
    );
    expect("usedRange" in sheet).toBe(true);
  });

  it("treats a zero rwMac alone, with a genuinely non-zero colMac, as no used range — the OR is not an AND", () => {
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_DIMENSIONS, [...u32(0), ...u32(0), ...u16(0), ...u16(3)]),
      ),
      [],
    );
    expect("usedRange" in sheet).toBe(false);
  });

  it("treats a zero colMac alone, with a genuinely non-zero rwMac, as no used range too", () => {
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_DIMENSIONS, [...u32(0), ...u32(5), ...u16(0), ...u16(0)]),
      ),
      [],
    );
    expect("usedRange" in sheet).toBe(false);
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

    expect(sheet.rows).toStrictEqual([
      { index: 3, heightPt: 15, hidden: false },
    ]);
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

    expect(sheet.rows[0]).toStrictEqual({ index: 0, hidden: false });
  });

  it("omits a height of exactly zero twips even when the producer did mark it declared", () => {
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_ROW, [
          ...u16(0),
          ...u16(0),
          ...u16(1),
          ...u16(0), // miyRw: zero twips
          ...u16(0),
          ...u16(0),
          0x40, // fUnsynced: declared
          0x01,
          ...u16(0),
        ]),
      ),
      [],
    );

    expect(sheet.rows[0]).toStrictEqual({ index: 0, hidden: false });
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

    expect(sheet.columns.map((column) => column.index)).toStrictEqual([
      1, 2, 3,
    ]);
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

    expect(sheet.merges).toStrictEqual([
      { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 },
      { startRow: 5, endRow: 5, startColumn: 3, endColumn: 4 },
    ]);
  });

  it("reads a Dv record into dataValidations (data-validation.test.ts covers the field mapping itself in full; this proves the record dispatch)", () => {
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_DV, [
          ...u32(0x1), // valType 1 (whole), typOperator 0 (between), no flags
          ...xlUnicodeString(""),
          ...xlUnicodeString(""),
          ...xlUnicodeString(""),
          ...xlUnicodeString(""),
          ...u16(3), // formula1 cce
          ...u16(0),
          0x1e,
          ...u16(1), // PtgInt 1
          ...u16(3), // formula2 cce
          ...u16(0),
          0x1e,
          ...u16(10), // PtgInt 10
          ...u16(1), // one range
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0),
        ]),
      ),
      [],
    );

    expect(sheet.dataValidations).toStrictEqual([
      {
        type: "whole",
        operator: "between",
        formula1: "1",
        formula2: "10",
        allowBlank: false,
        showInputMessage: false,
        showErrorMessage: false,
        errorStyle: "stop",
        promptTitle: "",
        errorTitle: "",
        prompt: "",
        error: "",
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      },
    ]);
  });

  it("reads a CondFmt/CF group into conditionalFormats, including the lookahead skip past its own CF children (conditional-format.test.ts covers the field mapping itself in full; this proves the record dispatch)", () => {
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_CONDFMT, [
          ...u16(1), // ccf — one CF record follows
          ...u16(0), // fToughRecalc + nID, unused
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0), // refBound (Ref8U), unused
          ...u16(1), // one range
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0),
        ]),
        record(RECORD_CF, [
          0x01, // ct: comparison
          0x05, // cp: greaterThan
          ...u16(3), // cce1
          ...u16(0), // cce2
          0x1e,
          ...u16(10), // PtgInt 10
        ]),
        record(RECORD_DIMENSIONS, [...u32(0), ...u32(2), ...u16(0), ...u16(2)]),
      ),
      [],
    );

    expect(sheet.conditionalFormats).toStrictEqual([
      {
        operator: "greaterThan",
        formula1: "10",
        formula2: undefined,
        style: undefined,
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      },
    ]);
    // Dimensions, the record right after the CF this CondFmt claimed, is still read on the following loop iteration — proving the lookahead skip advanced past exactly the CondFmt's own group and nothing more.
    expect(sheet.usedRange).toStrictEqual({
      startRow: 0,
      endRow: 1,
      startColumn: 0,
      endColumn: 1,
    });
  });

  it("reads a CondFmt12/CF12 group into conditionalFormats, including the lookahead skip past its own CF12 children (conditional-format-12.test.ts covers the field mapping itself in full; this proves the record dispatch)", () => {
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_CONDFMT12, [
          ...new Array<number>(12).fill(0), // frtRefHeaderU
          ...u16(1), // ccf — one CF12 record follows
          ...u16(0), // fToughRecalc + nID, unused
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0), // refBound (Ref8U), unused
          ...u16(1), // one range
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0),
        ]),
        record(RECORD_CF12, [
          ...new Array<number>(12).fill(0), // frtRefHeader
          0x03, // ct: colour scale
          0x00, // cp
          ...u16(0), // cce1
          ...u16(0), // cce2
          ...u32(0), // cbDxf
          ...u16(0), // fmlaActive cce
          0x00, // flags
          ...u16(0), // ipriority
          ...u16(0), // icfTemplate
          16, // cbTemplateParm
          ...new Array<number>(16).fill(0), // rgbTemplateParms
          // CFGradient: two stops, min/max, indexed colours
          ...u16(0), // unused
          0x00, // reserved1
          2, // cInterpCurve
          2, // cGradientCurve
          0x03, // fClamp + fBackground
          0x02,
          ...u16(0),
          ...f64(0), // cfvo(min) + numDomain
          0x03,
          ...u16(0),
          ...f64(0), // cfvo(max) + numDomain
          ...f64(0),
          ...u32(0x00000001),
          ...u32(2),
          ...f64(0), // numGrange + CFColor(icv 2)
          ...f64(0),
          ...u32(0x00000001),
          ...u32(3),
          ...f64(0), // numGrange + CFColor(icv 3)
        ]),
        record(RECORD_DIMENSIONS, [...u32(0), ...u32(2), ...u16(0), ...u16(2)]),
      ),
      [],
    );

    expect(sheet.conditionalFormats12).toStrictEqual([
      {
        kind: "colorScale",
        stops: [
          { value: { type: "min" }, color: { kind: "icv", icv: 2, tint: 0 } },
          { value: { type: "max" }, color: { kind: "icv", icv: 3, tint: 0 } },
        ],
        priority: 0,
        stopIfTrue: false,
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      },
    ]);
    // Dimensions, the record right after the CF12 this CondFmt12 claimed, is still read on the following loop iteration — proving the lookahead skip advanced past exactly the CondFmt12's own group and nothing more.
    expect(sheet.usedRange).toStrictEqual({
      startRow: 0,
      endRow: 1,
      startColumn: 0,
      endColumn: 1,
    });
  });

  it("resolves a CFEx record into conditionalFormats12, extending the CondFmt group it names by nID (conditional-format-ex.test.ts covers readCfEx/readCondFmtGroup's own composition in full; this proves the record dispatch actually reaches readCfEx at all)", () => {
    const nID = 7;
    const sheet = readSheetRecords(
      groupsOf(
        record(RECORD_CONDFMT, [
          ...u16(1), // ccf — one CF record follows
          ...u16(nID << 1), // A-fToughRecalc(0) + nID
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0), // refBound (Ref8U), unused
          ...u16(1), // one range
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0),
        ]),
        record(RECORD_CF, [
          0x02, // ct: formula
          0x00, // cp
          ...u16(9), // cce1
          ...u16(0), // cce2
          0x17,
          ...shortXlUnicodeString("needle"), // PtgStr "needle"
        ]),
        record(RECORD_CFEX, [
          ...new Array<number>(12).fill(0), // frtRefHeaderU
          ...u32(0), // fIsCF12: 0, this is the legacy-CF-extending shape
          ...u16(nID),
          ...u16(0), // icf
          0x00, // cp
          0x08, // icfTemplate: containsText
          ...u16(0), // ipriority
          0x01, // flags: A-fActive set, B-fStopIfTrue clear
          0x00, // fHasDXF: no DXF trailer
          16, // cbTemplateParm
          ...u16(0), // ctp
          ...new Array<number>(14).fill(0), // reserved
        ]),
      ),
      [],
    );

    expect(sheet.conditionalFormats12).toStrictEqual([
      {
        kind: "containsText",
        text: "needle",
        priority: 0,
        stopIfTrue: false,
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
        style: undefined,
      },
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

    expect(sheet.print.setup).toStrictEqual({
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

    expect(sheet.print.marginsPt).toStrictEqual({
      left: 36,
      right: 54,
      top: 72,
      bottom: 90,
    });
  });

  it("leaves a margin absent when the sheet carries no record for that side", () => {
    // [MS-XLS] 2.1.7.20.6's PAGESETUP production brackets each margin individually, so a sheet stating one and not the others is well-formed — and "states nothing" has to stay distinguishable from "states the default".
    const sheet = readSheetRecords(
      groupsOf(record(RECORD_LEFTMARGIN, f64(0.5))),
      [],
    );

    expect(sheet.print.marginsPt).toStrictEqual({ left: 36 });
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
    // Unlike PrintRowCol's own genuinely 16-bit Boolean field, PrintGrid packs its one real bit into a 16-bit record with 15 undefined bits alongside it — a bare `!== 0` test would read any of them set as gridlines-on.
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
    // [MS-XLS] 2.4.142/2.4.343: a count then that many six-byte structures — a HorzBrk's row plus its colStart/colEnd, a VertBrk's col plus its rowStart/rowEnd.
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

    expect(sheet.print.rowBreaks).toStrictEqual([4, 10]);
    expect(sheet.print.columnBreaks).toStrictEqual([3]);
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

    expect(sheet.print.rowBreaks).toStrictEqual([7]);
  });

  it("states nothing at all for a sheet carrying none of the print records", () => {
    const sheet = readSheetRecords(
      groupsOf(record(RECORD_BLANK, cell(0, 0))),
      [],
    );

    expect(sheet.print).toStrictEqual({
      marginsPt: {},
      rowBreaks: [],
      columnBreaks: [],
    });
  });
});
