import { describe, expect, it } from "vitest";
import type { ContentSheetConditionalFormat } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { childrenWithTag } from "../util";
import {
  DxfTable,
  buildConditionalFormattingElements,
  readConditionalFormats,
} from "./conditional-format";

function hasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}

// A worksheet carrying exactly one <conditionalFormatting> wrapper with exactly one <cfRule> child, so every test below can build just the cfRule's own attributes/children and get back formats[0]/residueElements[0] directly.
function worksheetWithRule(
  sqref: string,
  cfRule: ReturnType<typeof el>,
  dxfs: ReturnType<typeof el>[] = [],
): {
  formats: ContentSheetConditionalFormat[];
  residueElements: ReturnType<typeof el>[];
} {
  const worksheet = el("worksheet", {}, [
    el("conditionalFormatting", { sqref }, [cfRule]),
  ]);
  return readConditionalFormats(worksheet, dxfs);
}

describe("readConditionalFormats: the wrapper's own sqref gates every rule inside it", () => {
  it("quarantines every cfRule as residue when the wrapper's own sqref parses to no range at all", () => {
    const { formats, residueElements } = worksheetWithRule(
      "not a ref",
      el("cfRule", { type: "containsBlanks", dxfId: "0", priority: "1" }),
    );
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });
});

describe("readCommonFields: priority and stopIfTrue", () => {
  it("states no priority for a non-integer priority attribute", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", {
        type: "containsBlanks",
        priority: "not-a-number",
      }),
    );
    expect(hasOwn(formats[0] ?? {}, "priority")).toBe(false);
  });

  it("states stopIfTrue: true only for an explicit true value, and omits the key entirely otherwise", () => {
    const { formats: withStop } = worksheetWithRule(
      "A1",
      el("cfRule", {
        type: "containsBlanks",
        priority: "1",
        stopIfTrue: "1",
      }),
    );
    expect(withStop[0]?.stopIfTrue).toBe(true);
    const { formats: withoutStop } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "containsBlanks", priority: "1" }),
    );
    expect(hasOwn(withoutStop[0] ?? {}, "stopIfTrue")).toBe(false);
  });

  it("captures a genuinely unrecognised cfRule attribute as source residue, and states no source when every attribute is a managed one", () => {
    const { formats: withResidue } = worksheetWithRule(
      "A1",
      el("cfRule", {
        type: "containsBlanks",
        priority: "1",
        "x14ac:extraAttr": "value",
      }),
    );
    expect(withResidue[0]?.source).toBeDefined();
    const { formats: withoutResidue } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "containsBlanks", priority: "1" }),
    );
    expect(hasOwn(withoutResidue[0] ?? {}, "source")).toBe(false);
  });
});

describe("isSheetRuleOperator: every accepted member, distinctly", () => {
  function operatorOf(operator: string): string | undefined {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "cellIs", operator, priority: "1" }, [
        el("formula", {}, [txt("1")]),
      ]),
    );
    const format = formats[0];
    return format?.type === "cellIs" ? format.operator : undefined;
  }

  for (const operator of [
    "between",
    "notBetween",
    "equal",
    "notEqual",
    "greaterThan",
    "greaterThanOrEqual",
    "lessThan",
    "lessThanOrEqual",
  ]) {
    it(`accepts "${operator}"`, () => {
      expect(operatorOf(operator)).toBe(operator);
    });
  }

  it("rejects an unrecognised operator token, dropping the rule to residue", () => {
    const { formats, residueElements } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "cellIs", operator: "bogus", priority: "1" }, [
        el("formula", {}, [txt("1")]),
      ]),
    );
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });
});

describe("readCfRule: cellIs formula2 for notBetween too, not just between", () => {
  it("carries formula2 for a notBetween operator", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "cellIs", operator: "notBetween", priority: "1" }, [
        el("formula", {}, [txt("1")]),
        el("formula", {}, [txt("10")]),
      ]),
    );
    const format = formats[0];
    expect(format?.type === "cellIs" ? format.formula2 : undefined).toBe("10");
  });
});

describe("isTimePeriod: rejects an absent timePeriod attribute, dropping the rule to residue", () => {
  it("drops a timePeriod rule with no timePeriod attribute at all", () => {
    const { formats, residueElements } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "timePeriod", priority: "1" }),
    );
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });
});

describe("readCfvo: exact type-token membership", () => {
  function cfvoType(type: string): string | undefined {
    const { formats } = worksheetWithRule(
      "A1:B2",
      el("cfRule", { type: "colorScale", priority: "1" }, [
        el("colorScale", {}, [
          el("cfvo", { type, val: "0" }),
          el("cfvo", { type: "max" }),
          el("color", { rgb: "FFFF0000" }),
          el("color", { rgb: "FF0000FF" }),
        ]),
      ]),
    );
    const format = formats[0];
    return format?.type === "colorScale"
      ? format.stops[0]?.value.type
      : undefined;
  }

  it('recognises "num"', () => {
    expect(cfvoType("num")).toBe("num");
  });

  it('recognises "formula"', () => {
    expect(cfvoType("formula")).toBe("formula");
  });

  it('recognises "percentile"', () => {
    expect(cfvoType("percentile")).toBe("percentile");
  });

  it("rejects an unrecognised type token, dropping the whole colorScale rule to residue", () => {
    const { formats, residueElements } = worksheetWithRule(
      "A1:B2",
      el("cfRule", { type: "colorScale", priority: "1" }, [
        el("colorScale", {}, [
          el("cfvo", { type: "bogus", val: "0" }),
          el("cfvo", { type: "max" }),
          el("color", { rgb: "FFFF0000" }),
          el("color", { rgb: "FF0000FF" }),
        ]),
      ]),
    );
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });
});

function colorScaleFormats(cfvoAndColor: ReturnType<typeof el>[]) {
  return worksheetWithRule(
    "A1:B2",
    el("cfRule", { type: "colorScale", priority: "1" }, [
      el("colorScale", {}, cfvoAndColor),
    ]),
  );
}

describe("readColorScaleStops: the cfvo/color count boundary (2..3 stops, matched counts)", () => {
  it("rejects a colorScale whose cfvo/color counts genuinely mismatch, dropping the rule to residue", () => {
    const { formats, residueElements } = colorScaleFormats([
      el("cfvo", { type: "min" }),
      el("cfvo", { type: "max" }),
      el("color", { rgb: "FFFF0000" }),
    ]);
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });

  it("rejects a single-stop colorScale (below the 2-stop minimum)", () => {
    const { formats, residueElements } = colorScaleFormats([
      el("cfvo", { type: "min" }),
      el("color", { rgb: "FFFF0000" }),
    ]);
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });

  it("accepts exactly 2 stops (the minimum boundary itself)", () => {
    const { formats } = colorScaleFormats([
      el("cfvo", { type: "min" }),
      el("cfvo", { type: "max" }),
      el("color", { rgb: "FFFF0000" }),
      el("color", { rgb: "FF0000FF" }),
    ]);
    expect(formats[0]?.type).toBe("colorScale");
  });

  it("accepts exactly 3 stops (the maximum boundary itself)", () => {
    const { formats } = colorScaleFormats([
      el("cfvo", { type: "min" }),
      el("cfvo", { type: "percentile", val: "50" }),
      el("cfvo", { type: "max" }),
      el("color", { rgb: "FFFF0000" }),
      el("color", { rgb: "FF00FF00" }),
      el("color", { rgb: "FF0000FF" }),
    ]);
    expect(formats[0]?.type).toBe("colorScale");
  });

  it("rejects a 4-stop colorScale (above the 3-stop maximum), even though the counts still match", () => {
    const { formats, residueElements } = colorScaleFormats([
      el("cfvo", { type: "min" }),
      el("cfvo", { type: "percentile", val: "25" }),
      el("cfvo", { type: "percentile", val: "75" }),
      el("cfvo", { type: "max" }),
      el("color", { rgb: "FFFF0000" }),
      el("color", { rgb: "FF00FF00" }),
      el("color", { rgb: "FF00FFFF" }),
      el("color", { rgb: "FF0000FF" }),
    ]);
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });
});

describe("readDataBar: showValue's own default-is-true convention", () => {
  function dataBarShowValue(showValue?: string): boolean | undefined {
    const attrs: Record<string, string> = {};
    if (showValue !== undefined) {
      attrs.showValue = showValue;
    }
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "dataBar", priority: "1" }, [
        el("dataBar", attrs, [
          el("cfvo", { type: "min" }),
          el("cfvo", { type: "max" }),
          el("color", { rgb: "FFFF0000" }),
        ]),
      ]),
    );
    const format = formats[0];
    return format?.type === "dataBar" ? format.showValue : undefined;
  }

  it("states no showValue key at all when the attribute is absent (the true default)", () => {
    expect(hasOwn({ v: dataBarShowValue(undefined) }, "v")).toBe(true);
    expect(dataBarShowValue(undefined)).toBeUndefined();
  });

  it("states showValue: false only for an explicit false value", () => {
    expect(dataBarShowValue("0")).toBe(false);
  });

  it("states no showValue at all for an explicit true value (matching the default, nothing to record)", () => {
    expect(dataBarShowValue("1")).toBeUndefined();
  });
});

describe("readIconSet: reverse, showValue, and the empty-thresholds rejection", () => {
  it("rejects an iconSet with no cfvo thresholds at all, dropping the rule to residue", () => {
    const { formats, residueElements } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "iconSet", priority: "1" }, [el("iconSet", {})]),
    );
    expect(formats).toEqual([]);
    expect(residueElements).toHaveLength(1);
  });

  it("states reverse: true only for an explicit true value", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "iconSet", priority: "1" }, [
        el("iconSet", { reverse: "1" }, [
          el("cfvo", { type: "percent", val: "33" }),
        ]),
      ]),
    );
    const format = formats[0];
    expect(format?.type === "iconSet" ? format.reverse : undefined).toBe(true);
  });

  it("states showValue: false only for an explicit false value, and nothing for an explicit true", () => {
    const falseCase = worksheetWithRule(
      "A1",
      el("cfRule", { type: "iconSet", priority: "1" }, [
        el("iconSet", { showValue: "0" }, [
          el("cfvo", { type: "percent", val: "33" }),
        ]),
      ]),
    ).formats[0];
    expect(
      falseCase?.type === "iconSet" ? falseCase.showValue : undefined,
    ).toBe(false);
    const trueCase = worksheetWithRule(
      "A1",
      el("cfRule", { type: "iconSet", priority: "1" }, [
        el("iconSet", { showValue: "1" }, [
          el("cfvo", { type: "percent", val: "33" }),
        ]),
      ]),
    ).formats[0];
    expect(
      trueCase?.type === "iconSet" ? trueCase.showValue : undefined,
    ).toBeUndefined();
  });
});

describe("styleFromDxf/dxfResidueChildren: residue passthrough for font/fill/numFmt/alignment/border/protection", () => {
  function styleOf(dxf: ReturnType<typeof el>) {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "containsBlanks", priority: "1", dxfId: "0" }),
      [dxf],
    );
    return formats[0]?.type === "containsBlanks" ? formats[0].style : undefined;
  }

  it("states no style at all for a dxf carrying neither a resolvable colour nor any residue", () => {
    expect(styleOf(el("dxf", {}, []))).toBeUndefined();
  });

  it("keeps a font's other children (e.g. b/i toggles) as residue alongside a captured textColor", () => {
    const style = styleOf(
      el("dxf", {}, [
        el("font", {}, [el("b"), el("color", { rgb: "FFFF0000" })]),
      ]),
    );
    expect(style?.textColor).toEqual({ r: 1, g: 0, b: 0 });
    expect(style?.source?.xml).toContain("<b");
  });

  it("keeps a whole font element as residue when it carries no color child at all (no textColor captured)", () => {
    const style = styleOf(el("dxf", {}, [el("font", {}, [el("b")])]));
    expect(style?.textColor).toBeUndefined();
    expect(style?.source?.xml).toContain("<font");
    expect(style?.source?.xml).toContain("<b");
  });

  it("keeps a residual numFmt element verbatim", () => {
    const style = styleOf(
      el("dxf", {}, [el("numFmt", { numFmtId: "1", formatCode: "0.00" })]),
    );
    expect(style?.source?.xml).toContain("numFmt");
  });

  it("keeps other patternFill children and other fill children alongside a captured background", () => {
    const style = styleOf(
      el("dxf", {}, [
        el("fill", {}, [
          el("patternFill", { patternType: "solid" }, [
            el("fgColor", { rgb: "FF00FF00" }),
            el("bgColor", { rgb: "FFFF0000" }),
          ]),
        ]),
      ]),
    );
    expect(style?.background).toEqual({ r: 1, g: 0, b: 0 });
    expect(style?.source?.xml).toContain("fgColor");
  });

  it("keeps a whole fill element as residue when it carries no bgColor at all (no background captured)", () => {
    const style = styleOf(
      el("dxf", {}, [
        el("fill", {}, [
          el("patternFill", { patternType: "solid" }, [
            el("fgColor", { rgb: "FF00FF00" }),
          ]),
        ]),
      ]),
    );
    expect(style?.background).toBeUndefined();
    expect(style?.source?.xml).toContain("fgColor");
  });

  it("keeps alignment/border/protection residue elements verbatim, in document order", () => {
    const style = styleOf(
      el("dxf", {}, [
        el("alignment", { horizontal: "center" }),
        el("border", {}, [el("left", { style: "thin" })]),
        el("protection", { locked: "0" }),
      ]),
    );
    expect(style?.source?.xml).toBe(
      '<alignment horizontal="center"></alignment><border><left style="thin"></left></border><protection locked="0"></protection>',
    );
    expect(hasOwn(style ?? {}, "textColor")).toBe(false);
    expect(hasOwn(style ?? {}, "background")).toBe(false);
  });

  it("round-trips a dxf carrying every residue kind at once (font+color, fill+patternFill+bgColor, numFmt, alignment, border, protection) back through DxfTable.intern", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "containsBlanks", priority: "1", dxfId: "0" }),
      [
        el("dxf", {}, [
          el("font", {}, [el("b"), el("color", { rgb: "FFFF0000" })]),
          el("numFmt", { numFmtId: "1", formatCode: "0.00" }),
          el("fill", {}, [
            el("patternFill", { patternType: "solid" }, [
              el("fgColor", { rgb: "FF00FF00" }),
              el("bgColor", { rgb: "FF0000FF" }),
            ]),
          ]),
          el("alignment", { horizontal: "center" }),
          el("border", {}, [el("left", { style: "thin" })]),
          el("protection", { locked: "0" }),
        ]),
      ],
    );
    const style =
      formats[0]?.type === "containsBlanks" ? formats[0].style : undefined;
    if (style === undefined) {
      throw new Error("expected a style");
    }
    const dxfTable = new DxfTable();
    dxfTable.intern(style);
    const rebuilt = dxfTable.dxfElements()[0];
    if (rebuilt === undefined) {
      throw new Error("expected a rebuilt dxf element");
    }
    const tags = rebuilt.children
      .filter((c) => c.type === "element")
      .map((c) => c.tag);
    expect(tags).toEqual([
      "font",
      "numFmt",
      "fill",
      "alignment",
      "border",
      "protection",
    ]);
    const font = childrenWithTag(rebuilt, "font")[0];
    expect(childrenWithTag(font ?? el("x"), "b")).toHaveLength(1);
    expect(
      childrenWithTag(font ?? el("x"), "color")[0]?.attributes.find(
        (a) => a.name === "rgb",
      )?.value,
    ).toBe("FFff0000");
    const fill = childrenWithTag(rebuilt, "fill")[0];
    const patternFill = childrenWithTag(fill ?? el("x"), "patternFill")[0];
    expect(
      childrenWithTag(patternFill ?? el("x"), "fgColor")[0]?.attributes.find(
        (a) => a.name === "rgb",
      )?.value,
    ).toBe("FF00FF00");
    expect(
      childrenWithTag(patternFill ?? el("x"), "bgColor")[0]?.attributes.find(
        (a) => a.name === "rgb",
      )?.value,
    ).toBe("FF0000ff");
  });

  it("resolves style from an out-of-range dxfId as no style at all, rather than throwing", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "containsBlanks", priority: "1", dxfId: "99" }),
      [],
    );
    expect(hasOwn(formats[0] ?? {}, "style")).toBe(false);
  });
});

describe("readCfRule: cellIs formula2 only for between/notBetween", () => {
  it("carries formula2 for a between operator", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "cellIs", operator: "between", priority: "1" }, [
        el("formula", {}, [txt("1")]),
        el("formula", {}, [txt("10")]),
      ]),
    );
    const format = formats[0];
    expect(format?.type === "cellIs" ? format.formula2 : undefined).toBe("10");
  });

  it("omits formula2 entirely for a non-between/notBetween operator, even when a second <formula> exists", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "cellIs", operator: "greaterThan", priority: "1" }, [
        el("formula", {}, [txt("1")]),
        el("formula", {}, [txt("10")]),
      ]),
    );
    expect(hasOwn(formats[0] ?? {}, "formula2")).toBe(false);
  });
});

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
});

// --- the write side ---------------------------------------------------------------------------------------------

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
