import { describe, expect, it } from "vitest";

import type { ContentSheetCell } from "document-schema.js";
import type { FormulaSheetContext } from "../biff/ptg";
import {
  RECORD_AI,
  RECORD_BLANK,
  RECORD_BOOLERR,
  RECORD_LABEL,
  RECORD_NUMBER,
  RECORD_SERIES,
  RECORD_SERIESTEXT,
  RECORD_SIINDEX,
} from "../biff/record-types";
import { groupRecords } from "../biff/substreams";
import {
  f64,
  record,
  shortXlUnicodeString,
  u16,
  xlUnicodeString,
} from "../test-support/biff";
import { readChartSeries, type ChartRangeContext } from "./chart";

const SHEET0_CONTEXT: FormulaSheetContext = {
  sheets: [{ name: "Sheet1" }, { name: "Sheet2" }],
  sheetRanges: [
    { firstSheetIndex: 0, lastSheetIndex: 0 }, // ixti 0 -> Sheet1 (the chart's own owning sheet)
    { firstSheetIndex: 1, lastSheetIndex: 1 }, // ixti 1 -> Sheet2 (a different sheet)
  ],
};

/** A Series record ([MS-OGRAPH] "Series"): sdtX, sdtY (both ignored), category count, value count, sdtBSize, cValBSize (both ignored/unmodelled). */
function seriesRecord(
  categoryCount: number,
  valueCount: number,
): Uint8Array<ArrayBuffer> {
  return record(RECORD_SERIES, [
    ...u16(1),
    ...u16(1),
    ...u16(categoryCount),
    ...u16(valueCount),
    ...u16(1),
    ...u16(0),
  ]);
}

/** A PtgArea3d token targeting `ixti`'s sheet: opcode (0x3b by default; pass 0x5b/0x7b for the reference/value class variants), ixti, rowFirst, rowLast, colFirst, colLast. */
function area3dToken(
  ixti: number,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
  opcode = 0x3b,
): number[] {
  return [
    opcode,
    ...u16(ixti),
    ...u16(startRow),
    ...u16(endRow),
    ...u16(startColumn),
    ...u16(endColumn),
  ];
}

/** A PtgRef3d token targeting `ixti`'s sheet: opcode (0x3a by default; pass 0x5a/0x7a for the class variants), ixti, row, column. */
function ref3dToken(
  ixti: number,
  row: number,
  column: number,
  opcode = 0x3a,
): number[] {
  return [opcode, ...u16(ixti), ...u16(row), ...u16(column)];
}

/** Wraps a token in a PtgParen display wrapper (opcode 0x15), which carries no bytes of its own beyond the opcode. */
function parenWrapped(tokenBytes: readonly number[]): number[] {
  return [0x15, ...tokenBytes];
}

/** An AI (BRAI) record wrapping a range-reference formula: id, rt=2 (range), flags word, ifmt word, cce, rgce. */
function aiRangeRecord(
  id: number,
  tokenBytes: readonly number[],
): Uint8Array<ArrayBuffer> {
  return record(RECORD_AI, [
    id,
    0x02,
    ...u16(0),
    ...u16(0),
    ...u16(tokenBytes.length),
    ...tokenBytes,
  ]);
}

/** An AI record with no formula at all (rt=0, auto-generated) -- used for the AI ids this test doesn't care about resolving. */
function aiAutoRecord(id: number): Uint8Array<ArrayBuffer> {
  return record(RECORD_AI, [id, 0x00, ...u16(0), ...u16(0), ...u16(0)]);
}

/** The general AI (BRAI) record builder every other aiXRecord helper specialises: id, an explicit rt (rather than always rt=2), and arbitrary token bytes -- for a test proving the reader dispatches on rt itself, not merely on which bytes a particular rt conventionally carries. */
function aiRecord(
  id: number,
  rt: number,
  tokenBytes: readonly number[],
): Uint8Array<ArrayBuffer> {
  return record(RECORD_AI, [
    id,
    rt,
    ...u16(0),
    ...u16(0),
    ...u16(tokenBytes.length),
    ...tokenBytes,
  ]);
}

/** An AI record wrapping a literal-text formula (rt=1, a PtgStr token: opcode 0x17 + ShortXLUnicodeString). */
function aiLiteralTextRecord(
  id: number,
  text: string,
): Uint8Array<ArrayBuffer> {
  return aiRecord(id, 0x01, [0x17, ...shortXlUnicodeString(text)]);
}

/** An AI record wrapping a literal PtgInt token (opcode 0x1e, a plain u16). */
function aiLiteralIntRecord(
  id: number,
  value: number,
): Uint8Array<ArrayBuffer> {
  return aiRecord(id, 0x01, [0x1e, ...u16(value)]);
}

/** An AI record wrapping a literal PtgNum token (opcode 0x1f, an f64). */
function aiLiteralNumRecord(
  id: number,
  value: number,
): Uint8Array<ArrayBuffer> {
  return aiRecord(id, 0x01, [0x1f, ...f64(value)]);
}

function seriesTextRecord(text: string): Uint8Array<ArrayBuffer> {
  return record(RECORD_SERIESTEXT, [...u16(0), ...shortXlUnicodeString(text)]);
}

function siIndexRecord(numIndex: number): Uint8Array<ArrayBuffer> {
  return record(RECORD_SIINDEX, u16(numIndex));
}

function cachedNumber(
  point: number,
  series: number,
  value: number,
): Uint8Array<ArrayBuffer> {
  return record(RECORD_NUMBER, [
    ...u16(point),
    ...u16(series),
    ...u16(0),
    ...f64(value),
  ]);
}

function cachedLabel(
  point: number,
  series: number,
  text: string,
): Uint8Array<ArrayBuffer> {
  return record(RECORD_LABEL, [
    ...u16(point),
    ...u16(series),
    ...u16(0),
    ...xlUnicodeString(text),
  ]);
}

/** A cached BoolErr record: point, series, xf(2, ignored), a value byte, an fError byte -- errorTextOf(value) when fError is set, else "TRUE"/"FALSE" from whether value is nonzero. */
function cachedBoolErr(
  point: number,
  series: number,
  value: number,
  isError: boolean,
): Uint8Array<ArrayBuffer> {
  return record(RECORD_BOOLERR, [
    ...u16(point),
    ...u16(series),
    ...u16(0),
    value,
    isError ? 1 : 0,
  ]);
}

/** A cached Blank record: point, series, xf(2, ignored) -- no value fields at all, deliberately not one of addCacheEntry's own recognised record types (RECORD_NUMBER/RECORD_LABEL/RECORD_BOOLERR), so it contributes nothing to the cache. */
function cachedBlank(point: number, series: number): Uint8Array<ArrayBuffer> {
  return record(RECORD_BLANK, [...u16(point), ...u16(series), ...u16(0)]);
}

function contextWithCells(
  cells: readonly ContentSheetCell[],
): ChartRangeContext {
  return {
    formulaSheets: SHEET0_CONTEXT,
    ownSheetIndex: 0,
    ownSheetCells: cells,
  };
}

/** Reads a chart substream's own record() bytes through the real framing/grouping passes, so a test's fixture states real record bytes rather than pre-grouped internals. */
function chartRecords(rawRecords: readonly Uint8Array<ArrayBuffer>[]) {
  return groupRecords(
    rawRecords.map((data) => ({
      type: new DataView(data.buffer).getUint16(0, true),
      data: data.slice(4),
      offset: 0,
    })),
  );
}

const AI_ID_NAME = 0;
const AI_ID_VALUES = 1;
const AI_ID_CATEGORIES = 2;

describe("readChartSeries", () => {
  it("resolves categories/values from the chart's own owning sheet, with a cached series name", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "Jan" },
        displayText: "Jan",
      },
      {
        row: 1,
        column: 0,
        value: { kind: "string", value: "Feb" },
        displayText: "Feb",
      },
      {
        row: 0,
        column: 1,
        value: { kind: "number", value: 10 },
        displayText: "10",
      },
      {
        row: 1,
        column: 1,
        value: { kind: "number", value: 20 },
        displayText: "20",
      },
    ];
    const groups = chartRecords([
      seriesRecord(2, 2),
      aiAutoRecord(AI_ID_NAME),
      seriesTextRecord("Revenue"),
      aiRangeRecord(AI_ID_CATEGORIES, area3dToken(0, 0, 1, 0, 0)),
      aiRangeRecord(AI_ID_VALUES, area3dToken(0, 0, 1, 1, 1)),
      aiAutoRecord(3),
    ]);

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series).toStrictEqual([
      { name: "Revenue", categories: ["Jan", "Feb"], values: ["10", "20"] },
    ]);
  });

  it("falls back to the on-disk cache for a cross-sheet reference", () => {
    const groups = chartRecords([
      seriesRecord(1, 1),
      aiAutoRecord(AI_ID_NAME),
      aiRangeRecord(AI_ID_CATEGORIES, area3dToken(1, 0, 0, 0, 0)), // ixti 1 -> Sheet2, not the owning sheet
      aiRangeRecord(AI_ID_VALUES, area3dToken(1, 0, 0, 1, 1)),
      siIndexRecord(0x0002), // categories
      cachedLabel(0, 0, "Q1"),
      siIndexRecord(0x0001), // values
      cachedNumber(0, 0, 42),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series).toStrictEqual([
      { name: undefined, categories: ["Q1"], values: ["42"] },
    ]);
  });

  it("resolves a literal AI name (PtgStr) when no SeriesText follows", () => {
    const groups = chartRecords([
      seriesRecord(0, 0),
      aiLiteralTextRecord(AI_ID_NAME, "Literal Name"),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.name).toBe("Literal Name");
  });

  it("returns an empty string for a point with no cache entry and no resolvable range", () => {
    const groups = chartRecords([
      seriesRecord(1, 1),
      aiAutoRecord(AI_ID_CATEGORIES),
      aiAutoRecord(AI_ID_VALUES),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series).toStrictEqual([
      { name: undefined, categories: [""], values: [""] },
    ]);
  });

  it("returns no series for a chart substream with no Series records", () => {
    expect(readChartSeries([], contextWithCells([]))).toStrictEqual([]);
  });

  it("ignores a SeriesText cache unless it follows an AI naming the series itself, not values/categories", () => {
    const groups = chartRecords([
      seriesRecord(0, 0),
      aiAutoRecord(AI_ID_VALUES),
      seriesTextRecord("Should Not Apply"),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.name).toBeUndefined();
  });

  it("resolves a range-reference AI name (id=0, rt=range) from the referenced cell's own display text", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "Header" },
        displayText: "Header",
      },
    ];
    const groups = chartRecords([
      seriesRecord(0, 0),
      aiRangeRecord(AI_ID_NAME, area3dToken(0, 0, 0, 0, 0)),
    ]);

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series[0]?.name).toBe("Header");
  });

  it("never interprets an auto-generated (rt=0) AI name's own bytes as a range reference either, even when they happen to share a range opcode's own byte shape", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "WRONG" },
        displayText: "WRONG",
      },
    ];
    const groups = chartRecords([
      seriesRecord(0, 0),
      aiRecord(AI_ID_NAME, 0x00, area3dToken(0, 0, 0, 0, 0)),
    ]);

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series[0]?.name).toBeUndefined();
  });

  it("never interprets a literal AI's own token bytes as a range reference, even when they happen to share a range opcode's own byte shape", () => {
    const groups = chartRecords([
      seriesRecord(0, 1),
      aiRecord(AI_ID_VALUES, 0x01, area3dToken(0, 0, 0, 0, 0)),
    ]);
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "number", value: 5 },
        displayText: "5",
      },
    ];

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series[0]?.values).toStrictEqual([""]);
  });

  it("ignores a range-reference AI whose id is neither values nor categories (e.g. bubble size), leaving both untouched", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "number", value: 9 },
        displayText: "9",
      },
    ];
    const groups = chartRecords([
      seriesRecord(1, 1),
      aiRangeRecord(3, area3dToken(0, 0, 0, 0, 0)),
    ]);

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series[0]?.categories).toStrictEqual([""]);
    expect(series[0]?.values).toStrictEqual([""]);
  });

  it("ignores an SIIndex naming neither values nor categories (e.g. bubble size), so records following it never enter the cache", () => {
    const groups = chartRecords([
      seriesRecord(1, 1),
      aiAutoRecord(AI_ID_CATEGORIES),
      siIndexRecord(0x0003), // neither values (1) nor categories (2)
      cachedNumber(0, 0, 99),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.categories).toStrictEqual([""]);
  });

  it("caches a BoolErr's own error text when fError is set", () => {
    const groups = chartRecords([
      seriesRecord(1, 0),
      aiAutoRecord(AI_ID_CATEGORIES),
      siIndexRecord(0x0002),
      cachedBoolErr(0, 0, 0x07, true),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.categories).toStrictEqual(["#DIV/0!"]);
  });

  it("caches a BoolErr's own TRUE/FALSE spelling when fError is clear, distinguishing a genuinely nonzero value from zero", () => {
    const trueGroups = chartRecords([
      seriesRecord(1, 0),
      aiAutoRecord(AI_ID_CATEGORIES),
      siIndexRecord(0x0002),
      cachedBoolErr(0, 0, 1, false),
    ]);
    const falseGroups = chartRecords([
      seriesRecord(1, 0),
      aiAutoRecord(AI_ID_CATEGORIES),
      siIndexRecord(0x0002),
      cachedBoolErr(0, 0, 0, false),
    ]);

    expect(
      readChartSeries(trueGroups, contextWithCells([]))[0]?.categories,
    ).toStrictEqual(["TRUE"]);
    expect(
      readChartSeries(falseGroups, contextWithCells([]))[0]?.categories,
    ).toStrictEqual(["FALSE"]);
  });

  it("adds nothing to the cache for a cached Blank record, an explicit 'no value at this point' rather than a value", () => {
    const groups = chartRecords([
      seriesRecord(1, 0),
      aiAutoRecord(AI_ID_CATEGORIES),
      siIndexRecord(0x0002),
      cachedBlank(0, 0),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.categories).toStrictEqual([""]);
  });

  it("walks a single-row range across its own columns, not down to a second row", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 2,
        column: 0,
        value: { kind: "string", value: "Q1" },
        displayText: "Q1",
      },
      {
        row: 2,
        column: 1,
        value: { kind: "string", value: "Q2" },
        displayText: "Q2",
      },
    ];
    const groups = chartRecords([
      seriesRecord(2, 0),
      aiRangeRecord(AI_ID_CATEGORIES, area3dToken(0, 2, 2, 0, 1)),
    ]);

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series[0]?.categories).toStrictEqual(["Q1", "Q2"]);
  });

  it("walks a genuine rectangular range row-major -- across every column of one row before moving to the next", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "a" },
        displayText: "a",
      },
      {
        row: 0,
        column: 1,
        value: { kind: "string", value: "b" },
        displayText: "b",
      },
      {
        row: 1,
        column: 0,
        value: { kind: "string", value: "c" },
        displayText: "c",
      },
      {
        row: 1,
        column: 1,
        value: { kind: "string", value: "d" },
        displayText: "d",
      },
    ];
    const groups = chartRecords([
      seriesRecord(4, 0),
      aiRangeRecord(AI_ID_CATEGORIES, area3dToken(0, 0, 1, 0, 1)),
    ]);

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series[0]?.categories).toStrictEqual(["a", "b", "c", "d"]);
  });

  it("resolves nothing for an AI carrying an empty formula, rather than reading a literal token past the end of it", () => {
    const groups = chartRecords([
      seriesRecord(0, 0),
      aiRecord(AI_ID_NAME, 0x01, []),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.name).toBeUndefined();
  });

  it("unwraps a PtgParen display wrapper around a literal token before reading it", () => {
    const groups = chartRecords([
      seriesRecord(0, 0),
      aiRecord(
        AI_ID_NAME,
        0x01,
        parenWrapped([0x17, ...shortXlUnicodeString("Wrapped")]),
      ),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.name).toBe("Wrapped");
  });

  it("resolves a literal PtgInt AI name", () => {
    const groups = chartRecords([
      seriesRecord(0, 0),
      aiLiteralIntRecord(AI_ID_NAME, 42),
    ]);

    expect(readChartSeries(groups, contextWithCells([]))[0]?.name).toBe("42");
  });

  it("resolves a literal PtgNum AI name", () => {
    const groups = chartRecords([
      seriesRecord(0, 0),
      aiLiteralNumRecord(AI_ID_NAME, 3.5),
    ]);

    expect(readChartSeries(groups, contextWithCells([]))[0]?.name).toBe("3.5");
  });

  it("resolves nothing for an AI naming a range with an empty formula, rather than reading a range token past the end of it", () => {
    const groups = chartRecords([
      seriesRecord(1, 0),
      aiRangeRecord(AI_ID_CATEGORIES, []),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.categories).toStrictEqual([""]);
  });

  it("unwraps a PtgParen display wrapper around a range token before reading it", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
      },
    ];
    const groups = chartRecords([
      seriesRecord(1, 0),
      aiRangeRecord(AI_ID_CATEGORIES, parenWrapped(area3dToken(0, 0, 0, 0, 0))),
    ]);

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series[0]?.categories).toStrictEqual(["x"]);
  });

  it("resolves each of PtgRef3d's own three class-variant opcodes (reference/value/array) identically", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
      },
    ];
    for (const opcode of [0x3a, 0x5a, 0x7a]) {
      const groups = chartRecords([
        seriesRecord(1, 0),
        aiRangeRecord(AI_ID_CATEGORIES, ref3dToken(0, 0, 0, opcode)),
      ]);

      const series = readChartSeries(groups, contextWithCells(cells));

      expect(series[0]?.categories).toStrictEqual(["x"]);
    }
  });

  it("resolves each of PtgArea3d's own three class-variant opcodes (reference/value/array) identically", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
      },
    ];
    for (const opcode of [0x3b, 0x5b, 0x7b]) {
      const groups = chartRecords([
        seriesRecord(1, 0),
        aiRangeRecord(AI_ID_CATEGORIES, area3dToken(0, 0, 0, 0, 0, opcode)),
      ]);

      const series = readChartSeries(groups, contextWithCells(cells));

      expect(series[0]?.categories).toStrictEqual(["x"]);
    }
  });

  it("orders a PtgArea3d's own reversed row/column pair into ascending start/end, regardless of which corner the file states first", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
      },
      {
        row: 0,
        column: 1,
        value: { kind: "string", value: "y" },
        displayText: "y",
      },
    ];
    const groups = chartRecords([
      seriesRecord(2, 0),
      // colFirst=1, colLast=0 -- reversed, so startColumn must come from Math.min and endColumn from Math.max, not the other way round.
      aiRangeRecord(AI_ID_CATEGORIES, area3dToken(0, 0, 0, 1, 0)),
    ]);

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series[0]?.categories).toStrictEqual(["x", "y"]);
  });

  it("never resolves a range through the owning sheet's own cells when the reference points to a different sheet, even with no cache entry to fall back to", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "WRONG" },
        displayText: "WRONG",
      },
    ];
    const groups = chartRecords([
      seriesRecord(1, 0),
      aiRangeRecord(AI_ID_CATEGORIES, area3dToken(1, 0, 0, 0, 0)), // ixti 1 -> Sheet2, not the owning sheet
    ]);

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series[0]?.categories).toStrictEqual([""]);
  });

  it("never treats a genuinely multi-sheet 3D reference as the owning sheet, even when the owning sheet falls within its span", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "WRONG" },
        displayText: "WRONG",
      },
    ];
    const multiSheetContext: ChartRangeContext = {
      formulaSheets: {
        sheets: SHEET0_CONTEXT.sheets,
        sheetRanges: [{ firstSheetIndex: 0, lastSheetIndex: 1 }], // Sheet1:Sheet2 -- spans the owning sheet (0) but is not single-sheet
      },
      ownSheetIndex: 0,
      ownSheetCells: cells,
    };
    const groups = chartRecords([
      seriesRecord(1, 0),
      aiRangeRecord(AI_ID_CATEGORIES, area3dToken(0, 0, 0, 0, 0)),
    ]);

    const series = readChartSeries(groups, multiSheetContext);

    expect(series[0]?.categories).toStrictEqual([""]);
  });

  it("treats an ixti with no resolvable sheet range at all (out of bounds) as not the owning sheet", () => {
    const groups = chartRecords([
      seriesRecord(1, 0),
      aiRangeRecord(AI_ID_CATEGORIES, area3dToken(99, 0, 0, 0, 0)),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.categories).toStrictEqual([""]);
  });

  it("resolves the empty string for an own-sheet range point naming a cell the sheet's own cell list doesn't carry", () => {
    const groups = chartRecords([
      seriesRecord(1, 0),
      aiRangeRecord(AI_ID_CATEGORIES, area3dToken(0, 5, 5, 5, 5)),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.categories).toStrictEqual([""]);
  });

  it("never resolves a single-cell (PtgRef3d) reference through the owning sheet's own cells when it points to a different sheet", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "WRONG" },
        displayText: "WRONG",
      },
    ];
    const groups = chartRecords([
      seriesRecord(1, 0),
      aiRangeRecord(AI_ID_CATEGORIES, ref3dToken(1, 0, 0)), // ixti 1 -> Sheet2, not the owning sheet
    ]);

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series[0]?.categories).toStrictEqual([""]);
  });

  it("resolves nothing for a range-reference AI carrying an opcode that is neither the PtgRef3d nor the PtgArea3d family", () => {
    const groups = chartRecords([
      seriesRecord(1, 0),
      aiRangeRecord(AI_ID_CATEGORIES, [0x00, ...u16(0), ...u16(0), ...u16(0)]),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.categories).toStrictEqual([""]);
  });

  it("orders a PtgArea3d's own reversed row pair into ascending start/end, regardless of which comes first", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
      },
      {
        row: 1,
        column: 0,
        value: { kind: "string", value: "y" },
        displayText: "y",
      },
    ];
    const groups = chartRecords([
      seriesRecord(2, 0),
      // rowFirst=1, rowLast=0 -- reversed, so startRow must come from Math.min and endRow from Math.max, not the other way round.
      aiRangeRecord(AI_ID_CATEGORIES, area3dToken(0, 1, 0, 0, 0)),
    ]);

    const series = readChartSeries(groups, contextWithCells(cells));

    expect(series[0]?.categories).toStrictEqual(["x", "y"]);
  });

  it("keeps every earlier cached point when a later point arrives for the same role, rather than starting the role's own cache over each time", () => {
    const groups = chartRecords([
      seriesRecord(2, 0),
      aiAutoRecord(AI_ID_CATEGORIES),
      siIndexRecord(0x0002),
      cachedLabel(0, 0, "First"),
      cachedLabel(1, 0, "Second"),
    ]);

    const series = readChartSeries(groups, contextWithCells([]));

    expect(series[0]?.categories).toStrictEqual(["First", "Second"]);
  });

  it("treats a genuinely external workbook reference (a formatted sheet label, not a resolved range) as not the owning sheet", () => {
    const externalContext: ChartRangeContext = {
      formulaSheets: {
        sheets: SHEET0_CONTEXT.sheets,
        sheetRanges: [{ label: "[Other.xlsx]Sheet1", diagnostic: false }],
      },
      ownSheetIndex: 0,
      ownSheetCells: [
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "WRONG" },
          displayText: "WRONG",
        },
      ],
    };
    const groups = chartRecords([
      seriesRecord(1, 0),
      aiRangeRecord(AI_ID_CATEGORIES, area3dToken(0, 0, 0, 0, 0)),
    ]);

    const series = readChartSeries(groups, externalContext);

    expect(series[0]?.categories).toStrictEqual([""]);
  });
});
