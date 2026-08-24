import { describe, expect, it } from "vitest";
import {
  dimensionsEqual,
  dimensionToString,
  divideDimensions,
  isDimensionless,
  multiplyDimensions,
  scaleDimension,
} from "./dimensions";

describe("dimensions", () => {
  it("treats an omitted exponent and an explicit zero exponent as equal", () => {
    expect(dimensionsEqual({ length: 1 }, { length: 1, time: 0 })).toBe(true);
    expect(dimensionsEqual({}, { length: 0, mass: 0 })).toBe(true);
  });

  it("detects incompatible dimensions", () => {
    expect(dimensionsEqual({ length: 1 }, { time: 1 })).toBe(false);
    expect(dimensionsEqual({ length: 1 }, { length: 2 })).toBe(false);
  });

  it("recognises dimensionless vectors", () => {
    expect(isDimensionless({})).toBe(true);
    expect(isDimensionless({ length: 0 })).toBe(true);
    expect(isDimensionless({ length: 1 })).toBe(false);
  });

  it("multiplies dimensions by adding exponents", () => {
    expect(multiplyDimensions({ length: 1 }, { length: 1 })).toEqual({
      length: 2,
    });
    expect(multiplyDimensions({ length: 1 }, { time: -1 })).toEqual({
      length: 1,
      time: -1,
    });
    // Exponents that cancel to zero drop out of the result rather than being carried as explicit zeros.
    expect(multiplyDimensions({ length: 1 }, { length: -1 })).toEqual({});
  });

  it("divides dimensions by subtracting exponents (speed = length / time)", () => {
    expect(divideDimensions({ length: 1 }, { time: 1 })).toEqual({
      length: 1,
      time: -1,
    });
  });

  it("scales every exponent for pow/sqrt", () => {
    expect(scaleDimension({ length: 2, mass: 4 }, 0.5)).toEqual({
      length: 1,
      mass: 2,
    });
    expect(scaleDimension({ length: 1 }, 3)).toEqual({ length: 3 });
  });

  it("throws when scaling would not land on an integer exponent", () => {
    // length^1 has no square root dimension: 1 * 0.5 = 0.5 is not representable.
    expect(() => scaleDimension({ length: 1 }, 0.5)).toThrow(RangeError);
  });

  it("renders a human-readable dimension string in SI base order", () => {
    expect(dimensionToString({})).toBe("dimensionless");
    expect(dimensionToString({ length: 1, time: -1 })).toBe("length^1·time^-1");
    // mass (a lower SI_BASE_DIMENSIONS index than time) renders before time regardless of insertion order in the input object.
    expect(dimensionToString({ time: -2, mass: 1 })).toBe("mass^1·time^-2");
  });
});
