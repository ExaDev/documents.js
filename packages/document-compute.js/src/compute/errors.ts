import type { DimensionVector } from 'document-schema.js';
import { dimensionToString } from './dimensions';

// Real, exported error classes for every failure this package's evaluator and solver can hit -- the family's own convention (document-schema.js's schema-io.ts, archive-codec's OlePackageFormatError/CompoundFileFormatError, its ArchiveWalkLimitError) is a thrown Error subclass a caller can catch by name, never a `{ ok: false, error }` result wrapper. evaluate() and solveFor() follow that same idiom: a *successful* evaluate() call returns a plain Quantity | Interval (see evaluate.ts), and every failure throws one of these instead of being folded into the return type.

// Thrown when an operation combines two quantities (or intervals) whose dimensions don't admit it: add/subtract requiring equal dimensions, an exponent that must be dimensionless, or a pow/sqrt whose result dimension has no integer representation. The one class covers all of these because they are the same underlying problem -- the units-as-type-system check failing -- and a caller wanting to catch "my formula mixed incompatible units" catches this one name regardless of which operator tripped it.
export class IncompatibleDimensionsError extends Error {
  readonly operation: string;
  readonly left: DimensionVector;
  readonly right: DimensionVector;

  constructor(operation: string, left: DimensionVector, right: DimensionVector, detail?: string) {
    super(
      `'${operation}' requires compatible dimensions, got ${dimensionToString(left)} and ${dimensionToString(right)}` +
        (detail === undefined ? '.' : ` (${detail}).`),
    );
    this.name = 'IncompatibleDimensionsError';
    this.operation = operation;
    this.left = left;
    this.right = right;
  }
}

// Thrown when a 'sym' node's id has no entry in the FormulaBindings passed to evaluate() -- a formula referencing a symbol the caller never bound, rather than a silent `undefined` propagating through the arithmetic.
export class UnboundSymbolError extends Error {
  readonly symbol: string;

  constructor(symbol: string) {
    super(`symbol '${symbol}' has no entry in the supplied bindings.`);
    this.name = 'UnboundSymbolError';
    this.symbol = symbol;
  }
}

// Thrown when a 'qty' node names a unit id the supplied SymbolTable's units registry does not carry -- there is nothing to resolve the value's dimension or SI-conversion factor against.
export class UnknownUnitError extends Error {
  readonly unit: string;

  constructor(unit: string) {
    super(`unit '${unit}' is not registered in the supplied symbol table's units.`);
    this.name = 'UnknownUnitError';
    this.unit = unit;
  }
}

// Thrown for a division whose divisor is (or, for an interval, spans) exactly zero -- a real failure this package refuses to paper over as IEEE-754 Infinity/NaN silently flowing into the rest of a computation.
export class DivisionByZeroError extends Error {
  readonly operation: string;

  constructor(operation: string, detail: string) {
    super(`'${operation}': division by zero (${detail}).`);
    this.name = 'DivisionByZeroError';
    this.operation = operation;
  }
}

// Thrown for an expression shape or operator this evaluator deliberately does not implement: a 'matrix' node (this package evaluates scalar Quantity/Interval values, not matrices), an 'unparsed' node (source LaTeX document-schema.js's own lowering could not represent, so there is nothing to evaluate), an operator id the registry does not recognise, a wrong argument count, or an operator applied to an Interval operand this pass has no interval rule for (only add/subtract/multiply/divide/negate/abs are implemented over intervals -- see interval.ts). Also used for a solveFor call missing the option its chosen method requires (bracket for bisection, initialGuess for newton) and for a solveFor target expression that evaluates to an Interval rather than a plain Quantity, since root-finding needs a single-valued function.
export class UnsupportedExpressionError extends Error {
  readonly context: string;

  constructor(context: string, detail: string) {
    super(`${context}: ${detail}.`);
    this.name = 'UnsupportedExpressionError';
    this.context = context;
  }
}

// Thrown for a numeric operation whose real-valued domain the operand falls outside -- sqrt of a negative magnitude being the case this pass actually exercises. Distinct from IncompatibleDimensionsError: the units line up, the arithmetic itself just has no real answer.
export class NumericDomainError extends Error {
  readonly operation: string;

  constructor(operation: string, detail: string) {
    super(`'${operation}': ${detail}.`);
    this.name = 'NumericDomainError';
    this.operation = operation;
  }
}

// Thrown when bisection or Newton's method exhausts its iteration budget (or, for bisection, is handed a bracket whose endpoints don't straddle zero; or, for Newton, hits a vanishing/non-finite derivative) without the residual dropping under the requested tolerance -- solveFor never returns a number it cannot vouch for.
export class NonConvergentSolveError extends Error {
  readonly method: 'bisection' | 'newton';
  readonly iterations: number;

  constructor(method: 'bisection' | 'newton', iterations: number, detail: string) {
    super(`solveFor (${method}) did not converge after ${iterations} iteration(s): ${detail}.`);
    this.name = 'NonConvergentSolveError';
    this.method = method;
    this.iterations = iterations;
  }
}
