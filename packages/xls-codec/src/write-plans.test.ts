// The write suites split from write.test.ts by family (write-c), restating its imports verbatim.

import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetConditionalFormat,
  ContentSheetPrintSettings,
} from "document-schema.js";
import { PAGE_SIZE_LETTER, rgbHexToColor } from "document-schema.js";
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
import { PALETTE_ENTRY_COUNT } from "./biff/xf-colors";
import {} from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { assertNeverContentCellValueKind } from "./content";
import {} from "./container";
import {
  buildCellXfPlan,
  buildFontPlan,
  buildFormatPlan,
  buildPalettePlan,
  buildSstPlan,
  buildWorkbookStream,
  builtinCode,
} from "./write";
import { writeSheetConditionalFormats } from "./workbook/conditional-format-write";
import {} from "./workbook/data-validation-write";
import { buildWorksheetSubstream } from "./workbook/sheet-writer";
import * as drawingWriterModule from "./workbook/drawing-writer";
import { GENERAL_CELL_XF_INDEX } from "./workbook/globals-writer";

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

function document(sheets: readonly ContentSheet[]): XlsContentDocument {
  return { kind: "spreadsheet", metadata: {}, sheets: [...sheets] };
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

describe("builtinCode", () => {
  it("returns the real BUILTIN_NUMBER_FORMATS string for a genuine built-in id", () => {
    expect(builtinCode(0)).toBe("General");
  });

  it("throws for an id BUILTIN_NUMBER_FORMATS has no entry for", () => {
    expect(() => builtinCode(-1)).toThrow(
      "internal error: BUILTIN_NUMBER_FORMATS has no entry for id -1",
    );
  });
});

describe("buildFormatPlan", () => {
  function planFor(cells: readonly ContentSheetCell[]) {
    return buildFormatPlan([sheet("S", cells)]);
  }

  it("reuses one customFormats entry for two cells sharing an identical custom format code", () => {
    const plan = planFor([
      cell(0, 0, { kind: "number", value: 1 }, { numberFormatCode: "0.0000" }),
      cell(0, 1, { kind: "number", value: 2 }, { numberFormatCode: "0.0000" }),
    ]);
    expect(plan.customFormats).toHaveLength(1);
  });

  it("mints sequential custom format ids starting at FIRST_CUSTOM_FORMAT_ID (164)", () => {
    const plan = planFor([
      cell(
        0,
        0,
        { kind: "number", value: 1 },
        { numberFormatCode: "CUSTOM_A" },
      ),
      cell(
        0,
        1,
        { kind: "number", value: 2 },
        { numberFormatCode: "CUSTOM_B" },
      ),
    ]);
    expect(plan.customFormats.map((format) => format.id)).toStrictEqual([
      164, 165,
    ]);
  });

  it("throws once a workbook needs more than [MS-XLS] 2.4.126's own 164-382 custom-identifier range allows", () => {
    // 220 distinct custom codes: the range holds exactly 219 (164 through 382 inclusive), so the 220th distinct code is the one that overflows it.
    const cells = Array.from({ length: 220 }, (_, index) =>
      cell(
        0,
        index,
        { kind: "number", value: index },
        {
          numberFormatCode: `CUSTOM_${index}`,
        },
      ),
    );
    expect(() => planFor(cells)).toThrow(
      "workbook needs more than 219 distinct custom number formats, more than [MS-XLS] 2.4.126's own 164-382 custom-identifier range allows",
    );
  });

  it("accepts exactly 219 distinct custom codes, filling the 164-382 range without overflowing it", () => {
    const cells = Array.from({ length: 219 }, (_, index) =>
      cell(
        0,
        index,
        { kind: "number", value: index },
        {
          numberFormatCode: `CUSTOM_${index}`,
        },
      ),
    );
    const plan = planFor(cells);
    expect(plan.customFormats).toHaveLength(219);
    expect(plan.customFormats.at(-1)?.id).toBe(382);
  });

  it("never registers the number-format code of a cell writesCellRecord would drop, so an unused custom format is never minted for it", () => {
    // An empty, unformatted, formula-free cell writes no record at all (written-cells.ts's own writesCellRecord), so a numberFormatCode stated on it alone must never mint a customFormats entry no written cell record could ever reference.
    const droppedCell = cell(
      0,
      0,
      { kind: "empty" },
      { numberFormatCode: "NEVER_WRITTEN" },
    );
    expect(planFor([droppedCell]).customFormats).toStrictEqual([]);
  });

  it("refuses to look up a format code the workbook-wide scan never registered", () => {
    const plan = planFor([cell(0, 0, { kind: "number", value: 1 })]);
    expect(() => plan.formatIdOf("never scanned")).toThrow(
      'internal error: number-format code "never scanned" was not registered during the workbook-wide format scan',
    );
  });
});

describe("buildPalettePlan", () => {
  it("refuses to resolve any colour at all when the workbook's cells use none", () => {
    const plan = buildPalettePlan([
      sheet("S", [cell(0, 0, { kind: "number", value: 1 })]),
    ]);
    expect(() => plan.icvOf(rgbHexToColor("ff0000"))).toThrow(
      "internal error: colour ff0000 was not registered during the workbook-wide palette scan",
    );
  });

  it("needs no Palette record when every distinct colour already matches the fixed default table", () => {
    const black = rgbHexToColor("000000"); // DEFAULT_PALETTE_TABLE's own entry 0
    const plan = buildPalettePlan([
      sheet("S", [
        cell(
          0,
          0,
          { kind: "number", value: 1 },
          {
            background: { kind: "solid", color: black },
          },
        ),
      ]),
    ]);
    expect(plan.paletteColors).toBeUndefined();
    expect(() => plan.icvOf(black)).not.toThrow();
  });

  it("builds a real Palette record once at least one colour is not in the fixed default table, including every distinct colour the workbook uses, not just the non-default one", () => {
    const black = rgbHexToColor("000000"); // already in the default table
    const custom = rgbHexToColor("123456"); // not in the default table
    const plan = buildPalettePlan([
      sheet("S", [
        cell(
          0,
          0,
          { kind: "number", value: 1 },
          {
            background: { kind: "solid", color: black },
          },
        ),
        cell(
          0,
          1,
          { kind: "number", value: 2 },
          {
            background: { kind: "solid", color: custom },
          },
        ),
      ]),
    ]);
    expect(plan.paletteColors).toHaveLength(PALETTE_ENTRY_COUNT);
    expect(() => plan.icvOf(black)).not.toThrow();
    expect(() => plan.icvOf(custom)).not.toThrow();
  });

  it("refuses a workbook needing more distinct decoration colours than a Palette record can hold, naming the exact count and ceiling", () => {
    const cells = Array.from({ length: PALETTE_ENTRY_COUNT + 1 }, (_, index) =>
      cell(
        0,
        index,
        { kind: "number", value: index },
        {
          background: {
            kind: "solid",
            color: rgbHexToColor(index.toString(16).padStart(6, "0")),
          },
        },
      ),
    );
    expect(() => buildPalettePlan([sheet("S", cells)])).toThrow(
      `workbook needs ${PALETTE_ENTRY_COUNT + 1} distinct decoration colours, more than the ${PALETTE_ENTRY_COUNT} entries [MS-XLS] 2.4.188's own Palette record can hold`,
    );
  });
});

describe("buildFontPlan", () => {
  it("resolves a cell stating no font at all to font-table index 0, minting no second entry for it", () => {
    const plan = buildFontPlan(
      [sheet("S", [cell(0, 0, { kind: "number", value: 1 })])],
      buildPalettePlan([]),
    );
    expect(plan.fontEntries).toHaveLength(1);
    expect(
      plan.fontIndexForCell(cell(0, 0, { kind: "number", value: 1 })),
    ).toBe(0);
  });

  it("refuses to resolve a cell whose own font the workbook-wide font scan never saw", () => {
    const plan = buildFontPlan(
      [sheet("S", [cell(0, 0, { kind: "number", value: 1 })])],
      buildPalettePlan([]),
    );
    const neverScanned = cell(
      0,
      0,
      { kind: "number", value: 1 },
      {
        font: { bold: true },
      },
    );
    expect(() => plan.fontIndexForCell(neverScanned)).toThrow(
      /resolves to a font the workbook-wide font scan never saw/,
    );
  });

  it("mints two distinct font entries for fonts differing only in colour, not just name/size/weight/style", () => {
    const sheets = [
      sheet("S", [
        cell(
          0,
          0,
          { kind: "number", value: 1 },
          {
            font: { color: rgbHexToColor("ff0000") },
          },
        ),
        cell(
          0,
          1,
          { kind: "number", value: 2 },
          {
            font: { color: rgbHexToColor("0000ff") },
          },
        ),
      ]),
    ];
    const plan = buildFontPlan(sheets, buildPalettePlan(sheets));
    // Entry 0 is Normal; the two colours must each mint their own entry rather than collapsing onto one.
    expect(plan.fontEntries).toHaveLength(3);
  });
});

describe("buildCellXfPlan", () => {
  function planFor(cells: readonly ContentSheetCell[]) {
    const sheets = [sheet("S", cells)];
    const formatPlan = buildFormatPlan(sheets);
    const palettePlan = buildPalettePlan(sheets);
    const fontPlan = buildFontPlan(sheets, palettePlan);
    return buildCellXfPlan(sheets, formatPlan, palettePlan, fontPlan);
  }

  it("resolves a plain, undecorated cell to the implicit General cell XF, minting no entry for it", () => {
    const plan = planFor([cell(0, 0, { kind: "number", value: 1 })]);
    expect(plan.cellXfEntries).toStrictEqual([]);
    expect(plan.xfIndexForCell(cell(0, 0, { kind: "number", value: 1 }))).toBe(
      GENERAL_CELL_XF_INDEX,
    );
  });

  it("reuses one cell-XF entry for two cells sharing an identical format/font/alignment/decoration combination", () => {
    const decorated = (row: number) =>
      cell(
        row,
        0,
        { kind: "number", value: 1 },
        {
          alignment: "center",
          background: { kind: "solid", color: rgbHexToColor("ff0000") },
        },
      );
    const plan = planFor([decorated(0), decorated(1)]);
    expect(plan.cellXfEntries).toHaveLength(1);
  });

  it("gives two cells differing only in alignment two distinct cell-XF entries, not one shared entry", () => {
    const centered = cell(
      0,
      0,
      { kind: "number", value: 1 },
      {
        alignment: "center",
      },
    );
    const rightAligned = cell(
      0,
      1,
      { kind: "number", value: 1 },
      {
        alignment: "right",
      },
    );
    const plan = planFor([centered, rightAligned]);
    expect(plan.cellXfEntries).toHaveLength(2);
  });

  it("gives each of the four border sides its own distinct cell-XF entry, against an otherwise-identical undecorated baseline", () => {
    // Every cell here shares the identical background, so the only thing that could tell two of their cell-Xf signatures apart is which single border side (if any) each one states — proving each side's own segment of the signature genuinely carries the side's identity, not just its style/colour.
    const backgroundOnly = {
      kind: "solid",
      color: rgbHexToColor("00ff00"),
    } as const;
    const borderEdge = { color: rgbHexToColor("ff0000"), widthPt: 0.75 };
    const withBorder = (
      column: number,
      side: "left" | "right" | "top" | "bottom",
    ) =>
      cell(
        0,
        column,
        { kind: "number", value: 1 },
        {
          background: backgroundOnly,
          borders: { [side]: borderEdge },
        },
      );
    const baseline = cell(
      0,
      0,
      { kind: "number", value: 1 },
      {
        background: backgroundOnly,
      },
    );
    const plan = planFor([
      baseline,
      withBorder(1, "left"),
      withBorder(2, "right"),
      withBorder(3, "top"),
      withBorder(4, "bottom"),
    ]);
    expect(plan.cellXfEntries).toHaveLength(5);
  });

  it("refuses a cell fill of a kind ContentCellFillSchema's own discriminated union does not define", () => {
    const bogusFill = {
      kind: "bogus",
    } as unknown as ContentSheetCell["background"];
    expect(() =>
      planFor([
        cell(0, 0, { kind: "number", value: 1 }, { background: bogusFill }),
      ]),
    ).toThrow(
      "xls-codec cannot write a cell fill with kind 'bogus': ContentCellFillSchema's discriminated union only defines 'solid' and 'pattern'",
    );
  });

  it("mints a real decoration for a cell that carries formatting, rather than treating every cell as undecorated", () => {
    const decorated = cell(
      0,
      0,
      { kind: "number", value: 1 },
      {
        background: { kind: "solid", color: rgbHexToColor("ff0000") },
      },
    );
    const plan = planFor([decorated]);
    expect(plan.cellXfEntries).toHaveLength(1);
    expect(plan.cellXfEntries[0]?.decoration).not.toBeUndefined();
  });

  it("refuses to resolve a cell whose own cell-Xf signature the workbook-wide scan never saw", () => {
    const plan = planFor([cell(0, 0, { kind: "number", value: 1 })]);
    const neverScanned = cell(
      0,
      0,
      { kind: "number", value: 1 },
      {
        alignment: "center",
      },
    );
    expect(() => plan.xfIndexForCell(neverScanned)).toThrow(
      /which the workbook-wide cell-format scan never saw/,
    );
  });
});

describe("buildSstPlan", () => {
  it("is empty for a workbook with no string-kind cells at all", () => {
    const plan = buildSstPlan([
      sheet("S", [cell(0, 0, { kind: "number", value: 1 })]),
    ]);
    expect(plan.strings).toStrictEqual([]);
    expect(plan.totalCount).toBe(0);
  });

  it("counts every string-kind cell towards totalCount, even repeats of the identical value that share one strings-table slot", () => {
    const plan = buildSstPlan([
      sheet("S", [
        cell(0, 0, { kind: "string", value: "Repeat" }),
        cell(0, 1, { kind: "string", value: "Repeat" }),
      ]),
    ]);
    expect(plan.strings).toStrictEqual(["Repeat"]);
    expect(plan.totalCount).toBe(2);
  });

  it("refuses to look up a string the workbook-wide shared-string scan never registered", () => {
    const plan = buildSstPlan([
      sheet("S", [cell(0, 0, { kind: "string", value: "Known" })]),
    ]);
    expect(() => plan.indexOf("Unknown")).toThrow(
      'internal error: string "Unknown" was not registered during the workbook-wide shared-string scan',
    );
  });
});

describe("buildWorkbookStream", () => {
  it("refuses a document with no sheets at all", () => {
    expect(() => buildWorkbookStream(document([]))).toThrow(
      "a .xls workbook must contain at least one sheet ([MS-XLS] 2.1.7.20.3's own BUNDLESHEET production requires 1*BoundSheet8), but the document being written has none",
    );
  });

  it("refuses a workbook whose own drawing plan produced fewer sheet-drawing entries than the document has sheets", () => {
    // buildDrawingWritePlan's own contract guarantees one sheetDrawings entry per sheet, so this can only be reached by a genuine disagreement between the two — proven here by making the real function lie about it, rather than by a document this writer could ever produce on its own.
    const spy = vi
      .spyOn(drawingWriterModule, "buildDrawingWritePlan")
      .mockReturnValue({
        drawingGroupBytes: undefined,
        sheetDrawings: [],
        embeddingStreams: [],
      });
    try {
      expect(() =>
        buildWorkbookStream(
          document([sheet("S", [cell(0, 0, { kind: "number", value: 1 })])]),
        ),
      ).toThrow(
        "internal error: sheet 0 has no drawing plan entry — buildDrawingWritePlan produced fewer entries than there are sheets",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
