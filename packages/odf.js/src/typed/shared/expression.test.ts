import { describe, expect, it } from "vitest";
import { skipExpression, takeExpression } from "./expression";

describe("skipExpression", () => {
  it("stops at the first unnested occurrence of endChar", () => {
    expect(skipExpression("abc,def", 0, ",")).toBe(3);
  });

  it("runs to the end of the string when endChar never occurs", () => {
    expect(skipExpression("abcdef", 0, ",")).toBe(6);
  });

  it("a comma or paren INSIDE a nested (...) is not the end", () => {
    expect(skipExpression("(a,b),c", 0, ",")).toBe(5);
  });

  it("a brace nests exactly like a paren, and does not itself end the expression", () => {
    expect(skipExpression("{a,b},c", 0, ",")).toBe(5);
  });

  it("braces and parens can nest inside each other", () => {
    expect(skipExpression("(a{b,c}d),e", 0, ",")).toBe(9);
  });

  it("a comma inside a double-quoted string is not the end", () => {
    expect(skipExpression('"a,b",c', 0, ",")).toBe(5);
  });

  it("a comma inside a single-quoted string is not the end", () => {
    expect(skipExpression("'a,b',c", 0, ",")).toBe(5);
  });

  it("an unterminated quoted string runs to the end of the text", () => {
    expect(skipExpression('"unterminated', 0, ",")).toBe(13);
  });

  it("starts scanning exactly at the given start index, not from 0", () => {
    expect(skipExpression("xx,abc,def", 3, ",")).toBe(6);
  });
});

describe("takeExpression", () => {
  it("extracts and trims the expression up to endChar, advancing past it", () => {
    expect(takeExpression(" abc ,rest", 0, ",")).toEqual({
      value: "abc",
      nextIndex: 6,
    });
  });

  it("an empty expression (nothing but whitespace) yields undefined, never an empty string", () => {
    expect(takeExpression("   ,rest", 0, ",")).toEqual({
      value: undefined,
      nextIndex: 4,
    });
  });

  it("a genuinely empty span (no characters at all before endChar) yields undefined", () => {
    expect(takeExpression(",rest", 0, ",")).toEqual({
      value: undefined,
      nextIndex: 1,
    });
  });

  it("a non-empty, already-trimmed expression is returned exactly", () => {
    expect(takeExpression("abc)", 0, ")")).toEqual({
      value: "abc",
      nextIndex: 4,
    });
  });
});
