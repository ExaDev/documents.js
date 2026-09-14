import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import type {
  ContentSheetConditionalFormat,
  SheetRuleOperator,
} from "document-schema.js";
import {
  calextDateForTimePeriod,
  calextTypeForCfvoType,
  formatTargetRangeList,
  parseConditionValue,
  readConditionalFormats,
  readTargetRangeList,
  synthesiseConditionValue,
} from "./conditional-format";

// calcext:conditional-formats has no OASIS-published grammar at all -- every value/attribute name exercised here is transcribed from LibreOffice's own real reader (sc/source/filter/xml/xmlcondformat.cxx), see conditional-format.ts's own top-of-file note for the exact source functions. A real LibreOffice-produced fixture (fixtures/conditional-format.ods) exists and is exercised in read.test.ts's own "conditional-format.ods (real LibreOffice output)" describe block -- it directly caught a real entity-decoding bug this file's own synthetic cases below could not have found on their own (a producer that escapes '>' as '&gt;' in calcext:value), since a hand-built package only ever contains what its author thought to escape. Every OTHER variant exercised here (colour-scale, data-bar, icon-set, date-is, every condition mode) has no real fixture available, so those packages are hand-built (el/txt) to the identical wire shape xmlcondformat.cxx establishes, matching data-validation.test.ts's own established fallback for a producer-specific mini-language a real fixture wasn't available for.

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

  it("matches every no-operand keyword by PREFIX, not by suffix -- a trailing operand list still identifies the mode even though the value no longer ENDS with the bare keyword", () => {
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

function conditionalFormatsPackage(table: XmlElement): Package {
  return {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: [
          el("office:document-content", {}, [
            el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
          ]),
        ],
      },
    },
  };
}

function tableWith(...children: readonly XmlElement[]): XmlElement {
  return el("table:table", { "table:name": "Sheet1" }, [...children]);
}

describe("readConditionalFormats (synthetic packages, real calcext wire shapes)", () => {
  it("promotes a between condition into a cellIs rule with its resolved style", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.A1:Sheet1.A10",
          },
          [
            el("calcext:condition", {
              "calcext:value": "between(1,10)",
              "calcext:apply-style-name": "Good",
            }),
          ],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats, residueElements } = readConditionalFormats(table, pkg);
    expect(residueElements).toEqual([]);
    expect(formats).toStrictEqual([
      {
        type: "cellIs",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 9, endColumn: 0 }],
        operator: "between",
        formula1: "1",
        formula2: "10",
      },
    ]);
  });

  it("promotes a not-between condition with the notBetween operator, not just between", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A10" },
          [el("calcext:condition", { "calcext:value": "not-between(1,10)" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "cellIs",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 9, endColumn: 0 }],
        operator: "notBetween",
        formula1: "1",
        formula2: "10",
      },
    ]);
  });

  it('decodes an XML-escaped comparison operator (a real LibreOffice producer writes calcext:value=">3" as literally &gt;3 on disk -- typed/ods/fixtures/conditional-format.ods\'s own content.xml, confirmed directly)', () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [el("calcext:condition", { "calcext:value": "&gt;3" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "cellIs",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        operator: "greaterThan",
        formula1: "3",
      },
    ]);
  });

  it("resolves apply-style-name through the table-cell style cascade into textColor/background", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.B1:Sheet1.B1",
          },
          [
            el("calcext:condition", {
              "calcext:value": ">100",
              "calcext:apply-style-name": "Warn",
            }),
          ],
        ),
      ]),
    );
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:automatic-styles", {}, [
                el(
                  "style:style",
                  { "style:name": "Warn", "style:family": "table-cell" },
                  [
                    el("style:table-cell-properties", {
                      "fo:background-color": "#FFCC00",
                    }),
                    el("style:text-properties", { "fo:color": "#CC0000" }),
                  ],
                ),
              ]),
              el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
            ]),
          ],
        },
      },
    };
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "cellIs",
        ranges: [{ startRow: 0, startColumn: 1, endRow: 0, endColumn: 1 }],
        operator: "greaterThan",
        formula1: "100",
        style: {
          textColor: { r: 0.8, g: 0, b: 0 },
          background: { r: 1, g: 0.8, b: 0 },
        },
      },
    ]);
  });

  function conditionWithStyle(
    styleName: string,
    styleProperties: readonly XmlElement[],
  ): { pkg: Package; table: XmlElement } {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [
            el("calcext:condition", {
              "calcext:value": "unique",
              "calcext:apply-style-name": styleName,
            }),
          ],
        ),
      ]),
    );
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:automatic-styles", {}, [
                el(
                  "style:style",
                  { "style:name": "Warn", "style:family": "table-cell" },
                  [...styleProperties],
                ),
              ]),
              el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
            ]),
          ],
        },
      },
    };
    return { pkg, table };
  }

  it("carries only textColor when the resolved style sets no background at all", () => {
    const { pkg, table } = conditionWithStyle("Warn", [
      el("style:text-properties", { "fo:color": "#CC0000" }),
    ]);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats[0]).toStrictEqual({
      type: "uniqueValues",
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      style: { textColor: { r: 0.8, g: 0, b: 0 } },
    });
  });

  it("carries only background when the resolved style sets no text color at all", () => {
    const { pkg, table } = conditionWithStyle("Warn", [
      el("style:table-cell-properties", { "fo:background-color": "#FFCC00" }),
    ]);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats[0]).toStrictEqual({
      type: "uniqueValues",
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      style: { background: { r: 1, g: 0.8, b: 0 } },
    });
  });

  it("omits style entirely when the referenced style resolves to no chain at all (an apply-style-name naming a style that was never declared)", () => {
    const { pkg, table } = conditionWithStyle("DoesNotExist", [
      el("style:text-properties", { "fo:color": "#CC0000" }),
    ]);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats[0]).toStrictEqual({
      type: "uniqueValues",
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
    });
  });

  it("omits style entirely when the resolved chain sets neither a background nor a text color", () => {
    const { pkg, table } = conditionWithStyle("Warn", [
      el("style:table-cell-properties", { "fo:border": "0.5pt solid #000000" }),
    ]);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats[0]).toStrictEqual({
      type: "uniqueValues",
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
    });
  });

  it("omits style entirely when the condition carries no calcext:apply-style-name attribute at all", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [el("calcext:condition", { "calcext:value": "unique" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats[0]).toStrictEqual({
      type: "uniqueValues",
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
    });
  });

  it("omits style entirely for a condition with no apply-style-name, even when the document declares a real table-cell family default-style that would otherwise supply one", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [el("calcext:condition", { "calcext:value": "unique" })],
        ),
      ]),
    );
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:automatic-styles", {}, [
                el("style:default-style", { "style:family": "table-cell" }, [
                  el("style:text-properties", { "fo:color": "#CC0000" }),
                ]),
              ]),
              el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
            ]),
          ],
        },
      },
    };
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats[0]).toStrictEqual({
      type: "uniqueValues",
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
    });
  });

  it("promotes unique/duplicate, top10, aboveAverage, and containsErrors variants", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.A1:Sheet1.A1",
          },
          [el("calcext:condition", { "calcext:value": "unique" })],
        ),
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.B1:Sheet1.B1",
          },
          [el("calcext:condition", { "calcext:value": "top-percent(10)" })],
        ),
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.C1:Sheet1.C1",
          },
          [
            el("calcext:condition", {
              "calcext:value": "above-equal-average",
            }),
          ],
        ),
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.D1:Sheet1.D1",
          },
          [el("calcext:condition", { "calcext:value": "is-error" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "uniqueValues",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      },
      {
        type: "top10",
        ranges: [{ startRow: 0, startColumn: 1, endRow: 0, endColumn: 1 }],
        rank: 10,
        percent: true,
      },
      {
        type: "aboveAverage",
        ranges: [{ startRow: 0, startColumn: 2, endRow: 0, endColumn: 2 }],
        aboveAverage: true,
        equalAverage: true,
      },
      {
        type: "containsErrors",
        ranges: [{ startRow: 0, startColumn: 3, endRow: 0, endColumn: 3 }],
      },
    ]);
  });

  it("promotes notContainsErrors (is-no-error), a plain (non-percent) top-elements rank with neither percent nor bottom set, and a below-average rank with both flags false", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [el("calcext:condition", { "calcext:value": "is-no-error" })],
        ),
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.B1:Sheet1.B1" },
          [el("calcext:condition", { "calcext:value": "top-elements(5)" })],
        ),
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.C1:Sheet1.C1" },
          [el("calcext:condition", { "calcext:value": "below-average" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "notContainsErrors",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      },
      {
        type: "top10",
        ranges: [{ startRow: 0, startColumn: 1, endRow: 0, endColumn: 1 }],
        rank: 5,
      },
      {
        type: "aboveAverage",
        ranges: [{ startRow: 0, startColumn: 2, endRow: 0, endColumn: 2 }],
        aboveAverage: false,
        equalAverage: false,
      },
    ]);
  });

  it("promotes a bottom-percent rank with both bottom and percent set", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [el("calcext:condition", { "calcext:value": "bottom-percent(20)" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "top10",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        rank: 20,
        percent: true,
        bottom: true,
      },
    ]);
  });

  it("promotes a plain bottom-elements rank with bottom set but percent absent", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [el("calcext:condition", { "calcext:value": "bottom-elements(3)" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "top10",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        rank: 3,
        bottom: true,
      },
    ]);
  });

  it("promotes a plain above-average rule with both flags true/false, not just the equal-average variant", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [el("calcext:condition", { "calcext:value": "above-average" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "aboveAverage",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        aboveAverage: true,
        equalAverage: false,
      },
    ]);
  });

  it("falls back to residue for a top-elements rank that is zero, negative, or not a number at all", () => {
    for (const value of [
      "top-elements(0)",
      "top-elements(-1)",
      "top-elements(not-a-number)",
    ]) {
      const table = tableWith(
        el("calcext:conditional-formats", {}, [
          el(
            "calcext:conditional-format",
            { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
            [el("calcext:condition", { "calcext:value": value })],
          ),
        ]),
      );
      const pkg = conditionalFormatsPackage(table);
      const { formats, residueElements } = readConditionalFormats(table, pkg);
      expect(formats).toEqual([]);
      expect(residueElements).toHaveLength(1);
    }
  });

  it("falls back to residue for a between condition missing its second operand", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [el("calcext:condition", { "calcext:value": "between(1)" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats, residueElements } = readConditionalFormats(table, pkg);
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });

  it("promotes every text-matching mode into its own rule type, carrying the matched text verbatim", () => {
    const cases: [string, string][] = [
      ["begins-with(foo)", "beginsWith"],
      ["ends-with(foo)", "endsWith"],
      ["contains-text(foo)", "containsText"],
      ["not-contains-text(foo)", "notContainsText"],
    ];
    for (const [value, type] of cases) {
      const table = tableWith(
        el("calcext:conditional-formats", {}, [
          el(
            "calcext:conditional-format",
            { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
            [el("calcext:condition", { "calcext:value": value })],
          ),
        ]),
      );
      const pkg = conditionalFormatsPackage(table);
      const { formats } = readConditionalFormats(table, pkg);
      expect(formats).toStrictEqual([
        {
          type,
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          text: "foo",
        },
      ]);
    }
  });

  it("falls back to residue for a colour-scale with too few (one) or too many (four) entries", () => {
    for (const entries of [
      [
        el("calcext:color-scale-entry", {
          "calcext:type": "minimum",
          "calcext:color": "#FF0000",
        }),
      ],
      [
        el("calcext:color-scale-entry", {
          "calcext:type": "minimum",
          "calcext:color": "#FF0000",
        }),
        el("calcext:color-scale-entry", {
          "calcext:type": "percentile",
          "calcext:value": "33",
          "calcext:color": "#FFFF00",
        }),
        el("calcext:color-scale-entry", {
          "calcext:type": "percentile",
          "calcext:value": "67",
          "calcext:color": "#FFCC00",
        }),
        el("calcext:color-scale-entry", {
          "calcext:type": "maximum",
          "calcext:color": "#00FF00",
        }),
      ],
    ]) {
      const table = tableWith(
        el("calcext:conditional-formats", {}, [
          el(
            "calcext:conditional-format",
            { "calcext:target-range-address": "Sheet1.A1:Sheet1.A10" },
            [el("calcext:color-scale", {}, entries)],
          ),
        ]),
      );
      const pkg = conditionalFormatsPackage(table);
      const { formats, residueElements } = readConditionalFormats(table, pkg);
      expect(formats).toEqual([]);
      expect(residueElements).toHaveLength(1);
    }
  });

  it("promotes a colour-scale with exactly the minimum of two entries", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A10" },
          [
            el("calcext:color-scale", {}, [
              el("calcext:color-scale-entry", {
                "calcext:type": "minimum",
                "calcext:color": "#FF0000",
              }),
              el("calcext:color-scale-entry", {
                "calcext:type": "maximum",
                "calcext:color": "#00FF00",
              }),
            ]),
          ],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats, residueElements } = readConditionalFormats(table, pkg);
    expect(residueElements).toEqual([]);
    expect(formats).toStrictEqual([
      {
        type: "colorScale",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 9, endColumn: 0 }],
        stops: [
          { value: { type: "min" }, color: { r: 1, g: 0, b: 0 } },
          { value: { type: "max" }, color: { r: 0, g: 1, b: 0 } },
        ],
      },
    ]);
  });

  it("falls back to residue for an icon-set with no formatting-entry thresholds at all", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A10" },
          [el("calcext:icon-set", { "calcext:icon-set-type": "3Arrows" }, [])],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats, residueElements } = readConditionalFormats(table, pkg);
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });

  it("reads a data-bar's thresholds from the alternate calcext:data-bar-entry tag, not just calcext:formatting-entry", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A10" },
          [
            el("calcext:data-bar", { "calcext:positive-color": "#638EC6" }, [
              el("calcext:data-bar-entry", { "calcext:type": "minimum" }),
              el("calcext:data-bar-entry", { "calcext:type": "maximum" }),
            ]),
          ],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "dataBar",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 9, endColumn: 0 }],
        min: { type: "min" },
        max: { type: "max" },
        color: {
          r: 0.38823529411764707,
          g: 0.5568627450980392,
          b: 0.7764705882352941,
        },
      },
    ]);
  });

  it("promotes an icon-set with a real calcext:show-value flag, distinguishing it from a data-bar that declares none at all", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A10" },
          [
            el(
              "calcext:icon-set",
              {
                "calcext:icon-set-type": "3Arrows",
                "calcext:show-value": "false",
              },
              [
                el("calcext:formatting-entry", {
                  "calcext:type": "percent",
                  "calcext:value": "33",
                }),
                el("calcext:formatting-entry", {
                  "calcext:type": "percent",
                  "calcext:value": "67",
                }),
              ],
            ),
          ],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "iconSet",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 9, endColumn: 0 }],
        iconSetType: "3Arrows",
        thresholds: [
          { type: "percent", value: "33" },
          { type: "percent", value: "67" },
        ],
        showValue: false,
      },
    ]);
  });

  it("promotes an icon-set with calcext:show-value='true' as a real true, not just as 'not false'", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A10" },
          [
            el(
              "calcext:icon-set",
              {
                "calcext:icon-set-type": "3Arrows",
                "calcext:show-value": "true",
              },
              [
                el("calcext:formatting-entry", {
                  "calcext:type": "percent",
                  "calcext:value": "50",
                }),
              ],
            ),
          ],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "iconSet",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 9, endColumn: 0 }],
        iconSetType: "3Arrows",
        thresholds: [{ type: "percent", value: "50" }],
        showValue: true,
      },
    ]);
  });

  it("resolves a date-is rule's own calcext:style into a real style, exactly as a condition's apply-style-name does", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [
            el("calcext:date-is", {
              "calcext:date": "today",
              "calcext:style": "Warn",
            }),
          ],
        ),
      ]),
    );
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:automatic-styles", {}, [
                el(
                  "style:style",
                  { "style:name": "Warn", "style:family": "table-cell" },
                  [el("style:text-properties", { "fo:color": "#CC0000" })],
                ),
              ]),
              el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
            ]),
          ],
        },
      },
    };
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "timePeriod",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        timePeriod: "today",
        style: { textColor: { r: 0.8, g: 0, b: 0 } },
      },
    ]);
  });

  it("falls back to residue for a wrapper whose only rule child is an element tag this reader does not recognise at all", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [el("calcext:some-future-rule-kind", {})],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats, residueElements } = readConditionalFormats(table, pkg);
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });

  it("silently ignores an unrecognised sibling rule element rather than turning an otherwise-promotable format into residue", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [
            el("calcext:condition", { "calcext:value": "unique" }),
            el("calcext:some-future-rule-kind", {}),
          ],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats, residueElements } = readConditionalFormats(table, pkg);
    expect(residueElements).toEqual([]);
    expect(formats).toStrictEqual([
      {
        type: "uniqueValues",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      },
    ]);
  });

  it("promotes a colour-scale rule", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.A1:Sheet1.A10",
          },
          [
            el("calcext:color-scale", {}, [
              el("calcext:color-scale-entry", {
                "calcext:type": "minimum",
                "calcext:color": "#FF0000",
              }),
              el("calcext:color-scale-entry", {
                "calcext:type": "percentile",
                "calcext:value": "50",
                "calcext:color": "#FFFF00",
              }),
              el("calcext:color-scale-entry", {
                "calcext:type": "maximum",
                "calcext:color": "#00FF00",
              }),
            ]),
          ],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "colorScale",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 9, endColumn: 0 }],
        stops: [
          { value: { type: "min" }, color: { r: 1, g: 0, b: 0 } },
          {
            value: { type: "percentile", value: "50" },
            color: { r: 1, g: 1, b: 0 },
          },
          { value: { type: "max" }, color: { r: 0, g: 1, b: 0 } },
        ],
      },
    ]);
  });

  it("promotes a data-bar rule from its own positive-color and two formatting-entry thresholds", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.A1:Sheet1.A10",
          },
          [
            el(
              "calcext:data-bar",
              {
                "calcext:positive-color": "#638EC6",
                "calcext:show-value": "true",
              },
              [
                el("calcext:formatting-entry", { "calcext:type": "minimum" }),
                el("calcext:formatting-entry", { "calcext:type": "maximum" }),
              ],
            ),
          ],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "dataBar",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 9, endColumn: 0 }],
        min: { type: "min" },
        max: { type: "max" },
        color: {
          r: 0.38823529411764707,
          g: 0.5568627450980392,
          b: 0.7764705882352941,
        },
        showValue: true,
      },
    ]);
  });

  it("promotes an icon-set rule, carrying its own icon-set-type string through verbatim (an open, producer-extensible vocabulary)", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.A1:Sheet1.A10",
          },
          [
            el("calcext:icon-set", { "calcext:icon-set-type": "3Arrows" }, [
              el("calcext:formatting-entry", {
                "calcext:type": "percent",
                "calcext:value": "33",
              }),
              el("calcext:formatting-entry", {
                "calcext:type": "percent",
                "calcext:value": "67",
              }),
            ]),
          ],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "iconSet",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 9, endColumn: 0 }],
        iconSetType: "3Arrows",
        thresholds: [
          { type: "percent", value: "33" },
          { type: "percent", value: "67" },
        ],
      },
    ]);
  });

  it("promotes a date-is rule, including the year-scoped periods xlsx's own ST_TimePeriod has no member for", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.A1:Sheet1.A1",
          },
          [el("calcext:date-is", { "calcext:date": "last-7-days" })],
        ),
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.B1:Sheet1.B1",
          },
          [el("calcext:date-is", { "calcext:date": "this-year" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "timePeriod",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        timePeriod: "last7Days",
      },
      {
        type: "timePeriod",
        ranges: [{ startRow: 0, startColumn: 1, endRow: 0, endColumn: 1 }],
        timePeriod: "thisYear",
      },
    ]);
  });

  it("promotes several rule children under one wrapper, sharing that wrapper's own ranges", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.A1:Sheet1.A5",
          },
          [
            el("calcext:condition", { "calcext:value": "unique" }),
            el("calcext:condition", { "calcext:value": "is-error" }),
          ],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toHaveLength(2);
    expect(formats[0]?.ranges).toEqual(formats[1]?.ranges);
    expect(formats.map((format) => format.type)).toEqual([
      "uniqueValues",
      "containsErrors",
    ]);
  });

  it("falls back to a synthetic whole-rule residue clone for a formula-is condition (the same closed-form boundary xlsx's own 'expression' cfRule type draws)", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.A1:Sheet1.A1",
          },
          [el("calcext:condition", { "calcext:value": "formula-is(A1>B1)" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats, residueElements } = readConditionalFormats(table, pkg);
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
    expect(residueElements[0]?.tag).toBe("calcext:conditional-formats");
  });

  it("falls back to residue for an unmapped colour-scale entry type (auto-minimum/auto-maximum, a LibreOffice concept ECMA-376's own cfvo enum has no member for)", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "Sheet1.A1:Sheet1.A10",
          },
          [
            el("calcext:color-scale", {}, [
              el("calcext:color-scale-entry", {
                "calcext:type": "auto-minimum",
                "calcext:color": "#FF0000",
              }),
              el("calcext:color-scale-entry", {
                "calcext:type": "maximum",
                "calcext:color": "#00FF00",
              }),
            ]),
          ],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats, residueElements } = readConditionalFormats(table, pkg);
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });

  it("falls back to residue when target-range-address parses to no range at all", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          {
            "calcext:target-range-address": "not a range",
          },
          [el("calcext:condition", { "calcext:value": "unique" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats, residueElements } = readConditionalFormats(table, pkg);
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });

  it("returns empty results for a table with no calcext:conditional-formats element at all", () => {
    const table = tableWith(el("table:table-row", {}));
    const pkg = conditionalFormatsPackage(table);
    expect(readConditionalFormats(table, pkg)).toEqual({
      formats: [],
      residueElements: [],
    });
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
