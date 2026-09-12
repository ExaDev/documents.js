import { describe, expect, it } from "vitest";
import { matchEntity, unescapeString } from "./entity";

describe("matchEntity numeric references", () => {
  it("decodes a hex reference to its real character", () => {
    expect(matchEntity("&#x41;", 0)).toEqual({ raw: "&#x41;", value: "A" });
  });

  it("decodes a decimal reference to its real character", () => {
    expect(matchEntity("&#65;", 0)).toEqual({ raw: "&#65;", value: "A" });
  });

  it("decodes U+0000 to the replacement character, per the spec's own rule", () => {
    expect(matchEntity("&#x0;", 0)?.value).toBe("�");
  });

  it("decodes the maximum valid codepoint (U+10FFFF) normally, not as a replacement", () => {
    expect(matchEntity("&#x10FFFF;", 0)?.value).toBe(
      String.fromCodePoint(0x10ffff),
    );
  });

  it("decodes one past the maximum valid codepoint to the replacement character", () => {
    expect(matchEntity("&#x110000;", 0)?.value).toBe("�");
  });

  it("decodes the character just below the surrogate range normally", () => {
    expect(matchEntity("&#xD7FF;", 0)?.value).toBe(
      String.fromCodePoint(0xd7ff),
    );
  });

  it("decodes the first surrogate codepoint (U+D800) to the replacement character", () => {
    expect(matchEntity("&#xD800;", 0)?.value).toBe("�");
  });

  it("decodes the last surrogate codepoint (U+DFFF) to the replacement character", () => {
    expect(matchEntity("&#xDFFF;", 0)?.value).toBe("�");
  });

  it("decodes the character just past the surrogate range normally", () => {
    expect(matchEntity("&#xE000;", 0)?.value).toBe(
      String.fromCodePoint(0xe000),
    );
  });

  it("returns undefined for an unrecognised named entity", () => {
    expect(matchEntity("&MissingGlyph;", 0)).toBeUndefined();
  });
});

describe("unescapeString", () => {
  it("passes plain text with neither a backslash nor an entity through unchanged", () => {
    expect(unescapeString("plain text")).toBe("plain text");
  });

  it("resolves a backslash escape", () => {
    expect(unescapeString("a\\*b")).toBe("a*b");
  });

  it("resolves a named entity", () => {
    expect(unescapeString("a&amp;b")).toBe("a&b");
  });

  it("leaves a lone unescapable backslash as a literal character", () => {
    expect(unescapeString("a\\zb")).toBe("a\\zb");
  });

  it("leaves an unrecognised '&' sequence as literal text", () => {
    expect(unescapeString("a&b")).toBe("a&b");
  });
});
