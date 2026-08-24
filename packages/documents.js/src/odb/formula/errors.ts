// The three failure classes src/odb/formula/'s Report Builder rpt formula engine can report, shared by its parser and its evaluator. Every one of them is a hard failure: this engine never degrades a formula it cannot fully handle into a blank cell, a zero, or a best-effort value.
//
// The policy is src/odb/sql/errors.ts's, which is in turn src/hsqldb/script.ts's -- a closed allowlist, where anything recognised but unimplemented is named rather than silently dropped. It applies with particular force here: a report band is a handful of cells, so one silently-wrong total is the whole output being wrong, with nothing on the page to hint that it happened. The three classes map onto the three distinct ways a formula can fail, exactly as the SQL engine's do:
//
// - RptFormulaUnsupportedError -- a well-formed rpt: call naming a function outside this engine's implemented set (HASCHANGED, LEFT, SUM, COUNT, AVG, MIN, MAX). Real Report Builder ships a much larger function library; every one of the rest is refused by name rather than evaluated to something plausible.
// - RptFormulaParseError -- text that is not a well-formed rpt formula at all: an unrecognised prefix, an unterminated reference, a missing separator, or a supported function called with the wrong number or kind of arguments.
// - RptFormulaEvaluationError -- a formula that parsed cleanly but cannot be evaluated against the report's own data and definitions: an unresolvable or ambiguous reference, a named-function cycle, LEFT over a non-text value, an aggregate over non-numeric values, or a formula whose band gives it no row to read.
//
// A fourth class, RptReportStructureError, covers a failure that is about the report rather than about any one formula -- a group with no break test at all, or a nesting shape this engine's level-indexed scoping is not defined for. It carries the report's own name rather than a formula, because in both cases there is no formula text to quote.

const MESSAGE_FORMULA_PREVIEW_LENGTH = 200;

function truncateForMessage(formula: string): string {
  return formula.length > MESSAGE_FORMULA_PREVIEW_LENGTH
    ? `${formula.slice(0, MESSAGE_FORMULA_PREVIEW_LENGTH)}...`
    : formula;
}

// A genuine Report Builder function this engine recognises as a function call and deliberately does not implement. `functionName` is the name exactly as written in the formula (not upper-cased), so a caller can branch on it rather than pattern-matching the message text; `formula` is the offending formula's own full source text, verbatim.
export class RptFormulaUnsupportedError extends Error {
  readonly functionName: string;
  readonly formula: string;

  constructor(functionName: string, formula: string) {
    super(
      `Report Builder formula: rpt:${functionName} is not supported by this bounded formula engine -- supported functions are HASCHANGED, LEFT, SUM, COUNT, AVG, MIN, MAX -- in formula: ${truncateForMessage(formula)}`,
    );
    this.name = "RptFormulaUnsupportedError";
    this.functionName = functionName;
    this.formula = formula;
  }
}

// Text that is not a well-formed rpt formula under this engine's grammar. `offset` is the source position the failure was detected at, so a caller can point at it.
export class RptFormulaParseError extends Error {
  readonly formula: string;
  readonly offset: number;

  constructor(message: string, formula: string, offset: number) {
    super(
      `Report Builder formula parse error at offset ${String(offset)}: ${message} -- in formula: ${truncateForMessage(formula)}`,
    );
    this.name = "RptFormulaParseError";
    this.formula = formula;
    this.offset = offset;
  }
}

// A formula that parsed cleanly but cannot be evaluated against the report definition and result set it was handed.
export class RptFormulaEvaluationError extends Error {
  readonly formula: string;

  constructor(message: string, formula: string) {
    super(
      `Report Builder formula evaluation error: ${message} -- in formula: ${truncateForMessage(formula)}`,
    );
    this.name = "RptFormulaEvaluationError";
    this.formula = formula;
  }
}

// A report whose own band and group structure this engine cannot evaluate, independently of any one formula: a group declaring no rpt:group-expression to break on, or a nesting shape other than the strict outermost-to-innermost chain real Report Builder writes and this engine's level-indexed scoping is defined for.
export class RptReportStructureError extends Error {
  readonly reportName: string;

  constructor(message: string, reportName: string) {
    super(
      `Report Builder report structure error in report "${reportName}": ${message}`,
    );
    this.name = "RptReportStructureError";
    this.reportName = reportName;
  }
}
