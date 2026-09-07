import type {
  Color,
  ContentSheetConditionalFormat,
  ContentSheetConditionalFormatStyle,
  ContentSheetConditionalFormatValue,
  ContentSheetRange,
  SheetRuleOperator,
} from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { attrValue, childrenWithTag } from "../../xml/query";
import { parseCellReference } from "../shared/a1";
import { resolveStyle, resolveStyleElementChain } from "../shared/cascade";
import { parseOdfColor } from "../shared/color";
import { readCellStyleDecoration } from "../shared/table";
import { takeExpression } from "../shared/expression";
import { decodeXmlText } from "../../xml/entities";

// calcext:conditional-formats reading -- LibreOffice's own vendor extension for ODF conditional formatting (there is no OASIS-published grammar for it at all, unlike most of this reader's own targets), one calcext:conditional-formats element per table:table, sibling to its own table:table-row children (confirmed against real LibreOffice output, see typed/ods/read.ts's own collectOdsExtensionElementResidue note). Every element/attribute name and the calcext:condition value mini-language below are transcribed directly from LibreOffice's own reader (sc/source/filter/xml/xmlcondformat.cxx: ScXMLConditionalFormatsContext, ScXMLConditionalFormatContext, ScXMLConditionContext's own GetConditionData, ScXMLColorScaleFormatContext, ScXMLDataBarFormatContext, ScXMLIconSetFormatContext, ScXMLDateIsContext, and the shared setColorEntryType helper), the same "producer-specific attribute value not otherwise pinned down by any published spec is handled by reading the real implementation, not guessed at" precedent typed/ods/data-validation.ts's own table:condition reading already established.
//
// One calcext:conditional-format wraps a target-range-address plus one or more rule children (condition/color-scale/data-bar/icon-set/date-is), each promoted into its own ContentSheetConditionalFormat sharing that wrapper's own parsed ranges -- the identical "one wrapper, several rules, ranges copied onto each" modelling ooxml.js's own xlsx conditionalFormatting/cfRule reading already uses (ExaDev/documents.js#758), which is exactly the shape ContentSheetConditionalFormatSchema was designed around. A rule this reader cannot promote (an unrecognised condition value, a colour-scale/data-bar/icon-set entry type this format's own closed union has no member for, or a target-range-address that parses to no range at all) is left for the caller to hand to the pre-existing whole-element residue mechanism, as a synthetic single-rule calcext:conditional-format clone carrying the original wrapper's own target-range-address so the range that clone needs to reconstruct from survives alongside it.

export interface ConditionalFormatReadResult {
  formats: ContentSheetConditionalFormat[];
  residueElements: XmlElement[];
}

type CfvoType = "num" | "percent" | "max" | "min" | "formula" | "percentile";

// calcext's own color-scale-entry/formatting-entry/data-bar-entry "type" vocabulary (LibreOffice's shared setColorEntryType helper) -- "auto-minimum"/"auto-maximum" (an automatically-computed scale endpoint with no explicit value, a LibreOffice-specific concept ECMA-376's own closed cfvo type enum has no member for) are deliberately absent from this map, exactly mirroring how ooxml.js's own isCfvoType leaves an unrecognised xlsx cfvo @type unpromoted -- a rule using either falls back to residue rather than being silently narrowed to a plain "min"/"max".
const CFVO_TYPE_BY_CALCEXT_TYPE: ReadonlyMap<string, CfvoType> = new Map([
  ["minimum", "min"],
  ["maximum", "max"],
  ["percentile", "percentile"],
  ["percent", "percent"],
  ["formula", "formula"],
]);

export function readTargetRangeList(value: string): ContentSheetRange[] {
  const ranges: ContentSheetRange[] = [];
  for (const part of value.split(" ")) {
    if (part.length === 0) {
      continue;
    }
    const separatorIndex = part.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const start = parseA1WithOptionalSheetPrefix(part.slice(0, separatorIndex));
    const end = parseA1WithOptionalSheetPrefix(part.slice(separatorIndex + 1));
    if (start === undefined || end === undefined) {
      continue;
    }
    ranges.push({
      startRow: start.row,
      startColumn: start.column,
      endRow: end.row,
      endColumn: end.column,
    });
  }
  return ranges;
}

function parseA1WithOptionalSheetPrefix(
  cellPart: string,
): { column: number; row: number } | undefined {
  const dotIndex = cellPart.lastIndexOf(".");
  const bareReference =
    dotIndex === -1 ? cellPart : cellPart.slice(dotIndex + 1);
  return parseCellReference(bareReference);
}

function readConditionalFormatStyle(
  styleName: string | undefined,
  pkg: Package,
): ContentSheetConditionalFormatStyle | undefined {
  if (styleName === undefined) {
    return undefined;
  }
  const { elements } = resolveStyleElementChain(styleName, "table-cell", pkg);
  if (elements.length === 0) {
    return undefined;
  }
  // ContentSheetConditionalFormatStyleSchema.background is a plain colour (the two properties actually observed on a real dxf, per that schema's own top comment); readCellStyleDecoration's own background is the richer solid/pattern ContentCellFill a regular cell can carry, so only the 'solid' case narrows down to a colour here -- a pattern fill on the referenced style has no representation in this narrower schema and is simply not carried through, matching the schema's own documented scope.
  const { background: fill } = readCellStyleDecoration(elements);
  const background = fill?.kind === "solid" ? fill.color : undefined;
  const { properties } = resolveStyle(styleName, "table-cell", pkg);
  const textColor = properties.color;
  if (background === undefined && textColor === undefined) {
    return undefined;
  }
  return {
    ...(textColor !== undefined ? { textColor } : {}),
    ...(background !== undefined ? { background } : {}),
  };
}

// calcext:condition's own "value" mini-language (e.g. "between(1,10)", "=formula", "unique", "top-elements(5)") -- transcribed directly from xmlcondformat.cxx's own GetConditionData, which matches by literal prefix (longest real match wins by construction: every prefix below is distinct and none is itself a prefix of an earlier-checked one) then extracts 0-2 paren/comma-delimited operands via ScXMLConditionHelper::getExpression, the same balanced-paren/quote-aware algorithm typed/shared/expression.ts already carries for table:condition's own unrelated mini-language.
type ConditionMode =
  | "unique"
  | "duplicate"
  | "between"
  | "not-between"
  | "eq-less"
  | "eq-greater"
  | "not-equal"
  | "less"
  | "equal"
  | "greater"
  | "formula-is"
  | "top-elements"
  | "bottom-elements"
  | "top-percent"
  | "bottom-percent"
  | "above-average"
  | "below-average"
  | "above-equal-average"
  | "below-equal-average"
  | "is-error"
  | "is-no-error"
  | "begins-with"
  | "ends-with"
  | "contains-text"
  | "not-contains-text";

interface ParsedCondition {
  readonly mode: ConditionMode;
  readonly expr1: string | undefined;
  readonly expr2: string | undefined;
}

export function parseConditionValue(
  value: string,
): ParsedCondition | undefined {
  if (value.startsWith("unique")) {
    return { mode: "unique", expr1: undefined, expr2: undefined };
  }
  if (value.startsWith("duplicate")) {
    return { mode: "duplicate", expr1: undefined, expr2: undefined };
  }
  if (value.startsWith("not-between")) {
    return parseTwoOperand(value, "not-between");
  }
  if (value.startsWith("between")) {
    return parseTwoOperand(value, "between");
  }
  if (value.startsWith("<=")) {
    return { mode: "eq-less", expr1: value.slice(2), expr2: undefined };
  }
  if (value.startsWith(">=")) {
    return { mode: "eq-greater", expr1: value.slice(2), expr2: undefined };
  }
  if (value.startsWith("!=")) {
    return { mode: "not-equal", expr1: value.slice(2), expr2: undefined };
  }
  if (value.startsWith("<")) {
    return { mode: "less", expr1: value.slice(1), expr2: undefined };
  }
  if (value.startsWith("=")) {
    return { mode: "equal", expr1: value.slice(1), expr2: undefined };
  }
  if (value.startsWith(">")) {
    return { mode: "greater", expr1: value.slice(1), expr2: undefined };
  }
  if (value.startsWith("formula-is")) {
    return parseOneOperand(value, "formula-is");
  }
  if (value.startsWith("top-elements")) {
    return parseOneOperand(value, "top-elements");
  }
  if (value.startsWith("bottom-elements")) {
    return parseOneOperand(value, "bottom-elements");
  }
  if (value.startsWith("top-percent")) {
    return parseOneOperand(value, "top-percent");
  }
  if (value.startsWith("bottom-percent")) {
    return parseOneOperand(value, "bottom-percent");
  }
  if (value.startsWith("above-equal-average")) {
    return {
      mode: "above-equal-average",
      expr1: undefined,
      expr2: undefined,
    };
  }
  if (value.startsWith("below-equal-average")) {
    return {
      mode: "below-equal-average",
      expr1: undefined,
      expr2: undefined,
    };
  }
  if (value.startsWith("above-average")) {
    return { mode: "above-average", expr1: undefined, expr2: undefined };
  }
  if (value.startsWith("below-average")) {
    return { mode: "below-average", expr1: undefined, expr2: undefined };
  }
  if (value.startsWith("is-no-error")) {
    return { mode: "is-no-error", expr1: undefined, expr2: undefined };
  }
  if (value.startsWith("is-error")) {
    return { mode: "is-error", expr1: undefined, expr2: undefined };
  }
  if (value.startsWith("begins-with")) {
    return parseOneOperand(value, "begins-with");
  }
  if (value.startsWith("ends-with")) {
    return parseOneOperand(value, "ends-with");
  }
  if (value.startsWith("not-contains-text")) {
    return parseOneOperand(value, "not-contains-text");
  }
  if (value.startsWith("contains-text")) {
    return parseOneOperand(value, "contains-text");
  }
  return undefined;
}

// The operand list always starts at mode.length + 1: every mode string handled here is immediately followed, with no whitespace, by the '(' that opens its own operand list (confirmed against every real pStr + N offset in xmlcondformat.cxx's own GetConditionData -- N is mechanically strlen(prefix) + 1 in every single case). Deriving it from `mode` itself here, rather than repeating each prefix's own length as a hardcoded literal per call site, is what caught a real off-by-one in this function's own first draft: "not-contains-text" -- 18 real characters -- was originally paired with a hand-counted 19.
function parseOneOperand(value: string, mode: ConditionMode): ParsedCondition {
  const { value: expr1 } = takeExpression(value, mode.length + 1, ")");
  return { mode, expr1, expr2: undefined };
}

function parseTwoOperand(value: string, mode: ConditionMode): ParsedCondition {
  const first = takeExpression(value, mode.length + 1, ",");
  const second = takeExpression(value, first.nextIndex, ")");
  return { mode, expr1: first.value, expr2: second.value };
}

const COMPARISON_OPERATOR_BY_MODE: ReadonlyMap<
  ConditionMode,
  SheetRuleOperator
> = new Map([
  ["eq-less", "lessThanOrEqual"],
  ["eq-greater", "greaterThanOrEqual"],
  ["not-equal", "notEqual"],
  ["less", "lessThan"],
  ["equal", "equal"],
  ["greater", "greaterThan"],
]);

// decodeXmlText on every attribute value read here, not just this one: this package parses with processEntities:false (xml/parse.ts), so an attribute value is stored exactly as the source XML spelled it -- a real LibreOffice-produced calcext:value of ">3" is confirmed (typed/ods/fixtures/conditional-format.ods's own content.xml) to serialise as calcext:value="&gt;3", literally, on disk. Reading it via a bare attrValue() would hand ">3"'s own comparison-operator prefix match a literal "&gt;3" instead, silently failing to match any of this mini-language's own prefixes and quarantining a real, well-formed rule as unpromotable residue.
function readCondition(
  conditionEl: XmlElement,
  ranges: ContentSheetRange[],
  pkg: Package,
): ContentSheetConditionalFormat | undefined {
  const rawValue = attrValue(conditionEl, "calcext:value");
  const parsed =
    rawValue === undefined
      ? undefined
      : parseConditionValue(decodeXmlText(rawValue));
  if (parsed === undefined) {
    return undefined;
  }
  const styleName = attrValue(conditionEl, "calcext:apply-style-name");
  const style = readConditionalFormatStyle(
    styleName === undefined ? undefined : decodeXmlText(styleName),
    pkg,
  );
  const styleField = style === undefined ? {} : { style };

  switch (parsed.mode) {
    case "unique":
      return { type: "uniqueValues", ranges, ...styleField };
    case "duplicate":
      return { type: "duplicateValues", ranges, ...styleField };
    case "is-error":
      return { type: "containsErrors", ranges, ...styleField };
    case "is-no-error":
      return { type: "notContainsErrors", ranges, ...styleField };
    case "between":
    case "not-between": {
      if (parsed.expr1 === undefined || parsed.expr2 === undefined) {
        return undefined;
      }
      return {
        type: "cellIs",
        ranges,
        operator: parsed.mode === "between" ? "between" : "notBetween",
        formula1: parsed.expr1,
        formula2: parsed.expr2,
        ...styleField,
      };
    }
    case "eq-less":
    case "eq-greater":
    case "not-equal":
    case "less":
    case "equal":
    case "greater": {
      const operator = COMPARISON_OPERATOR_BY_MODE.get(parsed.mode);
      if (operator === undefined || parsed.expr1 === undefined) {
        return undefined;
      }
      return {
        type: "cellIs",
        ranges,
        operator,
        formula1: parsed.expr1,
        ...styleField,
      };
    }
    case "top-elements":
    case "bottom-elements":
    case "top-percent":
    case "bottom-percent": {
      if (parsed.expr1 === undefined) {
        return undefined;
      }
      const rank = Number(parsed.expr1);
      if (!Number.isFinite(rank) || rank <= 0) {
        return undefined;
      }
      const bottom =
        parsed.mode === "bottom-elements" || parsed.mode === "bottom-percent"
          ? true
          : undefined;
      const percent =
        parsed.mode === "top-percent" || parsed.mode === "bottom-percent"
          ? true
          : undefined;
      return {
        type: "top10",
        ranges,
        rank,
        ...(percent !== undefined ? { percent } : {}),
        ...(bottom !== undefined ? { bottom } : {}),
        ...styleField,
      };
    }
    case "above-average":
    case "below-average":
    case "above-equal-average":
    case "below-equal-average": {
      const aboveAverage =
        parsed.mode === "above-average" ||
        parsed.mode === "above-equal-average";
      const equalAverage =
        parsed.mode === "above-equal-average" ||
        parsed.mode === "below-equal-average";
      return {
        type: "aboveAverage",
        ranges,
        aboveAverage,
        equalAverage,
        ...styleField,
      };
    }
    case "begins-with":
    case "ends-with":
    case "contains-text":
    case "not-contains-text": {
      if (parsed.expr1 === undefined) {
        return undefined;
      }
      const type =
        parsed.mode === "begins-with"
          ? "beginsWith"
          : parsed.mode === "ends-with"
            ? "endsWith"
            : parsed.mode === "contains-text"
              ? "containsText"
              : "notContainsText";
      return { type, ranges, text: parsed.expr1, ...styleField };
    }
    case "formula-is":
      // ECMA-376's own 'expression' cfRule type has no closed-form structure to model without a general formula engine, and ContentSheetConditionalFormatSchema deliberately excludes it (see that schema's own top comment) -- calcext:condition's own formula-is is the identical concept, so it is left unpromoted here for exactly the same reason.
      return undefined;
  }
}

function readCfvoValue(
  entryEl: XmlElement,
): ContentSheetConditionalFormatValue | undefined {
  const rawType = attrValue(entryEl, "calcext:type");
  const type =
    rawType === undefined ? undefined : CFVO_TYPE_BY_CALCEXT_TYPE.get(rawType);
  if (type === undefined) {
    return undefined;
  }
  const value = attrValue(entryEl, "calcext:value");
  return {
    type,
    ...(value !== undefined ? { value: decodeXmlText(value) } : {}),
  };
}

function readColorScale(
  colorScaleEl: XmlElement,
  ranges: ContentSheetRange[],
): ContentSheetConditionalFormat | undefined {
  const entryEls = childrenWithTag(colorScaleEl, "calcext:color-scale-entry");
  if (entryEls.length < 2 || entryEls.length > 3) {
    return undefined;
  }
  const stops: { value: ContentSheetConditionalFormatValue; color: Color }[] =
    [];
  for (const entryEl of entryEls) {
    const value = readCfvoValue(entryEl);
    const colorRaw = attrValue(entryEl, "calcext:color");
    const color = colorRaw === undefined ? undefined : parseOdfColor(colorRaw);
    if (value === undefined || color === undefined) {
      return undefined;
    }
    stops.push({ value, color });
  }
  return { type: "colorScale", ranges, stops };
}

function readDataBar(
  dataBarEl: XmlElement,
  ranges: ContentSheetRange[],
): ContentSheetConditionalFormat | undefined {
  const entryEls = [
    ...childrenWithTag(dataBarEl, "calcext:formatting-entry"),
    ...childrenWithTag(dataBarEl, "calcext:data-bar-entry"),
  ];
  const minEl = entryEls[0];
  const maxEl = entryEls[1];
  if (minEl === undefined || maxEl === undefined) {
    return undefined;
  }
  const min = readCfvoValue(minEl);
  const max = readCfvoValue(maxEl);
  const colorRaw = attrValue(dataBarEl, "calcext:positive-color");
  const color = colorRaw === undefined ? undefined : parseOdfColor(colorRaw);
  if (min === undefined || max === undefined || color === undefined) {
    return undefined;
  }
  const showValue = attrValue(dataBarEl, "calcext:show-value");
  return {
    type: "dataBar",
    ranges,
    min,
    max,
    color,
    ...(showValue !== undefined ? { showValue: showValue === "true" } : {}),
  };
}

function readIconSet(
  iconSetEl: XmlElement,
  ranges: ContentSheetRange[],
): ContentSheetConditionalFormat | undefined {
  const iconSetType = attrValue(iconSetEl, "calcext:icon-set-type");
  if (iconSetType === undefined) {
    return undefined;
  }
  const thresholds: ContentSheetConditionalFormatValue[] = [];
  for (const entryEl of childrenWithTag(
    iconSetEl,
    "calcext:formatting-entry",
  )) {
    const value = readCfvoValue(entryEl);
    if (value === undefined) {
      return undefined;
    }
    thresholds.push(value);
  }
  if (thresholds.length === 0) {
    return undefined;
  }
  const showValue = attrValue(iconSetEl, "calcext:show-value");
  return {
    type: "iconSet",
    ranges,
    iconSetType,
    thresholds,
    ...(showValue !== undefined ? { showValue: showValue === "true" } : {}),
  };
}

type TimePeriod =
  | "yesterday"
  | "today"
  | "tomorrow"
  | "last7Days"
  | "thisMonth"
  | "lastMonth"
  | "nextMonth"
  | "thisWeek"
  | "lastWeek"
  | "nextWeek"
  | "thisYear"
  | "lastYear"
  | "nextYear";

// calcext:date-is is ODF/calcext's own year-scoped superset of xlsx's ST_TimePeriod (see document-schema.js's own top-of-file note on the timePeriod union member this reader alone can reach): today/yesterday/tomorrow/last-7-days/this-week/last-week/next-week/this-month/last-month/next-month/this-year/last-year/next-year.
const TIME_PERIOD_BY_CALCEXT_DATE: ReadonlyMap<string, TimePeriod> = new Map([
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
]);

function readDateIs(
  dateIsEl: XmlElement,
  ranges: ContentSheetRange[],
  pkg: Package,
): ContentSheetConditionalFormat | undefined {
  const dateRaw = attrValue(dateIsEl, "calcext:date");
  const timePeriod =
    dateRaw === undefined
      ? undefined
      : TIME_PERIOD_BY_CALCEXT_DATE.get(dateRaw);
  if (timePeriod === undefined) {
    return undefined;
  }
  const dateIsStyleName = attrValue(dateIsEl, "calcext:style");
  const style = readConditionalFormatStyle(
    dateIsStyleName === undefined ? undefined : decodeXmlText(dateIsStyleName),
    pkg,
  );
  return {
    type: "timePeriod",
    ranges,
    timePeriod,
    ...(style !== undefined ? { style } : {}),
  };
}

function readConditionalFormat(
  formatEl: XmlElement,
  pkg: Package,
): { formats: ContentSheetConditionalFormat[]; promoted: boolean } {
  const targetRangeAddress = attrValue(
    formatEl,
    "calcext:target-range-address",
  );
  const ranges =
    targetRangeAddress === undefined
      ? []
      : readTargetRangeList(targetRangeAddress);
  if (ranges.length === 0) {
    return { formats: [], promoted: false };
  }
  const formats: ContentSheetConditionalFormat[] = [];
  let sawAnyChild = false;
  let allPromoted = true;
  for (const child of formatEl.children) {
    if (child.type !== "element") {
      continue;
    }
    let promotedFormat: ContentSheetConditionalFormat | undefined;
    switch (child.tag) {
      case "calcext:condition":
        sawAnyChild = true;
        promotedFormat = readCondition(child, ranges, pkg);
        break;
      case "calcext:color-scale":
        sawAnyChild = true;
        promotedFormat = readColorScale(child, ranges);
        break;
      case "calcext:data-bar":
        sawAnyChild = true;
        promotedFormat = readDataBar(child, ranges);
        break;
      case "calcext:icon-set":
        sawAnyChild = true;
        promotedFormat = readIconSet(child, ranges);
        break;
      case "calcext:date-is":
        sawAnyChild = true;
        promotedFormat = readDateIs(child, ranges, pkg);
        break;
      default:
        continue;
    }
    if (promotedFormat === undefined) {
      allPromoted = false;
      continue;
    }
    formats.push(promotedFormat);
  }
  return { formats, promoted: sawAnyChild && allPromoted };
}

export function readConditionalFormats(
  tableElement: XmlElement,
  pkg: Package,
): ConditionalFormatReadResult {
  const formats: ContentSheetConditionalFormat[] = [];
  const residueElements: XmlElement[] = [];
  const wrapperEl = childrenWithTag(
    tableElement,
    "calcext:conditional-formats",
  )[0];
  if (wrapperEl === undefined) {
    return { formats, residueElements };
  }
  for (const formatEl of childrenWithTag(
    wrapperEl,
    "calcext:conditional-format",
  )) {
    const result = readConditionalFormat(formatEl, pkg);
    if (result.promoted) {
      formats.push(...result.formats);
    } else {
      residueElements.push({
        type: "element",
        tag: "calcext:conditional-formats",
        attributes: wrapperEl.attributes,
        children: [formatEl],
      });
    }
  }
  return { formats, residueElements };
}
