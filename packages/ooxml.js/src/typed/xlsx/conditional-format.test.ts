import { describe, expect, it } from "vitest";
import type { ContentSheetConditionalFormat } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { childrenWithTag } from "../util";
import { readConditionalFormats } from "./conditional-format";
import { DxfTable } from "./conditional-format-write";
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

function colorScaleFormats(cfvoAndColor: readonly ReturnType<typeof el>[]) {
  return worksheetWithRule(
    "A1:B2",
    el("cfRule", { type: "colorScale", priority: "1" }, [
      el("colorScale", {}, cfvoAndColor),
    ]),
  );
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

  it("rejects a colorScale with more color elements than cfvo elements, not just fewer", () => {
    const { formats, residueElements } = colorScaleFormats([
      el("cfvo", { type: "min" }),
      el("cfvo", { type: "max" }),
      el("color", { rgb: "FFFF0000" }),
      el("color", { rgb: "FF00FF00" }),
      el("color", { rgb: "FF0000FF" }),
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
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "dataBar", priority: "1" }, [
        el("dataBar", {}, [
          el("cfvo", { type: "min" }),
          el("cfvo", { type: "max" }),
          el("color", { rgb: "FFFF0000" }),
        ]),
      ]),
    );
    expect(hasOwn(formats[0] ?? {}, "showValue")).toBe(false);
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

  it("states no reverse key at all when the attribute is absent", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "iconSet", priority: "1" }, [
        el("iconSet", {}, [el("cfvo", { type: "percent", val: "33" })]),
      ]),
    );
    expect(hasOwn(formats[0] ?? {}, "reverse")).toBe(false);
  });

  it("states no showValue key at all when the attribute is absent (the true default)", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "iconSet", priority: "1" }, [
        el("iconSet", {}, [el("cfvo", { type: "percent", val: "33" })]),
      ]),
    );
    expect(hasOwn(formats[0] ?? {}, "showValue")).toBe(false);
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

  it("preserves a font's own malformed color element (no rgb attribute) as residue rather than mistaking its mere presence for a captured textColor", () => {
    const style = styleOf(el("dxf", {}, [el("font", {}, [el("color", {})])]));
    expect(style?.textColor).toBeUndefined();
    expect(style?.source?.xml).toContain("<font");
    expect(style?.source?.xml).toContain("<color");
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

  it("preserves a fill's own malformed bgColor element (no rgb attribute) as residue rather than mistaking its mere presence for a captured background", () => {
    const style = styleOf(
      el("dxf", {}, [
        el("fill", {}, [el("patternFill", {}, [el("bgColor", {})])]),
      ]),
    );
    expect(style?.background).toBeUndefined();
    expect(style?.source?.xml).toContain("<fill");
    expect(style?.source?.xml).toContain("<bgColor");
  });

  it("doesn't route a wholly empty non-fill/font residue element (e.g. an empty alignment) through the fill-collapse logic once a background has genuinely been captured from an earlier fill", () => {
    const style = styleOf(
      el("dxf", {}, [
        el("fill", {}, [
          el("patternFill", {}, [el("bgColor", { rgb: "FFFF0000" })]),
        ]),
        el("alignment", {}, []),
      ]),
    );
    expect(style?.background).toEqual({ r: 1, g: 0, b: 0 });
    expect(style?.source?.xml).toContain("<alignment");
  });

  it("keeps a patternFill's own attributes (e.g. patternType) as residue even once its only child (bgColor) has been fully captured", () => {
    const style = styleOf(
      el("dxf", {}, [
        el("fill", {}, [
          el("patternFill", { patternType: "solid" }, [
            el("bgColor", { rgb: "FFFF0000" }),
          ]),
        ]),
      ]),
    );
    expect(style?.background).toEqual({ r: 1, g: 0, b: 0 });
    expect(style?.source?.xml).toContain('patternType="solid"');
  });

  it("keeps a fill element's own attributes as residue when its patternFill collapses to nothing but the fill itself carries an attribute", () => {
    const style = styleOf(
      el("dxf", {}, [
        el("fill", { unknownFillAttr: "x" }, [
          el("patternFill", {}, [el("bgColor", { rgb: "FFFF0000" })]),
        ]),
      ]),
    );
    expect(style?.background).toEqual({ r: 1, g: 0, b: 0 });
    expect(style?.source?.xml).toContain('unknownFillAttr="x"');
  });

  it("keeps a fill element's other (non-patternFill) children as residue when its patternFill collapses to nothing", () => {
    const style = styleOf(
      el("dxf", {}, [
        el("fill", {}, [
          el("patternFill", {}, [el("bgColor", { rgb: "FFFF0000" })]),
          el("gradientFill", {}, []),
        ]),
      ]),
    );
    expect(style?.background).toEqual({ r: 1, g: 0, b: 0 });
    expect(style?.source?.xml).toContain("<gradientFill");
  });

  it("keeps a second, patternFill-less <fill> element's own content as residue once background has already been captured from the first fill", () => {
    const style = styleOf(
      el("dxf", {}, [
        el("fill", {}, [
          el("patternFill", {}, [el("bgColor", { rgb: "FFFF0000" })]),
        ]),
        el("fill", { emptySecondFillAttr: "a" }, []),
        el("fill", {}, [el("gradientFill", {}, [])]),
        el("fill", {}, []),
      ]),
    );
    expect(style?.background).toEqual({ r: 1, g: 0, b: 0 });
    expect(style?.source?.xml).toContain('emptySecondFillAttr="a"');
    expect(style?.source?.xml).toContain("<gradientFill");
    expect(style?.source?.xml).not.toContain("<fill></fill>");
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

  it("round-trips a patternFill's own attributes (e.g. patternType) through DxfTable.intern when rebuilding a background style", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "containsBlanks", priority: "1", dxfId: "0" }),
      [
        el("dxf", {}, [
          el("fill", {}, [
            el("patternFill", { patternType: "solid" }, [
              el("fgColor", { rgb: "FF00FF00" }),
              el("bgColor", { rgb: "FF0000FF" }),
            ]),
          ]),
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
    const fill = childrenWithTag(rebuilt, "fill")[0];
    const patternFill = childrenWithTag(fill ?? el("x"), "patternFill")[0];
    expect(
      patternFill?.attributes.find((a) => a.name === "patternType")?.value,
    ).toBe("solid");
  });

  it("keeps a fill's own other (non-patternFill) children, and never duplicates patternFill itself, when rebuilding a background style through DxfTable.intern", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "containsBlanks", priority: "1", dxfId: "0" }),
      [
        el("dxf", {}, [
          el("fill", {}, [
            el("patternFill", {}, [
              el("fgColor", { rgb: "FF00FF00" }),
              el("bgColor", { rgb: "FFFF0000" }),
            ]),
            el("gradientFill", {}, []),
          ]),
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
    const fill = childrenWithTag(rebuilt, "fill")[0];
    const fillChildTags = (fill?.children ?? [])
      .filter((c) => c.type === "element")
      .map((c) => c.tag);
    expect(fillChildTags.filter((tag) => tag === "patternFill")).toHaveLength(
      1,
    );
    expect(fillChildTags).toContain("gradientFill");
  });

  it("round-trips a font carrying no captured textColor (residue only) through DxfTable.intern", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "containsBlanks", priority: "1", dxfId: "0" }),
      [el("dxf", {}, [el("font", {}, [el("b")])])],
    );
    const style =
      formats[0]?.type === "containsBlanks" ? formats[0].style : undefined;
    if (style === undefined) {
      throw new Error("expected a style");
    }
    expect(style.textColor).toBeUndefined();
    const dxfTable = new DxfTable();
    dxfTable.intern(style);
    const rebuilt = dxfTable.dxfElements()[0];
    if (rebuilt === undefined) {
      throw new Error("expected a rebuilt dxf element");
    }
    const font = childrenWithTag(rebuilt, "font")[0];
    expect(childrenWithTag(font ?? el("x"), "b")).toHaveLength(1);
  });

  it("round-trips a fill carrying no captured background (residue only) through DxfTable.intern", () => {
    const { formats } = worksheetWithRule(
      "A1",
      el("cfRule", { type: "containsBlanks", priority: "1", dxfId: "0" }),
      [
        el("dxf", {}, [
          el("fill", {}, [
            el("patternFill", { patternType: "solid" }, [
              el("fgColor", { rgb: "FF00FF00" }),
            ]),
          ]),
        ]),
      ],
    );
    const style =
      formats[0]?.type === "containsBlanks" ? formats[0].style : undefined;
    if (style === undefined) {
      throw new Error("expected a style");
    }
    expect(style.background).toBeUndefined();
    const dxfTable = new DxfTable();
    dxfTable.intern(style);
    const rebuilt = dxfTable.dxfElements()[0];
    if (rebuilt === undefined) {
      throw new Error("expected a rebuilt dxf element");
    }
    const fill = childrenWithTag(rebuilt, "fill")[0];
    const patternFill = childrenWithTag(fill ?? el("x"), "patternFill")[0];
    expect(
      childrenWithTag(patternFill ?? el("x"), "fgColor")[0]?.attributes.find(
        (a) => a.name === "rgb",
      )?.value,
    ).toBe("FF00FF00");
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
