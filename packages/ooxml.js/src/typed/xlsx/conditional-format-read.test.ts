import { describe, expect, it } from "vitest";
import type { ContentSheetConditionalFormat } from "document-schema.js";
import { el } from "../../xml/fragment";
import { childrenWithTag } from "../util";
import { readConditionalFormats } from "./conditional-format";
import {
  buildConditionalFormattingElements,
  DxfTable,
} from "./conditional-format-write";
function hasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}

// A worksheet carrying exactly one <conditionalFormatting> wrapper with exactly one <cfRule> child, so every test below can build just the cfRule's own attributes/children and get back formats[0]/residueElements[0] directly.
function worksheetWithRule(
  sqref: string,
  cfRule: ReturnType<typeof el>,
  dxfs: readonly ReturnType<typeof el>[] = [],
): {
  formats: ContentSheetConditionalFormat[];
  residueElements: ReturnType<typeof el>[];
} {
  const worksheet = el("worksheet", {}, [
    el("conditionalFormatting", { sqref }, [cfRule]),
  ]);
  return readConditionalFormats(worksheet, dxfs);
}

function buildOneRule(format: ContentSheetConditionalFormat): {
  conditionalFormatting: ReturnType<typeof el>;
  dxfTable: DxfTable;
} {
  const dxfTable = new DxfTable();
  const [conditionalFormatting] = buildConditionalFormattingElements(
    [format],
    dxfTable,
  );
  if (conditionalFormatting === undefined) {
    throw new Error("expected one conditionalFormatting element");
  }
  return { conditionalFormatting, dxfTable };
}

function firstCfRule(conditionalFormatting: ReturnType<typeof el>) {
  const rule = childrenWithTag(conditionalFormatting, "cfRule")[0];
  if (rule === undefined) {
    throw new Error("expected a cfRule");
  }
  return rule;
}

describe("readCfRule: top10's rank boundary", () => {
  it("rejects rank 0 and negative rank, dropping the rule to residue", () => {
    for (const rank of ["0", "-1"]) {
      const { formats, residueElements } = worksheetWithRule(
        "A1",
        el("cfRule", { type: "top10", rank, priority: "1" }),
      );
      expect(formats).toEqual([]);
      expect(residueElements).toHaveLength(1);
    }
  });

  it("accepts rank 1 (the boundary itself) and states percent/bottom only when explicitly true", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", {
        type: "top10",
        rank: "1",
        percent: "1",
        bottom: "1",
        priority: "1",
      }),
    );
    const format = formats[0];
    expect(format?.type === "top10" ? format.rank : undefined).toBe(1);
    expect(format?.type === "top10" ? format.percent : undefined).toBe(true);
    expect(format?.type === "top10" ? format.bottom : undefined).toBe(true);
  });

  it("omits percent/bottom entirely when neither attribute is set", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "top10", rank: "5", priority: "1" }),
    );
    expect(hasOwn(formats[0] ?? {}, "percent")).toBe(false);
    expect(hasOwn(formats[0] ?? {}, "bottom")).toBe(false);
  });
});

describe("readCfRule: aboveAverage's own true-default and stdDev boundary", () => {
  it("states aboveAverage: false only for an explicit false value, and nothing for an absent or true value", () => {
    const explicit = worksheetWithRule(
      "A1",
      el("cfRule", { type: "aboveAverage", aboveAverage: "0", priority: "1" }),
    ).formats[0];
    expect(
      explicit?.type === "aboveAverage" ? explicit.aboveAverage : undefined,
    ).toBe(false);
    const absent = worksheetWithRule(
      "A1",
      el("cfRule", { type: "aboveAverage", priority: "1" }),
    ).formats[0];
    expect(hasOwn(absent ?? {}, "aboveAverage")).toBe(false);
  });

  it("states equalAverage: true only for an explicit true value", () => {
    const format = worksheetWithRule(
      "A1",
      el("cfRule", { type: "aboveAverage", equalAverage: "1", priority: "1" }),
    ).formats[0];
    expect(
      format?.type === "aboveAverage" ? format.equalAverage : undefined,
    ).toBe(true);
  });

  it("rejects stdDev 0, keeping the rule but omitting the stdDev key", () => {
    const format = worksheetWithRule(
      "A1",
      el("cfRule", { type: "aboveAverage", stdDev: "0", priority: "1" }),
    ).formats[0];
    expect(hasOwn(format ?? {}, "stdDev")).toBe(false);
  });

  it("accepts stdDev 1 (the boundary itself)", () => {
    const format = worksheetWithRule(
      "A1",
      el("cfRule", { type: "aboveAverage", stdDev: "1", priority: "1" }),
    ).formats[0];
    expect(format?.type === "aboveAverage" ? format.stdDev : undefined).toBe(1);
  });
});

describe("readCfRule: colorScale/iconSet type discrimination", () => {
  it('reads type "colorScale" as the colorScale kind, not falling through to residue', () => {
    const { formats } = worksheetWithRule(
      "A1:B2",
      el("cfRule", { type: "colorScale", priority: "1" }, [
        el("colorScale", {}, [
          el("cfvo", { type: "min" }),
          el("cfvo", { type: "max" }),
          el("color", { rgb: "FFFF0000" }),
          el("color", { rgb: "FF0000FF" }),
        ]),
      ]),
    );
    expect(formats[0]?.type).toBe("colorScale");
  });

  it('reads type "iconSet" as the iconSet kind, not falling through to residue', () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "iconSet", priority: "1" }, [
        el("iconSet", {}, [el("cfvo", { type: "percent", val: "33" })]),
      ]),
    );
    expect(formats[0]?.type).toBe("iconSet");
  });

  it("rejects an unrecognised cfRule type even when it happens to carry an <iconSet> child, rather than misreading it as the iconSet kind", () => {
    const { formats, residueElements } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "expression", priority: "1" }, [
        el("iconSet", {}, [el("cfvo", { type: "percent", val: "33" })]),
      ]),
    );
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });
});

// --- the write side ---------------------------------------------------------------------------------------------

describe("buildCfRuleElement: cellIs formula/formula2 elements", () => {
  it("writes exactly one <formula> for a formula1-only rule", () => {
    const { conditionalFormatting } = buildOneRule({
      type: "cellIs",
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      operator: "greaterThan",
      formula1: "5",
    });
    const rule = firstCfRule(conditionalFormatting);
    expect(childrenWithTag(rule, "formula")).toHaveLength(1);
  });

  it("writes two <formula> elements, in order, for a formula1+formula2 rule", () => {
    const { conditionalFormatting } = buildOneRule({
      type: "cellIs",
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      operator: "between",
      formula1: "1",
      formula2: "10",
    });
    const rule = firstCfRule(conditionalFormatting);
    const formulas = childrenWithTag(rule, "formula").map((f) => {
      const t = f.children[0];
      return t?.type === "text" ? t.value : undefined;
    });
    expect(formulas).toEqual(["1", "10"]);
  });
});

describe("buildCfRuleElement: residualAttributesFor's own expectedTag gate", () => {
  it("restores an unmanaged residual attribute (a real one this schema does not model) back onto the built cfRule", () => {
    const rule = firstCfRule(
      buildOneRule({
        type: "containsBlanks",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        source: {
          format: "xlsx",
          xml: '<cfRule pivot="1"></cfRule>',
        },
      }).conditionalFormatting,
    );
    expect(rule.attributes.find((a) => a.name === "pivot")?.value).toBe("1");
  });
});

describe("rangeSetKey: distinguishes ranges by the separator between fields, not just concatenation", () => {
  it("groups a single 10:0-1:1 range separately from two adjacent 1:0-1:1/0:1-1:1 ranges, even though naive concatenation without a separator would collide", () => {
    const elements = buildConditionalFormattingElements(
      [
        {
          type: "containsBlanks",
          ranges: [{ startRow: 10, startColumn: 0, endRow: 1, endColumn: 1 }],
        },
        {
          type: "containsErrors",
          ranges: [
            { startRow: 1, startColumn: 0, endRow: 1, endColumn: 1 },
            { startRow: 0, startColumn: 1, endRow: 1, endColumn: 1 },
          ],
        },
      ],
      new DxfTable(),
    );
    expect(elements).toHaveLength(2);
  });

  it("distinguishes two range sets whose per-range keys, once joined without a separator between ranges, would collide into the identical string", () => {
    const elements = buildConditionalFormattingElements(
      [
        {
          type: "containsBlanks",
          ranges: [
            { startRow: 1, startColumn: 0, endRow: 0, endColumn: 12 },
            { startRow: 3, startColumn: 0, endRow: 0, endColumn: 1 },
          ],
        },
        {
          type: "containsErrors",
          ranges: [
            { startRow: 1, startColumn: 0, endRow: 0, endColumn: 1 },
            { startRow: 23, startColumn: 0, endRow: 0, endColumn: 1 },
          ],
        },
      ],
      new DxfTable(),
    );
    expect(elements).toHaveLength(2);
  });
});

describe("buildCfRuleElement: top10's percent/bottom attribute presence", () => {
  it("writes bottom='1' only when bottom is true, and omits it entirely otherwise", () => {
    const withBottom = firstCfRule(
      buildOneRule({
        type: "top10",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        rank: 5,
        bottom: true,
      }).conditionalFormatting,
    );
    expect(childrenWithTag).toBeDefined();
    const bottomAttr = withBottom.attributes.find((a) => a.name === "bottom");
    expect(bottomAttr?.value).toBe("true");

    const withoutBottom = firstCfRule(
      buildOneRule({
        type: "top10",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        rank: 5,
      }).conditionalFormatting,
    );
    expect(withoutBottom.attributes.some((a) => a.name === "bottom")).toBe(
      false,
    );
  });

  it("writes percent='true' only when percent is true, and omits it entirely otherwise", () => {
    const withPercent = firstCfRule(
      buildOneRule({
        type: "top10",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        rank: 5,
        percent: true,
      }).conditionalFormatting,
    );
    expect(
      withPercent.attributes.find((a) => a.name === "percent")?.value,
    ).toBe("true");
    const withoutPercent = firstCfRule(
      buildOneRule({
        type: "top10",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        rank: 5,
      }).conditionalFormatting,
    );
    expect(withoutPercent.attributes.some((a) => a.name === "percent")).toBe(
      false,
    );
  });
});

describe("buildCfRuleElement: aboveAverage's own three independent flags", () => {
  it("writes aboveAverage='0' only when aboveAverage is explicitly false", () => {
    const rule = firstCfRule(
      buildOneRule({
        type: "aboveAverage",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        aboveAverage: false,
      }).conditionalFormatting,
    );
    expect(rule.attributes.find((a) => a.name === "aboveAverage")?.value).toBe(
      "false",
    );
    const defaultRule = firstCfRule(
      buildOneRule({
        type: "aboveAverage",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      }).conditionalFormatting,
    );
    expect(defaultRule.attributes.some((a) => a.name === "aboveAverage")).toBe(
      false,
    );
  });

  it("writes equalAverage='true' only when equalAverage is explicitly true, and omits it otherwise", () => {
    const rule = firstCfRule(
      buildOneRule({
        type: "aboveAverage",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        equalAverage: true,
      }).conditionalFormatting,
    );
    expect(rule.attributes.find((a) => a.name === "equalAverage")?.value).toBe(
      "true",
    );
    const withoutEqualAverage = firstCfRule(
      buildOneRule({
        type: "aboveAverage",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      }).conditionalFormatting,
    );
    expect(
      withoutEqualAverage.attributes.some((a) => a.name === "equalAverage"),
    ).toBe(false);
  });

  it("writes stdDev only when it is genuinely present, never a phantom stdDev attribute", () => {
    const rule = firstCfRule(
      buildOneRule({
        type: "aboveAverage",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        stdDev: 2,
      }).conditionalFormatting,
    );
    expect(rule.attributes.find((a) => a.name === "stdDev")?.value).toBe("2");
    const withoutStdDev = firstCfRule(
      buildOneRule({
        type: "aboveAverage",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      }).conditionalFormatting,
    );
    expect(withoutStdDev.attributes.some((a) => a.name === "stdDev")).toBe(
      false,
    );
  });
});

describe("buildCfRuleElement: colorScale/dataBar/iconSet element shape", () => {
  it("writes one <colorScale> with every cfvo before every color, in stop order", () => {
    const rule = firstCfRule(
      buildOneRule({
        type: "colorScale",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        stops: [
          { value: { type: "min" }, color: { r: 1, g: 0, b: 0 } },
          { value: { type: "max" }, color: { r: 0, g: 0, b: 1 } },
        ],
      }).conditionalFormatting,
    );
    const colorScale = childrenWithTag(rule, "colorScale")[0];
    if (colorScale === undefined) {
      throw new Error("expected colorScale");
    }
    const tags = colorScale.children
      .filter((c) => c.type === "element")
      .map((c) => c.tag);
    expect(tags).toEqual(["cfvo", "cfvo", "color", "color"]);
    const colors = childrenWithTag(colorScale, "color").map(
      (c) => c.attributes.find((a) => a.name === "rgb")?.value,
    );
    expect(colors).toEqual(["FFff0000", "FF0000ff"]);
  });

  it("writes dataBar's showValue on the <dataBar> element itself, not the <cfRule>", () => {
    const rule = firstCfRule(
      buildOneRule({
        type: "dataBar",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        min: { type: "min" },
        max: { type: "max" },
        color: { r: 1, g: 0, b: 0 },
        showValue: false,
      }).conditionalFormatting,
    );
    expect(rule.attributes.some((a) => a.name === "showValue")).toBe(false);
    const dataBar = childrenWithTag(rule, "dataBar")[0];
    expect(dataBar?.attributes.find((a) => a.name === "showValue")?.value).toBe(
      "false",
    );
    const withoutShowValue = firstCfRule(
      buildOneRule({
        type: "dataBar",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        min: { type: "min" },
        max: { type: "max" },
        color: { r: 1, g: 0, b: 0 },
      }).conditionalFormatting,
    );
    const defaultDataBar = childrenWithTag(withoutShowValue, "dataBar")[0];
    expect(defaultDataBar?.attributes.some((a) => a.name === "showValue")).toBe(
      false,
    );
  });

  it("writes iconSet's iconSet attribute only for a non-default iconSetType", () => {
    const defaultType = firstCfRule(
      buildOneRule({
        type: "iconSet",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        iconSetType: "3TrafficLights1",
        thresholds: [{ type: "percent", value: "33" }],
      }).conditionalFormatting,
    );
    const defaultIconSet = childrenWithTag(defaultType, "iconSet")[0];
    expect(defaultIconSet?.attributes.some((a) => a.name === "iconSet")).toBe(
      false,
    );

    const customType = firstCfRule(
      buildOneRule({
        type: "iconSet",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        iconSetType: "3Arrows",
        thresholds: [{ type: "percent", value: "33" }],
      }).conditionalFormatting,
    );
    const customIconSet = childrenWithTag(customType, "iconSet")[0];
    expect(
      customIconSet?.attributes.find((a) => a.name === "iconSet")?.value,
    ).toBe("3Arrows");
  });

  it("writes iconSet's reverse and showValue only when explicitly set", () => {
    const rule = firstCfRule(
      buildOneRule({
        type: "iconSet",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        iconSetType: "3TrafficLights1",
        thresholds: [{ type: "percent", value: "33" }],
        reverse: true,
        showValue: false,
      }).conditionalFormatting,
    );
    const iconSet = childrenWithTag(rule, "iconSet")[0];
    expect(iconSet?.attributes.find((a) => a.name === "reverse")?.value).toBe(
      "true",
    );
    expect(iconSet?.attributes.find((a) => a.name === "showValue")?.value).toBe(
      "false",
    );
    const withoutFlags = childrenWithTag(
      firstCfRule(
        buildOneRule({
          type: "iconSet",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          iconSetType: "3TrafficLights1",
          thresholds: [{ type: "percent", value: "33" }],
        }).conditionalFormatting,
      ),
      "iconSet",
    )[0];
    expect(withoutFlags?.attributes.some((a) => a.name === "reverse")).toBe(
      false,
    );
    expect(withoutFlags?.attributes.some((a) => a.name === "showValue")).toBe(
      false,
    );
  });
});

describe("buildConditionalFormattingElements: range grouping and priority assignment", () => {
  it("groups two rules sharing the identical range set into one conditionalFormatting wrapper", () => {
    const range = { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 };
    const elements = buildConditionalFormattingElements(
      [
        { type: "containsBlanks", ranges: [range] },
        { type: "containsErrors", ranges: [range] },
      ],
      new DxfTable(),
    );
    expect(elements).toHaveLength(1);
    expect(childrenWithTag(elements[0] ?? el("x"), "cfRule")).toHaveLength(2);
  });

  it("splits two rules with genuinely different range sets into two separate wrappers", () => {
    const elements = buildConditionalFormattingElements(
      [
        {
          type: "containsBlanks",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        },
        {
          type: "containsErrors",
          ranges: [{ startRow: 1, startColumn: 1, endRow: 1, endColumn: 1 }],
        },
      ],
      new DxfTable(),
    );
    expect(elements).toHaveLength(2);
  });

  it("assigns explicit priorities verbatim, and fills the gap for an unpriorised rule rather than colliding with it", () => {
    const elements = buildConditionalFormattingElements(
      [
        {
          type: "containsBlanks",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          priority: 1,
        },
        {
          type: "containsErrors",
          ranges: [{ startRow: 1, startColumn: 1, endRow: 1, endColumn: 1 }],
        },
      ],
      new DxfTable(),
    );
    const priorities = elements.flatMap((wrapper) =>
      childrenWithTag(wrapper, "cfRule").map(
        (rule) => rule.attributes.find((a) => a.name === "priority")?.value,
      ),
    );
    // The unpriorised rule must NOT reuse "1" (already explicitly claimed) — it gets the next free integer, "2".
    expect(
      [...priorities].sort((a, b) => (a ?? "").localeCompare(b ?? "")),
    ).toEqual(["1", "2"]);
  });

  it("assigns sequential priorities to two unpriorised rules sharing one range, in document order", () => {
    const range = { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 };
    const elements = buildConditionalFormattingElements(
      [
        { type: "containsBlanks", ranges: [range] },
        { type: "containsErrors", ranges: [range] },
      ],
      new DxfTable(),
    );
    const priorities = childrenWithTag(elements[0] ?? el("x"), "cfRule").map(
      (rule) => rule.attributes.find((a) => a.name === "priority")?.value,
    );
    expect(priorities).toEqual(["1", "2"]);
  });
});
