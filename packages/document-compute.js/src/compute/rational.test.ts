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

  it("divides by a rational whose own numerator is not 1, distinguishing the cross-multiplication from a same-result division", () => {
    // (1/2) / (3/4) = 4/6 = 2/3 -- the divisor's numerator (3) is not 1, so a*d/(b*n) and a*d*(b*n) (or a*d/(b*n) with integer BigInt division instead of the correct cross-multiply) would disagree here, unlike the "divides exactly" case above where the divisor's numerator is 1 and every wrong formula happens to coincide with the right one.
    const result = divideRational(
      toRational({ numerator: "1", denominator: "2" }),
      toRational({ numerator: "3", denominator: "4" }),
    );
    expect(toExactRational(result)).toEqual({
      numerator: "2",
      denominator: "3",
    });
  });

  it("throws on division by zero with its own specific message, before reduce's own zero-denominator guard could ever produce a different one", () => {
    expect(() =>
      divideRational(
        toRational({ numerator: "1", denominator: "2" }),
        toRational({ numerator: "0", denominator: "1" }),
      ),
    ).toThrow("rational.ts: division by zero");
  });

  it("throws when a supplied Rational carries a zero denominator, even though toRational's own callers never construct one", () => {
    // Rational is a plain interface, not a validated type -- reduce()'s own d === 0n guard is the only thing standing between a directly-constructed zero-denominator Rational and a silent BigInt division-by-zero further down. Exercised here via addRational since reduce itself is not exported.
    expect(() => addRational({ n: 1n, d: 0n }, { n: 1n, d: 1n })).toThrow(
      RangeError,
    );
    expect(() => addRational({ n: 1n, d: 0n }, { n: 1n, d: 1n })).toThrow(
      "rational.ts: denominator must not be zero",
    );
  });

  it("reduces a zero numerator to the canonical 0/1 through the same general path as any other value, for either sign of denominator", () => {
    expect(toExactRational({ n: 0n, d: 5n })).toEqual({
      numerator: "0",
      denominator: "1",
    });
    expect(toExactRational({ n: 0n, d: -5n })).toEqual({
      numerator: "0",
      denominator: "1",
    });
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
