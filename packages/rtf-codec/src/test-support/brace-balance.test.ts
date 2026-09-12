import { describe, expect, it } from "vitest";
import { expectBalancedBraces } from "./brace-balance";

describe("expectBalancedBraces", () => {
  it("passes for an empty string", () => {
    expectBalancedBraces("");
  });

  it("passes for balanced nested groups", () => {
    expectBalancedBraces("{\\rtf1{\\b bold}{\\i italic}}");
  });

  it("fails for an unclosed group", () => {
    expect(() => {
      expectBalancedBraces("{\\rtf1{\\b bold}");
    }).toThrow();
  });

  it("fails for a close with no matching open", () => {
    expect(() => {
      expectBalancedBraces("{\\rtf1}}");
    }).toThrow();
  });

  it("does not count an escaped brace as a real delimiter", () => {
    // \{ and \} are RTF's own literal-brace escapes -- a real \{...\} pair here would be miscounted as a genuine unbalanced group if the escape weren't recognized.
    expectBalancedBraces("{\\rtf1 \\{not a group\\}}");
  });

  it("does not treat the brace following an escaped backslash as escaped", () => {
    // \\{ is an escaped backslash (\\) followed by a REAL opening brace, not an escaped brace -- the two-character escape must consume exactly \\ and stop there, not swallow the { that follows it too.
    expect(() => {
      expectBalancedBraces("{\\rtf1 \\\\{unclosed");
    }).toThrow();
    expectBalancedBraces("{\\rtf1 \\\\{closed}}");
  });

  it("treats a lone trailing backslash with nothing after it as consuming only itself", () => {
    // The string ends right after the backslash -- rtf[index + 1] is genuinely undefined, not one of the three escape characters, so the backslash must be consumed alone (index += 1) rather than the reader assuming a two-character escape it can't actually see.
    expectBalancedBraces("{\\rtf1 text}\\");
  });

  it("does not miscount a brace immediately after an unrelated control word backslash", () => {
    // \b is not one of the two-character escapes (\\, \{, \}), so the backslash and the b are each consumed on their own, and the { that follows is a real group delimiter.
    expect(() => {
      expectBalancedBraces("\\b{");
    }).toThrow();
    expectBalancedBraces("\\b{}");
  });
});
