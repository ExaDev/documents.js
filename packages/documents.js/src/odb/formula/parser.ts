import type { CellAggregateFunction } from "../values";
import { RptFormulaParseError, RptFormulaUnsupportedError } from "./errors";

// The parser for a single rpt:formula attribute value -- the string LibreOffice Report Builder writes on a rpt:formatted-text control, on a rpt:function definition, and on a rpt:group's own rpt:group-expression. Formula text in, one RptFormula out. It makes no evaluation decisions at all: resolving a reference to a column or a named function, and deciding which rows an aggregate covers, are src/odb/formula/evaluate.ts's job.
//
// Unlike src/odb/sql/, this module has no separate lexer file. The SQL engine needs one because SQL has a keyword vocabulary, operator precedence, and statement structure to keep out of the grammar; this language has none of that -- a formula is a prefix, optionally one function name, and a parenthesised argument list -- so a separate token stream would be ceremony rather than separation.
//
// The grammar, taken verbatim from the shape real LibreOffice 26.2 output uses (every production below appears in the checked-in form-and-report.odb fixture -- see src/odb/formula/report.test.ts, which reads each one straight out of the package rather than restating it):
//
// - formula     := fieldRef | rptCall
// - fieldRef    := 'field:' bracketRef                                  e.g. field:[CUSTOMER]
// - rptCall     := 'rpt:' NAME '(' [ argument { ';' argument } ] ')'    e.g. rpt:SUM([AMOUNT])
// - argument    := bracketRef | quotedRef | number
// - bracketRef  := '[' name ']'                                         e.g. [QUARTER]
// - quotedRef   := '"' name '"'                                         e.g. "REGION"
//
// Two details are worth stating because they are easy to get wrong from a comma-and-parenthesis intuition. The argument separator is a SEMICOLON, not a comma -- LibreOffice's formula languages use the Basic/Calc convention throughout, and rpt:LEFT([QUARTER];2) in the real fixture is the confirmation. And the two reference spellings, [NAME] and "NAME", are treated here as one concept: the real fixture writes rpt:HASCHANGED("REGION") with quotes and rpt:SUM([AMOUNT]) with brackets, with no observable difference in meaning beyond which the writer emitted, so both parse to the same RptReference and resolve by the same rule. The spelling is retained on the node purely so an error message can quote the reference the way its author wrote it.
//
// The function allowlist is closed, matching src/odb/sql/'s own policy (see src/odb/formula/errors.ts's top-of-file comment): HASCHANGED, LEFT, and the same five aggregates the SQL engine implements. Every other rpt: function name -- and Report Builder ships many -- throws RptFormulaUnsupportedError naming it, rather than being evaluated to a plausible-looking wrong value.

export type RptAggregateFunction = CellAggregateFunction;

// A reference to a result-set column or to a named rpt:function, as written. `spelling` records which of the two forms carried it, for error messages only -- resolution never consults it.
export interface RptReference {
  readonly name: string;
  readonly spelling: "bracket" | "quote";
}

export type RptFormula =
  // field:[X] -- a plain bound-field reference. No computation at all: the referenced value passes straight through. It shares this attribute (and therefore this parser) with the rpt: forms below, which is why it is handled here rather than being left to the renderer to sniff for.
  | {
      readonly kind: "field";
      readonly reference: RptReference;
      readonly text: string;
    }
  // rpt:HASCHANGED(X) -- true when X's value differs from its value on the immediately preceding row, and on the first row. Report Builder's group-break test.
  | {
      readonly kind: "hasChanged";
      readonly reference: RptReference;
      readonly text: string;
    }
  // rpt:LEFT(X;n) -- the first n characters of X's text.
  | {
      readonly kind: "left";
      readonly reference: RptReference;
      readonly length: number;
      readonly text: string;
    }
  // rpt:SUM(X) / COUNT / AVG / MIN / MAX -- an aggregate over the rows of whichever band the formula sits in. See src/odb/formula/evaluate.ts for the scoping rule, which is the whole substance of this engine.
  | {
      readonly kind: "aggregate";
      readonly aggregate: RptAggregateFunction;
      readonly reference: RptReference;
      readonly text: string;
    };

const AGGREGATE_FUNCTIONS: ReadonlySet<string> = new Set<RptAggregateFunction>([
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
]);

function isAggregateFunction(name: string): name is RptAggregateFunction {
  return AGGREGATE_FUNCTIONS.has(name);
}

type RptArgument =
  | { readonly kind: "reference"; readonly reference: RptReference }
  | { readonly kind: "number"; readonly value: number };

const FIELD_PREFIX = "field:";
const RPT_PREFIX = "rpt:";

function isNameCharacter(character: string): boolean {
  return (
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z") ||
    (character >= "0" && character <= "9") ||
    character === "_"
  );
}

class FormulaScanner {
  private offset = 0;

  constructor(private readonly formula: string) {}

  get position(): number {
    return this.offset;
  }

  fail(message: string): never {
    throw new RptFormulaParseError(message, this.formula, this.offset);
  }

  skipWhitespace(): void {
    while (
      this.offset < this.formula.length &&
      /\s/.test(this.formula.charAt(this.offset))
    ) {
      this.offset += 1;
    }
  }

  atEnd(): boolean {
    this.skipWhitespace();
    return this.offset >= this.formula.length;
  }

  peek(): string {
    this.skipWhitespace();
    return this.formula.charAt(this.offset);
  }

  // Consumes `text` if it is next (after whitespace), reporting whether it was. Used only for the two prefixes, which is why it does not need to guard against a longer name starting with the same characters.
  tryConsume(text: string): boolean {
    this.skipWhitespace();
    if (!this.formula.startsWith(text, this.offset)) {
      return false;
    }
    this.offset += text.length;
    return true;
  }

  expect(character: string, what: string): void {
    this.skipWhitespace();
    if (this.formula.charAt(this.offset) !== character) {
      this.fail(
        `expected ${what} ("${character}") but found ${this.offset >= this.formula.length ? "the end of the formula" : `"${this.formula.charAt(this.offset)}"`}`,
      );
    }
    this.offset += 1;
  }

  readName(what: string): string {
    this.skipWhitespace();
    const start = this.offset;
    while (
      this.offset < this.formula.length &&
      isNameCharacter(this.formula.charAt(this.offset))
    ) {
      this.offset += 1;
    }
    if (this.offset === start) {
      this.fail(`expected ${what}`);
    }
    return this.formula.slice(start, this.offset);
  }

  // A bracketed reference's own name is taken verbatim up to the closing bracket: ODF writes a column name unescaped here, and a real column name cannot contain "]" without an escaping convention this format does not define.
  readBracketReference(): RptReference {
    this.expect("[", "the opening bracket of a column reference");
    const start = this.offset;
    const close = this.formula.indexOf("]", this.offset);
    if (close < 0) {
      this.offset = this.formula.length;
      this.fail('unterminated column reference -- no closing "]"');
    }
    this.offset = close + 1;
    return { name: this.formula.slice(start, close), spelling: "bracket" };
  }

  // A quoted reference, with "" as an embedded double quote -- SQL's own escaping convention, which is what both engines this package reads .odb expressions with already follow (see src/odb/sql/lexer.ts).
  readQuotedReference(): RptReference {
    this.expect('"', "the opening quote of a name reference");
    let name = "";
    for (;;) {
      if (this.offset >= this.formula.length) {
        this.fail("unterminated name reference -- no closing double quote");
      }
      const character = this.formula.charAt(this.offset);
      this.offset += 1;
      if (character !== '"') {
        name += character;
        continue;
      }
      if (this.formula.charAt(this.offset) === '"') {
        name += '"';
        this.offset += 1;
        continue;
      }
      return { name, spelling: "quote" };
    }
  }

  readNumber(): number {
    this.skipWhitespace();
    const start = this.offset;
    if (this.formula.charAt(this.offset) === "-") {
      this.offset += 1;
    }
    while (
      this.offset < this.formula.length &&
      this.formula.charAt(this.offset) >= "0" &&
      this.formula.charAt(this.offset) <= "9"
    ) {
      this.offset += 1;
    }
    if (this.formula.charAt(this.offset) === ".") {
      this.offset += 1;
      while (
        this.offset < this.formula.length &&
        this.formula.charAt(this.offset) >= "0" &&
        this.formula.charAt(this.offset) <= "9"
      ) {
        this.offset += 1;
      }
    }
    const text = this.formula.slice(start, this.offset);
    const value = Number(text);
    if (text === "" || text === "-" || !Number.isFinite(value)) {
      this.offset = start;
      this.fail("expected a number");
    }
    return value;
  }

  readArgument(): RptArgument {
    const next = this.peek();
    if (next === "") {
      this.fail("expected an argument but found the end of the formula");
    }
    if (next === "[") {
      return { kind: "reference", reference: this.readBracketReference() };
    }
    if (next === '"') {
      return { kind: "reference", reference: this.readQuotedReference() };
    }
    return { kind: "number", value: this.readNumber() };
  }
}

function referenceArgument(
  argument: RptArgument | undefined,
  functionName: string,
  ordinal: string,
  scanner: FormulaScanner,
): RptReference {
  if (argument?.kind !== "reference") {
    scanner.fail(
      `rpt:${functionName}'s ${ordinal} argument must be a column or function reference ([NAME] or "NAME")`,
    );
  }
  return argument.reference;
}

function expectArgumentCount(
  argumentValues: readonly RptArgument[],
  expected: number,
  functionName: string,
  scanner: FormulaScanner,
): void {
  if (argumentValues.length !== expected) {
    scanner.fail(
      `rpt:${functionName} takes exactly ${String(expected)} argument${expected === 1 ? "" : "s"}, but ${String(argumentValues.length)} ${argumentValues.length === 1 ? "was" : "were"} given`,
    );
  }
}

function buildCall(
  functionName: string,
  argumentValues: readonly RptArgument[],
  formula: string,
  scanner: FormulaScanner,
): RptFormula {
  const canonical = functionName.toUpperCase();
  if (canonical === "HASCHANGED") {
    expectArgumentCount(argumentValues, 1, functionName, scanner);
    return {
      kind: "hasChanged",
      reference: referenceArgument(
        argumentValues[0],
        functionName,
        "first",
        scanner,
      ),
      text: formula,
    };
  }
  if (canonical === "LEFT") {
    expectArgumentCount(argumentValues, 2, functionName, scanner);
    const reference = referenceArgument(
      argumentValues[0],
      functionName,
      "first",
      scanner,
    );
    const lengthArgument = argumentValues[1];
    if (lengthArgument?.kind !== "number") {
      scanner.fail(
        `rpt:${functionName}'s second argument must be a number of characters`,
      );
    }
    if (!Number.isInteger(lengthArgument.value) || lengthArgument.value < 0) {
      scanner.fail(
        `rpt:${functionName}'s second argument must be a non-negative whole number of characters, but was ${String(lengthArgument.value)}`,
      );
    }
    return {
      kind: "left",
      reference,
      length: lengthArgument.value,
      text: formula,
    };
  }
  if (isAggregateFunction(canonical)) {
    expectArgumentCount(argumentValues, 1, functionName, scanner);
    return {
      kind: "aggregate",
      aggregate: canonical,
      reference: referenceArgument(
        argumentValues[0],
        functionName,
        "first",
        scanner,
      ),
      text: formula,
    };
  }
  throw new RptFormulaUnsupportedError(functionName, formula);
}

// Parses one rpt:formula attribute value. The two prefixes are the only two this grammar admits: anything else -- an empty attribute, a bare column name, a Basic expression -- throws RptFormulaParseError rather than being guessed at.
export function parseRptFormula(formula: string): RptFormula {
  const scanner = new FormulaScanner(formula);
  if (scanner.tryConsume(FIELD_PREFIX)) {
    const reference = scanner.readBracketReference();
    if (!scanner.atEnd()) {
      scanner.fail("unexpected trailing text after a field: reference");
    }
    return { kind: "field", reference, text: formula };
  }
  if (!scanner.tryConsume(RPT_PREFIX)) {
    scanner.fail(
      `expected a formula beginning "${FIELD_PREFIX}" or "${RPT_PREFIX}"`,
    );
  }
  const functionName = scanner.readName("an rpt: function name");
  scanner.expect("(", "the opening parenthesis of a function's argument list");
  const argumentValues: RptArgument[] = [];
  if (scanner.peek() !== ")") {
    argumentValues.push(scanner.readArgument());
    while (scanner.peek() === ";") {
      scanner.expect(";", "an argument separator");
      argumentValues.push(scanner.readArgument());
    }
  }
  scanner.expect(")", "the closing parenthesis of a function's argument list");
  if (!scanner.atEnd()) {
    scanner.fail("unexpected trailing text after a function call");
  }
  return buildCall(functionName, argumentValues, formula, scanner);
}
