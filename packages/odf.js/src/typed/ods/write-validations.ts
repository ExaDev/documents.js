import type {
  Color,
  ContentSheet,
  ContentSheetConditionalFormat,
  ContentSheetConditionalFormatStyle,
  ContentSheetConditionalFormatValue,
  ContentSheetDataValidation,
  ContentSheetRange,
} from "document-schema.js";
import {} from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";

import {} from "../../package-io/scaffold";
import { type StyleRegistry } from "../../styles/registry";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";

import { formatOdfColor } from "../shared/color";

import {} from "../shared/paragraph";
import {} from "../shared/text";
import { cellReference } from "../shared/a1";
import {} from "../shared/border";
import {} from "./read";
import { synthesiseContentValidationCondition } from "./data-validation";
import { coverageKey } from "./write";

import {
  calextDateForTimePeriod,
  calextTypeForCfvoType,
  formatTargetRangeList,
  synthesiseConditionValue,
} from "./conditional-format";

export interface OdsWriteState {
  readonly pkg: Package;
  readonly registry: StyleRegistry;
  readonly contentAutomaticStyles: XmlElement;
  readonly stylesAutomaticStyles: XmlElement;
  readonly masterStyles: XmlElement;
  // The document-wide table:content-validations container (a direct child of office:spreadsheet, before every table:table) plus the fingerprint interner backing it: rules with identical promoted content across the whole document share one definition and one minted name, exactly the structure readContentValidationDefinitions/resolveSheetDataValidations join back together per sheet.
  readonly contentValidations: XmlElement;
  readonly validationNames: Map<string, string>;
  nextValidationName: number;
  nextObject: number;
  nextImage: number;
  nextZIndex: number;
  nextSheetStyle: number;
}

// The data-validation and conditional-format style writers split from write.ts: the interning, naming and XML emission for every validation rule and conditional format a sheet carries.

export function canonicalValidationKey(
  rule: ContentSheetDataValidation,
): string {
  return JSON.stringify([
    synthesiseContentValidationCondition(rule) ?? null,
    rule.allowBlank ?? true,
    rule.showInputMessage === true,
    rule.promptTitle,
    rule.prompt,
    rule.showErrorMessage === true,
    rule.errorStyle,
    rule.errorTitle,
    rule.error,
  ]);
}

// One table:content-validation definition per distinct written rule content in the whole document, interned by that key and named deterministically ("val1", "val2", ... in first-encounter order). The name is this writer's own mint — ODF ties no meaning to it beyond the references cells carry, and readOdsContent joins purely through it.
export function internContentValidation(
  rule: ContentSheetDataValidation,
  state: OdsWriteState,
): string {
  const fingerprint = canonicalValidationKey(rule);
  const existing = state.validationNames.get(fingerprint);
  if (existing !== undefined) {
    return existing;
  }
  const name = `val${state.nextValidationName}`;
  state.nextValidationName += 1;
  state.validationNames.set(fingerprint, name);

  const attributes: Record<string, string> = {
    "table:name": name,
  };
  const condition = synthesiseContentValidationCondition(rule);
  if (condition !== undefined) {
    attributes["table:condition"] = encodeXmlText(condition);
  }
  // allowBlank's absent form already reads back as true (readContentValidation's own default), so only the explicit "false" needs stating.
  if (rule.allowBlank === false) {
    attributes["table:allow-empty-cell"] = "false";
  }
  const children: XmlElement[] = [];
  const helpMessage = writeValidationMessage("table:help-message", rule);
  if (helpMessage !== undefined) {
    children.push(helpMessage);
  }
  const errorMessage = writeValidationMessage("table:error-message", rule);
  if (errorMessage !== undefined) {
    children.push(errorMessage);
  }
  state.contentValidations.children.push(
    el("table:content-validation", attributes, children),
  );
  return name;
}

// table:help-message/table:error-message, the inverse of readContentValidation's own message reading: a title attribute, a display flag stated only when true (an absent table:display reads back as absent, never as false), and a text:p per '\n'-separated body line.
export function writeValidationMessage(
  tag: "table:help-message" | "table:error-message",
  rule: ContentSheetDataValidation,
): XmlElement | undefined {
  const isHelp = tag === "table:help-message";
  const display = isHelp ? rule.showInputMessage : rule.showErrorMessage;
  const title = isHelp ? rule.promptTitle : rule.errorTitle;
  const body = isHelp ? rule.prompt : rule.error;
  if (display === undefined && title === undefined && body === undefined) {
    return undefined;
  }
  const attributes: Record<string, string> = {};
  if (display === true) {
    attributes["table:display"] = "true";
  }
  if (title !== undefined) {
    attributes["table:title"] = encodeXmlText(title);
  }
  if (!isHelp && rule.errorStyle !== undefined) {
    attributes["table:message-type"] = rule.errorStyle;
  }
  const children: XmlNode[] = [];
  if (body !== undefined) {
    for (const line of body.split("\n")) {
      children.push(el("text:p", {}, [txt(line)]));
    }
  }
  return el(tag, attributes, children);
}

// Every grid position a sheet's rules stamp, as coverageKey -> minted definition name. Positions covered by another cell's vertical span are excluded: ODF carries a validation reference only on a real table:table-cell, and a table:covered-table-cell (the only element a span-covered position can be) is invisible to readOdsContent's own reference walk — a position a span hides is a position no producer can reference, not a gap this writer chose.
export function validationNameByPosition(
  sheet: ContentSheet,
  covered: ReadonlySet<string>,
  state: OdsWriteState,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const rule of sheet.dataValidations ?? []) {
    const name = internContentValidation(rule, state);
    for (const range of rule.ranges) {
      for (let row = range.startRow; row <= range.endRow; row += 1) {
        for (
          let column = range.startColumn;
          column <= range.endColumn;
          column += 1
        ) {
          const key = coverageKey(row, column);
          if (!covered.has(key)) {
            names.set(key, name);
          }
        }
      }
    }
  }
  return names;
}

// A conditional-format rule's resulting style as one interned table-cell-family named style — the same channel a regular cell's own decoration takes (sheetCellStyle above), so readConditionalFormatStyle's resolveStyleElementChain finds it through the identical path. Only the two properties the schema itself carries are stated; a style carrying nothing but quarantined source mints nothing at all and reads back as no style.
export function conditionalFormatStyleName(
  style: ContentSheetConditionalFormatStyle | undefined,
  registry: StyleRegistry,
): string | undefined {
  if (style === undefined) {
    return undefined;
  }
  const propertyElements: XmlElement[] = [];
  if (style.background !== undefined) {
    propertyElements.push(
      el("style:table-cell-properties", {
        "fo:background-color": formatOdfColor(style.background),
      }),
    );
  }
  if (style.textColor !== undefined) {
    propertyElements.push(
      el("style:text-properties", {
        "fo:color": formatOdfColor(style.textColor),
      }),
    );
  }
  if (propertyElements.length === 0) {
    return undefined;
  }
  return registry.intern({
    properties: {},
    family: "table-cell",
    propertyElements,
  });
}

// calcext:color is stated only where the format itself carries one: a colour-scale entry's own colour. Data-bar and icon-set entries carry none (the data bar's colour lives on its parent's calcext:positive-color, and an icon-set entry has no colour concept at all), so `color` is optional and the attribute is simply absent without it.
export function writeCfvoEntry(
  tag: string,
  value: Readonly<ContentSheetConditionalFormatValue>,
  color?: Color,
): XmlElement {
  const type = calextTypeForCfvoType(value.type);
  if (type === undefined) {
    // Guarded by unsupportedConditionalFormatReason before any entry is built; an unreachable fallback here would silently write a stand-in type the read side maps differently.
    throw new Error(
      `writeCfvoEntry: cfvo type '${value.type}' has no calcext spelling`,
    );
  }
  const attributes: Record<string, string> = { "calcext:type": type };
  if (color !== undefined) {
    attributes["calcext:color"] = formatOdfColor(color);
  }
  if (value.value !== undefined) {
    attributes["calcext:value"] = encodeXmlText(value.value);
  }
  return el(tag, attributes);
}

// Why a conditional-format rule cannot be written, for every schema member or field ODF's calcext extension has no spelling for. Everything else has a genuine inverse; writeSheet throws this reason by name rather than emitting a rule that would read back as something else.
export function unsupportedConditionalFormatReason(
  format: ContentSheetConditionalFormat,
): string | undefined {
  if (format.type === "containsBlanks" || format.type === "notContainsBlanks") {
    return `a '${format.type}' rule, which calcext:condition's own vocabulary has no spelling for`;
  }
  if (format.priority !== undefined) {
    return "a conditional-format priority, which ODF's calcext extension carries no attribute for";
  }
  if (format.stopIfTrue !== undefined) {
    return "a stopIfTrue flag, which ODF's calcext extension carries no attribute for";
  }
  if (format.type === "aboveAverage" && format.stdDev !== undefined) {
    return "an aboveAverage standard-deviation count, which calcext:condition's own vocabulary has no spelling for";
  }
  if (format.type === "iconSet" && format.reverse === true) {
    return "a reversed icon set, which calcext:icon-set carries no attribute for";
  }
  const thresholds: ContentSheetConditionalFormatValue[] =
    format.type === "colorScale"
      ? format.stops.map((stop) => stop.value)
      : format.type === "dataBar"
        ? [format.min, format.max]
        : format.type === "iconSet"
          ? format.thresholds
          : [];
  if (
    thresholds.some(
      (threshold) => calextTypeForCfvoType(threshold.type) === undefined,
    )
  ) {
    return `a 'num' threshold value, which the calcext entry vocabulary has no spelling for (only min/max/percent/percentile/formula exist on this side of the round trip)`;
  }
  return undefined;
}

// One rule child of a calcext:conditional-format wrapper. Every rule reaching here already passed unsupportedConditionalFormatReason, so each branch states a genuine inverse rather than a degradation.
export function writeConditionalFormatChild(
  format: ContentSheetConditionalFormat,
  sheetName: string,
  registry: StyleRegistry,
): XmlElement {
  const baseCellAddress = `${sheetName}.${cellReference(format.ranges[0]!.startColumn, format.ranges[0]!.startRow)}`;
  switch (format.type) {
    case "colorScale": {
      const children: XmlElement[] = [];
      for (const stop of format.stops) {
        children.push(
          writeCfvoEntry("calcext:color-scale-entry", stop.value, stop.color),
        );
      }
      return el("calcext:color-scale", {}, children);
    }
    case "dataBar": {
      const attributes: Record<string, string> = {
        "calcext:positive-color": formatOdfColor(format.color),
      };
      if (format.showValue !== undefined) {
        attributes["calcext:show-value"] = format.showValue ? "true" : "false";
      }
      return el("calcext:data-bar", attributes, [
        writeCfvoEntry("calcext:formatting-entry", format.min),
        writeCfvoEntry("calcext:formatting-entry", format.max),
      ]);
    }
    case "iconSet": {
      const children: XmlElement[] = [];
      for (const threshold of format.thresholds) {
        children.push(writeCfvoEntry("calcext:formatting-entry", threshold));
      }
      const attributes: Record<string, string> = {
        "calcext:icon-set-type": encodeXmlText(format.iconSetType),
      };
      if (format.showValue !== undefined) {
        attributes["calcext:show-value"] = format.showValue ? "true" : "false";
      }
      return el("calcext:icon-set", attributes, children);
    }
    case "timePeriod": {
      const attributes: Record<string, string> = {
        "calcext:date": calextDateForTimePeriod(format.timePeriod),
      };
      const styleName = conditionalFormatStyleName(format.style, registry);
      if (styleName !== undefined) {
        attributes["calcext:style"] = encodeXmlText(styleName);
      }
      return el("calcext:date-is", attributes);
    }
    default: {
      // Every remaining type is a calcext:condition rule; its value is guaranteed synthesizable by the same refusal pass.
      const value = synthesiseConditionValue(format);
      if (value === undefined) {
        throw new Error(
          `writeConditionalFormatChild: a '${format.type}' rule reached the condition builder unsynthesizable`,
        );
      }
      const attributes: Record<string, string> = {
        "calcext:value": encodeXmlText(value),
        "calcext:base-cell-address": encodeXmlText(baseCellAddress),
      };
      const styleName = conditionalFormatStyleName(format.style, registry);
      if (styleName !== undefined) {
        attributes["calcext:apply-style-name"] = encodeXmlText(styleName);
      }
      return el("calcext:condition", attributes);
    }
  }
}

// The sheet's whole calcext:conditional-formats block: one calcext:conditional-format wrapper per distinct range list (the read side promotes each rule of a shared wrapper with that wrapper's own ranges, so rules sharing ranges re-share a wrapper and rules with distinct ranges each get their own), emitted after the rows exactly where the read side's childrenWithTag finds it and every real producer puts it.
export function writeConditionalFormats(
  sheet: ContentSheet,
  state: OdsWriteState,
): XmlElement | undefined {
  if (
    sheet.conditionalFormats === undefined ||
    sheet.conditionalFormats.length === 0
  ) {
    return undefined;
  }
  const wrappers = new Map<
    string,
    { ranges: ContentSheetRange[]; rules: ContentSheetConditionalFormat[] }
  >();
  for (const format of sheet.conditionalFormats) {
    const key = JSON.stringify(format.ranges);
    const wrapper = wrappers.get(key);
    if (wrapper === undefined) {
      wrappers.set(key, { ranges: format.ranges, rules: [format] });
    } else {
      wrapper.rules.push(format);
    }
  }
  const children: XmlElement[] = [];
  for (const { ranges, rules } of wrappers.values()) {
    children.push(
      el(
        "calcext:conditional-format",
        {
          "calcext:target-range-address": encodeXmlText(
            formatTargetRangeList(ranges, sheet.name),
          ),
        },
        rules.map((rule) =>
          writeConditionalFormatChild(rule, sheet.name, state.registry),
        ),
      ),
    );
  }
  return el("calcext:conditional-formats", {}, children);
}

// --- the used range: every position this writer must materialise a table:table-column/-row element for ---------------
//
// ODF's own table:table-column/table:table-row model is purely positional — there is no "skip to column N" spelling — so a sparse `columns`/`rows`/`cells` input has to be densified into one element per position from 0 up to the highest position anything in the sheet actually references, INDEPENDENTLY per axis (a column-only declaration must never force a row to exist, and vice versa).
export interface UsedRange {
  readonly maxRow: number | undefined;
  readonly maxColumn: number | undefined;
}
