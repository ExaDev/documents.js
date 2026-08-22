import { describe, expect, it } from 'vitest';
import type { MathExpression } from 'document-schema.js';
import { solveFor } from './solve';
import type { FormulaBindings } from './bindings';
import { interval } from './interval';
import { quantity } from './quantity';
import { NonConvergentSolveError, UnsupportedExpressionError } from './errors';

function num(numerator: string, denominator = '1'): MathExpression {
  return { kind: 'num', numerator, denominator };
}
function sym(id: string): MathExpression {
  return { kind: 'sym', id };
}
function app(operator: string, args: MathExpression[]): MathExpression {
  return { kind: 'app', operator, args };
}

// x^2, used across both algorithms below: solveFor(xSquared, 4, 'x', {}, ...) should find x = 2 (within the chosen bracket/initial guess).
const xSquared: MathExpression = app('math:pow', [sym('x'), num('2')]);

describe('solveFor: bisection (the default method)', () => {
  it('solves x^2 = 4 for the positive root within a bracket', () => {
    const root = solveFor(xSquared, 4, 'x', {}, { bracket: [0, 3] });
    expect(root).toBeCloseTo(2, 6);
  });

  it('solves a linear formula for one unknown given the rest of the bindings (F = m * a, solve for a)', () => {
    const force = app('math:multiply', [sym('m'), sym('a')]);
    const bindings: FormulaBindings = { m: quantity(2, { mass: 1 }) };
    // F = 10 N = m * a -> a = 5
    const a = solveFor(force, 10, 'a', bindings, { bracket: [0, 20] });
    expect(a).toBeCloseTo(5, 6);
  });

  it('honours unknownDimension, binding the unknown symbol under a non-dimensionless dimension', () => {
    // Solving the identity expression sym('L') = 5 (SI-coherent metres) for L.
    const root = solveFor(sym('L'), 5, 'L', {}, { bracket: [0, 10], unknownDimension: { length: 1 } });
    expect(root).toBeCloseTo(5, 6);
  });

  it('throws NonConvergentSolveError when the bracket does not straddle a root', () => {
    expect(() => solveFor(xSquared, 4, 'x', {}, { bracket: [3, 5] })).toThrow(NonConvergentSolveError);
  });

  it('throws NonConvergentSolveError when the iteration budget is exhausted before reaching the requested tolerance', () => {
    expect(() =>
      solveFor(xSquared, 4, 'x', {}, { bracket: [0, 3], tolerance: 1e-15, maxIterations: 3 }),
    ).toThrow(NonConvergentSolveError);
  });

  it('throws UnsupportedExpressionError when options.bracket is missing', () => {
    expect(() => solveFor(xSquared, 4, 'x', {}, {})).toThrow(UnsupportedExpressionError);
  });
});

describe('solveFor: Newton\'s method', () => {
  it('solves x^2 = 4 for the positive root from an initial guess, using a central-difference derivative', () => {
    const root = solveFor(xSquared, 4, 'x', {}, { method: 'newton', initialGuess: 3 });
    expect(root).toBeCloseTo(2, 6);
  });

  it('converges to the same root bisection finds, from a different initial guess', () => {
    const root = solveFor(xSquared, 4, 'x', {}, { method: 'newton', initialGuess: 1.5 });
    expect(root).toBeCloseTo(2, 6);
  });

  it('throws UnsupportedExpressionError when options.initialGuess is missing', () => {
    expect(() => solveFor(xSquared, 4, 'x', {}, { method: 'newton' })).toThrow(UnsupportedExpressionError);
  });

  it('throws NonConvergentSolveError when the residual is independent of the unknown (a vanishing derivative) -- the documented non-convergent case', () => {
    // The expression never references 'x', so f(x) is the constant 5 - 1 = 4 for every trial point: the central-difference derivative is exactly zero and Newton cannot take a step.
    expect(() => solveFor(num('5'), 1, 'x', {}, { method: 'newton', initialGuess: 0 })).toThrow(NonConvergentSolveError);
  });
});

describe('solveFor: expressions that do not evaluate to a plain Quantity', () => {
  it('throws UnsupportedExpressionError when the expression evaluates to an Interval', () => {
    const bindings: FormulaBindings = { bound: interval(1, 2, {}) };
    expect(() => solveFor(sym('bound'), 1.5, 'x', bindings, { bracket: [0, 1] })).toThrow(UnsupportedExpressionError);
  });
});
