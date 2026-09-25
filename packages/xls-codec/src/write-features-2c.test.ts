// The CF12-era write suites, split from write-features-2.test.ts, restating its harness verbatim.

// The write suites split from write.test.ts by family (write-b), restating its imports verbatim.

import type {
  ContentSheet,
  ContentSheetCell,
  ContentSheetConditionalFormat,
  ContentSheetPrintSettings,
} from "document-schema.js";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import {} from "archive-codec";
import { describe, expect, it } from "vitest";

import {} from "./biff/xf-colors";
import {} from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { readXlsContent } from "./content";
import {} from "./container";
import { writeXlsContent } from "./write";
import {} from "./workbook/conditional-format-write";
import {} from "./workbook/data-validation-write";
import {} from "./workbook/sheet-writer";
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

/** Mirrors content.ts's own private displayTextOf exactly, so a test fixture's displayText is what a real reader would also produce for the same value — required because ContentSheetCellSchema documents displayText as always present. */

function document(sheets: readonly ContentSheet[]): XlsContentDocument {
  return { kind: "spreadsheet", metadata: {}, sheets: [...sheets] };
}

describe("writeXlsContent: CF12-era conditional formats written (#1186)", () => {
  const RANGE = { startRow: 1, endRow: 4, startColumn: 1, endColumn: 3 };

  function roundTripped(
    rule: ContentSheetConditionalFormat,
  ): ContentSheetConditionalFormat[] {
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: [rule] })]),
      ),
    );
    return reread.sheets[0]?.conditionalFormats ?? [];
  }

  it("round-trips a two-stop colour scale with an explicit priority", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "colorScale",
      ranges: [RANGE],
      priority: 3,
      stops: [
        { value: { type: "min" }, color: { r: 1, g: 0, b: 0 } },
        { value: { type: "max" }, color: { r: 0, g: 1, b: 0 } },
      ],
    };
    expect(roundTripped(rule)).toStrictEqual([rule]);
  });

  it("round-trips a three-stop colour scale with numeric, percent, and percentile thresholds", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "colorScale",
      ranges: [RANGE],
      stops: [
        { value: { type: "num", value: "0" }, color: { r: 0, g: 0, b: 1 } },
        {
          value: { type: "percent", value: "50" },
          color: { r: 1, g: 1, b: 0 },
        },
        { value: { type: "max" }, color: { r: 1, g: 0, b: 0 } },
      ],
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips a data bar with its bar colour, thresholds, and hidden value", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "dataBar",
      ranges: [RANGE],
      min: { type: "num", value: "0" },
      max: { type: "num", value: "100" },
      // 51/255 and 204/255: colour values exact under the reader's own 255ths quantisation, so the round trip is byte-exact rather than approximately equal.
      color: { r: 0, g: 204 / 255, b: 1 },
      showValue: false,
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips an icon set with reverse and a five-icon set", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "iconSet",
      ranges: [RANGE],
      iconSetType: "5Quarters",
      reverse: true,
      thresholds: [
        { type: "min" },
        { type: "percent", value: "25" },
        { type: "percent", value: "50" },
        { type: "percent", value: "75" },
        { type: "max" },
      ],
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("refuses an icon-set threshold count the named set cannot carry", () => {
    expect(() =>
      roundTripped({
        type: "iconSet",
        ranges: [RANGE],
        iconSetType: "3Arrows",
        thresholds: [
          { type: "min" },
          { type: "percent", value: "50" },
          { type: "max" },
          { type: "percent", value: "75" },
        ],
      }),
    ).toThrow(/cStates table fixes the set at 3/);
  });

  it("resolves each of iconSetThresholdCount's own three boundaries to the exact right count, not just one interior set from each band", () => {
    // 3Symbols2 (index 7) and 4Arrows (index 8) straddle the first boundary; 4TrafficLights (index 12) and 5Arrows (index 13) straddle the second — each pair proves that boundary is <=, not < or <=-one-off.
    const caseFor = (
      iconSetType: string,
      count: number,
    ): ContentSheetConditionalFormat => ({
      type: "iconSet",
      ranges: [RANGE],
      iconSetType,
      thresholds: Array.from({ length: count }, (_unused, index) =>
        index === 0
          ? { type: "min" as const }
          : index === count - 1
            ? { type: "max" as const }
            : {
                type: "percent" as const,
                value: String((index * 100) / (count - 1)),
              },
      ),
    });
    for (const [iconSetType, count] of [
      ["3Symbols2", 3],
      ["4Arrows", 4],
      ["4TrafficLights", 4],
      ["5Arrows", 5],
    ] as const) {
      const rule = caseFor(iconSetType, count);
      expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
    }
  });

  it("refuses an icon-set type outside the seventeen built-in sets", () => {
    expect(() =>
      roundTripped({
        type: "iconSet",
        ranges: [RANGE],
        iconSetType: "Custom3Arrows",
        thresholds: [
          { type: "min" },
          { type: "percent", value: "50" },
          { type: "max" },
        ],
      }),
    ).toThrow(/no BIFF8 byte to be written as/);
  });

  it("refuses stopIfTrue on a visual-scale rule, which [MS-XLS] pins to zero", () => {
    expect(() =>
      roundTripped({
        type: "dataBar",
        ranges: [RANGE],
        min: { type: "min" },
        max: { type: "max" },
        color: { r: 0, g: 0, b: 0 },
        stopIfTrue: true,
      }),
    ).toThrow(/pins CF12's own fStopIfTrue bit to zero/);
  });

  it("refuses stopIfTrue on each of the other two visual-scale rule types on its own, not only dataBar", () => {
    expect(() =>
      roundTripped({
        type: "colorScale",
        ranges: [RANGE],
        stops: [
          { value: { type: "min" }, color: { r: 1, g: 0, b: 0 } },
          { value: { type: "max" }, color: { r: 0, g: 1, b: 0 } },
        ],
        stopIfTrue: true,
      }),
    ).toThrow(/pins CF12's own fStopIfTrue bit to zero/);
    expect(() =>
      roundTripped({
        type: "iconSet",
        ranges: [RANGE],
        iconSetType: "3Arrows",
        thresholds: [
          { type: "min" },
          { type: "percent", value: "50" },
          { type: "max" },
        ],
        stopIfTrue: true,
      }),
    ).toThrow(/pins CF12's own fStopIfTrue bit to zero/);
  });

  it("round-trips a top10 rule with rank, percent, bottom, and style", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [RANGE],
      rank: 5,
      percent: true,
      bottom: true,
      priority: 2,
      // Red and pale yellow — the identical pair the cellIs style round trip above uses, both exact under the reader's 255ths colour quantisation and present in the fixed default palette, so the DXFN icv path round-trips them byte-exactly.
      style: {
        textColor: { r: 1, g: 0, b: 0 },
        background: { r: 1, g: 1, b: 0.8 },
      },
    };
    expect(roundTripped(rule)).toStrictEqual([rule]);
  });

  it("round-trips a plain aboveAverage rule and an equal-average below-average one", () => {
    const above: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [RANGE],
    };
    const belowEqualStdDev: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [RANGE],
      aboveAverage: false,
      equalAverage: true,
      stdDev: 2,
    };
    expect(roundTripped(above)).toStrictEqual([{ ...above, priority: 1 }]);
    expect(roundTripped(belowEqualStdDev)).toStrictEqual([
      { ...belowEqualStdDev, priority: 1 },
    ]);
  });

  it("round-trips an aboveAverage rule carrying a style", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [RANGE],
      style: { textColor: { r: 1, g: 0, b: 0 } },
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("refuses an aboveAverage standard-deviation count beyond [MS-XLS]'s own table", () => {
    expect(() =>
      roundTripped({
        type: "aboveAverage",
        ranges: [RANGE],
        stdDev: 3,
      }),
    ).toThrow(/admits only 0, 1, or 2/);
  });

  it("round-trips a timePeriod rule", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "timePeriod",
      ranges: [RANGE],
      timePeriod: "last7Days",
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips a timePeriod rule carrying a style", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "timePeriod",
      ranges: [RANGE],
      timePeriod: "today",
      style: { background: { r: 1, g: 1, b: 0 } },
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips the operand-free family", () => {
    for (const type of [
      "containsBlanks",
      "notContainsBlanks",
      "containsErrors",
      "notContainsErrors",
      "uniqueValues",
      "duplicateValues",
    ] as const) {
      const rule: ContentSheetConditionalFormat = {
        type,
        ranges: [RANGE],
        style: { background: { r: 1, g: 1, b: 0.8 } },
      };
      expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
    }
  });

  it("round-trips the text family, recovering the search text from the generated formula", () => {
    for (const type of [
      "containsText",
      "notContainsText",
      "beginsWith",
      "endsWith",
    ] as const) {
      const rule: ContentSheetConditionalFormat = {
        type,
        ranges: [RANGE],
        text: 'a "quoted" needle',
        style: { textColor: { r: 1, g: 0, b: 0 } },
      };
      expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
    }
  });

  it("mints unique priorities for rules stating none, and keeps stated ones", () => {
    const rules: ContentSheetConditionalFormat[] = [
      {
        type: "timePeriod",
        ranges: [RANGE],
        timePeriod: "today",
      },
      {
        type: "duplicateValues",
        ranges: [RANGE],
        priority: 1,
      },
      {
        type: "uniqueValues",
        ranges: [RANGE],
      },
    ];
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: rules })]),
      ),
    );
    expect(reread.sheets[0]?.conditionalFormats).toStrictEqual([
      { ...rules[0], priority: 2 },
      { ...rules[1], priority: 1 },
      { ...rules[2], priority: 3 },
    ]);
  });

  it("refuses two rules declaring the same priority rather than renumbering them", () => {
    expect(() =>
      roundTripped({
        type: "timePeriod",
        ranges: [RANGE],
        timePeriod: "today",
        priority: 7,
      }),
    ).not.toThrow();
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            conditionalFormats: [
              {
                type: "timePeriod",
                ranges: [RANGE],
                timePeriod: "today",
                priority: 7,
              },
              {
                type: "timePeriod",
                ranges: [RANGE],
                timePeriod: "tomorrow",
                priority: 7,
              },
            ],
          }),
        ]),
      ),
    ).toThrow(/requires ipriority to be unique/);
  });

  it("keeps base cellIs groups and CF12 groups on one sheet, both reading back", () => {
    const cellIs: ContentSheetConditionalFormat = {
      type: "cellIs",
      ranges: [RANGE],
      operator: "equal",
      formula1: "3",
    };
    const textRule: ContentSheetConditionalFormat = {
      type: "containsText",
      ranges: [RANGE],
      text: "needle",
    };
    const reread = readXlsContent(
      writeXlsContent(
        document([sheet("S", [], { conditionalFormats: [cellIs, textRule] })]),
      ),
    );
    expect(reread.sheets[0]?.conditionalFormats).toStrictEqual([
      cellIs,
      { ...textRule, priority: 1 },
    ]);
  });

  it("round-trips a data bar whose value is shown (the non-default of the earlier hidden-value test)", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "dataBar",
      ranges: [RANGE],
      min: { type: "min" },
      max: { type: "max" },
      color: { r: 1, g: 0, b: 0 },
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips an icon set with showValue false and reverse absent (the opposite of the earlier reverse test)", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "iconSet",
      ranges: [RANGE],
      iconSetType: "3Arrows",
      showValue: false,
      thresholds: [
        { type: "min" },
        { type: "percent", value: "50" },
        { type: "max" },
      ],
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips a top10 rule selecting from the top rather than the bottom, by count rather than percent", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [RANGE],
      rank: 3,
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips a top10 rule selecting from the bottom by count, isolating fTop from fPercent", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [RANGE],
      rank: 3,
      bottom: true,
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips a top10 rule selecting from the top by percent, isolating fPercent from fTop", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [RANGE],
      rank: 3,
      percent: true,
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips every combination of aboveAverage/equalAverage", () => {
    const aboveEqual: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [RANGE],
      equalAverage: true,
    };
    const belowNotEqual: ContentSheetConditionalFormat = {
      type: "aboveAverage",
      ranges: [RANGE],
      aboveAverage: false,
    };
    expect(roundTripped(aboveEqual)).toStrictEqual([
      { ...aboveEqual, priority: 1 },
    ]);
    expect(roundTripped(belowNotEqual)).toStrictEqual([
      { ...belowNotEqual, priority: 1 },
    ]);
  });

  it("round-trips a rule declaring stopIfTrue", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "top10",
      ranges: [RANGE],
      rank: 1,
      stopIfTrue: true,
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("round-trips a colour-scale stop of every threshold kind, including percentile and formula", () => {
    const rule: ContentSheetConditionalFormat = {
      type: "colorScale",
      ranges: [RANGE],
      stops: [
        {
          value: { type: "percentile", value: "10" },
          color: { r: 0, g: 0, b: 1 },
        },
        {
          value: { type: "formula", value: "A1" },
          color: { r: 1, g: 0, b: 0 },
        },
      ],
    };
    expect(roundTripped(rule)).toStrictEqual([{ ...rule, priority: 1 }]);
  });

  it("refuses a threshold of a value-bearing type carrying no value", () => {
    expect(() =>
      roundTripped({
        type: "colorScale",
        ranges: [RANGE],
        stops: [
          { value: { type: "percent" }, color: { r: 0, g: 0, b: 0 } },
          { value: { type: "max" }, color: { r: 1, g: 1, b: 1 } },
        ],
      }),
    ).toThrow(/carries no value/);
  });
});
