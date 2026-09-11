import type {
  DimensionVector,
  FormulaBindings,
  MathExpression,
  SymbolTable,
} from "document-schema.js";
import { evaluate } from "./evaluate";
import { quantity } from "./quantity";
import { NonConvergentSolveError, UnsupportedExpressionError } from "./errors";

// Numeric solve-for over the same evaluator (ExaDev/documents.js#573's "root-finding over our own evaluator"): given every binding except one unknown symbol, and a target value the expression should equal, find the unknown's magnitude that makes it so. Deliberately root-finding, not rearrangement -- no algebra happens here, the expression is evaluated at trial points and driven toward targetValue by bisection or Newton's method. Symbolic rearrangement (isolating the unknown algebraically) is out of scope for this pass; see this package's README.
export type SolveMethod = "bisection" | "newton";

export interface SolveForOptions {
  /** Which root-finding algorithm to use. Default: 'bisection' (needs no derivative and cannot diverge the way Newton can, so it is the safer default; Newton converges faster once it has a decent initialGuess). */
  method?: SolveMethod;
  /** Convergence threshold on |f(x)| = |evaluate(expression, ...) - targetValue|. Default 1e-9. */
  tolerance?: number;
  /** Iteration budget before giving up with NonConvergentSolveError. Default 100. */
  maxIterations?: number;
  /** Required for 'bisection': an [low, high] bracket whose residuals at the endpoints have opposite signs (the intermediate value theorem is bisection's entire correctness argument -- there is no bracket to fall back on if this does not hold, so a bad bracket throws rather than guessing one). */
  bracket?: [number, number];
  /** Required for 'newton': the starting point the iteration refines from. */
  initialGuess?: number;
  /** The dimension the unknown symbol is bound under at each trial point. Default {} (dimensionless) -- set this when the unknown is not dimensionless, e.g. { length: 1 } to solve for a length in SI-coherent metres. */
  unknownDimension?: DimensionVector;
  /** Step size h for Newton's central-difference derivative estimate (see newton() below). Default 1e-6. */
  derivativeStep?: number;
}

const DEFAULT_TOLERANCE = 1e-9;
const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_DERIVATIVE_STEP = 1e-6;
const EMPTY_SYMBOL_TABLE: SymbolTable = { symbols: [], units: [] };

// f(x) = evaluate(expression with unknownSymbol bound to x) - targetValue. Requires the expression to evaluate to a plain Quantity: root-finding needs a single real-valued function of x, and an Interval result has no one number to compare against targetValue.
function residualFn(
  expression: MathExpression,
  targetValue: number,
  unknownSymbol: string,
  bindings: FormulaBindings,
  context: SymbolTable,
  dimension: DimensionVector,
): (x: number) => number {
  return (x: number): number => {
    const result = evaluate(
      expression,
      { ...bindings, [unknownSymbol]: quantity(x, dimension) },
      context,
    );
    if (result.kind !== "quantity") {
      throw new UnsupportedExpressionError(
        "solveFor",
        "the expression must evaluate to a plain Quantity, not an Interval",
      );
    }
    return result.magnitude - targetValue;
  };
}

export function solveFor(
  expression: MathExpression,
  targetValue: number,
  unknownSymbol: string,
  bindings: FormulaBindings,
  options: SolveForOptions = {},
  context: SymbolTable = EMPTY_SYMBOL_TABLE,
): number {
  const method = options.method ?? "bisection";
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const dimension = options.unknownDimension ?? {};
  const f = residualFn(
    expression,
    targetValue,
    unknownSymbol,
    bindings,
    context,
    dimension,
  );

  if (method === "bisection") {
    return bisection(f, options.bracket, tolerance, maxIterations);
  }
  return newton(
    f,
    options.initialGuess,
    tolerance,
    maxIterations,
    options.derivativeStep ?? DEFAULT_DERIVATIVE_STEP,
  );
}

function bisection(
  f: (x: number) => number,
  bracket: [number, number] | undefined,
  tolerance: number,
  maxIterations: number,
): number {
  if (bracket === undefined) {
    throw new UnsupportedExpressionError(
      "solveFor",
      "method 'bisection' requires options.bracket: [low, high]",
    );
  }
  let [low, high] = bracket;
  let fLow = f(low);
  const fHigh0 = f(high);
  if (Math.abs(fLow) < tolerance) return low;
  if (Math.abs(fHigh0) < tolerance) return high;
  if (fLow > 0 === fHigh0 > 0) {
    throw new NonConvergentSolveError(
      "bisection",
      0,
      `residual at the bracket endpoints does not change sign (f(${low})=${fLow}, f(${high})=${fHigh0}) -- bisection needs a bracket straddling the root`,
    );
  }

  for (let i = 0; i < maxIterations; i += 1) {
    const mid = (low + high) / 2;
    const fMid = f(mid);
    if (Math.abs(fMid) < tolerance) {
      return mid;
    }
    // Stryker disable next-line EqualityOperator: `fMid > 0` vs `fMid >= 0` (and likewise for `fLow`) only disagree when the operand is exactly 0 -- but the `Math.abs(fMid) < tolerance` return above already catches fMid === 0 whenever tolerance > 0 (0 is always < a positive tolerance), so this line is never reached with fMid === 0 in that case. The only way to reach it with fMid === 0 is tolerance <= 0, and then this line's outcome can never be observed either: no residual ever satisfies a `< tolerance` (or `<= 0`) check again for the rest of the run, so the loop always exhausts to the identical `maxIterations`-and-`tolerance` message regardless of which branch was taken here. fLow is bound to fMid in the true branch (`fLow = fMid`), so the same reasoning applies to it on every subsequent iteration.
    if (fMid > 0 === fLow > 0) {
      low = mid;
      fLow = fMid;
    } else {
      high = mid;
    }
  }
  throw new NonConvergentSolveError(
    "bisection",
    maxIterations,
    `residual still exceeds tolerance ${tolerance} after ${maxIterations} iterations`,
  );
}

function newton(
  f: (x: number) => number,
  initialGuess: number | undefined,
  tolerance: number,
  maxIterations: number,
  h: number,
): number {
  if (initialGuess === undefined) {
    throw new UnsupportedExpressionError(
      "solveFor",
      "method 'newton' requires options.initialGuess",
    );
  }
  let x = initialGuess;
  for (let i = 0; i < maxIterations; i += 1) {
    const fx = f(x);
    if (Math.abs(fx) < tolerance) {
      return x;
    }
    // No symbolic derivative is available (out of scope for this pass -- see the README), so the derivative is estimated numerically. Central difference (f(x+h) - f(x-h)) / (2h) rather than a one-sided forward/backward difference because its truncation error is O(h^2) instead of O(h), which matters here since h is a fixed step rather than adaptively shrunk.
    const derivative = (f(x + h) - f(x - h)) / (2 * h);
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-14) {
      throw new NonConvergentSolveError(
        "newton",
        i,
        `the numeric derivative vanished or diverged near x=${x}`,
      );
    }
    const next = x - fx / derivative;
    // Stryker disable next-line ConditionalExpression,BlockStatement: kept as a genuine safety net (a caller-supplied MathExpression could in principle be pathological), but no expression buildable from this package's own grammar (add/subtract/multiply/divide/pow/trig, all smooth away from their own poles) can actually reach this branch without derivative having already failed the check above. For any such function, |f'(x)| scales with |f(x)| / |x| near an ordinary point (so a residual large enough to overflow fx / derivative forces a comparably large, non-vanishing derivative, keeping the quotient bounded), and at a genuine critical point (f' -> 0) reaching a residual that large requires an additive constant so much bigger than the varying term that the central-difference subtraction rounds the measured derivative to exactly 0.0 -- caught above as vanished, never as a small-but-finite value here. So `next` is non-finite if and only if `derivative` already was, or fx itself already was (both already thrown above by the time this line runs), which also means the throw body immediately below -- including its own message -- has no reachable input to exercise it either.
    if (!Number.isFinite(next)) {
      throw new NonConvergentSolveError(
        "newton",
        i,
        // Stryker disable next-line StringLiteral: unreachable for the same reason as the guard above -- see that comment.
        `the iteration diverged to a non-finite value near x=${x}`,
      );
    }
    x = next;
  }
  throw new NonConvergentSolveError(
    "newton",
    maxIterations,
    `residual still exceeds tolerance ${tolerance} after ${maxIterations} iterations`,
  );
}
