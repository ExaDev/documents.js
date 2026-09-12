import { describe, expect, it } from "vitest";

import type { ContentSheetCell } from "document-schema.js";
import type { FormulaSheetContext } from "../biff/ptg";
import {
  RECORD_AI,
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

/** A PtgArea3d token targeting `ixti`'s sheet: opcode 0x3b, ixti, rowFirst, rowLast, colFirst, colLast. */
function area3dToken(
  ixti: number,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
): number[] {
  return [
    0x3b,
    ...u16(ixti),
    ...u16(startRow),
    ...u16(endRow),
    ...u16(startColumn),
    ...u16(endColumn),
  ];
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

/** An AI record wrapping a literal-text formula (rt=1, a PtgStr token: opcode 0x17 + ShortXLUnicodeString). */
function aiLiteralTextRecord(
  id: number,
  text: string,
): Uint8Array<ArrayBuffer> {
  const token = [0x17, ...shortXlUnicodeString(text)];
  return record(RECORD_AI, [
    id,
    0x01,
    ...u16(0),
    ...u16(0),
    ...u16(token.length),
    ...token,
  ]);
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
});
