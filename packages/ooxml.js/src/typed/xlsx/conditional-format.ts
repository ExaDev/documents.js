import type {
  Color,
  ContentSheetConditionalFormat,
  ContentSheetConditionalFormatStyle,
  ContentSheetConditionalFormatValue,
  ContentSheetRange,
  SheetRuleOperator,
  SourceResidue,
} from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { buildXml } from "../../xml/build";
import { attr, childrenWithTag, decodeEntities, textContent } from "../util";
import { readXmlBool } from "./util";
import { colorFromElement, readColorRgb } from "./styles";
import { captureResidualAttributes } from "./rule-residue";
import { parseSqref } from "./sqref";

// xlsx conditionalFormatting/cfRule <-> ContentSheetConditionalFormat, promoted from the anchor-cell residue landing typed/xlsx/content.ts's own applyCellResidueRules used to quarantine every rule under, for every CLOSED-form ECMA-376 rule type document-schema.js's own discriminated union names (ExaDev/documents.js#758, verified against real-producer-validation-and-cellis.xlsx's cellIs pair and real-producer-colorscale.xlsx's colorScale rule). One conditionalFormatting wrapper's own sqref is shared by every cfRule nested inside it, so each promoted rule copies that wrapper's parsed ranges onto its own `ranges` field rather than the wrapper carrying them once — the schema puts ranges on the RULE, not on a wrapper concept the tree/flat model has no place for. A cfRule whose type this union does not cover ('expression', the one deliberate ECMA-376 member left unpromoted — see document-schema.js's own doc comment) is left for the caller to hand to the pre-existing whole-element residue mechanism unchanged, as a synthetic single-rule conditionalFormatting clone carrying the original wrapper's own attributes so the sqref that clone needs to anchor and reconstruct from survives Alongside it.

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
  // Synthetic single-cfRule <conditionalFormatting sqref="..."> wrapper elements, one per cfRule this union could not promote (an unpromotable type, or a wrapper whose own sqref parsed to no range at all) — fed to content.ts's own applyCellResidueRules exactly as a whole quarantined rule always has been.
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

// SpreadsheetML's own colorScale carries 2 or 3 stops; anything else is not a valid color scale.
const MAX_COLOR_SCALE_STOPS = 3;

function readColorScaleStops(
  colorScaleEl: XmlElement,
): ColorScaleStop[] | undefined {
  const cfvoEls = childrenWithTag(colorScaleEl, "cfvo");
  const colorEls = childrenWithTag(colorScaleEl, "color");
  if (
    cfvoEls.length !== colorEls.length ||
    cfvoEls.length < 2 ||
    cfvoEls.length > MAX_COLOR_SCALE_STOPS
  ) {
    return undefined;
  }
  const stops: ColorScaleStop[] = [];
  for (let index = 0; index < cfvoEls.length; index++) {
    const cfvoEl = cfvoEls[index];
    const colorEl = colorEls[index];
    if (cfvoEl === undefined) {
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
  // CT_DataBar/@showValue's own documented default is true — absent means "show", so only an explicit false is worth recording, matching this reader's own "absent means default" convention throughout.
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
export const DEFAULT_ICON_SET_TYPE = "3TrafficLights1";

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

// Resolves a cfRule's own dxfId against the workbook's <dxfs> table, then extracts whatever of textColor/background the referenced <dxf> carries — the two properties actually observed on a real producer's differential format (font colour, fill background); everything else the dxf carries (alignment, border, numFmt, protection, or a font/fill's own OTHER children) rides the resulting style's `source` residue verbatim, in document order, so a same-format write can restore it (buildDxfElement below is the exact inverse).
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

// Every branch below builds its ENTIRE return literal in one expression (conditional spreads for the optional fields) rather than declaring a widened `ContentSheetConditionalFormat`-typed local and mutating it afterwards — the latter loses the discriminant narrowing the moment the wider union type is spelled out, so a later `result.style = style` would not typecheck for a colorScale/dataBar/iconSet branch (none of which have a `style` field at all). Returning the literal directly lets TypeScript check it against the ONE union member its own `type` tag names.
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
    const rank = Number(rankRaw);
    if (!Number.isFinite(rank) || rank <= 0) {
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
    // CT_CfRule/@aboveAverage's own documented default is true — only an explicit false is worth recording.
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

  // 'expression', or any type this union does not name — left for the caller's whole-element residue fallback.
  return undefined;
}

// --- the write side -------------------------------------------------------------------------------------------
