import { describe, expect, it } from "vitest";
import type {
  ContentSheetConditionalFormat,
  SheetRuleOperator,
} from "document-schema.js";
import {
  calextDateForTimePeriod,
  calextTypeForCfvoType,
  formatTargetRangeList,
  parseConditionValue,
  readTargetRangeList,
  synthesiseConditionValue,
  assertNeverConditionMode,
  assertNeverConditionalFormatType,
} from "./conditional-format";

// calcext:conditional-formats has no OASIS-published grammar at all — every value/attribute name exercised here is transcribed from LibreOffice's own real reader (sc/source/filter/xml/xmlcondformat.cxx), see conditional-format.ts's own top-of-file note for the exact source functions. A real LibreOffice-produced fixture (fixtures/conditional-format.ods) exists and is exercised in read.test.ts's own "conditional-format.ods (real LibreOffice output)" describe block — it directly caught a real entity-decoding bug this file's own synthetic cases below could not have found on their own (a producer that escapes '>' as '&gt;' in calcext:value), since a hand-built package only ever contains what its author thought to escape. Every OTHER variant exercised here (colour-scale, data-bar, icon-set, date-is, every condition mode) has no real fixture available, so those packages are hand-built (el/txt) to the identical wire shape xmlcondformat.cxx establishes, matching data-validation.test.ts's own established fallback for a producer-specific mini-language a real fixture wasn't available for.

describe("parseConditionValue", () => {
  it("parses unique/duplicate as no-operand keywords", () => {
    expect(parseConditionValue("unique")).toEqual({
      mode: "unique",
      expr1: undefined,
      expr2: undefined,
    });
    expect(parseConditionValue("duplicate")).toEqual({
      mode: "duplicate",
      expr1: undefined,
      expr2: undefined,
    });
  });

  it("parses between/not-between with two comma-separated operands", () => {
    expect(parseConditionValue("between(1,10)")).toEqual({
      mode: "between",
      expr1: "1",
      expr2: "10",
    });
    expect(parseConditionValue("not-between(1,10)")).toEqual({
      mode: "not-between",
      expr1: "1",
      expr2: "10",
    });
  });

  it("parses a nested-parens operand without ending the expression early (the same balanced-paren hazard table:condition's own suite proves)", () => {
    expect(parseConditionValue("between(MIN(A1:A5),MAX(A1:A5))")).toEqual({
      mode: "between",
      expr1: "MIN(A1:A5)",
      expr2: "MAX(A1:A5)",
    });
  });

  it("parses every comparison operator spelling", () => {
    const cases: [string, string][] = [
      ["<=5", "eq-less"],
      [">=5", "eq-greater"],
      ["!=5", "not-equal"],
      ["<5", "less"],
      ["=5", "equal"],
      [">5", "greater"],
    ];
    for (const [value, mode] of cases) {
      expect(parseConditionValue(value)).toEqual({
        mode,
        expr1: "5",
        expr2: undefined,
      });
    }
  });

  it("parses formula-is as its own mode (later left unpromoted, the same closed-form boundary the expression cfRule type draws)", () => {
    expect(parseConditionValue("formula-is(A1>B1)")).toEqual({
      mode: "formula-is",
      expr1: "A1>B1",
      expr2: undefined,
    });
  });

  it("parses top/bottom N-elements and N-percent", () => {
    expect(parseConditionValue("top-elements(5)")).toEqual({
      mode: "top-elements",
      expr1: "5",
      expr2: undefined,
    });
    expect(parseConditionValue("bottom-elements(3)")).toEqual({
      mode: "bottom-elements",
      expr1: "3",
      expr2: undefined,
    });
    expect(parseConditionValue("top-percent(10)")).toEqual({
      mode: "top-percent",
      expr1: "10",
      expr2: undefined,
    });
    expect(parseConditionValue("bottom-percent(10)")).toEqual({
      mode: "bottom-percent",
      expr1: "10",
      expr2: undefined,
    });
  });

  it("parses all four average modes as no-operand keywords, longest-prefix-first so 'above-average' doesn't shadow 'above-equal-average'", () => {
    for (const mode of [
      "above-average",
      "below-average",
      "above-equal-average",
      "below-equal-average",
    ]) {
      expect(parseConditionValue(mode)).toEqual({
        mode,
        expr1: undefined,
        expr2: undefined,
      });
    }
  });

  it("parses is-error/is-no-error, longest-prefix-first so 'is-error' doesn't shadow 'is-no-error'", () => {
    expect(parseConditionValue("is-no-error")).toEqual({
      mode: "is-no-error",
      expr1: undefined,
      expr2: undefined,
    });
    expect(parseConditionValue("is-error")).toEqual({
      mode: "is-error",
      expr1: undefined,
      expr2: undefined,
    });
  });

  it("parses the text-matching modes with their one paren-wrapped operand", () => {
    expect(parseConditionValue("begins-with(foo)")).toEqual({
      mode: "begins-with",
      expr1: "foo",
      expr2: undefined,
    });
    expect(parseConditionValue("ends-with(foo)")).toEqual({
      mode: "ends-with",
      expr1: "foo",
      expr2: undefined,
    });
    expect(parseConditionValue("contains-text(foo)")).toEqual({
      mode: "contains-text",
      expr1: "foo",
      expr2: undefined,
    });
    expect(parseConditionValue("not-contains-text(foo)")).toEqual({
      mode: "not-contains-text",
      expr1: "foo",
      expr2: undefined,
    });
  });

  it("returns undefined for a producer-extended or malformed value this reader cannot make sense of", () => {
    expect(parseConditionValue("some-future-mode(1)")).toBeUndefined();
  });

  it("matches every no-operand keyword by PREFIX, not by suffix — a trailing operand list still identifies the mode even though the value no longer ENDS with the bare keyword", () => {
    const cases: [string, string][] = [
      ["unique(ignored)", "unique"],
      ["duplicate(ignored)", "duplicate"],
      ["above-equal-average(ignored)", "above-equal-average"],
      ["below-equal-average(ignored)", "below-equal-average"],
      ["above-average(ignored)", "above-average"],
      ["below-average(ignored)", "below-average"],
      ["is-no-error(ignored)", "is-no-error"],
      ["is-error(ignored)", "is-error"],
    ];
    for (const [value, mode] of cases) {
      expect(parseConditionValue(value)?.mode).toBe(mode);
    }
  });
});

describe("readTargetRangeList", () => {
  it("parses a single Sheet.Cell:Sheet.Cell range, discarding the redundant sheet-name prefix (same convention as table:print-ranges)", () => {
    expect(readTargetRangeList("Sheet1.A1:Sheet1.C3")).toEqual([
      { startRow: 0, startColumn: 0, endRow: 2, endColumn: 2 },
    ]);
  });

  it("parses a space-separated multi-range list, ScRangeStringConverter::GetRangeListFromString's own default separator", () => {
    expect(
      readTargetRangeList("Sheet1.A1:Sheet1.A3 Sheet1.C1:Sheet1.C3"),
    ).toEqual([
      { startRow: 0, startColumn: 0, endRow: 2, endColumn: 0 },
      { startRow: 0, startColumn: 2, endRow: 2, endColumn: 2 },
    ]);
  });

  it("skips a malformed entry rather than failing the whole list", () => {
    expect(readTargetRangeList("not-a-range Sheet1.A1:Sheet1.A1")).toEqual([
      { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
    ]);
  });

  it("skips a genuinely empty entry produced by a run of consecutive separators, rather than treating it as malformed", () => {
    expect(
      readTargetRangeList("Sheet1.A1:Sheet1.A1  Sheet1.B1:Sheet1.B1"),
    ).toEqual([
      { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
      { startRow: 0, startColumn: 1, endRow: 0, endColumn: 1 },
    ]);
  });

  it("skips an entry with no ':' separator at all, rather than misreading it as a single-cell range", () => {
    expect(readTargetRangeList("Sheet1.A1 Sheet1.B1:Sheet1.B1")).toEqual([
      { startRow: 0, startColumn: 1, endRow: 0, endColumn: 1 },
    ]);
  });

  it("skips a colon-less entry even when both halves a naive split would produce happen to look like valid cell references on their own (A11 read as 'A1' + '1', not as a real range)", () => {
    expect(readTargetRangeList("A11 Sheet1.B1:Sheet1.B1")).toEqual([
      { startRow: 0, startColumn: 1, endRow: 0, endColumn: 1 },
    ]);
  });

  it("parses a range with no sheet-name prefix at all, not just the prefixed form", () => {
    expect(readTargetRangeList("A1:C3")).toEqual([
      { startRow: 0, startColumn: 0, endRow: 2, endColumn: 2 },
    ]);
  });
});

describe("formatTargetRangeList", () => {
  it("formats a single range as a sheet-prefixed A1:A1 pair", () => {
    expect(
      formatTargetRangeList(
        [{ startRow: 0, startColumn: 0, endRow: 2, endColumn: 2 }],
        "Sheet1",
      ),
    ).toBe("Sheet1.A1:Sheet1.C3");
  });

  it("space-joins several ranges, matching the read side's own separator", () => {
    expect(
      formatTargetRangeList(
        [
          { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
          { startRow: 1, startColumn: 1, endRow: 1, endColumn: 1 },
        ],
        "Sheet1",
      ),
    ).toBe("Sheet1.A1:Sheet1.A1 Sheet1.B2:Sheet1.B2");
  });
});

describe("calextTypeForCfvoType", () => {
  it("inverts every real cfvo type this reader promotes", () => {
    for (const [cfvoType, calextType] of [
      ["min", "minimum"],
      ["max", "maximum"],
      ["percentile", "percentile"],
      ["percent", "percent"],
      ["formula", "formula"],
    ] as const) {
      expect(calextTypeForCfvoType(cfvoType)).toBe(calextType);
    }
  });

  it("returns undefined for 'num', which no calcext type maps onto", () => {
    expect(calextTypeForCfvoType("num")).toBeUndefined();
  });
});

describe("calextDateForTimePeriod", () => {
  it("inverts every real calcext:date this reader promotes", () => {
    for (const [calextDate, timePeriod] of [
      ["today", "today"],
      ["yesterday", "yesterday"],
      ["tomorrow", "tomorrow"],
      ["last-7-days", "last7Days"],
      ["this-week", "thisWeek"],
      ["last-week", "lastWeek"],
      ["next-week", "nextWeek"],
      ["this-month", "thisMonth"],
      ["last-month", "lastMonth"],
      ["next-month", "nextMonth"],
      ["this-year", "thisYear"],
      ["last-year", "lastYear"],
      ["next-year", "nextYear"],
    ] as const) {
      expect(calextDateForTimePeriod(timePeriod)).toBe(calextDate);
    }
  });

  it("throws for a value with no calcext:date spelling, rather than silently emitting nothing", () => {
    expect(() => calextDateForTimePeriod("not-a-real-period")).toThrow(
      /no calcext:date spelling for 'not-a-real-period'/,
    );
  });
});

describe("synthesiseConditionValue", () => {
  function cellIs(
    operator: SheetRuleOperator,
    formula1: string,
    formula2?: string,
  ): ContentSheetConditionalFormat {
    return {
      type: "cellIs",
      ranges: [],
      operator,
      formula1,
      ...(formula2 === undefined ? {} : { formula2 }),
    };
  }

  it("synthesises between/not-between with both operands", () => {
    expect(synthesiseConditionValue(cellIs("between", "1", "10"))).toBe(
      "between(1,10)",
    );
    expect(synthesiseConditionValue(cellIs("notBetween", "1", "10"))).toBe(
      "not-between(1,10)",
    );
  });

  it("falls back to a plain comparison when a between/notBetween operator is missing its second operand", () => {
    expect(synthesiseConditionValue(cellIs("between", "1"))).toBeUndefined();
  });

  it("never treats a plain comparison operator as between/notBetween just because a stray formula2 happens to be present", () => {
    expect(synthesiseConditionValue(cellIs("equal", "5", "10"))).toBe("=5");
  });

  it("synthesises every plain comparison operator's own symbol", () => {
    const cases: [SheetRuleOperator, string][] = [
      ["equal", "=5"],
      ["notEqual", "!=5"],
      ["lessThan", "<5"],
      ["lessThanOrEqual", "<=5"],
      ["greaterThan", ">5"],
      ["greaterThanOrEqual", ">=5"],
    ];
    for (const [operator, expected] of cases) {
      expect(synthesiseConditionValue(cellIs(operator, "5"))).toBe(expected);
    }
  });

  it("synthesises the no-operand keywords", () => {
    expect(synthesiseConditionValue({ type: "uniqueValues", ranges: [] })).toBe(
      "unique",
    );
    expect(
      synthesiseConditionValue({ type: "duplicateValues", ranges: [] }),
    ).toBe("duplicate");
    expect(
      synthesiseConditionValue({ type: "containsErrors", ranges: [] }),
    ).toBe("is-error");
    expect(
      synthesiseConditionValue({ type: "notContainsErrors", ranges: [] }),
    ).toBe("is-no-error");
  });

  it("synthesises every top10 rank/bottom/percent combination", () => {
    const cases: [boolean | undefined, boolean | undefined, string][] = [
      [undefined, undefined, "top-elements(5)"],
      [undefined, true, "top-percent(5)"],
      [true, undefined, "bottom-elements(5)"],
      [true, true, "bottom-percent(5)"],
    ];
    for (const [bottom, percent, expected] of cases) {
      expect(
        synthesiseConditionValue({
          type: "top10",
          ranges: [],
          rank: 5,
          ...(bottom === undefined ? {} : { bottom }),
          ...(percent === undefined ? {} : { percent }),
        }),
      ).toBe(expected);
    }
  });

  it("synthesises every aboveAverage direction/qualifier combination", () => {
    const cases: [boolean, boolean, string][] = [
      [true, false, "above-average"],
      [true, true, "above-equal-average"],
      [false, false, "below-average"],
      [false, true, "below-equal-average"],
    ];
    for (const [aboveAverage, equalAverage, expected] of cases) {
      expect(
        synthesiseConditionValue({
          type: "aboveAverage",
          ranges: [],
          aboveAverage,
          equalAverage,
        }),
      ).toBe(expected);
    }
  });

  it("synthesises every text-matching mode with its own paren-wrapped text", () => {
    const cases: [ContentSheetConditionalFormat["type"], string][] = [
      ["beginsWith", "begins-with(foo)"],
      ["endsWith", "ends-with(foo)"],
      ["containsText", "contains-text(foo)"],
      ["notContainsText", "not-contains-text(foo)"],
    ];
    for (const [type, expected] of cases) {
      expect(
        synthesiseConditionValue({
          type,
          ranges: [],
          text: "foo",
        } as ContentSheetConditionalFormat),
      ).toBe(expected);
    }
  });

  it("returns undefined for containsBlanks/notContainsBlanks, which calcext:condition's own grammar has no spelling for", () => {
    expect(
      synthesiseConditionValue({ type: "containsBlanks", ranges: [] }),
    ).toBeUndefined();
    expect(
      synthesiseConditionValue({ type: "notContainsBlanks", ranges: [] }),
    ).toBeUndefined();
  });

  it("returns undefined for the rule kinds that are never calcext:condition rules at all", () => {
    expect(
      synthesiseConditionValue({
        type: "colorScale",
        ranges: [],
        stops: [],
      }),
    ).toBeUndefined();
    expect(
      synthesiseConditionValue({
        type: "dataBar",
        ranges: [],
        min: { type: "min" },
        max: { type: "max" },
        color: { r: 0, g: 0, b: 0 },
      }),
    ).toBeUndefined();
    expect(
      synthesiseConditionValue({
        type: "iconSet",
        ranges: [],
        iconSetType: "3Arrows",
        thresholds: [],
      }),
    ).toBeUndefined();
    expect(
      synthesiseConditionValue({
        type: "timePeriod",
        ranges: [],
        timePeriod: "today",
      }),
    ).toBeUndefined();
  });
});

describe("assertNeverConditionMode", () => {
  it("throws naming the unhandled mode, proving readCondition's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverConditionMode("bogus" as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'readCondition: unhandled ConditionMode "bogus"',
    );
  });
});

describe("assertNeverConditionalFormatType", () => {
  it("throws naming the unhandled type, proving synthesiseConditionValue's and canonicalConditionalFormats's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverConditionalFormatType({ type: "bogus" } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'synthesiseConditionValue: unhandled ContentSheetConditionalFormat type {"type":"bogus"}',
    );
  });
});
