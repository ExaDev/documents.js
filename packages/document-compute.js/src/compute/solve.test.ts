import { describe, expect, it } from "vitest";
import type { FormulaBindings, MathExpression } from "document-schema.js";
import { solveFor } from "./solve";
import { interval } from "./interval";
import { quantity } from "./quantity";
import { NonConvergentSolveError, UnsupportedExpressionError } from "./errors";

function num(numerator: string, denominator = "1"): MathExpression {
  return { kind: "num", numerator, denominator };
}
function sym(id: string): MathExpression {
  return { kind: "sym", id };
}
function app(operator: string, args: MathExpression[]): MathExpression {
  return { kind: "app", operator, args };
}

// x^2, used across both algorithms below: solveFor(xSquared, 4, 'x', {}, ...) should find x = 2 (within the chosen bracket/initial guess).
const xSquared: MathExpression = app("math:pow", [sym("x"), num("2")]);

describe("solveFor: bisection (the default method)", () => {
  it("solves x^2 = 4 for the positive root within a bracket", () => {
    const root = solveFor(xSquared, 4, "x", {}, { bracket: [0, 3] });
    expect(root).toBeCloseTo(2, 6);
  });

  it("returns the bracket's own low endpoint immediately when it is already within tolerance, without ever computing a midpoint", () => {
    // f(2) = 2^2 - 4 = 0 exactly, at the bracket's own low endpoint.
    const root = solveFor(xSquared, 4, "x", {}, { bracket: [2, 3] });
    expect(root).toBe(2);
  });

  it("returns the bracket's own high endpoint immediately when it is already within tolerance", () => {
    // f(2) = 2^2 - 4 = 0 exactly, at the bracket's own high endpoint.
    const root = solveFor(xSquared, 4, "x", {}, { bracket: [0, 2] });
    expect(root).toBe(2);
  });

  it("solves for a negative root, exercising the bisection step direction with a positive residual at the low endpoint", () => {
    // f(-3) = 9 - 4 = 5 (positive at low), f(0) = -4 (negative at high) -- the opposite polarity from the positive-root cases above.
    const root = solveFor(xSquared, 4, "x", {}, { bracket: [-3, 0] });
    expect(root).toBeCloseTo(-2, 6);
  });

  it("does not treat a residual exactly at the tolerance boundary as converged for the bracket's low endpoint (the comparison is strict)", () => {
    // f(low) = low - 0 = low, set exactly to tolerance: a correct strict '<' does not return early here, so the bracket (both endpoints positive) is then correctly rejected as non-straddling; a mutated '<=' would instead return `low` immediately without ever checking the sign.
    const tolerance = 2 ** -10;
    expect(() =>
      solveFor(sym("x"), 0, "x", {}, { bracket: [tolerance, 1], tolerance }),
    ).toThrow(NonConvergentSolveError);
  });

  it("does not treat a residual exactly at the tolerance boundary as converged for the bracket's high endpoint", () => {
    const tolerance = 2 ** -10;
    const root = solveFor(
      sym("x"),
      0,
      "x",
      {},
      { bracket: [-1, tolerance], tolerance },
    );
    expect(root).not.toBe(tolerance);
  });

  it("does not treat a midpoint residual exactly at tolerance as converged (the comparison is strict, not inclusive)", () => {
    // mid = (low + high) / 2 = tolerance exactly, on the loop's first iteration; a correct strict '<' keeps refining past it, a mutated '<=' would return the midpoint immediately.
    const tolerance = 2 ** -10;
    const low = -1;
    const high = 2 * tolerance - low;
    const root = solveFor(
      sym("x"),
      0,
      "x",
      {},
      { bracket: [low, high], tolerance },
    );
    expect(root).not.toBe(tolerance);
    expect(Math.abs(root)).toBeLessThan(tolerance);
  });

  it("treats a residual of exactly zero at the bracket's low endpoint as non-positive, immediately reporting no sign change rather than entering the loop (tolerance 0 forces the sign check to run instead of returning early)", () => {
    let caught: unknown;
    try {
      solveFor(
        sym("x"),
        0,
        "x",
        {},
        { bracket: [0, 1], tolerance: 0, maxIterations: 5 },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NonConvergentSolveError);
    expect((caught as NonConvergentSolveError).iterations).toBe(5);
    expect((caught as NonConvergentSolveError).message).toContain(
      "residual still exceeds tolerance",
    );
  });

  it("treats a residual of exactly zero at the bracket's high endpoint as non-positive too, immediately reporting no sign change rather than entering the loop", () => {
    let caught: unknown;
    try {
      solveFor(
        sym("x"),
        0,
        "x",
        {},
        { bracket: [-1, 0], tolerance: 0, maxIterations: 5 },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NonConvergentSolveError);
    expect((caught as NonConvergentSolveError).iterations).toBe(0);
    expect((caught as NonConvergentSolveError).message).toContain(
      "does not change sign",
    );
  });

  it("respects an exact zero iteration budget, never evaluating a midpoint even when the very first midpoint would itself be the exact root", () => {
    // mid = (0 + 4) / 2 = 2, the exact root -- with a correct zero-iteration budget the loop body must never run, so this still reports non-convergence rather than opportunistically returning 2.
    expect(() =>
      solveFor(xSquared, 4, "x", {}, { bracket: [0, 4], maxIterations: 0 }),
    ).toThrow(NonConvergentSolveError);
  });

  it("solves a linear formula for one unknown given the rest of the bindings (F = m * a, solve for a)", () => {
    const force = app("math:multiply", [sym("m"), sym("a")]);
    const bindings: FormulaBindings = { m: quantity(2, { mass: 1 }) };
    // F = 10 N = m * a -> a = 5
    const a = solveFor(force, 10, "a", bindings, { bracket: [0, 20] });
    expect(a).toBeCloseTo(5, 6);
  });

  it("honours unknownDimension, binding the unknown symbol under a non-dimensionless dimension", () => {
    // Solving the identity expression sym('L') = 5 (SI-coherent metres) for L.
    const root = solveFor(
      sym("L"),
      5,
      "L",
      {},
      { bracket: [0, 10], unknownDimension: { length: 1 } },
    );
    expect(root).toBeCloseTo(5, 6);
  });

  it("throws NonConvergentSolveError when the bracket does not straddle a root -- both endpoints positive", () => {
    let caught: unknown;
    try {
      solveFor(xSquared, 4, "x", {}, { bracket: [3, 5] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NonConvergentSolveError);
    expect((caught as NonConvergentSolveError).method).toBe("bisection");
    expect((caught as NonConvergentSolveError).iterations).toBe(0);
    expect((caught as NonConvergentSolveError).message).toBe(
      "solveFor (bisection) did not converge after 0 iteration(s): residual at the bracket endpoints does not change sign (f(3)=5, f(5)=21) -- bisection needs a bracket straddling the root.",
    );
  });

  it("throws NonConvergentSolveError when the bracket does not straddle a root -- both endpoints negative", () => {
    // f(-1) = 1 - 4 = -3, f(1) = 1 - 4 = -3: both negative, distinguishing this sign-mismatch case from the both-positive one above.
    expect(() => solveFor(xSquared, 4, "x", {}, { bracket: [-1, 1] })).toThrow(
      NonConvergentSolveError,
    );
  });

  it("throws NonConvergentSolveError when the iteration budget is exhausted before reaching the requested tolerance", () => {
    let caught: unknown;
    try {
      solveFor(
        xSquared,
        4,
        "x",
        {},
        { bracket: [0, 3], tolerance: 1e-15, maxIterations: 3 },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NonConvergentSolveError);
    expect((caught as NonConvergentSolveError).method).toBe("bisection");
    expect((caught as NonConvergentSolveError).iterations).toBe(3);
    expect((caught as NonConvergentSolveError).message).toBe(
      "solveFor (bisection) did not converge after 3 iteration(s): residual still exceeds tolerance 1e-15 after 3 iterations.",
    );
  });

  it("throws UnsupportedExpressionError with an exact message when options.bracket is missing", () => {
    let caught: unknown;
    try {
      solveFor(xSquared, 4, "x", {}, {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe("solveFor");
    expect((caught as UnsupportedExpressionError).message).toBe(
      "solveFor: method 'bisection' requires options.bracket: [low, high].",
    );
  });
});

describe("solveFor: Newton's method", () => {
  it("solves x^2 = 4 for the positive root from an initial guess, using a central-difference derivative", () => {
    const root = solveFor(
      xSquared,
      4,
      "x",
      {},
      { method: "newton", initialGuess: 3 },
    );
    expect(root).toBeCloseTo(2, 6);
  });

  it("converges to the same root bisection finds, from a different initial guess", () => {
    const root = solveFor(
      xSquared,
      4,
      "x",
      {},
      { method: "newton", initialGuess: 1.5 },
    );
    expect(root).toBeCloseTo(2, 6);
  });

  it("throws UnsupportedExpressionError with an exact message when options.initialGuess is missing", () => {
    let caught: unknown;
    try {
      solveFor(xSquared, 4, "x", {}, { method: "newton" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe("solveFor");
    expect((caught as UnsupportedExpressionError).message).toBe(
      "solveFor: method 'newton' requires options.initialGuess.",
    );
  });

  it("throws NonConvergentSolveError when the residual is independent of the unknown (a vanishing derivative) -- the documented non-convergent case", () => {
    // The expression never references 'x', so f(x) is the constant 5 - 1 = 4 for every trial point: the central-difference derivative is exactly zero and Newton cannot take a step.
    let caught: unknown;
    try {
      solveFor(num("5"), 1, "x", {}, { method: "newton", initialGuess: 0 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NonConvergentSolveError);
    expect((caught as NonConvergentSolveError).method).toBe("newton");
    expect((caught as NonConvergentSolveError).iterations).toBe(0);
    expect((caught as NonConvergentSolveError).message).toBe(
      "solveFor (newton) did not converge after 0 iteration(s): the numeric derivative vanished or diverged near x=0.",
    );
  });

  it("throws NonConvergentSolveError with a non-finite derivative when the residual itself is non-finite at every trial point", () => {
    // targetValue = Infinity makes every finite evaluate() result minus target equal to -Infinity, so the central-difference derivative is Infinity - Infinity = NaN -- non-finite, not merely tiny.
    expect(() =>
      solveFor(
        sym("x"),
        Infinity,
        "x",
        {},
        { method: "newton", initialGuess: 0 },
      ),
    ).toThrow(NonConvergentSolveError);
  });

  it("stops at an exact iteration budget for Newton rather than running one iteration past it", () => {
    // From initialGuess = 3 with the default tolerance (1e-9), convergence happens on the loop's own 5th execution (i = 4, verified by tracing the iterates: 3, 2.1666..., 2.00641..., 2.0000102..., 2.0000000000262 -- the last one first satisfies |fx| < 1e-9). A budget of exactly 4 iterations must therefore exhaust one execution short of ever reaching that converging step, not silently run it anyway.
    let caught: unknown;
    try {
      solveFor(
        xSquared,
        4,
        "x",
        {},
        { method: "newton", initialGuess: 3, maxIterations: 4 },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NonConvergentSolveError);
    expect((caught as NonConvergentSolveError).method).toBe("newton");
    expect((caught as NonConvergentSolveError).iterations).toBe(4);
    expect((caught as NonConvergentSolveError).message).toBe(
      "solveFor (newton) did not converge after 4 iteration(s): residual still exceeds tolerance 1e-9 after 4 iterations.",
    );
  });

  it("returns the initial guess immediately when it is already within tolerance, without ever estimating a derivative", () => {
    const root = solveFor(
      xSquared,
      4,
      "x",
      {},
      { method: "newton", initialGuess: 2 },
    );
    expect(root).toBe(2);
  });

  it("takes a further Newton step rather than stopping early when the residual sits exactly at, but not under, the tolerance", () => {
    // f(x) = x - target (identity), with x0 = 1, tolerance = 2^-10, and target = x0 - tolerance -- all exact in binary, so fx = x0 - target is bit-identical to tolerance, not merely close to it. A correct strict '<' takes the (exact, for a linear function) Newton step to the true root at `target`; a mutated '<=' would return x0 unchanged instead.
    const tolerance = 2 ** -10;
    const x0 = 1;
    const target = x0 - tolerance;
    const root = solveFor(
      sym("x"),
      target,
      "x",
      {},
      { method: "newton", initialGuess: x0, tolerance },
    );
    expect(root).not.toBe(x0);
    expect(root).toBeCloseTo(target, 12);
  });
});

describe("solveFor: expressions that do not evaluate to a plain Quantity", () => {
  it("throws UnsupportedExpressionError with an exact message when the expression evaluates to an Interval", () => {
    const bindings: FormulaBindings = { bound: interval(1, 2, {}) };
    let caught: unknown;
    try {
      solveFor(sym("bound"), 1.5, "x", bindings, { bracket: [0, 1] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe("solveFor");
    expect((caught as UnsupportedExpressionError).message).toBe(
      "solveFor: the expression must evaluate to a plain Quantity, not an Interval.",
    );
  });
});

describe("solveFor: Newton's method -- derivative-vanishing threshold", () => {
  it("treats a derivative of exactly 1e-14 as still usable (the vanishing check is a strict '<', not '<=')", () => {
    // f(x) = k*x with k = 1e-14 exactly. Choosing h as a power of two and x0 = h makes every step of the central-difference computation exact in floating point (a power-of-two scaling never rounds): f(x0 - h) = k*0 = 0 exactly, f(x0 + h) = k*(2h) exactly, so the estimated derivative is bit-for-bit 1e-14 -- not merely close to it. A correct strict '<' does not treat this as vanished and takes the (exact, for a linear function) Newton step straight to the true root at 0; a mutated '<=' would misclassify this genuine, usable derivative as vanished and throw immediately instead.
    const h = 2 ** -20;
    const linear: MathExpression = {
      kind: "app",
      operator: "math:multiply",
      args: [
        { kind: "num", numerator: "1", denominator: "100000000000000" },
        sym("x"),
      ],
    };
    const root = solveFor(
      linear,
      0,
      "x",
      {},
      {
        method: "newton",
        initialGuess: h,
        derivativeStep: h,
        tolerance: 1e-25,
        maxIterations: 5,
      },
    );
    expect(root).toBe(0);
  });
});
