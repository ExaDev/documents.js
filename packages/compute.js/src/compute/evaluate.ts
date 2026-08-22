import type { MathApp, MathExpression, MathProd, MathQty, MathSum, SymbolTable } from 'document-schema.js';
import type { FormulaBindings } from './bindings';
import { isDimensionless } from './dimensions';
import {
  absQuantity,
  addQuantities,
  cosQuantity,
  divideQuantities,
  multiplyQuantities,
  negateQuantity,
  powQuantity,
  quantity,
  type Quantity,
  sinQuantity,
  sqrtQuantity,
  subtractQuantities,
  tanQuantity,
} from './quantity';
import {
  absInterval,
  addIntervals,
  divideIntervals,
  type Interval,
  multiplyIntervals,
  negateInterval,
  pointInterval,
  subtractIntervals,
} from './interval';
import { addRational, multiplyRational, toRational, rationalToNumber } from './rational';
import { IncompatibleDimensionsError, UnboundSymbolError, UnknownUnitError, UnsupportedExpressionError } from './errors';

// The tree-walking interpreter over document-schema.js's MathExpression (src/math.ts) -- this package's answer to ExaDev/documents.js#573's `evaluate(expression, bindings, context) -> Quantity | Interval | error`. context is optional because not every expression contains a 'qty' node (a purely symbolic formula over already-typed bindings never looks a unit up), and defaults to an empty registry.
//
// Return shape: a *successful* call returns EvaluationResult (Quantity | Interval) directly, never a result-wrapper object -- every failure throws one of this package's own Error subclasses (errors.ts) instead, matching the family's existing convention for signalling failure (document-schema.js's schema-io.ts, archive-codec's CompoundFileFormatError/ArchiveWalkLimitError: a thrown, named Error a caller can catch by class, not a `{ ok, error }` union folded into the return type).
export type EvaluationResult = Quantity | Interval;

const EMPTY_SYMBOL_TABLE: SymbolTable = { symbols: [], units: [] };

export function isInterval(value: EvaluationResult): value is Interval {
  return value.kind === 'interval';
}

function toInterval(value: EvaluationResult): Interval {
  return isInterval(value) ? value : pointInterval(value.magnitude, value.dimension);
}

function asQuantity(value: EvaluationResult, context: string): Quantity {
  if (isInterval(value)) {
    throw new UnsupportedExpressionError(context, 'this position requires a plain Quantity, not an Interval');
  }
  return value;
}

interface BinaryOperator {
  quantity: (a: Quantity, b: Quantity) => Quantity;
  interval: (a: Interval, b: Interval) => Interval;
}

interface UnaryOperator {
  quantity: (a: Quantity) => Quantity;
  interval?: (a: Interval) => Interval; // absent means this operator has no interval rule in this pass -- see errors.ts's UnsupportedExpressionError doc comment
}

// The core arithmetic registry every reference consumer of this grammar implements (document-schema.js's own comment on MathApp, src/math.ts): namespaced 'math:*' operator ids, arity and semantics owned here since document-schema.js never evaluates anything. Deliberately not exhaustive of all conceivable numeric functions -- symbolic algebra and a general function library are out of scope for this pass (see this package's README); what is here covers the four required arithmetic operations plus enough unary operators (negate/abs/sqrt/trig) to make solveFor's worked examples realistic.
const BINARY_OPERATORS: Record<string, BinaryOperator> = {
  'math:add': { quantity: addQuantities, interval: addIntervals },
  'math:subtract': { quantity: subtractQuantities, interval: subtractIntervals },
  'math:multiply': { quantity: multiplyQuantities, interval: multiplyIntervals },
  'math:divide': { quantity: divideQuantities, interval: divideIntervals },
};

const UNARY_OPERATORS: Record<string, UnaryOperator> = {
  'math:negate': { quantity: negateQuantity, interval: negateInterval },
  'math:abs': { quantity: absQuantity, interval: absInterval },
  'math:sqrt': { quantity: sqrtQuantity },
  'math:sin': { quantity: sinQuantity },
  'math:cos': { quantity: cosQuantity },
  'math:tan': { quantity: tanQuantity },
};

export function evaluate(
  expression: MathExpression,
  bindings: FormulaBindings,
  context: SymbolTable = EMPTY_SYMBOL_TABLE,
): EvaluationResult {
  switch (expression.kind) {
    case 'num':
      return quantity(rationalToNumber(toRational(expression)), {});
    case 'qty':
      return evaluateQty(expression, context);
    case 'sym': {
      const bound = bindings[expression.id];
      if (bound === undefined) {
        throw new UnboundSymbolError(expression.id);
      }
      return bound;
    }
    case 'app':
      return evaluateApp(expression, bindings, context);
    case 'sum':
    case 'prod':
      return evaluateBinder(expression, bindings, context);
    case 'matrix':
      throw new UnsupportedExpressionError(
        'evaluate',
        "matrix-valued expressions are out of scope for this pass -- compute.js evaluates scalar Quantity/Interval values only",
      );
    case 'unparsed':
      throw new UnsupportedExpressionError(
        'evaluate',
        `this node is source LaTeX ("${expression.latex}") document-schema.js's lowering could not represent structurally, so there is nothing to evaluate`,
      );
  }
}

function evaluateQty(node: MathQty, context: SymbolTable): Quantity {
  const unit = context.units.find((entry) => entry.id === node.unit);
  if (unit === undefined) {
    throw new UnknownUnitError(node.unit);
  }
  // si_value = value * factorToSi + offsetToSi, computed entirely as exact BigInt rationals (rational.ts) and converted to a float exactly once -- see quantity.ts's header comment on where this package draws the exact/float boundary.
  let siValue = multiplyRational(toRational(node.value), toRational(unit.factorToSi));
  if (unit.offsetToSi !== undefined) {
    siValue = addRational(siValue, toRational(unit.offsetToSi));
  }
  return quantity(rationalToNumber(siValue), unit.dimension);
}

function evaluateApp(node: MathApp, bindings: FormulaBindings, context: SymbolTable): EvaluationResult {
  const args = node.args.map((arg) => evaluate(arg, bindings, context));

  const binary = BINARY_OPERATORS[node.operator];
  if (binary !== undefined) {
    if (args.length !== 2) {
      throw new UnsupportedExpressionError('evaluate', `operator '${node.operator}' takes exactly 2 arguments, got ${args.length}`);
    }
    const [left, right] = args as [EvaluationResult, EvaluationResult];
    if (isInterval(left) || isInterval(right)) {
      return binary.interval(toInterval(left), toInterval(right));
    }
    return binary.quantity(left, right);
  }

  const unary = UNARY_OPERATORS[node.operator];
  if (unary !== undefined) {
    if (args.length !== 1) {
      throw new UnsupportedExpressionError('evaluate', `operator '${node.operator}' takes exactly 1 argument, got ${args.length}`);
    }
    const [only] = args as [EvaluationResult];
    if (isInterval(only)) {
      if (unary.interval === undefined) {
        throw new UnsupportedExpressionError('evaluate', `operator '${node.operator}' has no interval rule in this pass`);
      }
      return unary.interval(only);
    }
    return unary.quantity(only);
  }

  // math:pow is binary like the arithmetic operators above but is not defined over intervals in this pass (a general interval power needs monotonicity analysis this pass does not implement -- see the README's scope note), so it is handled on its own rather than folded into BINARY_OPERATORS.
  if (node.operator === 'math:pow') {
    if (args.length !== 2) {
      throw new UnsupportedExpressionError('evaluate', `'math:pow' takes exactly 2 arguments, got ${args.length}`);
    }
    const [base, exponent] = args as [EvaluationResult, EvaluationResult];
    return powQuantity(asQuantity(base, 'evaluate'), asQuantity(exponent, 'evaluate'));
  }

  throw new UnsupportedExpressionError('evaluate', `unknown operator '${node.operator}'`);
}

// Sigma/product notation: bounds must resolve to dimensionless integers (a loop index has no unit), the binder name is bound locally to each successive integer as the body is evaluated, and the accumulator starts at the operation's identity (0 for sum, 1 for prod). Kept to Quantity-only bounds and bodies -- summing/multiplying a family of Intervals is a real generalisation this pass leaves out (see the README's scope note); a binder that would need it throws UnsupportedExpressionError rather than silently narrowing an Interval to its point value.
function evaluateBinder(node: MathSum | MathProd, bindings: FormulaBindings, context: SymbolTable): Quantity {
  const lower = asQuantity(evaluate(node.lower, bindings, context), `evaluate:${node.kind}`);
  const upper = asQuantity(evaluate(node.upper, bindings, context), `evaluate:${node.kind}`);
  if (!isDimensionless(lower.dimension) || !isDimensionless(upper.dimension)) {
    throw new IncompatibleDimensionsError(`math:${node.kind}`, lower.dimension, upper.dimension, 'binder bounds must be dimensionless');
  }
  if (!Number.isInteger(lower.magnitude) || !Number.isInteger(upper.magnitude)) {
    throw new UnsupportedExpressionError(`evaluate:${node.kind}`, 'binder bounds must evaluate to integers');
  }

  let accumulator = node.kind === 'sum' ? quantity(0, {}) : quantity(1, {});
  for (let i = lower.magnitude; i <= upper.magnitude; i += 1) {
    const bodyBindings: FormulaBindings = { ...bindings, [node.binder]: quantity(i, {}) };
    const bodyValue = asQuantity(evaluate(node.body, bodyBindings, context), `evaluate:${node.kind}`);
    accumulator = node.kind === 'sum' ? addQuantities(accumulator, bodyValue) : multiplyQuantities(accumulator, bodyValue);
  }
  return accumulator;
}
