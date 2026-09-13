import { describe, expect, it } from "vitest";
import {
  parseNonNegativeIntField,
  parseNumberField,
  parsePositiveIntField,
  truncatePreview,
} from "./text";

describe("truncatePreview", () => {
  it("returns short text unchanged", () => {
    expect(truncatePreview("hello", 10)).toBe("hello");
  });

  it("collapses internal whitespace runs (newlines, tabs) to a single space", () => {
    expect(truncatePreview("a\n\tb   c", 20)).toBe("a b c");
  });

  it("trims leading and trailing whitespace", () => {
    expect(truncatePreview("  hello  ", 20)).toBe("hello");
  });

  it("returns the literal '(empty)' marker for text that collapses to nothing", () => {
    expect(truncatePreview("   \n\t  ", 10)).toBe("(empty)");
    expect(truncatePreview("", 10)).toBe("(empty)");
  });

  it("truncates text longer than maxLength, appending an ellipsis", () => {
    expect(truncatePreview("abcdefghij", 5)).toBe("abcd…");
  });

  it("does not truncate text exactly at maxLength", () => {
    expect(truncatePreview("abcde", 5)).toBe("abcde");
  });

  it("never produces a negative slice length even for a maxLength of 0", () => {
    expect(truncatePreview("abcdef", 0)).toBe("…");
  });
});

describe("parsePositiveIntField", () => {
  it("parses a positive integer string", () => {
    expect(parsePositiveIntField("3", 1)).toBe(3);
  });

  it("falls back for zero", () => {
    expect(parsePositiveIntField("0", 7)).toBe(7);
  });

  it("falls back for a negative number", () => {
    expect(parsePositiveIntField("-1", 7)).toBe(7);
  });

  it("falls back for a non-numeric string", () => {
    expect(parsePositiveIntField("abc", 7)).toBe(7);
  });

  it("falls back for an empty string", () => {
    expect(parsePositiveIntField("", 7)).toBe(7);
  });

  it("parses the integer part of a decimal string via parseInt truncation", () => {
    expect(parsePositiveIntField("3.9", 1)).toBe(3);
  });
});

describe("parseNonNegativeIntField", () => {
  it("parses a positive integer string", () => {
    expect(parseNonNegativeIntField("3", 1)).toBe(3);
  });

  it("accepts zero, unlike parsePositiveIntField", () => {
    expect(parseNonNegativeIntField("0", 7)).toBe(0);
  });

  it("falls back for a negative number", () => {
    expect(parseNonNegativeIntField("-1", 7)).toBe(7);
  });

  it("falls back for a non-numeric string", () => {
    expect(parseNonNegativeIntField("abc", 7)).toBe(7);
  });
});

describe("parseNumberField", () => {
  it("parses a positive float", () => {
    expect(parseNumberField("3.5", 1)).toBe(3.5);
  });

  it("accepts zero", () => {
    expect(parseNumberField("0", 1)).toBe(0);
  });

  it("accepts a negative number", () => {
    expect(parseNumberField("-2.5", 1)).toBe(-2.5);
  });

  it("falls back for a non-numeric string", () => {
    expect(parseNumberField("abc", 1)).toBe(1);
  });

  it("falls back for a non-finite value", () => {
    expect(parseNumberField("Infinity", 1)).toBe(1);
  });
});
