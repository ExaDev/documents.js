// Direct unit tests for this module's own character-class predicates and codepoint helpers -- link.ts and delimiter.ts only exercise these through whatever characters the round-trip suites' own markdown sources happen to contain, never at the exact boundaries (0x1f/0x20, 0x7e/0x7f, the surrogate-pair range edges) that distinguish a correct comparison from an off-by-one one.

import { describe, expect, it } from "vitest";
import {
  codePointAt,
  codePointBefore,
  containsAsciiControlOrSpace,
  isAsciiControl,
} from "./chars";

describe("isAsciiControl", () => {
  it("returns false for an empty string, where codePointAt(0) is undefined", () => {
    expect(isAsciiControl("")).toBe(false);
  });

  it("treats 0x1f (unit separator) as control, but not 0x20 (space) immediately past it", () => {
    expect(isAsciiControl("")).toBe(true);
    expect(isAsciiControl(" ")).toBe(false);
  });

  it("treats 0x7f (DEL) as control, but not 0x7e (~) immediately before it", () => {
    expect(isAsciiControl("")).toBe(true);
    expect(isAsciiControl("~")).toBe(false);
  });

  it("does not treat a byte past 0x7f as control", () => {
    expect(isAsciiControl("")).toBe(false);
  });
});

describe("containsAsciiControlOrSpace", () => {
  it("is false for an empty string", () => {
    expect(containsAsciiControlOrSpace("")).toBe(false);
  });

  it("is false for text with no control character and no space", () => {
    expect(containsAsciiControlOrSpace("abc")).toBe(false);
  });

  it("is true for text containing a control character", () => {
    expect(containsAsciiControlOrSpace("ab")).toBe(true);
  });

  it("is true for text containing a space", () => {
    expect(containsAsciiControlOrSpace("a b")).toBe(true);
  });
});

describe("codePointBefore", () => {
  it("returns a bare newline at the very start of the string", () => {
    expect(codePointBefore("abc", 0)).toBe("\n");
  });

  it("returns the single preceding character when it is not a low surrogate", () => {
    expect(codePointBefore("ab", 2)).toBe("b");
  });

  it("returns the single preceding character at index 1, too early for a surrogate pair to fit before it", () => {
    expect(codePointBefore("a😀", 1)).toBe("a");
  });

  it("returns the full surrogate pair when a genuine astral character precedes the index", () => {
    // U+1F600 (grinning face) is the high/low surrogate pair 😀.
    expect(codePointBefore("a😀", 3)).toBe("😀");
  });

  it("returns only the low surrogate when it is not preceded by a valid high surrogate", () => {
    // \uDE00 alone (a lone low surrogate, no high surrogate before it) is not a real pair.
    expect(codePointBefore("a\uDE00", 2)).toBe("\uDE00");
  });
});

describe("codePointAt", () => {
  it("returns a bare newline at or past the end of the string", () => {
    expect(codePointAt("abc", 3)).toBe("\n");
    expect(codePointAt("abc", 4)).toBe("\n");
  });

  it("returns the single character at a normal index", () => {
    expect(codePointAt("abc", 1)).toBe("b");
  });

  it("returns the full surrogate pair for an astral character", () => {
    expect(codePointAt("😀b", 0)).toBe("😀");
  });
});
