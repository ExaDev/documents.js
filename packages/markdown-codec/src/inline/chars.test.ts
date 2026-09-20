// Direct unit tests for this module's own character-class predicates and codepoint helpers — link.ts and delimiter.ts only exercise these through whatever characters the round-trip suites' own markdown sources happen to contain, never at the exact boundaries (0x1f/0x20, 0x7e/0x7f, and every one of the four surrogate-pair range edges individually) that distinguish a correct comparison from an off-by-one one.

import { describe, expect, it } from "vitest";
import {
  codePointAt,
  codePointBefore,
  containsAsciiControlOrSpace,
  isAsciiControl,
  isMarkdownSpace,
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

describe("isMarkdownSpace", () => {
  it("recognises space, tab, line feed, and carriage return", () => {
    expect(isMarkdownSpace(" ")).toBe(true);
    expect(isMarkdownSpace("\t")).toBe(true);
    expect(isMarkdownSpace("\n")).toBe(true);
    expect(isMarkdownSpace("\r")).toBe(true);
  });

  it("does not recognise a non-breaking space or an ordinary letter", () => {
    expect(isMarkdownSpace(" ")).toBe(false);
    expect(isMarkdownSpace("a")).toBe(false);
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

  describe("low-surrogate range boundary (0xdc00-0xdfff)", () => {
    it("treats 0xdc00 (the lower bound) as a low surrogate", () => {
      const low = String.fromCharCode(0xdc00);
      const text = String.fromCharCode(0xd800) + low;
      expect(codePointBefore(text, 2)).toBe(text);
    });

    it("does not treat 0xdbff (one below the lower bound) as a low surrogate", () => {
      const notLow = String.fromCharCode(0xdbff);
      const text = String.fromCharCode(0xd800) + notLow;
      expect(codePointBefore(text, 2)).toBe(notLow);
    });

    it("treats 0xdfff (the upper bound) as a low surrogate", () => {
      const low = String.fromCharCode(0xdfff);
      const text = String.fromCharCode(0xd800) + low;
      expect(codePointBefore(text, 2)).toBe(text);
    });

    it("does not treat 0xe000 (one above the upper bound) as a low surrogate", () => {
      const notLow = String.fromCharCode(0xe000);
      const text = String.fromCharCode(0xd800) + notLow;
      expect(codePointBefore(text, 2)).toBe(notLow);
    });
  });

  describe("high-surrogate range boundary (0xd800-0xdbff)", () => {
    it("treats 0xd800 (the lower bound) as a valid high surrogate", () => {
      const high = String.fromCharCode(0xd800);
      const low = String.fromCharCode(0xdc00);
      expect(codePointBefore(high + low, 2)).toBe(high + low);
    });

    it("does not treat 0xd7ff (one below the lower bound) as a valid high surrogate", () => {
      const notHigh = String.fromCharCode(0xd7ff);
      const low = String.fromCharCode(0xdc00);
      expect(codePointBefore(notHigh + low, 2)).toBe(low);
    });

    it("treats 0xdbff (the upper bound) as a valid high surrogate", () => {
      const high = String.fromCharCode(0xdbff);
      const low = String.fromCharCode(0xdc00);
      expect(codePointBefore(high + low, 2)).toBe(high + low);
    });

    it("does not treat 0xdc00 (one above the upper bound) as a valid high surrogate", () => {
      const notHigh = String.fromCharCode(0xdc00);
      const low = String.fromCharCode(0xdc00);
      expect(codePointBefore(notHigh + low, 2)).toBe(low);
    });
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
