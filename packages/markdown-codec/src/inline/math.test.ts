import { describe, expect, it } from "vitest";
import { matchMathInlineSpan } from "./math";

describe("matchMathInlineSpan", () => {
  it("matches a real \\(...\\) span, delimiters included", () => {
    expect(matchMathInlineSpan("\\(x^2\\)", 0)).toBe("\\(x^2\\)");
  });

  it("returns undefined for a bare '\\(' with no closing '\\)' anywhere", () => {
    expect(matchMathInlineSpan("\\(unterminated", 0)).toBeUndefined();
  });

  it("returns undefined when the char at index is not a backslash, even with a literal '(' immediately after and a '\\)' reachable later", () => {
    // A=charAt(index)!=='\\' is true, B=charAt(index+1)!=='(' is false -- neither guard clause alone should let the scan fall through to a bogus match against the trailing '\)'.
    expect(matchMathInlineSpan("x(later\\)", 0)).toBeUndefined();
  });

  it("returns undefined for a backslash not followed by '(', even with a '\\)' reachable later", () => {
    // A=charAt(index)!=='\\' is false, B=charAt(index+1)!=='(' is true.
    expect(matchMathInlineSpan("\\xlater\\)", 0)).toBeUndefined();
  });

  it("searches for the closing '\\)' starting strictly after the opening '\\(', never before it", () => {
    // A bogus "\)" sits just before the real "\(x\)" span; searching backwards from the opener (an off-by-arithmetic-sign bug) would match that bogus pair instead of the real close two characters further in.
    const text = "abc\\)\\(x\\)";
    const openerIndex = text.indexOf("\\(");
    expect(matchMathInlineSpan(text, openerIndex)).toBe("\\(x\\)");
  });
});
