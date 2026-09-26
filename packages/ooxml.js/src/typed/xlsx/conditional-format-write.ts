import type { Attribute, XmlElement, XmlNode } from "../../model/node";
import type {
  ContentSheetConditionalFormat,
  ContentSheetConditionalFormatStyle,
  ContentSheetConditionalFormatValue,
  ContentSheetRange,
  SourceResidue,
} from "document-schema.js";
import { DEFAULT_ICON_SET_TYPE } from "./conditional-format";
import { childrenWithTag } from "../util";
import { colorToRgbHex } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { formatSqref } from "./sqref";
import { parseXml } from "../../xml/parse";
import { residualAttributesFor } from "./rule-residue";
import { writeXmlBool } from "./util";
// The write half of xlsx conditional formatting, split from conditional-format.ts: the DxfTable that interns differential styles, range grouping, and the conditionalFormatting/cfRule/cfvo element builders. conditional-format.ts keeps the read side.
// The write-side allocator for <dxfs><dxf> entries: one per cfRule that needs a dxfId, in emission order. Deliberately undeduplicated — unlike CellFormatTable's own cellXfs interning (shared across every cell a workbook has, so dedup avoids a combinatorial blow-up), a workbook has at most a handful of conditional-format rules, and dedup here is a real optimization but not one round-trip correctness needs.
export class DxfTable {
  private readonly elements: XmlElement[] = [];

  intern(style: ContentSheetConditionalFormatStyle): number {
    const index = this.elements.length;
    this.elements.push(buildDxfElement(style));
    return index;
  }

  dxfElements(): readonly XmlElement[] {
    return this.elements;
  }
}

export function attrsRecord(
  attributes: readonly Attribute[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attribute of attributes) {
    result[attribute.name] = attribute.value;
  }
  return result;
}

export function extractResidueElements(
  source: SourceResidue | undefined,
): XmlElement[] {
  if (source?.format !== "xlsx") {
    return [];
  }
  const elements: XmlElement[] = [];
  for (const node of parseXml(source.xml)) {
    if (node.type === "element") {
      elements.push(node);
    }
  }
  return elements;
}

// CT_Dxf's own fixed child sequence (font?, numFmt?, fill?, alignment?, border?, protection?) — the exact inverse of styleFromDxf/dxfResidueChildren above, re-inserting the structured textColor/background at their spec position and passing every other residue element through verbatim in that same order, regardless of what order they happened to ride in the residue string.
export function buildDxfElement(
  style: ContentSheetConditionalFormatStyle,
): XmlElement {
  const residueByTag = new Map<string, XmlElement>();
  for (const element of extractResidueElements(style.source)) {
    residueByTag.set(element.tag, element);
  }
  const children: XmlElement[] = [];

  const residualFont = residueByTag.get("font");
  if (style.textColor !== undefined) {
    const fontChildren =
      residualFont === undefined ? [] : residualFont.children;
    const fontAttrs =
      residualFont === undefined ? {} : attrsRecord(residualFont.attributes);
    children.push(
      el("font", fontAttrs, [
        ...fontChildren,
        el("color", { rgb: `FF${colorToRgbHex(style.textColor)}` }),
      ]),
    );
  } else if (residualFont !== undefined) {
    children.push(residualFont);
  }

  const residualNumFmt = residueByTag.get("numFmt");
  if (residualNumFmt !== undefined) {
    children.push(residualNumFmt);
  }

  const residualFill = residueByTag.get("fill");
  if (style.background !== undefined) {
    const residualPatternFill =
      residualFill === undefined
        ? undefined
        : childrenWithTag(residualFill, "patternFill")[0];
    const patternFillChildren =
      residualPatternFill === undefined ? [] : residualPatternFill.children;
    const patternFillAttrs =
      residualPatternFill === undefined
        ? {}
        : attrsRecord(residualPatternFill.attributes);
    const otherFillChildren =
      residualFill === undefined
        ? []
        : residualFill.children.filter(
            (child) =>
              !(child.type === "element" && child.tag === "patternFill"),
          );
    children.push(
      el(
        "fill",
        residualFill === undefined ? {} : attrsRecord(residualFill.attributes),
        [
          el("patternFill", patternFillAttrs, [
            ...patternFillChildren,
            el("bgColor", { rgb: `FF${colorToRgbHex(style.background)}` }),
          ]),
          ...otherFillChildren,
        ],
      ),
    );
  } else if (residualFill !== undefined) {
    children.push(residualFill);
  }

  for (const tag of ["alignment", "border", "protection"] as const) {
    const residual = residueByTag.get(tag);
    if (residual !== undefined) {
      children.push(residual);
    }
  }

  return el("dxf", {}, children);
}

export interface RangeGroup {
  ranges: readonly ContentSheetRange[];
  rules: ContentSheetConditionalFormat[];
}

export function rangeSetKey(ranges: readonly ContentSheetRange[]): string {
  return ranges
    .map(
      (range) =>
        `${range.startRow}:${range.startColumn}:${range.endRow}:${range.endColumn}`,
    )
    .join("|");
}

export const TEXT_PREDICATE_OPERATOR: Readonly<
  Record<"containsText" | "notContainsText" | "beginsWith" | "endsWith", string>
> = {
  containsText: "containsText",
  notContainsText: "notContains",
  beginsWith: "beginsWith",
  endsWith: "endsWith",
};

export function buildCfvoElement(
  value: Readonly<ContentSheetConditionalFormatValue>,
): XmlElement {
  const attrs: Record<string, string> = { type: value.type };
  if (value.value !== undefined) {
    attrs.val = encodeXmlText(value.value);
  }
  return el("cfvo", attrs);
}

export function buildCfRuleElement(
  rule: ContentSheetConditionalFormat,
  priority: number,
  dxfTable: DxfTable,
): XmlElement {
  const attrs: Record<string, string> = residualAttributesFor(
    rule.source,
    "cfRule",
  );
  attrs.type = rule.type;
  attrs.priority = String(priority);
  if (rule.stopIfTrue === true) {
    attrs.stopIfTrue = writeXmlBool(true);
  }
  const children: XmlNode[] = [];
  let style: ContentSheetConditionalFormatStyle | undefined;

  switch (rule.type) {
    case "cellIs": {
      attrs.operator = rule.operator;
      children.push(el("formula", {}, [txt(encodeXmlText(rule.formula1))]));
      if (rule.formula2 !== undefined) {
        children.push(el("formula", {}, [txt(encodeXmlText(rule.formula2))]));
      }
      style = rule.style;
      break;
    }
    case "containsText":
    case "notContainsText":
    case "beginsWith":
    case "endsWith": {
      attrs.operator = TEXT_PREDICATE_OPERATOR[rule.type];
      attrs.text = encodeXmlText(rule.text);
      style = rule.style;
      break;
    }
    case "containsBlanks":
    case "notContainsBlanks":
    case "containsErrors":
    case "notContainsErrors":
    case "uniqueValues":
    case "duplicateValues": {
      style = rule.style;
      break;
    }
    case "top10": {
      attrs.rank = String(rule.rank);
      if (rule.percent === true) {
        attrs.percent = writeXmlBool(true);
      }
      if (rule.bottom === true) {
        attrs.bottom = writeXmlBool(true);
      }
      style = rule.style;
      break;
    }
    case "aboveAverage": {
      if (rule.aboveAverage === false) {
        attrs.aboveAverage = writeXmlBool(false);
      }
      if (rule.equalAverage === true) {
        attrs.equalAverage = writeXmlBool(true);
      }
      if (rule.stdDev !== undefined) {
        attrs.stdDev = String(rule.stdDev);
      }
      style = rule.style;
      break;
    }
    case "timePeriod": {
      attrs.timePeriod = rule.timePeriod;
      style = rule.style;
      break;
    }
    case "colorScale": {
      children.push(
        el("colorScale", {}, [
          ...rule.stops.map((stop) => buildCfvoElement(stop.value)),
          ...rule.stops.map((stop) =>
            el("color", { rgb: `FF${colorToRgbHex(stop.color)}` }),
          ),
        ]),
      );
      break;
    }
    case "dataBar": {
      const dataBarChildren: XmlElement[] = [
        buildCfvoElement(rule.min),
        buildCfvoElement(rule.max),
        el("color", { rgb: `FF${colorToRgbHex(rule.color)}` }),
      ];
      // CT_DataBar/@showValue — an attribute of the <dataBar> element itself, not of the enclosing <cfRule>.
      const dataBarAttrs: Record<string, string> =
        rule.showValue === false ? { showValue: writeXmlBool(false) } : {};
      children.push(el("dataBar", dataBarAttrs, dataBarChildren));
      break;
    }
    case "iconSet": {
      const iconSetAttrs: Record<string, string> = {};
      if (rule.iconSetType !== DEFAULT_ICON_SET_TYPE) {
        iconSetAttrs.iconSet = rule.iconSetType;
      }
      if (rule.reverse === true) {
        iconSetAttrs.reverse = writeXmlBool(true);
      }
      if (rule.showValue === false) {
        iconSetAttrs.showValue = writeXmlBool(false);
      }
      children.push(
        el("iconSet", iconSetAttrs, rule.thresholds.map(buildCfvoElement)),
      );
      break;
    }
  }

  if (style !== undefined) {
    attrs.dxfId = String(dxfTable.intern(style));
  }

  return el("cfRule", attrs, children);
}

// Groups rules by their own shared `ranges` into one <conditionalFormatting sqref="..."> wrapper per distinct range set — matching a real producer's own grouping (real-producer-validation-and-cellis.xlsx wraps its two cellIs rules, which share the identical B1:B2 target, in one conditionalFormatting element) — then assigns every rule missing an explicit `priority` the next integer CT_CfRule's own REQUIRED priority attribute has not already claimed, so a hand-built ContentSheetConditionalFormat with no priority at all still writes a valid, unique priority per rule.
export function buildConditionalFormattingElements(
  formats: readonly ContentSheetConditionalFormat[],
  dxfTable: DxfTable,
): XmlElement[] {
  const groupsByKey = new Map<string, RangeGroup>();
  const groupOrder: RangeGroup[] = [];
  for (const format of formats) {
    const key = rangeSetKey(format.ranges);
    const existing = groupsByKey.get(key);
    if (existing === undefined) {
      const group: RangeGroup = { ranges: format.ranges, rules: [format] };
      groupsByKey.set(key, group);
      groupOrder.push(group);
    } else {
      existing.rules.push(format);
    }
  }

  const usedPriorities = new Set<number>();
  for (const format of formats) {
    if (format.priority !== undefined) {
      usedPriorities.add(format.priority);
    }
  }
  let nextPriority = 1;
  const assignPriority = (explicit: number | undefined): number => {
    if (explicit !== undefined) {
      return explicit;
    }
    while (usedPriorities.has(nextPriority)) {
      nextPriority++;
    }
    return nextPriority++;
  };

  return groupOrder.map((group) => {
    const cfRuleElements = group.rules.map((rule) =>
      buildCfRuleElement(rule, assignPriority(rule.priority), dxfTable),
    );
    return el(
      "conditionalFormatting",
      { sqref: formatSqref(group.ranges) },
      cfRuleElements,
    );
  });
}
