import { describe, expect, it } from "vitest";
import {
  addRational,
  divideRational,
  multiplyRational,
  rationalToNumber,
  subtractRational,
  toExactRational,
  toRational,
} from "./rational";

describe("rational", () => {
  it("round-trips document-schema.js ExactRational values through toRational/toExactRational", () => {
    expect(toRational({ numerator: "3", denominator: "4" })).toEqual({
      n: 3n,
      d: 4n,
    });
    expect(toExactRational({ n: 3n, d: 4n })).toEqual({
      numerator: "3",
      denominator: "4",
    });
  });

  it("adds exactly", () => {
    // 1/2 + 1/3 = 5/6
    const result = addRational(
      toRational({ numerator: "1", denominator: "2" }),
      toRational({ numerator: "1", denominator: "3" }),
    );
    expect(toExactRational(result)).toEqual({
      numerator: "5",
      denominator: "6",
    });
  });

  it("subtracts exactly", () => {
    // 1/2 - 1/3 = 1/6
    const result = subtractRational(
      toRational({ numerator: "1", denominator: "2" }),
      toRational({ numerator: "1", denominator: "3" }),
    );
    expect(toExactRational(result)).toEqual({
      numerator: "1",
      denominator: "6",
    });
  });

  it("multiplies exactly and reduces to lowest terms", () => {
    // 2/3 * 3/4 = 6/12 = 1/2
    const result = multiplyRational(
      toRational({ numerator: "2", denominator: "3" }),
      toRational({ numerator: "3", denominator: "4" }),
    );
    expect(toExactRational(result)).toEqual({
      numerator: "1",
      denominator: "2",
    });
  });

  it("divides exactly", () => {
    // (1/2) / (1/4) = 2
    const result = divideRational(
      toRational({ numerator: "1", denominator: "2" }),
      toRational({ numerator: "1", denominator: "4" }),
    );
    expect(toExactRational(result)).toEqual({
      numerator: "2",
      denominator: "1",
    });
  });

  it("throws on division by zero", () => {
    expect(() =>
      divideRational(
        toRational({ numerator: "1", denominator: "2" }),
        toRational({ numerator: "0", denominator: "1" }),
      ),
    ).toThrow(RangeError);
  });

  it("canonicalises negative and zero values to document-schema.js's exact spelling", () => {
    // -2/4 reduces to -1/2: sign on the numerator, no leading zeros, denominator strictly positive.
    expect(toExactRational({ n: -2n, d: 4n })).toEqual({
      numerator: "-1",
      denominator: "2",
    });
    // A negative denominator's sign migrates to the numerator.
    expect(toExactRational({ n: 1n, d: -2n })).toEqual({
      numerator: "-1",
      denominator: "2",
    });
    // Zero has one canonical spelling regardless of which denominator produced it.
    expect(toExactRational({ n: 0n, d: 7n })).toEqual({
      numerator: "0",
      denominator: "1",
    });
  });

  it("performs a long conversion chain without floating-point drift, by staying exact until the final conversion", () => {
    // Multiplying 1/3 by itself 10 times and back down by 3^10 should return exactly to 1/3 -- bit-exact, not merely close -- because every step stays in BigInt rationals until rationalToNumber's single controlled float conversion at the end.
    let value = toRational({ numerator: "1", denominator: "3" });
    for (let i = 0; i < 10; i += 1) {
      value = multiplyRational(
        value,
        toRational({ numerator: "1", denominator: "3" }),
      );
    }
    for (let i = 0; i < 10; i += 1) {
      value = multiplyRational(
        value,
        toRational({ numerator: "3", denominator: "1" }),
      );
    }
    expect(toExactRational(value)).toEqual({
      numerator: "1",
      denominator: "3",
    });
    expect(rationalToNumber(value)).toBe(1 / 3);
  });

  it("converts to a JS number at the one controlled boundary", () => {
    expect(
      rationalToNumber(toRational({ numerator: "1", denominator: "2" })),
    ).toBe(0.5);
    expect(
      rationalToNumber(toRational({ numerator: "0", denominator: "1" })),
    ).toBe(0);
  });
});
