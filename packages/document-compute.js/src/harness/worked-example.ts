import type {
  ContentFormula,
  FormulaBindings,
  MathExpression,
  Quantity,
  SymbolTable,
} from "document-schema.js";
import { dimensionsEqual } from "../compute/dimensions";
import {
  type EvaluationResult,
  evaluate,
  isInterval,
} from "../compute/evaluate";
import {
  DivisionByZeroError,
  IncompatibleDimensionsError,
  NonConvergentSolveError,
  NumericDomainError,
  UnboundSymbolError,
  UnknownUnitError,
  UnsupportedExpressionError,
} from "../compute/errors";

// ExaDev/documents.js#794: the worked-example differential harness for document-compute.js -- ExaDev/documents.js#573's own stated differentiator, split off once #573's evaluator itself landed as this package. A document that states a formula and then works a specific numeric instance of it ("F = ma", "m = 2 kg", "a = 3 m/s^2", "F = 6 N") gives an input-to-expected-output pair for free: this module recognises that shape in a sequence of already-lowered ContentFormula values and checks evaluate()'s answer against the document's own stated one, so coverage becomes a measured fraction rather than a vibe, and every miss names a specific gap instead of a bare failure.
//
// The recognised shape is deliberately narrow and structural, not semantic: a formula lowers to this harness's "equality" shape only when its root is `app(math:eq, [sym, rhs])` -- a bare symbol on the left, per ExaDev/documents.js's own LaTeX lowering (packages/documents.js/src/latex/lower.ts), which is what "X = <something>" produces. Three kinds of equality line appear in a real worked example, told apart purely by whether the right-hand side still mentions a symbol and, if not, whether a symbol of that name is already awaiting a stated answer:
// - a DEFINITION ("F = m * a"): the right-hand side mentions at least one symbol. This is the formula under test; its right-hand side is evaluated once bindings are known.
// - a BINDING ("m = 2 kg"): the right-hand side is fully closed (no symbols) and no definition is waiting on this exact symbol -- an ordinary "given" value, folded into the running bindings for whichever definition consumes it next.
// - a STATED RESULT ("F = 6 N"): structurally identical to a binding, but its symbol matches a definition already pending -- the document restating the defined symbol's own value is what marks it as the answer to check, not a new given.
// A definition still pending when the sequence ends, or superseded by a second definition before its own result ever arrives, is not a silent miss: it surfaces as its own "unresolved" outcome, since the document simply never stated an answer to compare against, which is a different fact from evaluate() getting one wrong.
//
// A pending definition's right-hand side is evaluated against the LIVE running bindings at the moment its own stated result is reached, never a snapshot taken back when the definition itself was first seen: the common real document orders the general law FIRST ("F = ma"), then gives the specific numbers, then states the answer, so the bindings a definition needs typically do not exist yet at the point the definition line itself appears. This also means a binding restated between a definition and its own result (a document correcting or updating a "given" mid-example) is picked up at its latest value, which is the same reading a person working through the document by hand would give it.
//
// Scoped to point-valued (Quantity) answers -- every value this harness ever computes comes from evaluating a CLOSED statement with no bindings (see EMPTY_BINDINGS below), and evaluate() cannot produce an Interval from that: an Interval only ever arises by binding a symbol to one, which requires bindings this harness never has reason to supply. A genuinely interval-valued worked example ("0.87 <= cos(phi) <= 1", #573's own illustration of evaluate()'s interval arithmetic) has no representation in this "symbol = expression" equality grammar at all -- there is no MathExpression leaf for a literal interval, and documents.js's own LaTeX lowering has no compound-inequality-to-range recognition either -- so it is out of scope for this pass rather than silently mishandled: asQuantity below turns the type system's own Quantity | Interval possibility into an explicit "unsupported-construct" gap if it were ever reached, which given the above it structurally cannot be.

// Relative tolerance for comparing evaluate()'s answer against a document's own stated one: worked examples are conventionally rounded to a handful of significant figures by their authors (a textbook writes "6 N", not "6.0000000001 N"), so exact equality would reject every correctly-reproduced answer along with every genuinely wrong one.
const DEFAULT_RELATIVE_TOLERANCE = 1e-3;

const EMPTY_BINDINGS: FormulaBindings = {};
const EMPTY_SYMBOL_TABLE: SymbolTable = { symbols: [], units: [] };

// One category per document-compute.js error class (errors.ts), so a miss always names the SPECIFIC gap -- a missing symbol binding, an unresolvable unit, a units mismatch, a construct evaluate() does not implement (an Interval-valued result included -- see this module's header comment), a domain error (e.g. sqrt of a negative dimensioned quantity), or a solve that never converged.
export type WorkedExampleGap =
  | "unbound-symbol"
  | "unknown-unit"
  | "incompatible-dimensions"
  | "division-by-zero"
  | "unsupported-construct"
  | "numeric-domain"
  | "non-convergent-solve"
  | "other-evaluation-error";

export interface WorkedExampleMatch {
  readonly outcome: "match";
  readonly targetSymbol: string;
  readonly expected: Quantity;
  readonly actual: Quantity;
}

export interface WorkedExampleMismatch {
  readonly outcome: "mismatch";
  readonly targetSymbol: string;
  readonly expected: Quantity;
  readonly actual: Quantity;
}

export interface WorkedExampleGapResult {
  readonly outcome: "gap";
  readonly gap: WorkedExampleGap;
  readonly targetSymbol: string;
  readonly message: string;
}

export interface WorkedExampleUnresolved {
  readonly outcome: "unresolved";
  readonly targetSymbol: string;
  readonly message: string;
}

export type WorkedExampleOutcome =
  | WorkedExampleMatch
  | WorkedExampleMismatch
  | WorkedExampleGapResult
  | WorkedExampleUnresolved;

export interface WorkedExampleReport {
  readonly outcomes: readonly WorkedExampleOutcome[];
  readonly total: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly gaps: number;
  readonly unresolved: number;
  // matched / (matched + mismatched) -- the fraction of formulae carrying a genuinely stated numeric answer whose evaluation reproduced it. undefined (never a fabricated 0 or 1) when the sequence contained no formula this harness could resolve a stated answer for at all.
  readonly coverage: number | undefined;
}

interface EqualityShape {
  readonly targetSymbol: string;
  readonly rhs: MathExpression;
}

function asEquality(expression: MathExpression): EqualityShape | undefined {
  if (expression.kind !== "app" || expression.operator !== "math:eq") {
    return undefined;
  }
  const [lhs, rhs] = expression.args;
  if (lhs === undefined || rhs === undefined || lhs.kind !== "sym") {
    return undefined;
  }
  return { targetSymbol: lhs.id, rhs };
}

function containsSymbol(expression: MathExpression): boolean {
  switch (expression.kind) {
    case "sym":
      return true;
    case "num":
    case "qty":
    case "unparsed":
      return false;
    case "app":
      return expression.args.some(containsSymbol);
    case "sum":
    case "prod":
      return (
        containsSymbol(expression.lower) ||
        containsSymbol(expression.upper) ||
        containsSymbol(expression.body)
      );
    case "matrix":
      return expression.rows.some((row) => row.some(containsSymbol));
  }
}

// Narrows evaluate()'s Quantity | Interval return type down to this harness's own Quantity-only scope (see the module header comment on why an Interval cannot actually arise here) -- an explicit, named gap rather than a silent narrowing assumption, so a future change to how bindings are built that DID introduce an Interval would surface as data instead of a wrong comparison.
function asQuantity(value: EvaluationResult): Quantity {
  if (isInterval(value)) {
    throw new UnsupportedExpressionError(
      "runWorkedExampleSequence",
      "this harness compares point-valued Quantity answers only; a symbol resolving to a range (Interval) has no stated-answer comparison defined yet",
    );
  }
  return value;
}

function gapFromError(error: unknown): WorkedExampleGap {
  if (error instanceof UnboundSymbolError) {
    return "unbound-symbol";
  }
  if (error instanceof UnknownUnitError) {
    return "unknown-unit";
  }
  if (error instanceof IncompatibleDimensionsError) {
    return "incompatible-dimensions";
  }
  if (error instanceof DivisionByZeroError) {
    return "division-by-zero";
  }
  if (error instanceof UnsupportedExpressionError) {
    return "unsupported-construct";
  }
  if (error instanceof NumericDomainError) {
    return "numeric-domain";
  }
  if (error instanceof NonConvergentSolveError) {
    return "non-convergent-solve";
  }
  return "other-evaluation-error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withinTolerance(
  actual: number,
  expected: number,
  relativeTolerance: number,
): boolean {
  if (expected === 0) {
    return Math.abs(actual) <= relativeTolerance;
  }
  return Math.abs(actual - expected) / Math.abs(expected) <= relativeTolerance;
}

function resultsMatch(
  actual: Quantity,
  expected: Quantity,
  relativeTolerance: number,
): boolean {
  return (
    dimensionsEqual(actual.dimension, expected.dimension) &&
    withinTolerance(actual.magnitude, expected.magnitude, relativeTolerance)
  );
}

export interface WorkedExampleOptions {
  // Relative tolerance for comparing evaluate()'s answer against the document's own stated one (see DEFAULT_RELATIVE_TOLERANCE's own comment on why this is not exact equality).
  readonly relativeTolerance?: number;
}

interface PendingDefinition {
  readonly targetSymbol: string;
  readonly rhs: MathExpression;
}

// Walks a document's already-lowered formulae IN DOCUMENT ORDER and checks every worked example it can recognise. Formulae with no `content` (never lowered to semantics -- out of scope here, since this harness measures evaluation fidelity, not lowering coverage) and formulae that are not this harness's "symbol = expression" shape are silently skipped: they carry no stated answer to check against, so they are neither a pass nor a miss.
export function runWorkedExampleSequence(
  formulas: readonly ContentFormula[],
  symbolTable: SymbolTable = EMPTY_SYMBOL_TABLE,
  options?: WorkedExampleOptions,
): WorkedExampleReport {
  const relativeTolerance =
    options?.relativeTolerance ?? DEFAULT_RELATIVE_TOLERANCE;
  const bindings: Record<string, Quantity> = {};
  const outcomes: WorkedExampleOutcome[] = [];
  let pending: PendingDefinition | undefined;

  const closeUnresolved = (): void => {
    if (pending === undefined) {
      return;
    }
    outcomes.push({
      outcome: "unresolved",
      targetSymbol: pending.targetSymbol,
      message: `"${pending.targetSymbol}" was defined but the sequence never restated it as a closed numeric result before ending or being superseded by another definition`,
    });
    pending = undefined;
  };

  for (const formula of formulas) {
    if (formula.content === undefined) {
      continue;
    }
    const equality = asEquality(formula.content);
    if (equality === undefined) {
      continue;
    }
    const { targetSymbol, rhs } = equality;

    if (containsSymbol(rhs)) {
      // A DEFINITION: the formula under test. Its own bindings are resolved later, against whatever is current when its stated result is reached (see the module header comment on why this is not a snapshot taken now).
      closeUnresolved();
      pending = { targetSymbol, rhs };
      continue;
    }

    let closedValue: Quantity;
    try {
      closedValue = asQuantity(evaluate(rhs, EMPTY_BINDINGS, symbolTable));
    } catch (error) {
      outcomes.push({
        outcome: "gap",
        gap: gapFromError(error),
        targetSymbol,
        message: errorMessage(error),
      });
      continue;
    }

    if (pending?.targetSymbol === targetSymbol) {
      const { rhs: definitionRhs } = pending;
      pending = undefined;
      let actual: Quantity;
      try {
        actual = asQuantity(evaluate(definitionRhs, bindings, symbolTable));
      } catch (error) {
        outcomes.push({
          outcome: "gap",
          gap: gapFromError(error),
          targetSymbol,
          message: errorMessage(error),
        });
        continue;
      }
      outcomes.push(
        resultsMatch(actual, closedValue, relativeTolerance)
          ? { outcome: "match", targetSymbol, expected: closedValue, actual }
          : {
              outcome: "mismatch",
              targetSymbol,
              expected: closedValue,
              actual,
            },
      );
      continue;
    }

    bindings[targetSymbol] = closedValue;
  }
  closeUnresolved();

  const matched = outcomes.filter((o) => o.outcome === "match").length;
  const mismatched = outcomes.filter((o) => o.outcome === "mismatch").length;
  const gaps = outcomes.filter((o) => o.outcome === "gap").length;
  const unresolved = outcomes.filter((o) => o.outcome === "unresolved").length;
  return {
    outcomes,
    total: outcomes.length,
    matched,
    mismatched,
    gaps,
    unresolved,
    coverage:
      matched + mismatched === 0 ? undefined : matched / (matched + mismatched),
  };
}
