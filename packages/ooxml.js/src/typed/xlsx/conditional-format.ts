import type {
  Color,
  ContentSheetConditionalFormat,
  ContentSheetConditionalFormatStyle,
  ContentSheetConditionalFormatValue,
  ContentSheetRange,
  SheetRuleOperator,
  SourceResidue,
} from "document-schema.js";
import { colorToRgbHex } from "document-schema.js";
import type { Attribute, XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { buildXml } from "../../xml/build";
import { parseXml } from "../../xml/parse";
import { attr, childrenWithTag, decodeEntities, textContent } from "../util";
import { readXmlBool, writeXmlBool } from "./util";
import { colorFromElement, readColorRgb } from "./styles";
import {
  captureResidualAttributes,
  residualAttributesFor,
} from "./rule-residue";
import { formatSqref, parseSqref } from "./sqref";

// xlsx conditionalFormatting/cfRule <-> ContentSheetConditionalFormat, promoted from the anchor-cell residue landing typed/xlsx/content.ts's own applyCellResidueRules used to quarantine every rule under, for every CLOSED-form ECMA-376 rule type document-schema.js's own discriminated union names (ExaDev/documents.js#758, verified against real-producer-validation-and-cellis.xlsx's cellIs pair and real-producer-colorscale.xlsx's colorScale rule). One conditionalFormatting wrapper's own sqref is shared by every cfRule nested inside it, so each promoted rule copies that wrapper's parsed ranges onto its own `ranges` field rather than the wrapper carrying them once -- the schema puts ranges on the RULE, not on a wrapper concept the tree/flat model has no place for. A cfRule whose type this union does not cover ('expression', the one deliberate ECMA-376 member left unpromoted -- see document-schema.js's own doc comment) is left for the caller to hand to the pre-existing whole-element residue mechanism unchanged, as a synthetic single-rule conditionalFormatting clone carrying the original wrapper's own attributes so the sqref that clone needs to anchor and reconstruct from survives Alongside it.

const CF_RULE_MANAGED_ATTRIBUTES = new Set([
  "type",
  "dxfId",
  "priority",
  "stopIfTrue",
  "operator",
  "text",
  "rank",
  "percent",
  "bottom",
  "aboveAverage",
  "equalAverage",
  "stdDev",
  "timePeriod",
  "iconSet",
  "reverse",
  "showValue",
]);

export interface ConditionalFormatReadResult {
  formats: ContentSheetConditionalFormat[];
  // Synthetic single-cfRule <conditionalFormatting sqref="..."> wrapper elements, one per cfRule this union could not promote (an unpromotable type, or a wrapper whose own sqref parsed to no range at all) -- fed to content.ts's own applyCellResidueRules exactly as a whole quarantined rule always has been.
  residueElements: XmlElement[];
}

export function readConditionalFormats(
  worksheet: XmlElement,
  dxfs: readonly XmlElement[],
): ConditionalFormatReadResult {
  const formats: ContentSheetConditionalFormat[] = [];
  const residueElements: XmlElement[] = [];
  for (const wrapper of childrenWithTag(worksheet, "conditionalFormatting")) {
    const ranges = parseSqref(attr(wrapper, "sqref"));
    for (const cfRule of childrenWithTag(wrapper, "cfRule")) {
      const promoted =
        ranges.length === 0 ? undefined : readCfRule(cfRule, ranges, dxfs);
      if (promoted === undefined) {
        residueElements.push({
          type: "element",
          tag: "conditionalFormatting",
          attributes: wrapper.attributes,
          children: [cfRule],
        });
        continue;
      }
      formats.push(promoted);
    }
  }
  return { formats, residueElements };
}

function readCommonFields(
  cfRule: XmlElement,
  ranges: readonly ContentSheetRange[],
): {
  ranges: ContentSheetRange[];
  priority?: number;
  stopIfTrue?: boolean;
  source?: SourceResidue;
} {
  const result: {
    ranges: ContentSheetRange[];
    priority?: number;
    stopIfTrue?: boolean;
    source?: SourceResidue;
  } = { ranges: [...ranges] };
  const priorityRaw = attr(cfRule, "priority");
  if (priorityRaw !== undefined) {
    const priority = Number.parseInt(priorityRaw, 10);
    if (Number.isInteger(priority)) {
      result.priority = priority;
    }
  }
  if (readXmlBool(attr(cfRule, "stopIfTrue"))) {
    result.stopIfTrue = true;
  }
  const source = captureResidualAttributes(cfRule, CF_RULE_MANAGED_ATTRIBUTES);
  if (source !== undefined) {
    result.source = source;
  }
  return result;
}

function readFormula(cfRule: XmlElement, index: number): string | undefined {
  const formulaEls = childrenWithTag(cfRule, "formula");
  const formulaEl = formulaEls[index];
  return formulaEl === undefined ? undefined : textContent(formulaEl);
}

function isSheetRuleOperator(
  value: string | undefined,
): value is SheetRuleOperator {
  return (
    value === "between" ||
    value === "notBetween" ||
    value === "equal" ||
    value === "notEqual" ||
    value === "greaterThan" ||
    value === "greaterThanOrEqual" ||
    value === "lessThan" ||
    value === "lessThanOrEqual"
  );
}

const TEXT_PREDICATE_TYPES = new Set([
  "containsText",
  "notContainsText",
  "beginsWith",
  "endsWith",
]);

function isTextPredicateType(
  value: string | undefined,
): value is "containsText" | "notContainsText" | "beginsWith" | "endsWith" {
  return value !== undefined && TEXT_PREDICATE_TYPES.has(value);
}

const OPERAND_FREE_TYPES = new Set([
  "containsBlanks",
  "notContainsBlanks",
  "containsErrors",
  "notContainsErrors",
  "uniqueValues",
  "duplicateValues",
]);

function isOperandFreeType(
  value: string | undefined,
): value is
  | "containsBlanks"
  | "notContainsBlanks"
  | "containsErrors"
  | "notContainsErrors"
  | "uniqueValues"
  | "duplicateValues" {
  return value !== undefined && OPERAND_FREE_TYPES.has(value);
}

const TIME_PERIODS = new Set([
  "yesterday",
  "today",
  "tomorrow",
  "last7Days",
  "thisMonth",
  "lastMonth",
  "nextMonth",
  "thisWeek",
  "lastWeek",
  "nextWeek",
]);

function isTimePeriod(
  value: string | undefined,
): value is
  | "yesterday"
  | "today"
  | "tomorrow"
  | "last7Days"
  | "thisMonth"
  | "lastMonth"
  | "nextMonth"
  | "thisWeek"
  | "lastWeek"
  | "nextWeek" {
  return value !== undefined && TIME_PERIODS.has(value);
}

function isCfvoType(
  value: string | undefined,
): value is "num" | "percent" | "max" | "min" | "formula" | "percentile" {
  return (
    value === "num" ||
    value === "percent" ||
    value === "max" ||
    value === "min" ||
    value === "formula" ||
    value === "percentile"
  );
}

function readCfvo(
  cfvoEl: XmlElement,
): ContentSheetConditionalFormatValue | undefined {
  const type = attr(cfvoEl, "type");
  if (!isCfvoType(type)) {
    return undefined;
  }
  if (type === "min" || type === "max") {
    return { type };
  }
  const valRaw = attr(cfvoEl, "val");
  if (valRaw === undefined) {
    return undefined;
  }
  return { type, value: decodeEntities(valRaw) };
}

interface ColorScaleStop {
  value: ContentSheetConditionalFormatValue;
  color: Color;
}

function readColorScaleStops(
  colorScaleEl: XmlElement,
): ColorScaleStop[] | undefined {
  const cfvoEls = childrenWithTag(colorScaleEl, "cfvo");
  const colorEls = childrenWithTag(colorScaleEl, "color");
  if (
    cfvoEls.length !== colorEls.length ||
    cfvoEls.length < 2 ||
    cfvoEls.length > 3
  ) {
    return undefined;
  }
  const stops: ColorScaleStop[] = [];
  for (let index = 0; index < cfvoEls.length; index++) {
    const cfvoEl = cfvoEls[index];
    const colorEl = colorEls[index];
    if (cfvoEl === undefined || colorEl === undefined) {
      return undefined;
    }
    const value = readCfvo(cfvoEl);
    const color = colorFromElement(colorEl);
    if (value === undefined || color === undefined) {
      return undefined;
    }
    stops.push({ value, color });
  }
  return stops;
}

interface DataBarReading {
  min: ContentSheetConditionalFormatValue;
  max: ContentSheetConditionalFormatValue;
  color: Color;
  showValue?: boolean;
}

function readDataBar(dataBarEl: XmlElement): DataBarReading | undefined {
  const cfvoEls = childrenWithTag(dataBarEl, "cfvo");
  const minEl = cfvoEls[0];
  const maxEl = cfvoEls[1];
  const min = minEl === undefined ? undefined : readCfvo(minEl);
  const max = maxEl === undefined ? undefined : readCfvo(maxEl);
  const color = colorFromElement(childrenWithTag(dataBarEl, "color")[0]);
  if (min === undefined || max === undefined || color === undefined) {
    return undefined;
  }
  const result: DataBarReading = { min, max, color };
  // CT_DataBar/@showValue's own documented default is true -- absent means "show", so only an explicit false is worth recording, matching this reader's own "absent means default" convention throughout.
  const showValueRaw = attr(dataBarEl, "showValue");
  if (showValueRaw !== undefined && !readXmlBool(showValueRaw)) {
    result.showValue = false;
  }
  return result;
}

interface IconSetReading {
  iconSetType: string;
  thresholds: ContentSheetConditionalFormatValue[];
  reverse?: boolean;
  showValue?: boolean;
}

// CT_IconSet/@iconSet's own documented default when the attribute is absent.
const DEFAULT_ICON_SET_TYPE = "3TrafficLights1";

function readIconSet(iconSetEl: XmlElement): IconSetReading | undefined {
  const thresholds: ContentSheetConditionalFormatValue[] = [];
  for (const cfvoEl of childrenWithTag(iconSetEl, "cfvo")) {
    const value = readCfvo(cfvoEl);
    if (value === undefined) {
      return undefined;
    }
    thresholds.push(value);
  }
  if (thresholds.length === 0) {
    return undefined;
  }
  const result: IconSetReading = {
    iconSetType: attr(iconSetEl, "iconSet") ?? DEFAULT_ICON_SET_TYPE,
    thresholds,
  };
  if (readXmlBool(attr(iconSetEl, "reverse"))) {
    result.reverse = true;
  }
  const showValueRaw = attr(iconSetEl, "showValue");
  if (showValueRaw !== undefined && !readXmlBool(showValueRaw)) {
    result.showValue = false;
  }
  return result;
}

// Resolves a cfRule's own dxfId against the workbook's <dxfs> table, then extracts whatever of textColor/background the referenced <dxf> carries -- the two properties actually observed on a real producer's differential format (font colour, fill background); everything else the dxf carries (alignment, border, numFmt, protection, or a font/fill's own OTHER children) rides the resulting style's `source` residue verbatim, in document order, so a same-format write can restore it (buildDxfElement below is the exact inverse).
function styleFromDxf(
  dxf: XmlElement,
): ContentSheetConditionalFormatStyle | undefined {
  const fontEl = childrenWithTag(dxf, "font")[0];
  const textColor =
    fontEl === undefined ? undefined : readColorRgb(fontEl, "color");
  const fillEl = childrenWithTag(dxf, "fill")[0];
  const patternFillEl =
    fillEl === undefined
      ? undefined
      : childrenWithTag(fillEl, "patternFill")[0];
  const background =
    patternFillEl === undefined
      ? undefined
      : readColorRgb(patternFillEl, "bgColor");
  const residueChildren = dxfResidueChildren(
    dxf,
    textColor !== undefined,
    background !== undefined,
  );
  const style: ContentSheetConditionalFormatStyle = {};
  if (textColor !== undefined) {
    style.textColor = textColor;
  }
  if (background !== undefined) {
    style.background = background;
  }
  if (residueChildren.length > 0) {
    style.source = { format: "xlsx", xml: buildXml(residueChildren) };
  }
  return style.textColor === undefined &&
    style.background === undefined &&
    style.source === undefined
    ? undefined
    : style;
}

function withoutChildTag(
  element: XmlElement,
  tag: string,
): XmlElement | undefined {
  const remaining = element.children.filter(
    (child) => !(child.type === "element" && child.tag === tag),
  );
  if (remaining.length === 0 && element.attributes.length === 0) {
    return undefined;
  }
  return { ...element, children: remaining };
}

function fillResidue(fillEl: XmlElement): XmlElement | undefined {
  const patternFillEl = childrenWithTag(fillEl, "patternFill")[0];
  const otherFillChildren = fillEl.children.filter(
    (child) => !(child.type === "element" && child.tag === "patternFill"),
  );
  if (patternFillEl === undefined) {
    return otherFillChildren.length === 0 && fillEl.attributes.length === 0
      ? undefined
      : { ...fillEl, children: otherFillChildren };
  }
  const patternFillResidue = withoutChildTag(patternFillEl, "bgColor");
  if (patternFillResidue === undefined) {
    return otherFillChildren.length === 0 && fillEl.attributes.length === 0
      ? undefined
      : { ...fillEl, children: otherFillChildren };
  }
  return { ...fillEl, children: [patternFillResidue, ...otherFillChildren] };
}

// The rest of a <dxf> element once its own textColor/background have been structurally extracted: every direct child other than font/fill passes through verbatim, and font/fill themselves pass through minus the specific sub-element that was captured (dropped entirely once empty, so a dxf carrying nothing else collapses to no residue at all, matching the real fixture this was verified against).
function dxfResidueChildren(
  dxf: XmlElement,
  textColorCaptured: boolean,
  backgroundCaptured: boolean,
): XmlElement[] {
  const residue: XmlElement[] = [];
  for (const child of dxf.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "font" && textColorCaptured) {
      const remainder = withoutChildTag(child, "color");
      if (remainder !== undefined) {
        residue.push(remainder);
      }
      continue;
    }
    if (child.tag === "fill" && backgroundCaptured) {
      const remainder = fillResidue(child);
      if (remainder !== undefined) {
        residue.push(remainder);
      }
      continue;
    }
    residue.push(child);
  }
  return residue;
}

function resolveStyle(
  cfRule: XmlElement,
  dxfs: readonly XmlElement[],
): ContentSheetConditionalFormatStyle | undefined {
  const dxfIdRaw = attr(cfRule, "dxfId");
  if (dxfIdRaw === undefined) {
    return undefined;
  }
  const dxfId = Number.parseInt(dxfIdRaw, 10);
  const dxf = Number.isInteger(dxfId) ? dxfs[dxfId] : undefined;
  return dxf === undefined ? undefined : styleFromDxf(dxf);
}

// Every branch below builds its ENTIRE return literal in one expression (conditional spreads for the optional fields) rather than declaring a widened `ContentSheetConditionalFormat`-typed local and mutating it afterwards -- the latter loses the discriminant narrowing the moment the wider union type is spelled out, so a later `result.style = style` would not typecheck for a colorScale/dataBar/iconSet branch (none of which have a `style` field at all). Returning the literal directly lets TypeScript check it against the ONE union member its own `type` tag names.
function readCfRule(
  cfRule: XmlElement,
  ranges: readonly ContentSheetRange[],
  dxfs: readonly XmlElement[],
): ContentSheetConditionalFormat | undefined {
  const type = attr(cfRule, "type");
  const common = readCommonFields(cfRule, ranges);
  const style = resolveStyle(cfRule, dxfs);
  const styleField = style === undefined ? {} : { style };

  if (type === "cellIs") {
    const operatorRaw = attr(cfRule, "operator");
    const formula1 = readFormula(cfRule, 0);
    if (!isSheetRuleOperator(operatorRaw) || formula1 === undefined) {
      return undefined;
    }
    const formula2 =
      operatorRaw === "between" || operatorRaw === "notBetween"
        ? readFormula(cfRule, 1)
        : undefined;
    return {
      type: "cellIs",
      ...common,
      operator: operatorRaw,
      formula1,
      ...(formula2 === undefined ? {} : { formula2 }),
      ...styleField,
    };
  }

  if (isTextPredicateType(type)) {
    const text = attr(cfRule, "text");
    if (text === undefined) {
      return undefined;
    }
    return { type, ...common, text: decodeEntities(text), ...styleField };
  }

  if (isOperandFreeType(type)) {
    return { type, ...common, ...styleField };
  }

  if (type === "top10") {
    const rankRaw = attr(cfRule, "rank");
    const rank = rankRaw === undefined ? undefined : Number(rankRaw);
    if (rank === undefined || !Number.isFinite(rank) || rank <= 0) {
      return undefined;
    }
    return {
      type: "top10",
      ...common,
      rank,
      ...(readXmlBool(attr(cfRule, "percent")) ? { percent: true } : {}),
      ...(readXmlBool(attr(cfRule, "bottom")) ? { bottom: true } : {}),
      ...styleField,
    };
  }

  if (type === "aboveAverage") {
    // CT_CfRule/@aboveAverage's own documented default is true -- only an explicit false is worth recording.
    const aboveAverageRaw = attr(cfRule, "aboveAverage");
    const stdDevRaw = attr(cfRule, "stdDev");
    const stdDev =
      stdDevRaw === undefined ? undefined : Number.parseInt(stdDevRaw, 10);
    return {
      type: "aboveAverage",
      ...common,
      ...(aboveAverageRaw !== undefined && !readXmlBool(aboveAverageRaw)
        ? { aboveAverage: false }
        : {}),
      ...(readXmlBool(attr(cfRule, "equalAverage"))
        ? { equalAverage: true }
        : {}),
      ...(stdDev !== undefined && Number.isInteger(stdDev) && stdDev > 0
        ? { stdDev }
        : {}),
      ...styleField,
    };
  }

  if (type === "timePeriod") {
    const timePeriod = attr(cfRule, "timePeriod");
    if (!isTimePeriod(timePeriod)) {
      return undefined;
    }
    return { type: "timePeriod", ...common, timePeriod, ...styleField };
  }

  if (type === "colorScale") {
    const colorScaleEl = childrenWithTag(cfRule, "colorScale")[0];
    const stops =
      colorScaleEl === undefined
        ? undefined
        : readColorScaleStops(colorScaleEl);
    if (stops === undefined) {
      return undefined;
    }
    return { type: "colorScale", ...common, stops };
  }

  if (type === "dataBar") {
    const dataBarEl = childrenWithTag(cfRule, "dataBar")[0];
    const parsed = dataBarEl === undefined ? undefined : readDataBar(dataBarEl);
    if (parsed === undefined) {
      return undefined;
    }
    return {
      type: "dataBar",
      ...common,
      min: parsed.min,
      max: parsed.max,
      color: parsed.color,
      ...(parsed.showValue === undefined
        ? {}
        : { showValue: parsed.showValue }),
    };
  }

  if (type === "iconSet") {
    const iconSetEl = childrenWithTag(cfRule, "iconSet")[0];
    const parsed = iconSetEl === undefined ? undefined : readIconSet(iconSetEl);
    if (parsed === undefined) {
      return undefined;
    }
    return {
      type: "iconSet",
      ...common,
      iconSetType: parsed.iconSetType,
      thresholds: parsed.thresholds,
      ...(parsed.reverse === undefined ? {} : { reverse: parsed.reverse }),
      ...(parsed.showValue === undefined
        ? {}
        : { showValue: parsed.showValue }),
    };
  }

  // 'expression', or any type this union does not name -- left for the caller's whole-element residue fallback.
  return undefined;
}

// --- the write side -------------------------------------------------------------------------------------------

// The write-side allocator for <dxfs><dxf> entries: one per cfRule that needs a dxfId, in emission order. Deliberately undeduplicated -- unlike CellFormatTable's own cellXfs interning (shared across every cell a workbook has, so dedup avoids a combinatorial blow-up), a workbook has at most a handful of conditional-format rules, and dedup here is a real optimization but not one round-trip correctness needs.
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

function attrsRecord(attributes: readonly Attribute[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attribute of attributes) {
    result[attribute.name] = attribute.value;
  }
  return result;
}

function extractResidueElements(
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

// CT_Dxf's own fixed child sequence (font?, numFmt?, fill?, alignment?, border?, protection?) -- the exact inverse of styleFromDxf/dxfResidueChildren above, re-inserting the structured textColor/background at their spec position and passing every other residue element through verbatim in that same order, regardless of what order they happened to ride in the residue string.
function buildDxfElement(
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

interface RangeGroup {
  ranges: readonly ContentSheetRange[];
  rules: ContentSheetConditionalFormat[];
}

function rangeSetKey(ranges: readonly ContentSheetRange[]): string {
  return ranges
    .map(
      (range) =>
        `${range.startRow}:${range.startColumn}:${range.endRow}:${range.endColumn}`,
    )
    .join("|");
}

const TEXT_PREDICATE_OPERATOR: Readonly<
  Record<"containsText" | "notContainsText" | "beginsWith" | "endsWith", string>
> = {
  containsText: "containsText",
  notContainsText: "notContains",
  beginsWith: "beginsWith",
  endsWith: "endsWith",
};

function buildCfvoElement(
  value: ContentSheetConditionalFormatValue,
): XmlElement {
  const attrs: Record<string, string> = { type: value.type };
  if (value.value !== undefined) {
    attrs.val = encodeXmlText(value.value);
  }
  return el("cfvo", attrs);
}

function buildCfRuleElement(
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
      // CT_DataBar/@showValue -- an attribute of the <dataBar> element itself, not of the enclosing <cfRule>.
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

// Groups rules by their own shared `ranges` into one <conditionalFormatting sqref="..."> wrapper per distinct range set -- matching a real producer's own grouping (real-producer-validation-and-cellis.xlsx wraps its two cellIs rules, which share the identical B1:B2 target, in one conditionalFormatting element) -- then assigns every rule missing an explicit `priority` the next integer CT_CfRule's own REQUIRED priority attribute has not already claimed, so a hand-built ContentSheetConditionalFormat with no priority at all still writes a valid, unique priority per rule.
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
    usedPriorities.add(nextPriority);
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
