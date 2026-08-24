import { decodeEntities } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { encodeXmlText, needsSpacePreserve } from "./entities";

describe("encodeXmlText", () => {
  it("is the exact inverse of ooxml.js decodeEntities", () => {
    for (const value of [
      "Tom & Jerry",
      "<tag>",
      "a \"quoted\" 'word'",
      "plain text",
      "",
    ]) {
      expect(decodeEntities(encodeXmlText(value))).toBe(value);
    }
  });

  it("escapes all five predefined XML entities", () => {
    expect(encodeXmlText(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("escapes & first so it never double-escapes entities introduced by the other replacements", () => {
    expect(encodeXmlText("<")).toBe("&lt;");
  });
});

describe("needsSpacePreserve", () => {
  it("is true for leading or trailing whitespace", () => {
    expect(needsSpacePreserve(" leading")).toBe(true);
    expect(needsSpacePreserve("trailing ")).toBe(true);
    expect(needsSpacePreserve("\ttab")).toBe(true);
  });

  it("is false for text with no leading or trailing whitespace", () => {
    expect(needsSpacePreserve("no whitespace at the edges")).toBe(false);
    expect(needsSpacePreserve("")).toBe(false);
  });
});
