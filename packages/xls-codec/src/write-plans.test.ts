// The write suites split from write.test.ts by family (write-c), restating its imports verbatim.

import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetConditionalFormat,
  ContentSheetPrintSettings,
} from "document-schema.js";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import {} from "archive-codec";
import { describe, expect, it, vi } from "vitest";

import {
  RECORD_CALCCOUNT,
  RECORD_CF12,
  RECORD_DIMENSIONS,
  RECORD_EOF,
  RECORD_HORIZONTALPAGEBREAKS,
  RECORD_MERGECELLS,
  RECORD_ROW,
  RECORD_SETUP,
  RECORD_VERTICALPAGEBREAKS,
} from "./biff/record-types";
import { readRecords } from "./biff/records";
import * as writtenCellsModule from "./written-cells";
import {} from "./biff/xf-colors";
import {} from "./biff/write-errors";

import { assertNeverContentCellValueKind } from "./content";
import {} from "./container";
import {} from "./write";
import { writeSheetConditionalFormats } from "./workbook/conditional-format-write";
import {} from "./workbook/data-validation-write";
import { buildWorksheetSubstream } from "./workbook/sheet-writer";

import {} from "./workbook/globals-writer";

// Genuine .xls bytes — a real [MS-CFB] compound file holding a real BIFF8 Workbook stream — built by this package's own writer and read back through its own reader, the "primary verification method" this session's writers use throughout (the CFB writer, rtf-codec, wpd-codec). Every test here is a round trip: build a ContentDocument, write it, read it back, and check the read result reflects what was written — exercising the writer against a reader whose own correctness is independently pinned by content.test.ts's hand-built byte sequences.

const POINTS_PER_INCH = 72;
/** Excel's own "Normal" preset, which is what a sheet with nothing else to say about printing carries — and, since the reader falls back to exactly these values for a file stating none of the print records, what a round trip through this pair reproduces either way. The print-settings round trips at the end of this file are the ones that exercise real, non-default values. */
const PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: PAGE_SIZE_LETTER,
  margins: {
    topPt: 0.75 * POINTS_PER_INCH,
    rightPt: 0.7 * POINTS_PER_INCH,
    bottomPt: 0.75 * POINTS_PER_INCH,
    leftPt: 0.7 * POINTS_PER_INCH,
  },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function sheet(
  name: string,
  cells: readonly ContentSheetCell[],
  overrides: Partial<Omit<ContentSheet, "name" | "cells">> = {},
): ContentSheet {
  return {
    name,
    cells: [...cells],
    columns: [],
    rows: [],
    images: [],
    printSettings: PRINT_SETTINGS,
    ...overrides,
  };
}

function cell(
  row: number,
  column: number,
  value: ContentCellValue,
  extra: Partial<ContentSheetCell> = {},
): ContentSheetCell {
  return { row, column, value, displayText: displayTextFor(value), ...extra };
}

/** Mirrors content.ts's own private displayTextOf exactly, so a test fixture's displayText is what a real reader would also produce for the same value — required because ContentSheetCellSchema documents displayText as always present. */
function displayTextFor(value: ContentCellValue): string {
  switch (value.kind) {
    case "number":
    case "percentage":
    case "currency":
      return String(value.value);
    case "boolean":
      return value.value ? "TRUE" : "FALSE";
    case "date":
    case "time":
    case "dateTime":
    case "string":
    case "error":
      return value.value;
    case "empty":
      return "";
  }
  return assertNeverContentCellValueKind(value);
}

describe("buildWorksheetSubstream: Dimensions bytes content.ts never reads back", () => {
  // content.ts's own readSheetRecords stores RECORD_DIMENSIONS into usedRange, but nothing downstream of that ever reads the field back into a ContentSheet — so no round trip through readXlsContent can distinguish a correct Dimensions record from a subtly wrong one, and these tests call the writer directly instead.
  const NO_DRAWING = { msoDrawingRecords: [], objRecords: [] };
  const NO_STYLE_CTX = {
    icvOf: () => 0,
    xfIndexForCell: () => 0,
    sstIndexFor: () => 0,
  };

  function dimensionsDataOf(cells: readonly ContentSheetCell[]): Uint8Array {
    const bytes = buildWorksheetSubstream(
      sheet("S", cells),
      NO_STYLE_CTX,
      NO_DRAWING,
    );
    const dimensions = readRecords(bytes).find(
      (record) => record.type === RECORD_DIMENSIONS,
    );
    if (dimensions === undefined) {
      throw new Error("no Dimensions record was written");
    }
    return dimensions.data;
  }

  function u32AtOffset(data: Uint8Array, offset: number): number {
    return new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).getUint32(offset, true);
  }

  function u16AtOffset(data: Uint8Array, offset: number): number {
    return new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).getUint16(offset, true);
  }

  it("writes Dimensions as one past the true max row/column, and the true min, across several cells", () => {
    const data = dimensionsDataOf([
      cell(3, 5, { kind: "number", value: 1 }),
      cell(1, 9, { kind: "number", value: 2 }),
      cell(7, 2, { kind: "number", value: 3 }),
    ]);
    // rwMic(4) rwMac(4) colMic(2) colMac(2)
    expect(u32AtOffset(data, 0)).toBe(1); // rwMic: the smallest row (1)
    expect(u32AtOffset(data, 4)).toBe(8); // rwMac: the largest row (7) + 1
    expect(u16AtOffset(data, 8)).toBe(2); // colMic: the smallest column (2)
    expect(u16AtOffset(data, 10)).toBe(10); // colMac: the largest column (9) + 1
  });

  it("writes Dimensions as all zero for a sheet with no written cells", () => {
    const data = dimensionsDataOf([]);
    expect(u32AtOffset(data, 0)).toBe(0);
    expect(u32AtOffset(data, 4)).toBe(0);
    expect(u16AtOffset(data, 8)).toBe(0);
    expect(u16AtOffset(data, 10)).toBe(0);
  });
});

describe("buildWorksheetSubstream: sheet-writer.ts's own boundary and array-emptiness checks", () => {
  const NO_DRAWING = { msoDrawingRecords: [], objRecords: [] };
  const NO_STYLE_CTX = {
    icvOf: () => 0,
    xfIndexForCell: () => 0,
    sstIndexFor: () => 0,
  };

  function recordsOf(
    cells: readonly ContentSheetCell[],
    overrides: Partial<Omit<ContentSheet, "name" | "cells">> = {},
  ) {
    const bytes = buildWorksheetSubstream(
      sheet("S", cells, overrides),
      NO_STYLE_CTX,
      NO_DRAWING,
    );
    return readRecords(bytes);
  }

  function u16At(data: Uint8Array, offset: number): number {
    return new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).getUint16(offset, true);
  }

  /** RECORD_ROW's own first two u16 fields are rowIndex then colMic — filters a records list down to the one Row record naming the given index, since a sheet with several rows produces several. */
  function rowRecordAt(
    records: ReturnType<typeof readRecords>,
    rowIndex: number,
  ) {
    const row = records.find(
      (record) =>
        record.type === RECORD_ROW && u16At(record.data, 0) === rowIndex,
    );
    if (row === undefined) {
      throw new Error(`no Row record for index ${rowIndex} was written`);
    }
    return row.data;
  }

  it("writes Row's own colMic/colMac as the row's true min column and one past its true max, across several cells sharing a row", () => {
    const records = recordsOf([
      cell(2, 5, { kind: "number", value: 1 }),
      cell(2, 1, { kind: "number", value: 2 }),
      cell(2, 9, { kind: "number", value: 3 }),
    ]);
    const data = rowRecordAt(records, 2);
    expect(u16At(data, 2)).toBe(1); // colMic: the smallest column (1)
    expect(u16At(data, 4)).toBe(10); // colMac: the largest column (9) + 1
  });

  it("writes Row's own colMic/colMac as 0/0 for a declared row with no cells of its own", () => {
    const records = recordsOf([cell(0, 0, { kind: "number", value: 1 })], {
      rows: [{ index: 4, heightPt: 20 }],
    });
    const data = rowRecordAt(records, 4);
    expect(u16At(data, 2)).toBe(0);
    expect(u16At(data, 4)).toBe(0);
  });

  it("writes no MergeCells record at all for a sheet whose cells carry no real span", () => {
    // Every ordinary cell resolves rowSpan/colSpan to exactly 1 by default — the degenerate case a real merge (either axis greater than one) must be told apart from, not just "rowSpan or colSpan stated at all".
    const records = recordsOf([cell(0, 0, { kind: "number", value: 1 })]);
    expect(records.some((record) => record.type === RECORD_MERGECELLS)).toBe(
      false,
    );
  });

  it("writes no MergeCells entry for a cell whose rowSpan/colSpan are both explicitly 1", () => {
    const records = recordsOf([
      cell(0, 0, { kind: "number", value: 1 }, { rowSpan: 1, colSpan: 1 }),
    ]);
    expect(records.some((record) => record.type === RECORD_MERGECELLS)).toBe(
      false,
    );
  });

  it("writes CalcCount's own cIter as the real iteration-limit constant, not an empty calculation-state block", () => {
    const records = recordsOf([cell(0, 0, { kind: "number", value: 1 })]);
    const calcCount = records.find(
      (record) => record.type === RECORD_CALCCOUNT,
    );
    if (calcCount === undefined) {
      throw new Error("no CalcCount record was written");
    }
    expect(u16At(calcCount.data, 0)).toBe(100);
  });

  it("refuses a column past BIFF8's own 256-column grid", () => {
    expect(() =>
      buildWorksheetSubstream(
        sheet("S", [], { columns: [{ index: 256, widthPt: 50 }] }),
        NO_STYLE_CTX,
        NO_DRAWING,
      ),
    ).toThrow(/outside BIFF8's own 256-column grid/);
  });

  it("accepts a column exactly at BIFF8's own last column index", () => {
    expect(() =>
      buildWorksheetSubstream(
        sheet("S", [], { columns: [{ index: 255, widthPt: 50 }] }),
        NO_STYLE_CTX,
        NO_DRAWING,
      ),
    ).not.toThrow();
  });

  it("writes ColInfo's own flags as 0, not COLINFO_FLAG_HIDDEN, for a stated-but-not-hidden column", () => {
    const records = recordsOf([], {
      columns: [{ index: 0, widthPt: 100 }],
    });
    const colInfo = records.find((record) => record.type === 0x7d); // RECORD_COLINFO
    if (colInfo === undefined) {
      throw new Error("no ColInfo record was written");
    }
    expect(u16At(colInfo.data, 8)).toBe(0); // grbit
  });

  it("writes the Setup record's own iScale as the inactive-scale sentinel when fitToPages is stated, even if scalePercent is also present", () => {
    // ContentSheetPrintSettings does not enforce the two as mutually exclusive at the type level — fitToPages being stated is what must win, not merely scalePercent being absent.
    const records = recordsOf([], {
      printSettings: {
        ...PRINT_SETTINGS,
        scalePercent: 55,
        fitToPages: { width: 2, height: 3 },
      },
    });
    const setup = records.find((record) => record.type === RECORD_SETUP);
    if (setup === undefined) {
      throw new Error("no Setup record was written");
    }
    expect(u16At(setup.data, 2)).toBe(100); // iScale: SETUP_INACTIVE_SCALE_PERCENT, not the stated 55
  });

  it("writes no HorizontalPageBreaks/VerticalPageBreaks record for a sheet with declared but empty break arrays", () => {
    const records = recordsOf([], {
      printSettings: {
        ...PRINT_SETTINGS,
        manualBreaks: { rows: [], columns: [] },
      },
    });
    expect(
      records.some((record) => record.type === RECORD_HORIZONTALPAGEBREAKS),
    ).toBe(false);
    expect(
      records.some((record) => record.type === RECORD_VERTICALPAGEBREAKS),
    ).toBe(false);
  });

  it("writes HorizontalPageBreaks' own break indices in ascending order on the wire, not the declared order, before any read-side re-sorting could mask it", () => {
    // Reading a break back through ContentSheetPrintSettings' own round trip re-sorts on the read side too (sheet.ts's ascendingDistinct), so a roundtrip assertion alone cannot tell a writer that sorts from one that does not — this reads the raw HorizontalPageBreaks record directly instead.
    const records = recordsOf([], {
      printSettings: {
        ...PRINT_SETTINGS,
        manualBreaks: { rows: [20, 5, 15], columns: [] },
      },
    });
    const breaks = records.find(
      (record) => record.type === RECORD_HORIZONTALPAGEBREAKS,
    );
    if (breaks === undefined) {
      throw new Error("no HorizontalPageBreaks record was written");
    }
    expect(u16At(breaks.data, 0)).toBe(3); // cbrk
    expect(u16At(breaks.data, 2)).toBe(5); // first break: the smallest index
    expect(u16At(breaks.data, 8)).toBe(15); // second break: the middle index
    expect(u16At(breaks.data, 14)).toBe(20); // third break: the largest index
  });

  it("writes no MergeCells or comment records at all for a sheet with neither", () => {
    const records = recordsOf([cell(0, 0, { kind: "number", value: 1 })]);
    expect(records.some((record) => record.type === RECORD_MERGECELLS)).toBe(
      false,
    );
    // RECORD_NOTE ([MS-XLS] 0x001C) is writeSheetComments' own leading record — absent entirely for a sheet with no commented cells.
    expect(records.some((record) => record.type === 0x001c)).toBe(false);
  });

  it("ends every worksheet substream with a real EOF record", () => {
    const records = recordsOf([cell(0, 0, { kind: "number", value: 1 })]);
    expect(records.at(-1)?.type).toBe(RECORD_EOF);
  });

  it("writes a Row record's own cells sorted by column regardless of the order they were given in", () => {
    const records = recordsOf([
      cell(0, 9, { kind: "number", value: 1 }),
      cell(0, 1, { kind: "number", value: 2 }),
      cell(0, 5, { kind: "number", value: 3 }),
    ]);
    const numberRecords = records.filter((record) => record.type === 0x0203); // RECORD_NUMBER
    const columns = numberRecords.map((record) => u16At(record.data, 2));
    expect(columns).toStrictEqual([1, 5, 9]);
  });

  it("writes Row records themselves sorted by row index regardless of the order rows were declared or populated in", () => {
    const records = recordsOf(
      [
        cell(9, 0, { kind: "number", value: 1 }),
        cell(1, 0, { kind: "number", value: 2 }),
      ],
      { rows: [{ index: 5, heightPt: 20 }] },
    );
    const rowIndices = records
      .filter((record) => record.type === RECORD_ROW)
      .map((record) => u16At(record.data, 0));
    expect(rowIndices).toStrictEqual([1, 5, 9]);
  });

  it("throws sheet-writer's own internal-error message when a cell reaches writeCellValueRecord disagreeing with written-cells.ts's own filter about its formatting", () => {
    // written-cells.ts's own writesCellRecord calls cellCarriesFormatting as a same-module, unmocked local binding — vi.spyOn on the exported name never intercepts that internal call, only a cross-module import of it, which is exactly the call writeCellValueRecord makes. So the cell given here carries REAL formatting (a genuine background), satisfying writesCellRecord's own unmocked check honestly and letting the cell reach the cell table; only writeCellValueRecord's own cross-module call is mocked false, the disagreement this internal-error guard exists to catch — proving the guard actually fires and says what it claims to, rather than being unreachable dead code.
    const spy = vi
      .spyOn(writtenCellsModule, "cellCarriesFormatting")
      .mockReturnValueOnce(false);
    try {
      expect(() =>
        buildWorksheetSubstream(
          sheet("S", [
            cell(
              0,
              0,
              { kind: "empty" },
              { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
            ),
          ]),
          NO_STYLE_CTX,
          NO_DRAWING,
        ),
      ).toThrow(/internal error/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("writeSheetConditionalFormats: bytes the reader never inspects (#971/#1186)", () => {
  const RANGE = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
  const NO_ICV = (): number => 0;

  function cf12RecordDataOf(rule: ContentSheetConditionalFormat): Uint8Array {
    const pieces = writeSheetConditionalFormats(
      sheet("S", [], { conditionalFormats: [rule] }),
      NO_ICV,
    );
    const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
    const stream = new Uint8Array(total);
    let offset = 0;
    for (const piece of pieces) {
      stream.set(piece, offset);
      offset += piece.length;
    }
    const cf12 = readRecords(stream).find(
      (record) => record.type === RECORD_CF12,
    );
    if (cf12 === undefined) {
      throw new Error("no CF12 record was written");
    }
    return cf12.data;
  }

  function u32At(data: Uint8Array, offset: number): number {
    return new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).getUint32(offset, true);
  }

  function f64At(data: Uint8Array, offset: number): number {
    return new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).getFloat64(offset, true);
  }

  // CF12's own skeleton up to and including cbDxf ([MS-XLS] 2.4.43): frtRefHeader.rt(2) + grbitFrt(2) + ref8(8) + ct(1) + cp(1) + cce1(2) + cce2(2) = 18 bytes, then cbDxf itself as a 4-byte field.
  const CB_DXF_OFFSET = 18;

  it("writes cbDxf as 0 for a rule stating no style at all", () => {
    const data = cf12RecordDataOf({
      type: "aboveAverage",
      ranges: [RANGE],
    });
    expect(u32At(data, CB_DXF_OFFSET)).toBe(0);
  });

  it("writes a non-zero cbDxf for a rule stating a style", () => {
    const data = cf12RecordDataOf({
      type: "aboveAverage",
      ranges: [RANGE],
      style: { textColor: { r: 1, g: 0, b: 0 } },
    });
    expect(u32At(data, CB_DXF_OFFSET)).toBeGreaterThan(0);
  });

  // A colour-scale CF12's rgbCt (CFGradient, [MS-XLS] 2.5.32) starts right after the shared skeleton: cbDxf(4, always reading 0 here since ct 0x03 pins cbDxf to 0) + the empty dxf itself (0 bytes) + fmlaActive.cce(2) + fStopIfTrue(1) + ipriority(2) + icfTemplate(2) + cbTemplateParm(1) + templateParams(16) = 28 bytes after CB_DXF_OFFSET's own 4, i.e. CB_DXF_OFFSET + 4 + 28 = 50 is wrong — rechecked directly below against the record's own declared cbDxf/cbTemplateParm fields rather than hardcoded a second time, so a change to any one of those fixed sizes cannot silently desync this offset from the real layout.
  function gradientOffsetOf(data: Uint8Array): number {
    const cbDxf = u32At(data, CB_DXF_OFFSET);
    const cbTemplateParmOffset = CB_DXF_OFFSET + 4 + cbDxf + 2 + 1 + 2 + 2; // + fmlaActive.cce + fStopIfTrue + ipriority + icfTemplate
    const cbTemplateParm = data[cbTemplateParmOffset] ?? 0;
    return cbTemplateParmOffset + 1 + cbTemplateParm;
  }

  // CFGradient's own header (unused(2) + reserved1(1) + cInterpCurve(1) + cGradientCurve(1) + flags(1) = 6 bytes), then rgInterp: cInterpCurve entries of CFGradientInterpItem (a CFVO — 3 bytes for a fixed min/max stop, cce=0 — then the stop's own interpolation-position float, 8 bytes).
  function interpFractionAt(data: Uint8Array, stopIndex: number): number {
    const rgInterpStart = gradientOffsetOf(data) + 6;
    const stopStart = rgInterpStart + stopIndex * (3 + 8);
    return f64At(data, stopStart + 3);
  }

  it("writes a two-stop gradient's own fixed 0.0/1.0 interpolation fractions, not the three-stop set", () => {
    const data = cf12RecordDataOf({
      type: "colorScale",
      ranges: [RANGE],
      stops: [
        { value: { type: "min" }, color: { r: 0, g: 0, b: 0 } },
        { value: { type: "max" }, color: { r: 1, g: 1, b: 1 } },
      ],
    });
    expect(interpFractionAt(data, 0)).toBe(0.0);
    expect(interpFractionAt(data, 1)).toBe(1.0);
  });

  it("writes a three-stop gradient's own fixed 0.0/0.5/1.0 interpolation fractions, not the two-stop set", () => {
    const data = cf12RecordDataOf({
      type: "colorScale",
      ranges: [RANGE],
      stops: [
        { value: { type: "min" }, color: { r: 0, g: 0, b: 0 } },
        // "min" again (rather than a value-bearing type): every stop here must compile to the identical fixed 3-byte CFVO (cce 0, no rgce) for interpFractionAt's own fixed stride assumption to address the right byte offset — the middle stop's own threshold value is irrelevant to what this test checks.
        { value: { type: "min" }, color: { r: 0.5, g: 0.5, b: 0.5 } },
        { value: { type: "max" }, color: { r: 1, g: 1, b: 1 } },
      ],
    });
    expect(interpFractionAt(data, 0)).toBe(0.0);
    expect(interpFractionAt(data, 1)).toBe(0.5);
  });
});
