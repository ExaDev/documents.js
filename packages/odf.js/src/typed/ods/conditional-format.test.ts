import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import {
  parseConditionValue,
  readConditionalFormats,
  readTargetRangeList,
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
    expect(formats).toEqual([
      {
        type: "cellIs",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 9, endColumn: 0 }],
        operator: "between",
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
    expect(formats).toEqual([
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
    expect(formats).toEqual([
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
    expect(formats).toEqual([
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
    expect(formats).toEqual([
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
    expect(formats).toEqual([
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
    expect(formats).toEqual([
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
    expect(formats).toEqual([
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
