import { describe, expect, it } from "vitest";
import type {} from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import {} from "../../xml/query";
import {
  assertNeverContentCellValueKind,
  canonicalColor,
  canonicalCellFill,
  canonicalRun,
  canonicalCellValue,
  canonicalCell,
  canonicalCells,
  canonicalColumns,
  canonicalRows,
  canonicalSheetImage,
  canonicalImages,
  canonicalPrintSettings,
  canonicalDataValidations,
  canonicalConditionalFormatStyle,
  canonicalConditionalFormats,
} from "./write-canonical";

// The write side's XML-shape suite: what writeOdsContent actually emits, construct by construct — the sibling suite (write-round-trip.test.ts) proves the output reads back as the document it came from; this one proves the output is the ODF a real consumer expects, which a round trip through this package's own reader cannot (a writer and reader that agreed on the same wrong spelling would round-trip perfectly and open nowhere). This mirrors typed/odt/write.test.ts's own stated split of responsibility.

const MARGINS = { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 };

// normaliseOdsContent applies every canonical* helper below identically to BOTH sides of a round-trip equality check (write.test.ts / write-round-trip.test.ts's own expectRoundTrip: normalise(actual) vs. normalise(expected)), so a mutation confined to one of these helpers changes both sides in lockstep and is invisible to that comparison. Each is pinned here directly instead, against a literal expected return value.
describe("canonical* helpers: direct unit coverage (see the note above on why)", () => {
  it("canonicalColor round-trips a colour through hex unchanged", () => {
    expect(canonicalColor({ r: 0.2, g: 0.4, b: 0.6 })).toStrictEqual({
      r: 0.2,
      g: 0.4,
      b: 0.6,
    });
  });

  it("canonicalCellFill: a solid fill's own colour", () => {
    expect(
      canonicalCellFill({ kind: "solid", color: { r: 1, g: 0, b: 0 } }),
    ).toStrictEqual({ kind: "solid", color: { r: 1, g: 0, b: 0 } });
  });

  it("canonicalCellFill: a pattern's foreground colour, when present", () => {
    expect(
      canonicalCellFill({
        kind: "pattern",
        patternType: "mediumGray",
        foregroundColor: { r: 1, g: 0, b: 0 },
        backgroundColor: { r: 0, g: 0, b: 1 },
      }),
    ).toStrictEqual({ kind: "solid", color: { r: 1, g: 0, b: 0 } });
  });

  it("canonicalCellFill: falls back to a pattern's background colour when foreground is absent", () => {
    expect(
      canonicalCellFill({
        kind: "pattern",
        patternType: "mediumGray",
        backgroundColor: { r: 0, g: 0, b: 1 },
      }),
    ).toStrictEqual({ kind: "solid", color: { r: 0, g: 0, b: 1 } });
  });

  it("canonicalCellFill: undefined when a pattern states neither colour", () => {
    expect(
      canonicalCellFill({ kind: "pattern", patternType: "mediumGray" }),
    ).toBeUndefined();
  });

  it("canonicalRun: keeps only the fields actually stated, one at a time", () => {
    expect(canonicalRun({ text: "a" })).toStrictEqual({ text: "a" });
    expect(canonicalRun({ text: "a", bold: true })).toStrictEqual({
      text: "a",
      bold: true,
    });
    expect(canonicalRun({ text: "a", italic: true })).toStrictEqual({
      text: "a",
      italic: true,
    });
    expect(canonicalRun({ text: "a", underline: true })).toStrictEqual({
      text: "a",
      underline: true,
    });
    expect(canonicalRun({ text: "a", strike: true })).toStrictEqual({
      text: "a",
      strike: true,
    });
    expect(canonicalRun({ text: "a", fontFamily: "Arial" })).toStrictEqual({
      text: "a",
      fontFamily: "Arial",
    });
    expect(canonicalRun({ text: "a", sizePt: 12 })).toStrictEqual({
      text: "a",
      sizePt: 12,
    });
    expect(
      canonicalRun({ text: "a", color: { r: 1, g: 0, b: 0 } }),
    ).toStrictEqual({
      text: "a",
      color: { r: 1, g: 0, b: 0 },
    });
    expect(
      canonicalRun({ text: "a", hyperlink: "https://example.com" }),
    ).toStrictEqual({ text: "a", hyperlink: "https://example.com" });
  });

  it("canonicalCellValue: every value kind", () => {
    expect(
      canonicalCellValue({ kind: "number", value: 1, exactValue: "1.0" }),
    ).toStrictEqual({ kind: "number", value: 1 });
    expect(
      canonicalCellValue({ kind: "percentage", value: 0.5 }),
    ).toStrictEqual({
      kind: "percentage",
      value: 0.5,
    });
    expect(canonicalCellValue({ kind: "currency", value: 9.99 })).toStrictEqual(
      {
        kind: "currency",
        value: 9.99,
      },
    );
    expect(
      canonicalCellValue({ kind: "currency", value: 9.99, currency: "GBP" }),
    ).toStrictEqual({ kind: "currency", value: 9.99, currency: "GBP" });
    expect(canonicalCellValue({ kind: "boolean", value: true })).toStrictEqual({
      kind: "boolean",
      value: true,
    });
    expect(canonicalCellValue({ kind: "boolean", value: false })).toStrictEqual(
      {
        kind: "boolean",
        value: false,
      },
    );
    expect(
      canonicalCellValue({ kind: "date", value: "2026-01-01" }),
    ).toStrictEqual({
      kind: "date",
      value: "2026-01-01",
    });
    expect(
      canonicalCellValue({ kind: "time", value: "01:02:03" }),
    ).toStrictEqual({
      kind: "time",
      value: "PT1H2M3S",
    });
    expect(canonicalCellValue({ kind: "string", value: "hi" })).toStrictEqual({
      kind: "string",
      value: "hi",
    });
    expect(canonicalCellValue({ kind: "empty" })).toStrictEqual({
      kind: "empty",
    });
  });

  it("canonicalCell: a value-less, formula-less, text-less, comment-less cell vanishes entirely", () => {
    expect(
      canonicalCell({
        row: 0,
        column: 0,
        value: { kind: "empty" },
        displayText: "",
      }),
    ).toBeUndefined();
  });

  it("canonicalCell: an otherwise-empty cell survives when it carries a comment", () => {
    const cell = canonicalCell({
      row: 0,
      column: 0,
      value: { kind: "empty" },
      displayText: "",
      comment: { text: "note" },
    });
    expect(cell).toBeDefined();
    expect(cell?.comment).toStrictEqual({ text: "note" });
  });

  it("canonicalCell: an otherwise-empty cell survives when it carries a formula", () => {
    const cell = canonicalCell({
      row: 0,
      column: 0,
      value: { kind: "empty" },
      displayText: "",
      formula: "=1+1",
    });
    expect(cell).toBeDefined();
    expect(cell?.formula).toBe("=1+1");
  });

  it("canonicalCell: carries every optional field through when present", () => {
    const cell = canonicalCell({
      row: 2,
      column: 3,
      value: { kind: "string", value: "x" },
      displayText: "x",
      formula: "=A1",
      colSpan: 2,
      rowSpan: 3,
      background: { kind: "solid", color: { r: 1, g: 1, b: 1 } },
      borders: {
        left: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "solid" },
      },
      alignment: "center",
      verticalAlignment: "middle",
      comment: { text: "hi" },
    });
    expect(cell).toStrictEqual({
      row: 2,
      column: 3,
      value: { kind: "string", value: "x" },
      displayText: "x",
      runs: [{ text: "x" }],
      formula: "=A1",
      colSpan: 2,
      rowSpan: 3,
      background: { kind: "solid", color: { r: 1, g: 1, b: 1 } },
      borders: {
        left: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "solid" },
      },
      alignment: "center",
      verticalAlignment: "middle",
      comment: { text: "hi" },
    });
  });

  it("canonicalCell: carries no optional field at all when none are stated, not one set to undefined", () => {
    const cell = canonicalCell({
      row: 0,
      column: 0,
      value: { kind: "string", value: "x" },
      displayText: "x",
    });
    expect(cell).toStrictEqual({
      row: 0,
      column: 0,
      value: { kind: "string", value: "x" },
      displayText: "x",
      runs: [{ text: "x" }],
    });
  });

  it("canonicalCells: returns [] when the sheet's used range is undefined (no cells at all)", () => {
    expect(
      canonicalCells(
        { name: "s", cells: [], columns: [], rows: [], images: [] } as never,
        undefined,
        undefined,
      ),
    ).toStrictEqual([]);
  });

  it("canonicalColumns/canonicalRows: hidden is exactly true or undefined, never a bare boolean carrying false", () => {
    expect(canonicalColumns({ columns: [] } as never, undefined)).toStrictEqual(
      [],
    );
    const columns = canonicalColumns(
      {
        columns: [
          { index: 0, hidden: true },
          { index: 1, hidden: false },
        ],
      } as never,
      1,
    );
    expect(columns[0]?.hidden).toBe(true);
    expect(columns[1]?.hidden).toBeUndefined();

    expect(canonicalRows({ rows: [] } as never, undefined)).toStrictEqual([]);
    const rows = canonicalRows(
      {
        rows: [
          { index: 0, hidden: true },
          { index: 1, hidden: false },
        ],
      } as never,
      1,
    );
    expect(rows[0]?.hidden).toBe(true);
    expect(rows[1]?.hidden).toBeUndefined();
  });

  it("canonicalSheetImage: carries altText only when present", () => {
    const base = {
      kind: "image" as const,
      format: "png" as const,
      base64: "AA==",
      widthPt: 10,
      heightPt: 10,
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
    };
    expect(canonicalSheetImage(base)).toStrictEqual(base);
    expect(
      canonicalSheetImage({ ...base, altText: "a picture" }),
    ).toStrictEqual({
      ...base,
      altText: "a picture",
    });
  });

  it("canonicalImages: reorders into row-major anchor-position order, breaking ties by original index", () => {
    const imageAt = (anchorRow: number, anchorColumn: number) => ({
      kind: "image" as const,
      format: "png" as const,
      base64: "AA==",
      widthPt: 10,
      heightPt: 10,
      anchorRow,
      anchorColumn,
      offsetXPt: 0,
      offsetYPt: 0,
    });
    const secondAnchorColumn = 5;
    const second = imageAt(0, secondAnchorColumn);
    const first = imageAt(0, 1);
    const third = imageAt(2, 0);
    const result = canonicalImages({
      images: [second, third, first],
    } as never);
    expect(result).toStrictEqual([first, second, third]);
  });

  it("canonicalPrintSettings: carries every optional field only when present", () => {
    const required = {
      pageSize: PAGE_SIZE_A4,
      margins: MARGINS,
      gridlines: false,
      headers: false,
      pageOrder: "downThenOver" as const,
    };
    expect(canonicalPrintSettings(required)).toStrictEqual(required);
    expect(
      canonicalPrintSettings({
        ...required,
        printRange: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
        scalePercent: 80,
        fitToPages: { width: 1, height: 1 },
        repeatRows: { start: 0, end: 0 },
        repeatColumns: { start: 0, end: 0 },
        manualBreaks: { rows: [1], columns: [1] },
      }),
    ).toStrictEqual({
      ...required,
      printRange: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
      scalePercent: 80,
      fitToPages: { width: 1, height: 1 },
      repeatRows: { start: 0, end: 0 },
      repeatColumns: { start: 0, end: 0 },
      manualBreaks: { rows: [1], columns: [1] },
    });
  });

  it("canonicalDataValidations: undefined passes through unchanged", () => {
    expect(
      canonicalDataValidations({
        cells: [],
        dataValidations: undefined,
      } as never),
    ).toBeUndefined();
  });

  it("canonicalDataValidations: a list/custom rule with no formula1 degrades to a bare allow-blank custom rule", () => {
    const result = canonicalDataValidations({
      cells: [],
      dataValidations: [
        {
          type: "list",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        },
      ],
    } as never);
    expect(result).toStrictEqual([
      {
        type: "custom",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        allowBlank: true,
      },
    ]);
  });

  it("canonicalDataValidations: a list rule's operator is always forced to 'equal'", () => {
    const result = canonicalDataValidations({
      cells: [],
      dataValidations: [
        {
          type: "list",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          formula1: "A,B,C",
          operator: "between",
        },
      ],
    } as never);
    expect(result?.[0]?.operator).toBe("equal");
  });

  it("canonicalDataValidations: a custom rule never carries an operator", () => {
    const result = canonicalDataValidations({
      cells: [],
      dataValidations: [
        {
          type: "custom",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          formula1: "A1>0",
          operator: "greaterThan",
        },
      ],
    } as never);
    expect(result?.[0]).not.toHaveProperty("operator");
  });

  it("canonicalDataValidations: a rule whose every position is covered by a merged cell vanishes", () => {
    const result = canonicalDataValidations({
      cells: [{ row: 0, column: 0, colSpan: 2, rowSpan: 1 } as never],
      dataValidations: [
        {
          type: "whole",
          ranges: [{ startRow: 0, startColumn: 1, endRow: 0, endColumn: 1 }],
          operator: "greaterThan",
          formula1: "0",
        },
      ],
    } as never);
    expect(result).toStrictEqual([]);
  });

  it("canonicalConditionalFormatStyle: textColor wins over background when both are present", () => {
    expect(
      canonicalConditionalFormatStyle({
        textColor: { r: 1, g: 0, b: 0 },
        background: { r: 0, g: 0, b: 1 },
      }),
    ).toStrictEqual({ textColor: { r: 1, g: 0, b: 0 } });
  });

  it("canonicalConditionalFormatStyle: background alone, when textColor is absent", () => {
    expect(
      canonicalConditionalFormatStyle({ background: { r: 0, g: 0, b: 1 } }),
    ).toStrictEqual({ background: { r: 0, g: 0, b: 1 } });
  });

  it("canonicalConditionalFormatStyle: undefined for undefined input and for a style with neither colour", () => {
    expect(canonicalConditionalFormatStyle(undefined)).toBeUndefined();
    expect(canonicalConditionalFormatStyle({})).toBeUndefined();
  });

  it("canonicalConditionalFormats: undefined passes through unchanged", () => {
    expect(
      canonicalConditionalFormats({ conditionalFormats: undefined } as never),
    ).toBeUndefined();
  });

  const CF_RANGES = [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }];

  it("canonicalConditionalFormats: 'cellIs' carries formula2/style only when present", () => {
    const bare = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "cellIs",
          ranges: CF_RANGES,
          operator: "greaterThan",
          formula1: "0",
        },
      ],
    } as never);
    expect(bare?.[0]).toStrictEqual({
      type: "cellIs",
      ranges: CF_RANGES,
      operator: "greaterThan",
      formula1: "0",
    });
    const full = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "cellIs",
          ranges: CF_RANGES,
          operator: "between",
          formula1: "0",
          formula2: "10",
          style: { textColor: { r: 1, g: 0, b: 0 } },
        },
      ],
    } as never);
    expect(full?.[0]).toStrictEqual({
      type: "cellIs",
      ranges: CF_RANGES,
      operator: "between",
      formula1: "0",
      formula2: "10",
      style: { textColor: { r: 1, g: 0, b: 0 } },
    });
  });

  it("canonicalConditionalFormats: 'top10' carries percent/bottom only when present", () => {
    const result = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "top10",
          ranges: CF_RANGES,
          rank: 10,
          percent: true,
          bottom: true,
        },
      ],
    } as never);
    expect(result?.[0]).toStrictEqual({
      type: "top10",
      ranges: CF_RANGES,
      rank: 10,
      percent: true,
      bottom: true,
    });
    const bare = canonicalConditionalFormats({
      conditionalFormats: [{ type: "top10", ranges: CF_RANGES, rank: 10 }],
    } as never);
    expect(bare?.[0]).toStrictEqual({
      type: "top10",
      ranges: CF_RANGES,
      rank: 10,
    });
  });

  it("canonicalConditionalFormats: 'aboveAverage' carries aboveAverage/equalAverage only when present", () => {
    const result = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "aboveAverage",
          ranges: CF_RANGES,
          aboveAverage: false,
          equalAverage: true,
        },
      ],
    } as never);
    expect(result?.[0]).toStrictEqual({
      type: "aboveAverage",
      ranges: CF_RANGES,
      aboveAverage: false,
      equalAverage: true,
    });
    const bare = canonicalConditionalFormats({
      conditionalFormats: [{ type: "aboveAverage", ranges: CF_RANGES }],
    } as never);
    expect(bare?.[0]).toStrictEqual({
      type: "aboveAverage",
      ranges: CF_RANGES,
    });
  });

  it("canonicalConditionalFormats: 'dataBar'/'iconSet' carry showValue only when present", () => {
    const dataBar = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "dataBar",
          ranges: CF_RANGES,
          min: { type: "min" },
          max: { type: "max" },
          color: { r: 0, g: 1, b: 0 },
          showValue: false,
        },
      ],
    } as never);
    expect(dataBar?.[0]).toHaveProperty("showValue", false);
    const dataBarBare = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "dataBar",
          ranges: CF_RANGES,
          min: { type: "min" },
          max: { type: "max" },
          color: { r: 0, g: 1, b: 0 },
        },
      ],
    } as never);
    expect(dataBarBare?.[0]).not.toHaveProperty("showValue");

    const iconSet = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "iconSet",
          ranges: CF_RANGES,
          iconSetType: "3TrafficLights1",
          thresholds: [{ type: "percent", value: "33" }],
          showValue: false,
        },
      ],
    } as never);
    expect(iconSet?.[0]).toHaveProperty("showValue", false);
  });

  it("canonicalConditionalFormats: text-predicate and no-argument rule kinds carry style only when present", () => {
    const withStyle = canonicalConditionalFormats({
      conditionalFormats: [
        {
          type: "containsText",
          ranges: CF_RANGES,
          text: "x",
          style: { background: { r: 1, g: 1, b: 0 } },
        },
      ],
    } as never);
    expect(withStyle?.[0]).toHaveProperty("style", {
      background: { r: 1, g: 1, b: 0 },
    });
    const bare = canonicalConditionalFormats({
      conditionalFormats: [{ type: "uniqueValues", ranges: CF_RANGES }],
    } as never);
    expect(bare?.[0]).not.toHaveProperty("style");
  });
});

describe("assertNeverContentCellValueKind", () => {
  it("throws naming the unhandled kind, proving writeCellValueAttributes's and canonicalCellValue's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverContentCellValueKind({ kind: "bogus" } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'writeCellValueAttributes: unhandled ContentCellValue kind {"kind":"bogus"}',
    );
  });
});
