import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { glyphNameToUnicode } from "./glyph-names";

// The vendored lists read straight from their source files, not from the generated src/assets module the code under test parses: an entry the generator dropped or mangled shows up here as a mismatch rather than agreeing with itself.
function vendoredList(file: string): [string, string][] {
  const text = readFileSync(
    new URL(`../assets/agl/${file}`, import.meta.url),
    "utf8",
  );
  return text
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [name = "", values = ""] = line.split(";");
      return [
        name,
        String.fromCodePoint(
          ...values.split(" ").map((hex) => Number.parseInt(hex, 16)),
        ),
      ];
    });
}

describe("glyphNameToUnicode: every listed name", () => {
  it.each([["glyphlist.txt"], ["zapfdingbats.txt"]])(
    "resolves every entry of %s to the characters it lists",
    (file) => {
      const entries = vendoredList(file);
      expect(entries.length).toBeGreaterThan(0);
      const mismatches = entries.filter(
        ([name, text]) => glyphNameToUnicode(name) !== text,
      );
      expect(mismatches).toEqual([]);
    },
  );
});

describe("glyphNameToUnicode: the Adobe Glyph List Specification's algorithm", () => {
  // Each row is a name and the text it must resolve to, the expectation spelled out as code points so a reader can check it against the specification's own examples (https://github.com/adobe-type-tools/agl-specification, section 3) without trusting an editor's rendering of the characters.
  it.each<[string, string, readonly number[]]>([
    ["a name in the Adobe Glyph List", "Omega", [0x2126]],
    ["a name the list maps to a sequence", "dalethatafpatah", [0x5d3, 0x5b2]],
    ["a Zapf Dingbats name", "a1", [0x2701]],
    ["a variant suffix", "A.sc", [0x41]],
    ["a suffix that itself holds periods", "Omega.alt.01", [0x2126]],
    ["ligature components", "f_f_i", [0x66, 0x66, 0x69]],
    ["a ligature with a suffix", "T_h.swash", [0x54, 0x68]],
    ["a uni name", "uni2126", [0x2126]],
    ["a uni name of several code points", "uni20AC0308", [0x20ac, 0x308]],
    ["a u name in the BMP", "u0041", [0x41]],
    ["a u name past the BMP", "u1040C", [0x1040c]],
    ["a six-digit u name", "u10FFFF", [0x10ffff]],
    ["lowercase hexadecimal digits", "uni20ac", [0x20ac]],
    [
      "the specification's own mixed example",
      "Lcommaaccent_uni20AC0308_u1040C.alternate",
      [0x13b, 0x20ac, 0x308, 0x1040c],
    ],
  ])("resolves %s (%s)", (_, name, codePoints) => {
    expect(glyphNameToUnicode(name)).toBe(String.fromCodePoint(...codePoints));
  });

  it.each<[string, string]>([
    ["a name in no list and of neither constructed form", "foo"],
    ["a glyph index wearing a name", "g27"],
    ["a CID wearing a name", "cid42"],
    ["a name that is only a suffix", ".notdef"],
    ["an empty name", ""],
    ["a uni name naming surrogates", "uniD801DC0C"],
    ["a u name naming a surrogate", "uD800"],
    ["a u name past the last code point", "u110000"],
    ["a uni name whose digits are not whole groups of four", "uni004"],
    ["a u name of too few digits", "u041"],
    ["a u name of too many digits", "u0010FFFF"],
    ["a ligature with one unknown component", "f_foo"],
    ["a ligature with an empty component", "f__i"],
  ])("resolves nothing for %s (%s)", (_, name) => {
    expect(glyphNameToUnicode(name)).toBeUndefined();
  });
});
