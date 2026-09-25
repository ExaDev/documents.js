import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import type {} from "document-schema.js";
import { readConditionalFormats } from "./conditional-format";

// calcext:conditional-formats has no OASIS-published grammar at all — every value/attribute name exercised here is transcribed from LibreOffice's own real reader (sc/source/filter/xml/xmlcondformat.cxx), see conditional-format.ts's own top-of-file note for the exact source functions. A real LibreOffice-produced fixture (fixtures/conditional-format.ods) exists and is exercised in read.test.ts's own "conditional-format.ods (real LibreOffice output)" describe block — it directly caught a real entity-decoding bug this file's own synthetic cases below could not have found on their own (a producer that escapes '>' as '&gt;' in calcext:value), since a hand-built package only ever contains what its author thought to escape. Every OTHER variant exercised here (colour-scale, data-bar, icon-set, date-is, every condition mode) has no real fixture available, so those packages are hand-built (el/txt) to the identical wire shape xmlcondformat.cxx establishes, matching data-validation.test.ts's own established fallback for a producer-specific mini-language a real fixture wasn't available for.

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

  it('decodes an XML-escaped comparison operator (a real LibreOffice producer writes calcext:value=">3" as literally &gt;3 on disk — typed/ods/fixtures/conditional-format.ods\'s own content.xml, confirmed directly)', () => {
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

  it("falls back to residue for a top-elements/bottom-elements/top-percent/bottom-percent condition with no operand at all (no parenthesised rank to extract)", () => {
    for (const value of [
      "top-elements",
      "bottom-elements",
      "top-percent",
      "bottom-percent",
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

  it("promotes a duplicate-values rule read back from calcext:condition, not just parsed in isolation", () => {
    const table = tableWith(
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [el("calcext:condition", { "calcext:value": "duplicate" })],
        ),
      ]),
    );
    const pkg = conditionalFormatsPackage(table);
    const { formats } = readConditionalFormats(table, pkg);
    expect(formats).toStrictEqual([
      {
        type: "duplicateValues",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      },
    ]);
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
});
