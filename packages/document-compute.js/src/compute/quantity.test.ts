import { describe, expect, it } from "vitest";
import { QuantitySchema } from "document-schema.js";
import {
  IncompatibleDimensionsError,
  DivisionByZeroError,
  NumericDomainError,
} from "./errors";
import {
  absQuantity,
  addQuantities,
  cosQuantity,
  divideQuantities,
  multiplyQuantities,
  negateQuantity,
  powQuantity,
  quantity,
  sinQuantity,
  sqrtQuantity,
  subtractQuantities,
  tanQuantity,
} from "./quantity";

describe("Quantity schema", () => {
  it("validates a magnitude plus dimension vector", () => {
    expect(QuantitySchema.safeParse(quantity(5, { length: 1 })).success).toBe(
      true,
    );
    expect(
      QuantitySchema.safeParse({
        kind: "quantity",
        magnitude: "five",
        dimension: {},
      }).success,
    ).toBe(false);
  });
});

describe("addQuantities / subtractQuantities", () => {
  it("adds and subtracts quantities of equal dimension", () => {
    const a = quantity(2, { length: 1 });
    const b = quantity(3, { length: 1 });
    expect(addQuantities(a, b)).toEqual(quantity(5, { length: 1 }));
    expect(subtractQuantities(b, a)).toEqual(quantity(1, { length: 1 }));
  });

  it("throws IncompatibleDimensionsError when dimensions differ -- never a silently wrong number", () => {
    const metres = quantity(2, { length: 1 });
    const seconds = quantity(3, { time: 1 });
    expect(() => addQuantities(metres, seconds)).toThrow(
      IncompatibleDimensionsError,
    );
    expect(() => subtractQuantities(metres, seconds)).toThrow(
      IncompatibleDimensionsError,
    );

    let caught: unknown;
    try {
      addQuantities(metres, seconds);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((caught as IncompatibleDimensionsError).operation).toBe("math:add");

    let subtractCaught: unknown;
    try {
      subtractQuantities(metres, seconds);
    } catch (error) {
      subtractCaught = error;
    }
    expect(subtractCaught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((subtractCaught as IncompatibleDimensionsError).operation).toBe(
      "math:subtract",
    );
  });
});

describe("multiplyQuantities / divideQuantities", () => {
  it("combines dimension vectors by adding/subtracting exponents", () => {
    const mass = quantity(2, { mass: 1 });
    const acceleration = quantity(3, { length: 1, time: -2 });
    // F = m * a
    expect(multiplyQuantities(mass, acceleration)).toEqual(
      quantity(6, { mass: 1, length: 1, time: -2 }),
    );

    const distance = quantity(10, { length: 1 });
    const time = quantity(2, { time: 1 });
    // speed = distance / time
    expect(divideQuantities(distance, time)).toEqual(
      quantity(5, { length: 1, time: -1 }),
    );
  });

  it("throws DivisionByZeroError on division by a zero magnitude, naming the operation and dividend", () => {
    expect(() => divideQuantities(quantity(5, {}), quantity(0, {}))).toThrow(
      DivisionByZeroError,
    );
    let caught: unknown;
    try {
      divideQuantities(quantity(5, {}), quantity(0, {}));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DivisionByZeroError);
    expect((caught as DivisionByZeroError).operation).toBe("math:divide");
    expect((caught as DivisionByZeroError).message).toBe(
      "'math:divide': division by zero (divisor magnitude is exactly zero (dividend magnitude 5)).",
    );
  });
});

describe("negateQuantity / absQuantity", () => {
  it("flips sign / takes magnitude without touching dimension", () => {
    expect(negateQuantity(quantity(4, { length: 1 }))).toEqual(
      quantity(-4, { length: 1 }),
    );
    expect(absQuantity(quantity(-4, { length: 1 }))).toEqual(
      quantity(4, { length: 1 }),
    );
  });
});

describe("powQuantity", () => {
  it("raises a dimensionless base to any real power", () => {
    expect(powQuantity(quantity(2, {}), quantity(3, {}))).toEqual(
      quantity(8, {}),
    );
  });

  it("raises a dimensionless base to a non-integer power without ever reaching the dimensioned-base integer check", () => {
    // exponent.magnitude = 0.5 is not an integer -- if the dimensionless-base early return (isDimensionless(base.dimension)) were skipped or its condition flipped, this would fall through to `!Number.isInteger(exponent.magnitude)` and wrongly throw IncompatibleDimensionsError instead of returning 2.
    expect(powQuantity(quantity(4, {}), quantity(0.5, {}))).toEqual(
      quantity(2, {}),
    );
  });

  it("raises a dimensioned base to an integer power, scaling every exponent", () => {
    expect(powQuantity(quantity(2, { length: 1 }), quantity(3, {}))).toEqual(
      quantity(8, { length: 3 }),
    );
  });

  it("rejects a dimensioned exponent, naming the operation and the required-dimensionless detail", () => {
    let caught: unknown;
    try {
      powQuantity(quantity(2, {}), quantity(2, { length: 1 }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((caught as IncompatibleDimensionsError).operation).toBe("math:pow");
    expect((caught as IncompatibleDimensionsError).message).toBe(
      "'math:pow' requires compatible dimensions, got length^1 and dimensionless (the exponent must be dimensionless).",
    );
  });

  it("rejects a dimensioned base raised to a non-integer power, naming the operation and the integer-power detail", () => {
    let caught: unknown;
    try {
      powQuantity(quantity(4, { length: 1 }), quantity(0.5, {}));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((caught as IncompatibleDimensionsError).operation).toBe("math:pow");
    expect((caught as IncompatibleDimensionsError).message).toBe(
      "'math:pow' requires compatible dimensions, got length^1 and dimensionless (a dimensioned base can only be raised to an integer power).",
    );
  });
});

describe("sqrtQuantity", () => {
  it("halves every exponent when they are all even", () => {
    expect(sqrtQuantity(quantity(4, { length: 2 }))).toEqual(
      quantity(2, { length: 1 }),
    );
  });

  it("accepts a zero magnitude rather than treating it as negative", () => {
    expect(sqrtQuantity(quantity(0, {}))).toEqual(quantity(0, {}));
  });

  it("rejects a dimension with an odd exponent, naming the operation and the even-exponent detail", () => {
    let caught: unknown;
    try {
      sqrtQuantity(quantity(4, { length: 1 }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((caught as IncompatibleDimensionsError).operation).toBe("math:sqrt");
    expect((caught as IncompatibleDimensionsError).message).toBe(
      "'math:sqrt' requires compatible dimensions, got length^1 and dimensionless (every exponent must be even for the dimension to have an exact square root).",
    );
  });

  it("rejects a negative magnitude, naming the operation and the actual magnitude", () => {
    let caught: unknown;
    try {
      sqrtQuantity(quantity(-1, {}));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NumericDomainError);
    expect((caught as NumericDomainError).operation).toBe("math:sqrt");
    expect((caught as NumericDomainError).message).toBe(
      "'math:sqrt': magnitude must be non-negative, got -1.",
    );
  });
});

describe("trigonometric quantities", () => {
  it("operate on a dimensionless (radian) argument and return dimensionless results", () => {
    expect(cosQuantity(quantity(0, {})).magnitude).toBeCloseTo(1, 12);
    expect(sinQuantity(quantity(0, {})).magnitude).toBeCloseTo(0, 12);
    expect(tanQuantity(quantity(0, {})).magnitude).toBeCloseTo(0, 12);
    expect(cosQuantity(quantity(0, {})).dimension).toEqual({});
  });

  it("reject a dimensioned argument, each naming its own operator", () => {
    let sinCaught: unknown;
    try {
      sinQuantity(quantity(1, { length: 1 }));
    } catch (error) {
      sinCaught = error;
    }
    expect(sinCaught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((sinCaught as IncompatibleDimensionsError).operation).toBe(
      "math:sin",
    );

    let cosCaught: unknown;
    try {
      cosQuantity(quantity(1, { length: 1 }));
    } catch (error) {
      cosCaught = error;
    }
    expect(cosCaught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((cosCaught as IncompatibleDimensionsError).operation).toBe(
      "math:cos",
    );

    let tanCaught: unknown;
    try {
      tanQuantity(quantity(1, { length: 1 }));
    } catch (error) {
      tanCaught = error;
    }
    expect(tanCaught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((tanCaught as IncompatibleDimensionsError).operation).toBe(
      "math:tan",
    );
    expect((tanCaught as IncompatibleDimensionsError).message).toBe(
      "'math:tan' requires compatible dimensions, got length^1 and dimensionless (trigonometric functions take a dimensionless (radian) argument).",
    );
  });
});
