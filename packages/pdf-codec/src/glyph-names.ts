import {
  ADOBE_GLYPH_LIST,
  ZAPF_DINGBATS_GLYPH_LIST,
} from "./glyph-data/adobe-glyph-list";

// PostScript glyph name -> Unicode, by the algorithm the Adobe Glyph List Specification itself defines (https://github.com/adobe-type-tools/agl-specification, section 2): drop any variant suffix from the first period, split what remains into ligature components at each underscore, and map each component through the Adobe Glyph List, the ITC Zapf Dingbats Glyph List, or one of the two constructed forms ("uniXXXX..." and "uXXXX" to "uXXXXXX"). Both lists are vendored verbatim under assets/agl/ and embedded as src/glyph-data/adobe-glyph-list.ts.
//
// Three deliberate departures from the specification. The first replaces an answer: a glyph of the Symbol font that the list gives a code point of Adobe's own Private Use Area, although Unicode encodes the same glyph, resolves to the Unicode character (SYMBOL_ASSEMBLY_PIECES below), since a private-use code point names no character outside Adobe's own software. The other two refuse an answer the specification would give rather than giving one it would refuse. A component that maps to nothing makes the whole name map to nothing, where the specification maps it to an empty string: "f_xyz" names a ligature whose second half is unknown, and reporting it as "f" would be a plausible wrong reading. And the Zapf Dingbats list is consulted for every font rather than only for a font that is ZapfDingbats itself, since its "aNNN" names collide with no name in the Adobe Glyph List and so cannot misname a glyph from any other font. Hexadecimal digits in the constructed forms are accepted in either case, which can only recover a character, never substitute another.
//
// A name in no list and neither constructed form, such as "g27", "cid42" or "index3", is a glyph's position in one particular font wearing a name. It carries no information about the character drawn, and this function maps it to nothing; a caller holding that font's program can still identify the glyph through it (see builtin-encoding.ts).

// The three code-point ranges the constructed forms may name: everything but the UTF-16 surrogates, which are not Unicode scalar values (Unicode 16.0 section 3.9, definition D76).
const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;
const MAX_UNICODE_CODE_POINT = 0x10ffff;
const HEX_RADIX = 16;
const UNI_GROUP_DIGITS = 4; // "uni" is followed by one or more groups of exactly four hexadecimal digits

function isScalarValue(codePoint: number): boolean {
  return (
    codePoint <= MAX_UNICODE_CODE_POINT &&
    (codePoint < SURROGATE_FIRST || codePoint > SURROGATE_LAST)
  );
}

/**
 * The Symbol glyphs that the Adobe Glyph List gives code points of Adobe's own Private Use Area (U+F6xx and U+F8xx), which name no character, and the Unicode characters that are the same glyphs: the pieces a tall bracket, parenthesis or brace is assembled from, the extensions of the integral, vertical-arrow and horizontal-arrow signs, and the serif and sans-serif registered, copyright and trade mark signs. Keyed by the glyph's PostScript name in the Symbol font's built-in encoding (Adobe's `symbol.txt`, https://www.unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt, archived at https://web.archive.org/web/20261011050748/http://www.unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt, which gives each of these names the same private-use code point the Adobe Glyph List does), valued by the character of the Unicode Miscellaneous Technical block (https://www.unicode.org/charts/PDF/U2300.pdf, archived at https://web.archive.org/web/2026/https://www.unicode.org/charts/PDF/U2300.pdf) or Latin-1 and Letterlike Symbols block the glyph is. `radicalex`, the extension of the radical sign, is the one such glyph with no Unicode character, and resolves to the private-use code point the list gives it.
 */
const SYMBOL_ASSEMBLY_PIECES: ReadonlyMap<string, string> = new Map([
  ["parenlefttp", "\u239b"],
  ["parenleftex", "\u239c"],
  ["parenleftbt", "\u239d"],
  ["parenrighttp", "\u239e"],
  ["parenrightex", "\u239f"],
  ["parenrightbt", "\u23a0"],
  ["bracketlefttp", "\u23a1"],
  ["bracketleftex", "\u23a2"],
  ["bracketleftbt", "\u23a3"],
  ["bracketrighttp", "\u23a4"],
  ["bracketrightex", "\u23a5"],
  ["bracketrightbt", "\u23a6"],
  ["bracelefttp", "\u23a7"],
  ["braceleftmid", "\u23a8"],
  ["braceleftbt", "\u23a9"],
  ["braceex", "\u23aa"],
  ["bracerighttp", "\u23ab"],
  ["bracerightmid", "\u23ac"],
  ["bracerightbt", "\u23ad"],
  ["integralex", "\u23ae"],
  ["arrowhorizex", "\u23af"],
  ["arrowvertex", "\u23d0"],
  ["registerserif", "\u00ae"],
  ["registersans", "\u00ae"],
  ["copyrightserif", "\u00a9"],
  ["copyrightsans", "\u00a9"],
  ["trademarkserif", "\u2122"],
  ["trademarksans", "\u2122"],
]);

let listTable: ReadonlyMap<string, string> | undefined;

// Both lists, parsed on first use: each entry line is `name;HEX[ HEX...]`, a name mapping to one code point or, for a handful of precomposed Hebrew and Arabic forms, to a sequence of them.
function listedGlyphs(): ReadonlyMap<string, string> {
  if (listTable === undefined) {
    const table = new Map<string, string>();
    for (const list of [ADOBE_GLYPH_LIST, ZAPF_DINGBATS_GLYPH_LIST]) {
      for (const line of list.split("\n")) {
        const [name, values] = line.split(";");
        if (name === undefined || values === undefined) {
          continue;
        }
        table.set(
          name,
          String.fromCodePoint(
            ...values.split(" ").map((hex) => Number.parseInt(hex, HEX_RADIX)),
          ),
        );
      }
    }
    listTable = table;
  }
  return listTable;
}

// "uni" followed by one or more four-digit groups, each one code point; any group naming a surrogate rejects the whole component.
function uniForm(component: string): string | undefined {
  const match = /^uni((?:[0-9A-Fa-f]{4})+)$/.exec(component);
  if (match?.[1] === undefined) {
    return undefined;
  }
  const codePoints: number[] = [];
  for (let at = 0; at < match[1].length; at += UNI_GROUP_DIGITS) {
    const codePoint = Number.parseInt(
      match[1].slice(at, at + UNI_GROUP_DIGITS),
      HEX_RADIX,
    );
    if (!isScalarValue(codePoint)) {
      return undefined;
    }
    codePoints.push(codePoint);
  }
  return String.fromCodePoint(...codePoints);
}

// "u" followed by four to six hexadecimal digits naming one code point.
function uForm(component: string): string | undefined {
  const match = /^u([0-9A-Fa-f]{4,6})$/.exec(component);
  if (match?.[1] === undefined) {
    return undefined;
  }
  const codePoint = Number.parseInt(match[1], HEX_RADIX);
  return isScalarValue(codePoint) ? String.fromCodePoint(codePoint) : undefined;
}

function componentToUnicode(component: string): string | undefined {
  return (
    SYMBOL_ASSEMBLY_PIECES.get(component) ??
    listedGlyphs().get(component) ??
    uniForm(component) ??
    uForm(component)
  );
}

let pieceOfPrivateUse: ReadonlyMap<string, string> | undefined;

/**
 * The Unicode character of the Symbol glyph the Adobe Glyph List and Adobe's `symbol.txt` give `codePoint`, a code point of Adobe's own Private Use Area: U+F8EB, the private-use code point of `parenlefttp`, is U+239B. The inverse of the list for the glyphs SYMBOL_ASSEMBLY_PIECES covers, read from the list itself so the two cannot disagree.
 * @param codePoint - A code point a font's /ToUnicode CMap gave one of its glyphs.
 * @returns The character, or `undefined` for a code point that is no such glyph's (U+F8E5, the radical extension Unicode does not encode, among them).
 */
export function symbolPieceOfAdobePrivateUse(
  codePoint: number,
): string | undefined {
  if (pieceOfPrivateUse === undefined) {
    const table = new Map<string, string>();
    for (const [name, character] of SYMBOL_ASSEMBLY_PIECES) {
      const listed = listedGlyphs().get(name);
      if (listed !== undefined) {
        table.set(listed, character);
      }
    }
    pieceOfPrivateUse = table;
  }
  return pieceOfPrivateUse.get(String.fromCodePoint(codePoint));
}

/**
 * Resolves a PostScript glyph name to the text the glyph represents, by the Adobe Glyph List Specification's algorithm.
 * @param name - a glyph name as a font program, a `/Differences` array or a CFF charset states it, with or without a variant suffix ("A.sc") or ligature components ("f_f_i")
 * @returns the character or characters the name identifies, or undefined when the name, or any of its ligature components, identifies none
 */
export function glyphNameToUnicode(name: string): string | undefined {
  const period = name.indexOf(".");
  const base = period === -1 ? name : name.slice(0, period);
  if (base === "") {
    return undefined;
  }
  let text = "";
  for (const component of base.split("_")) {
    const mapped = componentToUnicode(component);
    if (mapped === undefined) {
      return undefined;
    }
    text += mapped;
  }
  return text;
}
