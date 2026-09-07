import type {
  ContentSheetDataValidation,
  ContentSheetDataValidationType,
  ContentSheetRange,
  SheetRuleOperator,
} from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { attrValue, childrenWithTag, findChildElement } from "../../xml/query";
import { decodeOdfText } from "../shared/text";

// table:content-validation reading -- ODF's own equivalent of xlsx's dataValidation, but structurally inverted: xlsx states a rule's own cell ranges directly (sqref); ODF mints one table:content-validation per RULE, document-wide (a direct child of office:spreadsheet, inside table:content-validations, sibling to every table:table -- confirmed against a real LibreOffice-produced .fods fixture, not assumed), and each table:table-cell that the rule applies to carries a table:content-validation-name reference back to it. This module owns reading the document-wide rule definitions; table/read.ts's own cell walk collects which cells reference which name, and joins the two per sheet (readSheet, ./read.ts) since a rule's own applicable ranges are scoped to whichever sheet(s) actually reference it, not to the rule definition itself.
//
// table:condition is ODF's own small formula-shaped mini-language (e.g. "of:cell-content-is-whole-number() and cell-content()>=1"), not a value this reader can just read off an attribute -- there is no closed grammar for it in the OASIS spec's own prose, so the token vocabulary, comparison operators, and "and <comparison>" secondary-clause structure below are transcribed directly from LibreOffice's own reader (sc/source/filter/xml/xmlcvali.cxx's GetCondition, sc/source/filter/xml/XMLConverter.cxx's ScXMLConditionHelper::parseCondition and its own spConditionInfos identifier table) rather than guessed at, matching how a producer-specific attribute value not otherwise pinned down by the format spec is handled everywhere else this package needs one (see typed/shared/table.ts's own loext: cell-fill precedent).

type ConditionKind =
  "keyword" | "comparison" | "function0" | "function1" | "function2";

interface ConditionInfo {
  readonly kind: ConditionKind;
  readonly validation?: ContentSheetDataValidationType; // absent for the two purely structural tokens ('and', 'cell-content') that never open a condition string on their own
  readonly operator?: SheetRuleOperator;
}

// Transcribed from XMLConverter.cxx's own spConditionInfos table, longest real match wins by construction since every identifier here is distinct and none is a prefix of another.
const CONDITION_INFOS: ReadonlyMap<string, ConditionInfo> = new Map([
  ["and", { kind: "keyword" }],
  ["cell-content", { kind: "comparison" }],
  ["cell-content-is-between", { kind: "function2", operator: "between" }],
  [
    "cell-content-is-not-between",
    { kind: "function2", operator: "notBetween" },
  ],
  ["cell-content-is-whole-number", { kind: "function0", validation: "whole" }],
  [
    "cell-content-is-decimal-number",
    { kind: "function0", validation: "decimal" },
  ],
  ["cell-content-is-date", { kind: "function0", validation: "date" }],
  ["cell-content-is-time", { kind: "function0", validation: "time" }],
  [
    "cell-content-is-in-list",
    { kind: "function1", validation: "list", operator: "equal" },
  ],
  [
    "cell-content-text-length",
    { kind: "comparison", validation: "textLength" },
  ],
  [
    "cell-content-text-length-is-between",
    { kind: "function2", validation: "textLength", operator: "between" },
  ],
  [
    "cell-content-text-length-is-not-between",
    { kind: "function2", validation: "textLength", operator: "notBetween" },
  ],
  ["is-true-formula", { kind: "function1", validation: "custom" }],
]);

const IDENTIFIER_PATTERN = /^[a-z-]+/;
const OPERATOR_PATTERN = /^(!=|<=|>=|=|<|>)/;
const OPERATOR_TO_RULE: ReadonlyMap<string, SheetRuleOperator> = new Map([
  ["=", "equal"],
  ["!=", "notEqual"],
  ["<", "lessThan"],
  ["<=", "lessThanOrEqual"],
  [">", "greaterThan"],
  [">=", "greaterThanOrEqual"],
]);

// Skips one formula expression starting at `start`, honouring nested parentheses/braces and quoted strings (a comma or closing paren inside either must not end the expression) -- transcribed from XMLConverter.cxx's own lclSkipExpression/lclSkipExpressionString. Returns the index of the first unnested occurrence of `endChar`, or `text.length` if the expression runs to the end unterminated.
function skipExpression(text: string, start: number, endChar: string): number {
  let index = start;
  while (index < text.length) {
    const ch = text[index];
    if (ch === endChar) {
      return index;
    }
    if (ch === "(") {
      index = skipExpression(text, index + 1, ")") + 1;
      continue;
    }
    if (ch === "{") {
      index = skipExpression(text, index + 1, "}") + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const closeQuote = text.indexOf(ch, index + 1);
      index = (closeQuote === -1 ? text.length : closeQuote) + 1;
      continue;
    }
    index += 1;
  }
  return text.length;
}

// Extracts and trims one expression, advancing past its own terminator -- XMLConverter.cxx's own getExpression. Returns undefined (never an empty string) when the expression is empty, matching that function's own "empty means failure" contract for a FUNCTION1/FUNCTION2 operand.
function takeExpression(
  text: string,
  start: number,
  endChar: string,
): { value: string | undefined; nextIndex: number } {
  const endIndex = skipExpression(text, start, endChar);
  const raw = text.slice(start, endIndex).trim();
  return {
    value: raw.length > 0 ? raw : undefined,
    nextIndex: endIndex + 1,
  };
}

interface ParsedToken {
  readonly info: ConditionInfo;
  readonly operand1: string | undefined;
  readonly operand2: string | undefined;
  readonly endIndex: number;
}

// One token of the condition mini-language starting at `start`: an identifier, matched against CONDITION_INFOS, then whatever that identifier's own kind requires immediately after it (a comparison operator and one trailing expression, an empty ()) pair, or one/two parenthesised expressions). Returns undefined on anything this reader cannot make sense of -- a genuinely malformed or producer-extended condition degrades to no validation type/operator rather than a wrong one, mirroring readCellValue's own "an honest 'we don't have one' beats a fabricated value" convention elsewhere in this reader.
function parseToken(text: string, start: number): ParsedToken | undefined {
  // Skips leading whitespace before matching -- real ODF condition strings have a literal space either side of the 'and' keyword (lclSkipWhitespace's own call sites in XMLConverter.cxx), and this parser's own primary/secondary calls resume exactly where the previous token's endIndex left off, which is never itself past that space.
  let searchStart = start;
  while (searchStart < text.length && text[searchStart] === " ") {
    searchStart += 1;
  }
  const match = IDENTIFIER_PATTERN.exec(text.slice(searchStart));
  if (match === null) {
    return undefined;
  }
  const identifier = match[0];
  const info = CONDITION_INFOS.get(identifier);
  if (info === undefined) {
    return undefined;
  }
  let index = searchStart + identifier.length;

  switch (info.kind) {
    case "keyword":
      return {
        info,
        operand1: undefined,
        operand2: undefined,
        endIndex: index,
      };

    case "function0": {
      if (text.slice(index, index + 2) !== "()") {
        return undefined;
      }
      return {
        info,
        operand1: undefined,
        operand2: undefined,
        endIndex: index + 2,
      };
    }

    case "comparison": {
      if (text.slice(index, index + 2) !== "()") {
        return undefined;
      }
      index += 2;
      const opMatch = OPERATOR_PATTERN.exec(text.slice(index));
      if (opMatch === null) {
        return undefined;
      }
      const operator = OPERATOR_TO_RULE.get(opMatch[0]);
      index += opMatch[0].length;
      const operand1 = text.slice(index).trim();
      if (operand1.length === 0) {
        return undefined;
      }
      return {
        info: { ...info, operator },
        operand1,
        operand2: undefined,
        endIndex: text.length,
      };
    }

    case "function1": {
      if (text[index] !== "(") {
        return undefined;
      }
      const { value, nextIndex } = takeExpression(text, index + 1, ")");
      if (value === undefined) {
        return undefined;
      }
      return {
        info,
        operand1: value,
        operand2: undefined,
        endIndex: nextIndex,
      };
    }

    case "function2": {
      if (text[index] !== "(") {
        return undefined;
      }
      const first = takeExpression(text, index + 1, ",");
      if (first.value === undefined) {
        return undefined;
      }
      const second = takeExpression(text, first.nextIndex, ")");
      if (second.value === undefined) {
        return undefined;
      }
      return {
        info,
        operand1: first.value,
        operand2: second.value,
        endIndex: second.nextIndex,
      };
    }
  }
}

interface ParsedCondition {
  readonly type: ContentSheetDataValidationType;
  readonly operator?: SheetRuleOperator;
  readonly formula1?: string;
  readonly formula2?: string;
}

// table:condition's own outer namespace prefix (e.g. "of:" for OpenFormula) precedes the whole condition string, not any one operand within it -- stripped once, generically, rather than enumerating every namespace a producer might use, since nothing here needs to know WHICH formula grammar the operands are written in (they stay raw text either way, matching ContentSheetDataValidationSchema's own "no formula engine" contract).
const NAMESPACE_PREFIX_PATTERN = /^[a-zA-Z]+:/;

export function parseContentValidationCondition(
  condition: string,
): ParsedCondition | undefined {
  const stripped = condition.replace(NAMESPACE_PREFIX_PATTERN, "");
  const primary = parseToken(stripped, 0);
  if (primary === undefined) {
    return undefined;
  }

  // FUNCTION1/FUNCTION2/COMPARISON tokens are already a complete condition (cell-content-is-in-list, is-true-formula, the text-length family, or the bare 'and cell-content()<op><expr>' shape when this same parser runs on a KEYWORD's own already-established validation type -- see the caller-facing distinction below).
  if (primary.info.kind !== "function0") {
    if (primary.info.validation === undefined) {
      return undefined;
    }
    return {
      type: primary.info.validation,
      operator: primary.info.operator,
      formula1: primary.operand1,
      formula2: primary.operand2,
    };
  }

  // whole/decimal/date/time: the type alone carries no operator or operand -- both come from a required ' and <comparison>' secondary clause naming the real constraint (GetCondition's own bSecondaryPart handling).
  if (primary.info.validation === undefined) {
    return undefined;
  }
  const andToken = parseToken(stripped, primary.endIndex);
  if (andToken?.info.kind !== "keyword") {
    return { type: primary.info.validation };
  }
  const secondary = parseToken(stripped, andToken.endIndex);
  if (
    secondary === undefined ||
    (secondary.info.kind !== "comparison" &&
      secondary.info.kind !== "function2")
  ) {
    return { type: primary.info.validation };
  }
  return {
    type: primary.info.validation,
    operator: secondary.info.operator,
    formula1: secondary.operand1,
    formula2: secondary.operand2,
  };
}

// table:help-message/table:error-message: a title attribute, a table:display boolean, and text:p children joined with a bare '\n' -- the identical multi-paragraph convention readCellText/readCellComment (./read.ts) already establish for a cell's own text and an annotation's own body.
function readMessageBody(messageEl: XmlElement): string {
  return childrenWithTag(messageEl, "text:p")
    .map((p) => decodeOdfText(p))
    .join("\n");
}

/** One table:content-validation definition, everything but the ranges it applies to -- those are resolved per sheet by the caller (readSheet, ./read.ts), since one rule definition can be referenced by cells across more than one sheet. */
export type ParsedContentValidation = Omit<
  ContentSheetDataValidation,
  "ranges"
>;

function readContentValidation(
  validationEl: XmlElement,
): ParsedContentValidation {
  const condition = attrValue(validationEl, "table:condition");
  const parsed =
    condition === undefined
      ? undefined
      : parseContentValidationCondition(condition);
  const rule: ParsedContentValidation = {
    type: parsed?.type ?? "custom",
  };
  if (parsed?.operator !== undefined) {
    rule.operator = parsed.operator;
  }
  if (parsed?.formula1 !== undefined) {
    rule.formula1 = parsed.formula1;
  }
  if (parsed?.formula2 !== undefined) {
    rule.formula2 = parsed.formula2;
  }
  if (attrValue(validationEl, "table:allow-empty-cell") === "false") {
    rule.allowBlank = false;
  } else {
    rule.allowBlank = true;
  }

  const helpMessage = findChildElement(
    validationEl.children,
    "table:help-message",
  );
  if (helpMessage !== undefined) {
    if (attrValue(helpMessage, "table:display") === "true") {
      rule.showInputMessage = true;
    }
    const title = attrValue(helpMessage, "table:title");
    if (title !== undefined) {
      rule.promptTitle = title;
    }
    const body = readMessageBody(helpMessage);
    if (body.length > 0) {
      rule.prompt = body;
    }
  }

  const errorMessage = findChildElement(
    validationEl.children,
    "table:error-message",
  );
  if (errorMessage !== undefined) {
    if (attrValue(errorMessage, "table:display") === "true") {
      rule.showErrorMessage = true;
    }
    const messageType = attrValue(errorMessage, "table:message-type");
    if (
      messageType === "stop" ||
      messageType === "warning" ||
      messageType === "information"
    ) {
      rule.errorStyle = messageType;
    }
    const title = attrValue(errorMessage, "table:title");
    if (title !== undefined) {
      rule.errorTitle = title;
    }
    const body = readMessageBody(errorMessage);
    if (body.length > 0) {
      rule.error = body;
    }
  }

  return rule;
}

/** Every table:content-validation definition in the document, keyed by its own table:name -- read once from office:spreadsheet's direct children (table:content-validations, a document-wide sibling of every table:table, confirmed against a real LibreOffice-produced .fods fixture rather than assumed to sit per-table the way calcext:conditional-formats does), so every sheet's own readSheet can resolve whichever names its own cells reference. */
export function readContentValidationDefinitions(
  spreadsheetElement: XmlElement,
): ReadonlyMap<string, ParsedContentValidation> {
  const definitions = new Map<string, ParsedContentValidation>();
  const container = findChildElement(
    spreadsheetElement.children,
    "table:content-validations",
  );
  if (container === undefined) {
    return definitions;
  }
  for (const validationEl of childrenWithTag(
    container,
    "table:content-validation",
  )) {
    const name = attrValue(validationEl, "table:name");
    if (name === undefined) {
      continue;
    }
    definitions.set(name, readContentValidation(validationEl));
  }
  return definitions;
}

/** Joins a sheet's own collected (validation name -> referencing cell ranges) map against the document-wide definitions, into the ContentSheetDataValidation[] a rule referenced by at least one of this sheet's own cells produces. A name with no matching definition (a malformed or not-yet-written producer file) contributes nothing -- the cells that referenced it simply carry no validation, rather than a fabricated one. */
export function resolveSheetDataValidations(
  refsByName: ReadonlyMap<string, ContentSheetRange[]>,
  definitions: ReadonlyMap<string, ParsedContentValidation>,
): ContentSheetDataValidation[] {
  const result: ContentSheetDataValidation[] = [];
  for (const [name, ranges] of refsByName) {
    const rule = definitions.get(name);
    if (rule === undefined) {
      continue;
    }
    result.push({ ...rule, ranges });
  }
  return result;
}
