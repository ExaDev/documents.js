import type { ContentFormula, MathExpression } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { SI_UNIT_REGISTRY } from "../test-support/units";
import { runWorkedExampleSequence } from "./worked-example";

// Builds the "symbol = expression" shape ExaDev/documents.js's LaTeX lowering (packages/documents.js/src/latex/lower.ts) produces for "X = <something>" -- an app(math:eq, [sym, rhs]) -- directly against document-schema.js's own MathExpression, bypassing LaTeX entirely: these tests are about the harness's own recognition and evaluation logic, not about the lowering pipeline that would normally feed it (that's exercised separately, end to end, in corpus.test.ts).
function equation(symbol: string, rhs: MathExpression): MathExpression {
  return {
    kind: "app",
    operator: "math:eq",
    args: [{ kind: "sym", id: symbol }, rhs],
  };
}

function sym(id: string): MathExpression {
  return { kind: "sym", id };
}

// ExactRational's numerator is a signed-integer string, so a decimal literal (6.001) has to be built as its own exact fraction (6001/1000) rather than passed straight through -- MathExpressionSchema's own 'num' node carries no decimal-point spelling at all.
function num(value: number): MathExpression {
  if (Number.isInteger(value)) {
    return { kind: "num", numerator: String(value), denominator: "1" };
  }
  const text = String(value);
  const dotIndex = text.indexOf(".");
  const fractionDigits = text.length - dotIndex - 1;
  const numerator = text.slice(0, dotIndex) + text.slice(dotIndex + 1);
  const denominator = String(10 ** fractionDigits);
  return { kind: "num", numerator, denominator };
}

function qty(value: number, unit: string): MathExpression {
  return {
    kind: "qty",
    value: { numerator: String(value), denominator: "1" },
    unit,
  };
}

function app(
  operator: string,
  args: readonly MathExpression[],
): MathExpression {
  return { kind: "app", operator, args: [...args] };
}

function formula(content: MathExpression): ContentFormula {
  return { mathml: [], content };
}

describe("runWorkedExampleSequence: dimensionless arithmetic", () => {
  it("matches when evaluate() reproduces the document's own stated answer", () => {
    const formulas = [
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))), // F = m * a (the definition)
      formula(equation("m", num(2))), // m = 2 (a binding)
      formula(equation("a", num(3))), // a = 3 (a binding)
      formula(equation("F", num(6))), // F = 6 (the stated result)
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.matched).toBe(1);
    expect(report.mismatched).toBe(0);
    expect(report.coverage).toBe(1);
    expect(report.outcomes).toEqual([
      {
        outcome: "match",
        targetSymbol: "F",
        expected: { kind: "quantity", magnitude: 6, dimension: {} },
        actual: { kind: "quantity", magnitude: 6, dimension: {} },
      },
    ]);
  });

  it("reports a mismatch when the stated answer does not match evaluate()'s own", () => {
    const formulas = [
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))),
      formula(equation("m", num(2))),
      formula(equation("a", num(3))),
      formula(equation("F", num(7))), // wrong on purpose
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.matched).toBe(0);
    expect(report.mismatched).toBe(1);
    expect(report.coverage).toBe(0);
    const [outcome] = report.outcomes;
    expect(outcome?.outcome).toBe("mismatch");
  });

  it("matches an exact zero stated answer using the absolute-tolerance branch, not a division by zero", () => {
    const formulas = [
      formula(equation("d", app("math:subtract", [sym("m"), sym("m2")]))),
      formula(equation("m", num(5))),
      formula(equation("m2", num(5))),
      formula(equation("d", num(0))),
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.matched).toBe(1);
  });

  it("rejects a non-zero actual against a zero stated answer once it exceeds the absolute tolerance", () => {
    const formulas = [
      formula(equation("d", app("math:subtract", [sym("m"), sym("m2")]))),
      formula(equation("m", num(5))),
      formula(equation("m2", num(4))),
      formula(equation("d", num(0))),
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.mismatched).toBe(1);
  });

  it("accepts an actual magnitude exactly at the absolute tolerance boundary against a zero stated answer (the comparison is inclusive)", () => {
    // m - m2 = (1 + 2^-10) - 1 = 2^-10 exactly (both exact in binary), matched against relativeTolerance = 2^-10 exactly: bit-identical, not merely close.
    const relativeTolerance = 2 ** -10;
    const formulas = [
      formula(equation("d", app("math:subtract", [sym("m"), sym("m2")]))),
      formula(equation("m", num(1 + relativeTolerance))),
      formula(equation("m2", num(1))),
      formula(equation("d", num(0))),
    ];
    const report = runWorkedExampleSequence(formulas, undefined, {
      relativeTolerance,
    });
    expect(report.matched).toBe(1);
  });

  it("accepts a residual exactly at the relative tolerance boundary (the comparison is inclusive)", () => {
    // Stated (expected) = 8, computed (actual) = m * a = 2 * 4.03125 = 8.0625: both exact in binary (0.03125 = 2^-5), and withinTolerance divides by |expected| = 8, so |actual - expected| / |expected| = 0.0625 / 8 = 2^-7 exactly, matching relativeTolerance = 2^-7 bit-for-bit -- not merely close to it.
    const relativeTolerance = 2 ** -7;
    const formulas = [
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))),
      formula(equation("m", num(2))),
      formula(equation("a", num(4.03125))),
      formula(equation("F", num(8))),
    ];
    const report = runWorkedExampleSequence(formulas, undefined, {
      relativeTolerance,
    });
    expect(report.matched).toBe(1);
  });

  it("rejects a residual just past the relative tolerance boundary, distinguishing the inclusive '<=' from a stricter '<'", () => {
    // Same construction as above but with the stated answer nudged so the ratio is strictly greater than the tolerance -- must mismatch under either operator, so this alone doesn't kill the boundary mutant, but pairs with the exact-boundary test above to pin the comparison down from both sides.
    const relativeTolerance = 2 ** -7;
    const formulas = [
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))),
      formula(equation("m", num(2))),
      formula(equation("a", num(4.0625))), // 2 * 4.0625 = 8.125, ratio = 0.125/8 = 2^-6, comfortably past 2^-7
      formula(equation("F", num(8))),
    ];
    const report = runWorkedExampleSequence(formulas, undefined, {
      relativeTolerance,
    });
    expect(report.mismatched).toBe(1);
  });

  it("tolerates a stated answer rounded within the relative tolerance", () => {
    const formulas = [
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))),
      formula(equation("m", num(2))),
      formula(equation("a", num(3))),
      formula(equation("F", num(6.001))), // rounded by the document's own author
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.matched).toBe(1);
  });

  it("rejects a stated answer outside an explicitly tightened tolerance", () => {
    const formulas = [
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))),
      formula(equation("m", num(2))),
      formula(equation("a", num(3))),
      formula(equation("F", num(6.001))),
    ];
    const report = runWorkedExampleSequence(formulas, undefined, {
      relativeTolerance: 1e-9,
    });
    expect(report.mismatched).toBe(1);
  });
});

describe("runWorkedExampleSequence: units-typed physics worked example", () => {
  it("matches a dimensioned worked example against the supplied unit registry", () => {
    const formulas = [
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))), // F = m * a
      formula(equation("m", qty(2, "si:kilogram"))), // m = 2 kg
      formula(equation("a", qty(3, "si:metre-per-second-squared"))), // a = 3 m/s^2
      formula(equation("F", qty(6, "si:newton"))), // F = 6 N
    ];
    const report = runWorkedExampleSequence(formulas, SI_UNIT_REGISTRY);
    expect(report.matched).toBe(1);
    const [outcome] = report.outcomes;
    expect(outcome).toMatchObject({
      outcome: "match",
      expected: {
        kind: "quantity",
        magnitude: 6,
        dimension: { mass: 1, length: 1, time: -2 },
      },
    });
  });

  it("reports incompatible-dimensions when the definition mixes incompatible quantities", () => {
    const formulas = [
      formula(equation("total", app("math:add", [sym("m"), sym("a")]))), // total = m + a -- mass + acceleration, nonsensical
      formula(equation("m", qty(2, "si:kilogram"))),
      formula(equation("a", qty(3, "si:metre-per-second-squared"))),
      formula(equation("total", num(5))),
    ];
    const report = runWorkedExampleSequence(formulas, SI_UNIT_REGISTRY);
    expect(report.gaps).toBe(1);
    expect(report.outcomes[0]).toMatchObject({
      outcome: "gap",
      gap: "incompatible-dimensions",
    });
  });

  it("reports unknown-unit when a qty node references a unit id absent from the registry", () => {
    const formulas = [formula(equation("m", qty(2, "si:no-such-unit")))];
    const report = runWorkedExampleSequence(formulas, SI_UNIT_REGISTRY);
    expect(report.gaps).toBe(1);
    expect(report.outcomes[0]).toMatchObject({
      outcome: "gap",
      gap: "unknown-unit",
    });
  });

  it("reports division-by-zero when a definition divides by a bound zero", () => {
    const formulas = [
      formula(equation("q", app("math:divide", [sym("m"), sym("n")]))),
      formula(equation("m", num(6))),
      formula(equation("n", num(0))),
      formula(equation("q", num(1))),
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.gaps).toBe(1);
    expect(report.outcomes[0]).toMatchObject({
      outcome: "gap",
      gap: "division-by-zero",
    });
  });

  it("reports numeric-domain when a definition takes the square root of a negative magnitude", () => {
    const formulas = [
      formula(equation("r", app("math:sqrt", [num(-4)]))),
      formula(equation("r", num(2))),
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.gaps).toBe(1);
    expect(report.outcomes[0]).toMatchObject({
      outcome: "gap",
      gap: "numeric-domain",
    });
  });

  it("counts multiple independent gaps without conflating them with matches or the total", () => {
    const formulas = [
      formula(equation("a", qty(1, "si:no-such-unit"))), // gap 1: unknown-unit
      formula(equation("b", app("math:sqrt", [num(-1)]))), // definition, held pending
      formula(equation("b", num(1))), // gap 2: numeric-domain, on resolving the pending definition
      formula(equation("F", app("math:multiply", [sym("m"), sym("a2")]))),
      formula(equation("m", num(2))),
      formula(equation("a2", num(3))),
      formula(equation("F", num(6))), // a genuine match, alongside the two gaps
    ];
    const report = runWorkedExampleSequence(formulas, SI_UNIT_REGISTRY);
    expect(report.gaps).toBe(2);
    expect(report.matched).toBe(1);
    expect(report.mismatched).toBe(0);
  });
});

describe("runWorkedExampleSequence: structural edge cases", () => {
  it("skips a formula whose content was never lowered to semantics", () => {
    const formulas: readonly ContentFormula[] = [{ mathml: [] }]; // no `content` field at all
    const report = runWorkedExampleSequence(formulas);
    expect(report.total).toBe(0);
  });

  it("skips a formula that is not a 'symbol = expression' shape", () => {
    const formulas = [formula(num(42))]; // a bare literal, no equation at all
    const report = runWorkedExampleSequence(formulas);
    expect(report.total).toBe(0);
  });

  it("skips an 'app' formula whose operator is not math:eq, rather than misreading its first argument as an equality's own left-hand side", () => {
    // If the operator check were bypassed, this formula (app('math:add', [sym('x'), num(1)])) would be misread as the equality shape asEquality actually recognises -- a bare symbol on the left -- treating it as the binding "x = 1" instead of skipping it entirely. Observed by checking x stays unbound: a later definition using x must gap with unbound-symbol, not silently succeed using a wrongly-inferred binding.
    const formulas = [
      formula({
        kind: "app",
        operator: "math:add",
        args: [sym("x"), num(1)],
      }),
      formula(equation("total", sym("x"))),
      formula(equation("total", num(1))),
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.total).toBe(1);
    expect(report.gaps).toBe(1);
    expect(report.matched).toBe(0);
    expect(report.outcomes[0]).toMatchObject({
      outcome: "gap",
      gap: "unbound-symbol",
    });
  });

  it("treats an expression as a definition when at least one argument contains a symbol, even if another argument is a closed literal", () => {
    // math:add's args are [sym('x'), num(1)] -- one contains a symbol, one does not. If containsSymbol used .every instead of .some, this would be misclassified as already-closed and evaluated immediately against EMPTY_BINDINGS, producing an unbound-symbol gap instead of being held as a pending definition.
    const formulas = [
      formula(equation("z", app("math:add", [sym("x"), num(1)]))),
      formula(equation("x", num(2))),
      formula(equation("z", num(3))),
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.gaps).toBe(0);
    expect(report.matched).toBe(1);
  });

  it("treats a sum/prod binder's own lower, upper, and body as containing a symbol whenever any one of them does", () => {
    // Each variant isolates one of the three sub-expressions as the only symbol-carrying one, so a definition using it is correctly held pending rather than evaluated immediately (which would fail since the outer bound symbols aren't defined yet).
    const lowerHasSymbol: MathExpression = {
      kind: "sum",
      binder: "i",
      lower: sym("n0"),
      upper: num(2),
      body: num(1),
    };
    const upperHasSymbol: MathExpression = {
      kind: "prod",
      binder: "i",
      lower: num(1),
      upper: sym("n1"),
      body: num(1),
    };
    const bodyHasSymbol: MathExpression = {
      kind: "sum",
      binder: "i",
      lower: num(1),
      upper: num(2),
      body: sym("n2"),
    };
    for (const [rhs, boundName, boundValue, expected] of [
      [lowerHasSymbol, "n0", 1, 2],
      [upperHasSymbol, "n1", 2, 1],
      [bodyHasSymbol, "n2", 5, 10],
    ] as const) {
      const formulas = [
        formula(equation("total", rhs)),
        formula(equation(boundName, num(boundValue))),
        formula(equation("total", num(expected))),
      ];
      const report = runWorkedExampleSequence(formulas);
      expect(report.matched).toBe(1);
      expect(report.gaps).toBe(0);
    }
  });

  it("treats a fully closed sum (no symbol anywhere in lower/upper/body) as a binding, not a definition held pending", () => {
    // If the OR were replaced wholesale with 'true' (rather than mutating one of its three operands), every sum/prod would be misclassified as a definition regardless of content -- including this one, which has no symbol anywhere and should instead be evaluated immediately as an ordinary closed binding, generating no outcome of its own the same way "m = 2" never does.
    const closedSum: MathExpression = {
      kind: "sum",
      binder: "i",
      lower: num(1),
      upper: num(3),
      body: num(5), // constant body -- 5 + 5 + 5 = 15, no reference to the binder or anything else
    };
    const formulas = [formula(equation("total", closedSum))];
    const report = runWorkedExampleSequence(formulas);
    // A closed binding with nothing ever restating it produces no outcome at all -- distinct from a wrongly-pending definition, which would surface as an "unresolved" outcome once the sequence ends.
    expect(report.total).toBe(0);
    expect(report.unresolved).toBe(0);
  });

  it("treats a matrix expression as containing a symbol whenever any one cell does, holding it pending rather than gapping it immediately", () => {
    // Distinguishes "held pending, then gapped only once something restates it" (correct: unresolved=0, gaps=1, from the eventual resolution attempt) from "wrongly read as closed, gapped immediately on first sight" (a .some/.every or arrow-function mutant: since nothing ever restates "total", a wrongly-immediate gap leaves nothing pending, so no "unresolved" outcome is ever produced either -- gaps=1 either way, but only the correct path also means the definition was genuinely held). The two are told apart by NEVER restating "total": correctly held pending, the sequence ends with it still awaiting a result, which closeUnresolved reports as "unresolved", not "gap".
    const matrixWithSymbol: MathExpression = {
      kind: "matrix",
      rows: [
        [num(1), num(2)],
        [sym("k"), num(4)],
      ],
    };
    const formulas = [
      formula(equation("total", matrixWithSymbol)),
      formula(equation("k", num(3))),
      // total is never restated.
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.gaps).toBe(0);
    expect(report.unresolved).toBe(1);
    expect(report.outcomes[0]).toMatchObject({
      outcome: "unresolved",
      targetSymbol: "total",
    });
  });

  it("reports unsupported-construct once a held-pending matrix definition is finally resolved", () => {
    const matrixWithSymbol: MathExpression = {
      kind: "matrix",
      rows: [[sym("k")]],
    };
    const formulas = [
      formula(equation("total", matrixWithSymbol)),
      formula(equation("k", num(3))),
      formula(equation("total", num(1))),
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.gaps).toBe(1);
    expect(report.outcomes[0]).toMatchObject({
      outcome: "gap",
      gap: "unsupported-construct",
    });
  });

  it("reports unresolved when a definition never gets a stated result, with an exact message naming it", () => {
    const formulas = [
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))),
      formula(equation("m", num(2))),
      formula(equation("a", num(3))),
      // no "F = ..." line ever restates F
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.unresolved).toBe(1);
    expect(report.outcomes[0]).toMatchObject({
      outcome: "unresolved",
      targetSymbol: "F",
      message:
        '"F" was defined but the sequence never restated it as a closed numeric result before ending or being superseded by another definition',
    });
  });

  it("reports the first definition as unresolved when a second definition supersedes it before either resolves", () => {
    const formulas = [
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))), // F = m * a, never resolved
      formula(equation("E", app("math:multiply", [sym("m"), sym("c")]))), // E = m * c, supersedes it
      formula(equation("m", num(2))),
      formula(equation("c", num(3))),
      formula(equation("E", num(6))),
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.unresolved).toBe(1);
    expect(report.matched).toBe(1);
    expect(report.outcomes[0]).toMatchObject({
      outcome: "unresolved",
      targetSymbol: "F",
    });
    expect(report.outcomes[1]).toMatchObject({
      outcome: "match",
      targetSymbol: "E",
    });
  });

  it("resolves a definition against whatever a binding was most recently redefined to, not its value when the definition line first appeared", () => {
    const formulas = [
      formula(equation("m", num(2))), // m = 2 (an initial, later-superseded binding)
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))), // F = m * a (the definition)
      formula(equation("m", num(99))), // m redefined before F's own result is reached
      formula(equation("a", num(3))),
      formula(equation("F", num(297))), // 99 * 3, using the latest m -- not the stale 2 * 3 = 6
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.matched).toBe(1);
    expect(report.outcomes[0]).toMatchObject({
      outcome: "match",
      actual: { magnitude: 297 },
    });
  });

  it("reports unbound-symbol rather than a false match when a definition's own binding was never supplied", () => {
    const formulas = [
      formula(equation("range", sym("phi"))), // "range = phi" -- phi is never bound by any preceding closed statement
      formula(equation("range", num(1))),
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.gaps).toBe(1);
    expect(report.outcomes[0]).toMatchObject({
      outcome: "gap",
      gap: "unbound-symbol",
    });
  });

  it("reports coverage as undefined when nothing in the sequence has a resolvable stated answer, never a fabricated 0 or 1", () => {
    const formulas = [formula(num(42))]; // skipped entirely -- not even a gap
    const report = runWorkedExampleSequence(formulas);
    expect(report.coverage).toBeUndefined();
    expect(report.matched).toBe(0);
    expect(report.mismatched).toBe(0);
  });

  it("computes coverage as matched / (matched + mismatched), not conflated with gaps or unresolved outcomes", () => {
    const formulas = [
      // Two matches.
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))),
      formula(equation("m", num(2))),
      formula(equation("a", num(3))),
      formula(equation("F", num(6))),
      formula(equation("G", app("math:multiply", [sym("m"), sym("b")]))),
      formula(equation("b", num(5))),
      formula(equation("G", num(10))),
      // One mismatch.
      formula(equation("H", app("math:multiply", [sym("m"), sym("c")]))),
      formula(equation("c", num(7))),
      formula(equation("H", num(999))),
      // One gap (must not affect the coverage ratio at all).
      formula(equation("j", qty(1, "si:no-such-unit"))),
      // One unresolved (must not affect the coverage ratio either).
      formula(equation("K", app("math:multiply", [sym("m"), sym("d")]))),
      formula(equation("d", num(1))),
    ];
    const report = runWorkedExampleSequence(formulas, SI_UNIT_REGISTRY);
    expect(report.matched).toBe(2);
    expect(report.mismatched).toBe(1);
    expect(report.gaps).toBe(1);
    expect(report.unresolved).toBe(1);
    // 2 / (2 + 1) = 2/3 -- distinct from every other plausible ratio of these four counts.
    expect(report.coverage).toBeCloseTo(2 / 3, 12);
  });

  it("reports a defined coverage when matched equals mismatched (both nonzero), not a fabricated undefined", () => {
    // matched - mismatched = 0 here even though matched + mismatched = 2 (nonzero) -- an arithmetic-operator mutant swapping the sum for a difference in the "nothing resolvable" guard would wrongly treat this as undefined.
    const formulas = [
      formula(equation("F", app("math:multiply", [sym("m"), sym("a")]))),
      formula(equation("m", num(2))),
      formula(equation("a", num(3))),
      formula(equation("F", num(6))), // match
      formula(equation("G", app("math:multiply", [sym("m"), sym("c")]))),
      formula(equation("c", num(7))),
      formula(equation("G", num(999))), // mismatch
    ];
    const report = runWorkedExampleSequence(formulas);
    expect(report.matched).toBe(1);
    expect(report.mismatched).toBe(1);
    expect(report.coverage).toBe(0.5);
  });
});
