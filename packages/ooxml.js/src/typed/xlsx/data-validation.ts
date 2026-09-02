import type {
  ContentSheetDataValidation,
  ContentSheetDataValidationType,
  SheetRuleOperator,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { attr, childrenWithTag, decodeEntities, textContent } from "../util";
import { readXmlBool, writeXmlBool } from "./util";
import {
  captureResidualAttributes,
  residualAttributesFor,
} from "./rule-residue";
import { formatSqref, parseSqref } from "./sqref";

// xlsx dataValidation <-> ContentSheetDataValidation, promoted from the anchor-cell residue landing typed/xlsx/content.ts's own applyCellResidueRules used to quarantine every rule under, for every ContentSheetDataValidationTypeSchema member -- effectively the FULL ECMA-376 ST_DataValidationType vocabulary bar its own 'none' member (a rule declaring no validation at all, vanishingly rare and structurally meaningless, so left for the whole-element residue fallback like any other unrecognised type).

const DATA_VALIDATION_TYPES = new Set([
  "whole",
  "decimal",
  "list",
  "date",
  "time",
  "textLength",
  "custom",
]);

function isDataValidationType(
  value: string | undefined,
): value is ContentSheetDataValidationType {
  return value !== undefined && DATA_VALIDATION_TYPES.has(value);
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

// 'list' and 'custom' have no comparison operator (document-schema.js's own doc comment on ContentSheetDataValidationSchema.operator) -- a stray operator attribute a producer left on one of these two (real-producer-validation-and-cellis.xlsx's own list validation carries operator="equal", meaningless for a list) is noise this reader does not carry into the structured field.
const TYPES_WITHOUT_OPERATOR = new Set<ContentSheetDataValidationType>([
  "list",
  "custom",
]);

const MANAGED_ATTRIBUTES = new Set([
  "type",
  "errorStyle",
  "operator",
  "allowBlank",
  "showInputMessage",
  "showErrorMessage",
  "promptTitle",
  "prompt",
  "errorTitle",
  "error",
  "sqref",
]);

export interface DataValidationReadResult {
  validations: ContentSheetDataValidation[];
  // Every <dataValidation> element this reader could not promote structurally (type 'none' or otherwise unrecognised, or a sqref that parses to no range at all) -- fed to content.ts's own applyCellResidueRules exactly as a whole quarantined rule always has been.
  residueElements: XmlElement[];
}

export function readDataValidations(
  worksheet: XmlElement,
): DataValidationReadResult {
  const validations: ContentSheetDataValidation[] = [];
  const residueElements: XmlElement[] = [];
  for (const container of childrenWithTag(worksheet, "dataValidations")) {
    for (const element of childrenWithTag(container, "dataValidation")) {
      const promoted = readDataValidation(element);
      if (promoted === undefined) {
        residueElements.push(element);
        continue;
      }
      validations.push(promoted);
    }
  }
  return { validations, residueElements };
}

function readFormulaChild(
  element: XmlElement,
  tag: "formula1" | "formula2",
): string | undefined {
  const child = childrenWithTag(element, tag)[0];
  // textContent already entity-decodes (typed/util.ts) -- formula text is carried verbatim otherwise, matching ContentSheetCell.formula's own "raw, unparsed" convention.
  return child === undefined ? undefined : textContent(child);
}

function readDataValidation(
  element: XmlElement,
): ContentSheetDataValidation | undefined {
  const typeRaw = attr(element, "type");
  if (!isDataValidationType(typeRaw)) {
    return undefined;
  }
  const ranges = parseSqref(attr(element, "sqref"));
  if (ranges.length === 0) {
    return undefined;
  }

  const operatorRaw = attr(element, "operator");
  const operator =
    !TYPES_WITHOUT_OPERATOR.has(typeRaw) && isSheetRuleOperator(operatorRaw)
      ? operatorRaw
      : undefined;
  const formula1 = readFormulaChild(element, "formula1");
  const formula2 =
    operator === "between" || operator === "notBetween"
      ? readFormulaChild(element, "formula2")
      : undefined;
  const promptTitle = attr(element, "promptTitle");
  const prompt = attr(element, "prompt");
  const errorTitle = attr(element, "errorTitle");
  const error = attr(element, "error");
  // 'stop' is CT_DataValidation/@errorStyle's own documented default -- left absent, matching this reader's own "absent means default" convention throughout.
  const errorStyleRaw = attr(element, "errorStyle");
  const errorStyle =
    errorStyleRaw === "warning" || errorStyleRaw === "information"
      ? errorStyleRaw
      : undefined;
  const source = captureResidualAttributes(element, MANAGED_ATTRIBUTES);

  return {
    ranges,
    type: typeRaw,
    ...(operator === undefined ? {} : { operator }),
    ...(formula1 === undefined ? {} : { formula1 }),
    ...(formula2 === undefined ? {} : { formula2 }),
    ...(readXmlBool(attr(element, "allowBlank")) ? { allowBlank: true } : {}),
    ...(readXmlBool(attr(element, "showInputMessage"))
      ? { showInputMessage: true }
      : {}),
    ...(promptTitle === undefined
      ? {}
      : { promptTitle: decodeEntities(promptTitle) }),
    ...(prompt === undefined ? {} : { prompt: decodeEntities(prompt) }),
    ...(readXmlBool(attr(element, "showErrorMessage"))
      ? { showErrorMessage: true }
      : {}),
    ...(errorStyle === undefined ? {} : { errorStyle }),
    ...(errorTitle === undefined
      ? {}
      : { errorTitle: decodeEntities(errorTitle) }),
    ...(error === undefined ? {} : { error: decodeEntities(error) }),
    ...(source === undefined ? {} : { source }),
  };
}

// --- the write side -------------------------------------------------------------------------------------------

export function buildDataValidationsElement(
  validations: readonly ContentSheetDataValidation[],
): XmlElement | undefined {
  if (validations.length === 0) {
    return undefined;
  }
  const elements = validations.map(buildDataValidationElement);
  return el("dataValidations", { count: String(elements.length) }, elements);
}

function buildDataValidationElement(
  validation: ContentSheetDataValidation,
): XmlElement {
  const attrs: Record<string, string> = residualAttributesFor(
    validation.source,
    "dataValidation",
  );
  attrs.type = validation.type;
  attrs.sqref = formatSqref(validation.ranges);
  if (validation.operator !== undefined) {
    attrs.operator = validation.operator;
  }
  attrs.allowBlank = writeXmlBool(validation.allowBlank === true);
  attrs.showInputMessage = writeXmlBool(validation.showInputMessage === true);
  attrs.showErrorMessage = writeXmlBool(validation.showErrorMessage === true);
  attrs.errorStyle = validation.errorStyle ?? "stop";
  if (validation.promptTitle !== undefined) {
    attrs.promptTitle = encodeXmlText(validation.promptTitle);
  }
  if (validation.prompt !== undefined) {
    attrs.prompt = encodeXmlText(validation.prompt);
  }
  if (validation.errorTitle !== undefined) {
    attrs.errorTitle = encodeXmlText(validation.errorTitle);
  }
  if (validation.error !== undefined) {
    attrs.error = encodeXmlText(validation.error);
  }
  const children: XmlNode[] = [];
  if (validation.formula1 !== undefined) {
    children.push(
      el("formula1", {}, [txt(encodeXmlText(validation.formula1))]),
    );
  }
  if (validation.formula2 !== undefined) {
    children.push(
      el("formula2", {}, [txt(encodeXmlText(validation.formula2))]),
    );
  }
  return el("dataValidation", attrs, children);
}
