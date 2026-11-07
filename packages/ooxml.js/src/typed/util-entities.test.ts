import { describe, expect, it } from "vitest";
import { el, txt } from "../xml/fragment";
import { decodeEntities, textContent } from "./util";

// decodeEntities reads the references XML defines without a DTD (the five predefined entities and decimal and hexadecimal character references) in one left-to-right pass, and leaves every other "&" sequence, including a character reference to a code point XML's Char production excludes, exactly as written.

describe("decodeEntities", () => {
  it.each([
    ["the five predefined entities", "&amp;&lt;&gt;&quot;&apos;", "&<>\"'"],
    ["a decimal reference", "&#101;", "e"],
    ["a hexadecimal reference", "&#x65;", "e"],
    ["upper-case hexadecimal digits", "&#x4A;&#x4a;", "JJ"],
    ["leading zeros", "&#0065;&#x0041;", "AA"],
    [
      "a reference beyond the Basic Multilingual Plane",
      "&#x1F600;",
      "\u{1F600}",
    ],
    ["tab, line feed and carriage return", "&#9;&#10;&#13;", "\t\n\r"],
    ["the last code point XML allows", "&#x10FFFF;", "\u{10FFFF}"],
    ["references inside surrounding text", "A &#38; B", "A & B"],
    ["an encoded ampersand before a reference", "&amp;#101;", "&#101;"],
    ["an encoded ampersand before a hex reference", "&amp;#x65;", "&#x65;"],
    ["an encoded ampersand before a named entity", "&amp;amp;", "&amp;"],
    ["a reference decoding to an ampersand", "&#38;amp;", "&amp;"],
  ])("decodes %s", (_case, input, expected) => {
    expect(decodeEntities(input)).toBe(expected);
  });

  it.each([
    ["NUL", "&#0;"],
    ["a C0 control other than tab, line feed and carriage return", "&#x1;"],
    ["a surrogate", "&#xD800;"],
    ["U+FFFE", "&#xFFFE;"],
    ["U+FFFF", "&#65535;"],
    ["a code point past U+10FFFF", "&#x110000;"],
    ["a reference too large for any code point", "&#99999999999999999999;"],
    ["an upper-case X, which CharRef does not allow", "&#X41;"],
    ["no digits", "&#;"],
    ["no hexadecimal digits", "&#x;"],
    ["a non-hexadecimal digit", "&#x6G;"],
    ["no closing semicolon", "&#101"],
    ["an entity no DTD declares", "&nbsp;"],
    ["a bare ampersand", "A & B"],
  ])("leaves %s as written", (_case, input) => {
    expect(decodeEntities(input)).toBe(input);
  });

  it("decodes the valid references around one it leaves as written", () => {
    expect(decodeEntities("&#65;&#0;&#x42;")).toBe("A&#0;B");
  });
});

describe("textContent", () => {
  it("decodes character references in element text", () => {
    const element = el("t", {}, [txt("Caf&#xE9; &#38; Bar")]);
    expect(textContent(element)).toBe("Café & Bar");
  });
});
