import { describe, expect, it } from "vitest";
import { IntervalSchema } from "document-schema.js";
import { IncompatibleDimensionsError, DivisionByZeroError } from "./errors";
import {
  absInterval,
  addIntervals,
  divideIntervals,
  interval,
  multiplyIntervals,
  negateInterval,
  pointInterval,
  subtractIntervals,
} from "./interval";

describe("interval constructor and schema", () => {
  it("accepts min <= max and rejects min > max", () => {
    expect(() => interval(1, 2)).not.toThrow();
    expect(() => interval(2, 1)).toThrow(RangeError);
    expect(() => interval(2, 1)).toThrow(
      "interval: min (2) must not exceed max (1)",
    );
    expect(
      IntervalSchema.safeParse({
        kind: "interval",
        min: 1,
        max: 2,
        dimension: {},
      }).success,
    ).toBe(true);
    expect(
      IntervalSchema.safeParse({
        kind: "interval",
        min: 2,
        max: 1,
        dimension: {},
      }).success,
    ).toBe(false);
  });

  it("promotes a point value to a degenerate interval", () => {
    const POINT_VALUE = 3;
    expect(pointInterval(POINT_VALUE, { length: 1 })).toEqual(
      interval(POINT_VALUE, POINT_VALUE, { length: 1 }),
    );
  });
});

describe("addIntervals / subtractIntervals", () => {
  it("adds bounds elementwise, representing a compliance region like 0.87 <= cos(phi) <= 1", () => {
    const COS_PHI_MIN = 0.87;
    const OFFSET = 0.1;
    const cosPhi = interval(COS_PHI_MIN, 1, {});
    const offset = interval(OFFSET, OFFSET, {}); // a point interval mixed with a real one
    expect(addIntervals(cosPhi, offset)).toEqual(
      interval(COS_PHI_MIN + OFFSET, 1 + OFFSET, {}),
    );
  });

  it("subtracts by combining the widest possible spread of endpoints", () => {
    const A_MAX = 5;
    expect(subtractIntervals(interval(1, A_MAX), interval(1, 2))).toEqual(
      interval(-1, A_MAX - 1, {}),
    );
  });

  it("throws IncompatibleDimensionsError on a dimension mismatch, naming its own operation", () => {
    let addCaught: unknown;
    try {
      addIntervals(interval(1, 2, { length: 1 }), interval(1, 2, { time: 1 }));
    } catch (error) {
      addCaught = error;
    }
    expect(addCaught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((addCaught as IncompatibleDimensionsError).operation).toBe(
      "math:add",
    );

    let subtractCaught: unknown;
    try {
      subtractIntervals(
        interval(1, 2, { length: 1 }),
        interval(1, 2, { time: 1 }),
      );
    } catch (error) {
      subtractCaught = error;
    }
    expect(subtractCaught).toBeInstanceOf(IncompatibleDimensionsError);
    expect((subtractCaught as IncompatibleDimensionsError).operation).toBe(
      "math:subtract",
    );
  });
});

describe("multiplyIntervals — sign-case coverage", () => {
  it("multiplies two positive intervals (corners at both maxima)", () => {
    const X_MAX = 3;
    const Y_MIN = 4;
    const Y_MAX = 5;
    expect(
      multiplyIntervals(interval(2, X_MAX), interval(Y_MIN, Y_MAX)),
    ).toEqual(interval(2 * Y_MIN, X_MAX * Y_MAX, {}));
  });

  it("multiplies two negative intervals (corners at both minima, in magnitude)", () => {
    const X_MIN = -4;
    const X_MAX = -2;
    const Y_MIN = -3;
    expect(
      multiplyIntervals(interval(X_MIN, X_MAX), interval(Y_MIN, -1)),
    ).toEqual(interval(X_MAX * -1, X_MIN * Y_MIN, {}));
  });

  it("multiplies a straddling interval by a straddling interval — the sign-flip case", () => {
    const X_MIN = -2;
    const X_MAX = 3;
    const Y_MAX = 4;
    // x in [-2, 3], y in [-1, 4]: extremes are x=-2,y=4 (-8) and x=3,y=4 (12).
    expect(
      multiplyIntervals(interval(X_MIN, X_MAX), interval(-1, Y_MAX)),
    ).toEqual(interval(X_MIN * Y_MAX, X_MAX * Y_MAX, {}));
  });

  it("multiplies a straddling interval by a strictly positive interval", () => {
    const X_MIN = -2;
    const X_MAX = 3;
    const Y_MAX = 4;
    expect(
      multiplyIntervals(interval(X_MIN, X_MAX), interval(2, Y_MAX)),
    ).toEqual(interval(X_MIN * Y_MAX, X_MAX * Y_MAX, {}));
  });

  it("combines dimensions by adding exponents, same as multiplyQuantities", () => {
    const INVERSE_TIME_MAX = 3;
    const distance = interval(1, 2, { length: 1 });
    const inverseTime = interval(2, INVERSE_TIME_MAX, { time: -1 });
    expect(multiplyIntervals(distance, inverseTime).dimension).toEqual({
      length: 1,
      time: -1,
    });
  });
});

// Decimal places toBeCloseTo checks divided-interval bounds to below, since the division itself is exact floating point but the constants above involve a repeating fraction.
const CLOSE_TO_PRECISION = 12;

describe("divideIntervals", () => {
  it("divides two positive intervals", () => {
    const X_MIN = 4;
    const X_MAX = 6;
    const Y_MAX = 3;
    // x in [4,6], y in [2,3]: extremes are 4/3 and 6/2=3.
    const result = divideIntervals(interval(X_MIN, X_MAX), interval(2, Y_MAX));
    expect(result.min).toBeCloseTo(X_MIN / Y_MAX, CLOSE_TO_PRECISION);
    expect(result.max).toBeCloseTo(X_MAX / 2, CLOSE_TO_PRECISION);
  });

  it("divides by a strictly negative interval (the reciprocal sign-flip case)", () => {
    const X_MIN = 4;
    const X_MAX = 6;
    const Y_MIN = -3;
    const Y_MAX = -2;
    // x in [4,6], y in [-3,-2]: x/y ranges from 6/-2=-3 (max magnitude denominator, smallest divisor -> most negative... ) to 4/-3.
    const result = divideIntervals(
      interval(X_MIN, X_MAX),
      interval(Y_MIN, Y_MAX),
    );
    expect(result.min).toBeCloseTo(X_MAX / Y_MAX, CLOSE_TO_PRECISION);
    expect(result.max).toBeCloseTo(X_MIN / Y_MIN, CLOSE_TO_PRECISION);
  });

  it("throws DivisionByZeroError when the divisor interval contains zero, naming the operation and the exact divisor bounds", () => {
    expect(() => divideIntervals(interval(1, 2), interval(-1, 1))).toThrow(
      DivisionByZeroError,
    );
    expect(() => divideIntervals(interval(1, 2), interval(0, 1))).toThrow(
      DivisionByZeroError,
    );
    // A divisor that only touches zero at its own upper bound (max === 0, not min) — distinguishes b.max >= 0 from a mutated b.max > 0, which would wrongly let this divisor through undetected.
    const TOUCHES_ZERO_MIN = -2;
    expect(() =>
      divideIntervals(interval(1, 2), interval(TOUCHES_ZERO_MIN, 0)),
    ).toThrow(DivisionByZeroError);

    let caught: unknown;
    try {
      divideIntervals(interval(1, 2), interval(-1, 1));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DivisionByZeroError);
    expect((caught as DivisionByZeroError).operation).toBe("math:divide");
    expect((caught as DivisionByZeroError).message).toBe(
      "'math:divide': division by zero (divisor interval [-1, 1] contains zero).",
    );
  });
});

describe("negateInterval / absInterval", () => {
  it("negates by flipping and swapping the bounds", () => {
    const MAX = 3;
    expect(negateInterval(interval(1, MAX))).toEqual(interval(-MAX, -1, {}));
  });

  it("takes abs correctly whether the interval is positive, negative, or straddling", () => {
    const POSITIVE_MAX = 3;
    const NEGATIVE_MIN = -5;
    const NEGATIVE_MAX = -2;
    const STRADDLING_MIN = -3;
    expect(absInterval(interval(1, POSITIVE_MAX))).toEqual(
      interval(1, POSITIVE_MAX, {}),
    );
    expect(absInterval(interval(NEGATIVE_MIN, NEGATIVE_MAX))).toEqual(
      interval(-NEGATIVE_MAX, -NEGATIVE_MIN, {}),
    );
    expect(absInterval(interval(STRADDLING_MIN, 2))).toEqual(
      interval(0, -STRADDLING_MIN, {}),
    );
  });
});
