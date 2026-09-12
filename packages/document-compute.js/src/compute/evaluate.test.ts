import { describe, expect, it } from "vitest";
import type {
  FormulaBindings,
  MathExpression,
  MathMatrix,
  MathUnparsed,
  SymbolTable,
} from "document-schema.js";
import { evaluate, evaluateQuantity, isInterval } from "./evaluate";
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

  it("throws UnsupportedExpressionError for an unknown operator id, with the exact message even for a 2-argument call that could be mistaken for math:pow's own gate", () => {
    // 2 arguments specifically: if the `node.operator === "math:pow"` check were mutated to always true, this operator name would still satisfy expectTwoArgs and silently compute pow(1, 2) instead of throwing.
    let caught: unknown;
    try {
      evaluate(app("math:frobnicate", [num("1"), num("2")]), {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe("evaluate");
    expect((caught as UnsupportedExpressionError).message).toBe(
      "evaluate: unknown operator 'math:frobnicate'.",
    );
  });

  it("throws UnsupportedExpressionError with an exact arity message for a binary operator given too few or too many arguments", () => {
    let tooFew: unknown;
    try {
      evaluate(app("math:add", [num("1")]), {});
    } catch (error) {
      tooFew = error;
    }
    expect(tooFew).toBeInstanceOf(UnsupportedExpressionError);
    expect((tooFew as UnsupportedExpressionError).context).toBe("evaluate");
    expect((tooFew as UnsupportedExpressionError).message).toBe(
      "evaluate: operator 'math:add' takes exactly 2 arguments, got 1.",
    );

    let tooMany: unknown;
    try {
      evaluate(app("math:add", [num("1"), num("2"), num("3")]), {});
    } catch (error) {
      tooMany = error;
    }
    expect(tooMany).toBeInstanceOf(UnsupportedExpressionError);
    expect((tooMany as UnsupportedExpressionError).message).toBe(
      "evaluate: operator 'math:add' takes exactly 2 arguments, got 3.",
    );
  });

  it("throws UnsupportedExpressionError with an exact arity message for math:pow given the wrong number of arguments", () => {
    let caught: unknown;
    try {
      evaluate(app("math:pow", [num("2")]), {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).message).toBe(
      "evaluate: 'math:pow' takes exactly 2 arguments, got 1.",
    );
  });

  it("rejects an Interval base or exponent to math:pow, naming which position rejected it", () => {
    const bindings: FormulaBindings = { phi: interval(1, 2, {}) };

    let baseCaught: unknown;
    try {
      evaluate(app("math:pow", [sym("phi"), num("2")]), bindings);
    } catch (error) {
      baseCaught = error;
    }
    expect(baseCaught).toBeInstanceOf(UnsupportedExpressionError);
    expect((baseCaught as UnsupportedExpressionError).context).toBe("evaluate");
    expect((baseCaught as UnsupportedExpressionError).message).toBe(
      "evaluate: this position requires a plain Quantity, not an Interval.",
    );

    let exponentCaught: unknown;
    try {
      evaluate(app("math:pow", [num("2"), sym("phi")]), bindings);
    } catch (error) {
      exponentCaught = error;
    }
    expect(exponentCaught).toBeInstanceOf(UnsupportedExpressionError);
    expect((exponentCaught as UnsupportedExpressionError).message).toBe(
      "evaluate: this position requires a plain Quantity, not an Interval.",
    );
  });
});

describe("evaluate: app -- unary operators", () => {
  it("negates, takes the absolute value of, and takes the square root of a Quantity", () => {
    expect(evaluate(app("math:negate", [num("4")]), {})).toEqual(
      quantity(-4, {}),
    );
    expect(
      evaluate(app("math:abs", [app("math:negate", [num("4")])]), {}),
    ).toEqual(quantity(4, {}));
    expect(evaluate(app("math:sqrt", [num("4")]), {})).toEqual(quantity(2, {}));
  });

  it("evaluates the trigonometric unary operators over a Quantity", () => {
    expect(
      (evaluate(app("math:sin", [num("0")]), {}) as { magnitude: number })
        .magnitude,
    ).toBeCloseTo(0, 12);
    expect(
      (evaluate(app("math:cos", [num("0")]), {}) as { magnitude: number })
        .magnitude,
    ).toBeCloseTo(1, 12);
    expect(
      (evaluate(app("math:tan", [num("0")]), {}) as { magnitude: number })
        .magnitude,
    ).toBeCloseTo(0, 12);
  });

  it("negates an Interval via the same evaluator, using the operator's own interval rule", () => {
    const bindings: FormulaBindings = { phi: interval(1, 3, {}) };
    const result = evaluate(app("math:negate", [sym("phi")]), bindings);
    expect(isInterval(result)).toBe(true);
    if (!isInterval(result)) throw new Error("expected an Interval result");
    expect(result.min).toBe(-3);
    expect(result.max).toBe(-1);
  });

  it("throws UnsupportedExpressionError with an exact message when a unary operator has no interval rule in this pass", () => {
    const bindings: FormulaBindings = { phi: interval(1, 4, {}) };
    let caught: unknown;
    try {
      evaluate(app("math:sqrt", [sym("phi")]), bindings);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe("evaluate");
    expect((caught as UnsupportedExpressionError).message).toBe(
      "evaluate: operator 'math:sqrt' has no interval rule in this pass.",
    );
  });

  it("throws UnsupportedExpressionError with an exact arity message for a unary operator given the wrong number of arguments", () => {
    let noArgs: unknown;
    try {
      evaluate(app("math:negate", []), {});
    } catch (error) {
      noArgs = error;
    }
    expect(noArgs).toBeInstanceOf(UnsupportedExpressionError);
    expect((noArgs as UnsupportedExpressionError).context).toBe("evaluate");
    expect((noArgs as UnsupportedExpressionError).message).toBe(
      "evaluate: operator 'math:negate' takes exactly 1 argument, got 0.",
    );

    let tooMany: unknown;
    try {
      evaluate(app("math:negate", [num("1"), num("2")]), {});
    } catch (error) {
      tooMany = error;
    }
    expect(tooMany).toBeInstanceOf(UnsupportedExpressionError);
    expect((tooMany as UnsupportedExpressionError).message).toBe(
      "evaluate: operator 'math:negate' takes exactly 1 argument, got 2.",
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
  it("throws UnsupportedExpressionError for a matrix node, with its own exact context and message", () => {
    const expression: MathMatrix = { kind: "matrix", rows: [[num("1")]] };
    let caught: unknown;
    try {
      evaluate(expression, {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe("evaluate");
    expect((caught as UnsupportedExpressionError).message).toBe(
      "evaluate: matrix-valued expressions are out of scope for this pass -- document-compute.js evaluates scalar Quantity/Interval values only.",
    );
  });

  it("throws UnsupportedExpressionError for an unparsed node, quoting the source LaTeX in the message", () => {
    const expression: MathUnparsed = {
      kind: "unparsed",
      latex: "\\frobnicate{x}",
    };
    let caught: unknown;
    try {
      evaluate(expression, {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe("evaluate");
    expect((caught as UnsupportedExpressionError).message).toBe(
      'evaluate: this node is source LaTeX ("\\frobnicate{x}") document-schema.js\'s lowering could not represent structurally, so there is nothing to evaluate.',
    );
  });
});

describe("evaluate: sum / prod binders -- error paths", () => {
  it("throws IncompatibleDimensionsError when only the lower bound is dimensioned", () => {
    const expression: MathExpression = {
      kind: "sum",
      binder: "i",
      lower: qty({ numerator: "1", denominator: "1" }, "si:metre"),
      upper: num("3"),
      body: sym("i"),
    };
    let caught: unknown;
    try {
      evaluate(expression, {}, context);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((caught as IncompatibleDimensionsError).operation).toBe("math:sum");
    expect((caught as IncompatibleDimensionsError).message).toBe(
      "'math:sum' requires compatible dimensions, got length^1 and dimensionless (binder bounds must be dimensionless).",
    );
  });

  it("throws IncompatibleDimensionsError when only the upper bound is dimensioned (prod)", () => {
    const expression: MathExpression = {
      kind: "prod",
      binder: "i",
      lower: num("1"),
      upper: qty({ numerator: "1", denominator: "1" }, "si:metre"),
      body: sym("i"),
    };
    let caught: unknown;
    try {
      evaluate(expression, {}, context);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((caught as IncompatibleDimensionsError).operation).toBe("math:prod");
  });

  it("throws UnsupportedExpressionError when only the lower bound is non-integer", () => {
    const expression: MathExpression = {
      kind: "sum",
      binder: "i",
      lower: num("1", "2"),
      upper: num("3"),
      body: sym("i"),
    };
    let caught: unknown;
    try {
      evaluate(expression, {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe("evaluate:sum");
    expect((caught as UnsupportedExpressionError).message).toBe(
      "evaluate:sum: binder bounds must evaluate to integers.",
    );
  });

  it("throws UnsupportedExpressionError when only the upper bound is non-integer (prod)", () => {
    const expression: MathExpression = {
      kind: "prod",
      binder: "i",
      lower: num("1"),
      upper: num("7", "2"),
      body: sym("i"),
    };
    let caught: unknown;
    try {
      evaluate(expression, {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe(
      "evaluate:prod",
    );
  });

  it("rejects an Interval-valued lower bound, naming the binder's own context", () => {
    const bindings: FormulaBindings = { phi: interval(1, 2, {}) };
    const expression: MathExpression = {
      kind: "sum",
      binder: "i",
      lower: sym("phi"),
      upper: num("2"),
      body: num("1"),
    };
    let caught: unknown;
    try {
      evaluate(expression, bindings);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe("evaluate:sum");
    expect((caught as UnsupportedExpressionError).message).toBe(
      "evaluate:sum: this position requires a plain Quantity, not an Interval.",
    );
  });

  it("rejects an Interval-valued upper bound, naming the binder's own context (prod)", () => {
    const bindings: FormulaBindings = { phi: interval(1, 2, {}) };
    const expression: MathExpression = {
      kind: "prod",
      binder: "i",
      lower: num("1"),
      upper: sym("phi"),
      body: num("1"),
    };
    let caught: unknown;
    try {
      evaluate(expression, bindings);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe(
      "evaluate:prod",
    );
  });

  it("rejects an Interval-valued body, naming the binder's own context", () => {
    const bindings: FormulaBindings = { phi: interval(1, 2, {}) };
    const expression: MathExpression = {
      kind: "sum",
      binder: "i",
      lower: num("1"),
      upper: num("2"),
      body: sym("phi"),
    };
    let caught: unknown;
    try {
      evaluate(expression, bindings);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe("evaluate:sum");
    expect((caught as UnsupportedExpressionError).message).toBe(
      "evaluate:sum: this position requires a plain Quantity, not an Interval.",
    );
  });
});

describe("evaluateQuantity", () => {
  it("returns the point value of an expression whose bindings are all point-valued, resolving units through the supplied symbol table", () => {
    const bindings: FormulaBindings = { m: quantity(2, { mass: 1 }) };
    const result = evaluateQuantity(
      app("math:multiply", [
        sym("m"),
        qty({ numerator: "3", denominator: "1" }, "si:metre"),
      ]),
      bindings,
      context,
    );
    expect(result).toEqual(quantity(6, { mass: 1, length: 1 }));
  });

  it("defaults to an empty symbol table, exactly as evaluate() does, for an expression that needs no unit lookup", () => {
    expect(evaluateQuantity(num("7"), {})).toEqual(quantity(7, {}));
  });

  it("rejects an Interval-valued result under its own context rather than widening the return type", () => {
    // The one way an Interval reaches this function at all: a binding that is itself one. A caller passing only Quantity bindings (the worked-example harness) can never see this, which is the whole point of the narrowing living here rather than being restated at each such call site.
    const bindings: FormulaBindings = { phi: interval(1, 2, {}) };
    let caught: unknown;
    try {
      evaluateQuantity(sym("phi"), bindings);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedExpressionError);
    expect((caught as UnsupportedExpressionError).context).toBe(
      "evaluateQuantity",
    );
    expect((caught as UnsupportedExpressionError).message).toBe(
      "evaluateQuantity: this position requires a plain Quantity, not an Interval.",
    );
  });
});
