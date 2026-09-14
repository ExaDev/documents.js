import { describe, expect, it } from "vitest";
import { decimalToRational, reduceRational } from "./rational";

describe("decimalToRational", () => {
  it("reduces a fractional literal to its lowest-terms rational", () => {
    expect(decimalToRational("3.14")).toEqual({
      numerator: "157",
      denominator: "50",
    });
  });

  it("treats a bare integer literal as an exact whole-number rational", () => {
    expect(decimalToRational("42")).toEqual({
      numerator: "42",
      denominator: "1",
    });
  });

  it("reduces a zero-valued literal to the schema's 0/1 convention regardless of trailing zeros", () => {
    expect(decimalToRational("0.00")).toEqual({
      numerator: "0",
      denominator: "1",
    });
  });

  it("returns undefined for a literal with two decimal points", () => {
    expect(decimalToRational("3.1.4")).toBeUndefined();
  });

  it("returns undefined for a literal containing non-digit characters", () => {
    expect(decimalToRational("12a")).toBeUndefined();
  });

  it("returns undefined for an empty literal", () => {
    expect(decimalToRational("")).toBeUndefined();
  });

  it("returns undefined for a literal with a leading sign, even though its trailing characters are digits", () => {
    expect(decimalToRational("-5")).toBeUndefined();
  });
});

describe("reduceRational", () => {
  it("divides both terms by their greatest common divisor", () => {
    expect(reduceRational(6n, 3n)).toEqual({
      numerator: "2",
      denominator: "1",
    });
  });

  it("leaves an already-reduced pair unchanged", () => {
    expect(reduceRational(7n, 5n)).toEqual({
      numerator: "7",
      denominator: "5",
    });
  });

  it("reduces a zero numerator against gcd(0, denominator) == denominator, landing on 0/1", () => {
    expect(reduceRational(0n, 9n)).toEqual({
      numerator: "0",
      denominator: "1",
    });
  });

  it("treats gcd(0, 0) as 1 rather than dividing by zero for a 0/0-shaped input", () => {
    expect(() => reduceRational(0n, 0n)).not.toThrow();
    expect(reduceRational(0n, 0n)).toEqual({
      numerator: "0",
      denominator: "0",
    });
  });
});
