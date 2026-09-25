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
