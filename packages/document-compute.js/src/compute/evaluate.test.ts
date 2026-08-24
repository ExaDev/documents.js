import { describe, expect, it } from "vitest";
import type {
  FormulaBindings,
  MathExpression,
  MathMatrix,
  MathUnparsed,
  SymbolTable,
} from "document-schema.js";
import { evaluate, isInterval } from "./evaluate";
import { interval } from "./interval";
import { quantity } from "./quantity";
import {
  DivisionByZeroError,
  IncompatibleDimensionsError,
  UnboundSymbolError,
  UnknownUnitError,
  UnsupportedExpressionError,
} from "./errors";

// -- small builders for MathExpression trees, mirroring document-schema.js's src/math.ts grammar --
function num(numerator: string, denominator = "1"): MathExpression {
  return { kind: "num", numerator, denominator };
}
function sym(id: string): MathExpression {
  return { kind: "sym", id };
}
function qty(
  value: { numerator: string; denominator: string },
  unit: string,
): MathExpression {
  return { kind: "qty", value, unit };
}
function app(operator: string, args: MathExpression[]): MathExpression {
  return { kind: "app", operator, args };
}

const context: SymbolTable = {
  symbols: [],
  units: [
    {
      id: "si:metre",
      symbol: "m",
      dimension: { length: 1 },
      factorToSi: { numerator: "1", denominator: "1" },
    },
    {
      id: "si:second",
      symbol: "s",
      dimension: { time: 1 },
      factorToSi: { numerator: "1", denominator: "1" },
    },
    // 1 foot = 0.3048 m exactly, 381/1250 -- document-schema.js's math.ts cites this exact unit as its own worked example.
    {
      id: "imperial:foot",
      symbol: "ft",
      dimension: { length: 1 },
      factorToSi: { numerator: "381", denominator: "1250" },
    },
    // An affine unit: 0 degC = 273.15 K.
    {
      id: "demo:celsius",
      symbol: "degC",
      dimension: { thermodynamicTemperature: 1 },
      factorToSi: { numerator: "1", denominator: "1" },
      offsetToSi: { numerator: "27315", denominator: "100" },
    },
  ],
};

describe("evaluate: num", () => {
  it("evaluates an exact-rational literal to a dimensionless Quantity", () => {
    const result = evaluate(num("7"), {});
    expect(isInterval(result)).toBe(false);
    expect(result).toEqual(quantity(7, {}));
  });

  it("evaluates a non-integer rational literal", () => {
    const result = evaluate(num("1", "4"), {});
    expect(result).toEqual(quantity(0.25, {}));
  });
});

describe("evaluate: qty", () => {
  it("resolves a unit-registry id against the supplied SymbolTable and converts to SI-coherent magnitude", () => {
    const result = evaluate(
      qty({ numerator: "10", denominator: "1" }, "imperial:foot"),
      {},
      context,
    );
    expect(result.kind).toBe("quantity");
    expect((result as { magnitude: number }).magnitude).toBeCloseTo(3.048, 12);
    expect(result.dimension).toEqual({ length: 1 });
  });

  it("applies an affine unit's offset as well as its factor", () => {
    const result = evaluate(
      qty({ numerator: "0", denominator: "1" }, "demo:celsius"),
      {},
      context,
    );
    expect((result as { magnitude: number }).magnitude).toBeCloseTo(273.15, 12);
  });

  it("throws UnknownUnitError for a unit id the symbol table does not carry", () => {
    expect(() =>
      evaluate(
        qty({ numerator: "1", denominator: "1" }, "nonexistent:unit"),
        {},
        context,
      ),
    ).toThrow(UnknownUnitError);
  });
});

describe("evaluate: sym", () => {
  it("returns the bound value for a symbol id", () => {
    const bindings: FormulaBindings = { x: quantity(5, { length: 1 }) };
    expect(evaluate(sym("x"), bindings)).toEqual(quantity(5, { length: 1 }));
  });

  it("throws UnboundSymbolError for a symbol with no binding", () => {
    expect(() => evaluate(sym("y"), {})).toThrow(UnboundSymbolError);
  });
});

describe("evaluate: app -- arithmetic over bound symbols", () => {
  const bindings: FormulaBindings = {
    m: quantity(2, { mass: 1 }),
    a: quantity(3, { length: 1, time: -2 }),
  };

  it("adds", () => {
    expect(evaluate(app("math:add", [num("2"), num("3")]), {})).toEqual(
      quantity(5, {}),
    );
  });

  it("subtracts", () => {
    expect(evaluate(app("math:subtract", [num("5"), num("3")]), {})).toEqual(
      quantity(2, {}),
    );
  });

  it("multiplies bound symbols, combining dimensions (F = m * a)", () => {
    expect(
      evaluate(app("math:multiply", [sym("m"), sym("a")]), bindings),
    ).toEqual(quantity(6, { mass: 1, length: 1, time: -2 }));
  });

  it("divides bound symbols, combining dimensions (speed = distance / time)", () => {
    const speedBindings: FormulaBindings = {
      distance: quantity(10, { length: 1 }),
      time: quantity(2, { time: 1 }),
    };
    expect(
      evaluate(
        app("math:divide", [sym("distance"), sym("time")]),
        speedBindings,
      ),
    ).toEqual(quantity(5, { length: 1, time: -1 }));
  });

  it("raises via math:pow", () => {
    expect(evaluate(app("math:pow", [num("2"), num("3")]), {})).toEqual(
      quantity(8, {}),
    );
  });

  it("throws IncompatibleDimensionsError adding across incompatible dimensions", () => {
    const mismatched = app("math:add", [
      qty({ numerator: "1", denominator: "1" }, "si:metre"),
      qty({ numerator: "1", denominator: "1" }, "si:second"),
    ]);
    expect(() => evaluate(mismatched, {}, context)).toThrow(
      IncompatibleDimensionsError,
    );
  });

  it("throws DivisionByZeroError dividing by an exact zero", () => {
    expect(() =>
      evaluate(app("math:divide", [num("5"), num("0")]), {}),
    ).toThrow(DivisionByZeroError);
  });

  it("throws UnsupportedExpressionError for an unknown operator id", () => {
    expect(() => evaluate(app("math:frobnicate", [num("1")]), {})).toThrow(
      UnsupportedExpressionError,
    );
  });
});

describe("evaluate: intervals, reusing the same evaluator", () => {
  it("mixes a bound Interval with a plain Quantity literal via point-interval promotion", () => {
    // 0.87 <= cos(phi) <= 1, doubled.
    const bindings: FormulaBindings = { cosPhi: interval(0.87, 1, {}) };
    const result = evaluate(
      app("math:multiply", [sym("cosPhi"), num("2")]),
      bindings,
    );
    expect(isInterval(result)).toBe(true);
    if (!isInterval(result)) throw new Error("expected an Interval result");
    expect(result.min).toBeCloseTo(1.74, 12);
    expect(result.max).toBeCloseTo(2, 12);
    expect(result.dimension).toEqual({});
  });

  it("propagates IncompatibleDimensionsError through interval arithmetic just as it does for Quantity", () => {
    const bindings: FormulaBindings = {
      a: interval(1, 2, { length: 1 }),
      b: interval(1, 2, { time: 1 }),
    };
    expect(() =>
      evaluate(app("math:add", [sym("a"), sym("b")]), bindings),
    ).toThrow(IncompatibleDimensionsError);
  });
});

describe("evaluate: sum / prod binders", () => {
  it("sums i from 1 to 3", () => {
    const expression: MathExpression = {
      kind: "sum",
      binder: "i",
      lower: num("1"),
      upper: num("3"),
      body: sym("i"),
    };
    expect(evaluate(expression, {})).toEqual(quantity(6, {}));
  });

  it("multiplies i from 1 to 4 (4!)", () => {
    const expression: MathExpression = {
      kind: "prod",
      binder: "i",
      lower: num("1"),
      upper: num("4"),
      body: sym("i"),
    };
    expect(evaluate(expression, {})).toEqual(quantity(24, {}));
  });
});

describe("evaluate: out-of-scope node kinds", () => {
  it("throws UnsupportedExpressionError for a matrix node", () => {
    const expression: MathMatrix = { kind: "matrix", rows: [[num("1")]] };
    expect(() => evaluate(expression, {})).toThrow(UnsupportedExpressionError);
  });

  it("throws UnsupportedExpressionError for an unparsed node", () => {
    const expression: MathUnparsed = {
      kind: "unparsed",
      latex: "\\frobnicate{x}",
    };
    expect(() => evaluate(expression, {})).toThrow(UnsupportedExpressionError);
  });
});
