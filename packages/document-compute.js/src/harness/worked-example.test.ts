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

  it("reports unresolved when a definition never gets a stated result", () => {
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
});
