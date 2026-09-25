import { describe, expect, it } from "vitest";
import { skipExpression, takeExpression } from "./expression";

describe("skipExpression", () => {
  it("stops at the first unnested occurrence of endChar", () => {
    const text = "abc,def";
    expect(skipExpression(text, 0, ",")).toBe(text.indexOf(","));
  });

  it("runs to the end of the string when endChar never occurs", () => {
    const text = "abcdef";
    expect(skipExpression(text, 0, ",")).toBe(text.length);
  });

  it("a comma or paren INSIDE a nested (...) is not the end", () => {
    const text = "(a,b),c";
    expect(skipExpression(text, 0, ",")).toBe(text.indexOf(")") + 1);
  });

  it("a brace nests exactly like a paren, and does not itself end the expression", () => {
    const text = "{a,b},c";
    expect(skipExpression(text, 0, ",")).toBe(text.indexOf("}") + 1);
  });

  it("braces and parens can nest inside each other", () => {
    const text = "(a{b,c}d),e";
    expect(skipExpression(text, 0, ",")).toBe(text.indexOf(")") + 1);
  });

  it("advances past an empty brace pair correctly, not merely re-consuming already-processed content that happens to reach the same answer", () => {
    // An immediately-closing "{}" isolates the brace branch's own trailing +1 from the recursive call's return value: rewinding by 2 instead (the mutation this pins) resets index to the opening "{" itself, causing skipExpression to re-open the identical brace pair forever.
    const text = "{},c";
    expect(skipExpression(text, 0, ",")).toBe(text.indexOf("}") + 1);
  });

  it("a comma inside a double-quoted string is not the end", () => {
    const text = '"a,b",c';
    expect(skipExpression(text, 0, ",")).toBe(text.indexOf('"', 1) + 1);
  });

  it("a comma inside a single-quoted string is not the end", () => {
    const text = "'a,b',c";
    expect(skipExpression(text, 0, ",")).toBe(text.indexOf("'", 1) + 1);
  });

  it("an unterminated quoted string runs to the end of the text", () => {
    const text = '"unterminated';
    expect(skipExpression(text, 0, ",")).toBe(text.length);
  });

  it("starts scanning exactly at the given start index, not from 0", () => {
    const text = "xx,abc,def";
    const startIndex = 3;
    expect(skipExpression(text, startIndex, ",")).toBe(
      text.indexOf(",", startIndex + 1),
    );
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
