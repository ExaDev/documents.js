import { symbolGlyphName } from "./encoding-symbol-tables";
import { glyphNameToUnicode } from "./glyph-names";
import { WINGDINGS_CHARACTERS } from "./wingdings-characters";

// A symbol font's glyphs have no Unicode of their own, so a producer that writes a /ToUnicode CMap for one (Word does, when it embeds Symbol or Wingdings as a CID font) gives each glyph the font's 8-bit code added to 0xF000, the Private Use Area code point the OpenType recommendations for symbol fonts derive from a code (https://learn.microsoft.com/en-us/typography/opentype/spec/recom, "Non-Standard (Symbol) Fonts", archived at https://web.archive.org/web/20261011050748/https://learn.microsoft.com/en-us/typography/opentype/spec/recom). That code point names the glyph only within its font: 0xFC is a check mark in Wingdings (U+2713) and a piece of a right brace in Symbol, and text that has left the font cannot say which. So the mapping is made here, where the font is known, and is keyed by it.
const SYMBOL_FONT_PRIVATE_USE_BASE = 0xf000;

const FIRST_SYMBOL_FONT_CODE = 0x20;
const LAST_SYMBOL_FONT_CODE = 0xff;

/** The symbol fonts whose 8-bit codes are mapped: the two a Word document uses for bullets, ticks, arrows and mathematical signs. Wingdings 2 and 3, Webdings and ZapfDingbats are different fonts with their own tables and are left as the producer wrote them. */
export type SymbolFont = "symbol" | "wingdings";

/**
 * The symbol font a font family name stands for, whichever way the producer spells it ("Symbol", "SymbolMT", "Wingdings"), or `undefined` for any other font.
 * @param family - The font's family as `styleFromBaseFontName` reads it from `/BaseFont`: the subset tag and style suffix already removed.
 * @returns The symbol font the family names, or `undefined`.
 */
export function symbolFontOf(family: string): SymbolFont | undefined {
  const name = family.replace(/[\s_-]/gu, "").toLowerCase();
  if (name === "symbol" || name === "symbolmt") {
    return "symbol";
  }
  return name === "wingdings" ? "wingdings" : undefined;
}

function isSymbolFontCode(codePoint: number): boolean {
  return (
    codePoint >= SYMBOL_FONT_PRIVATE_USE_BASE + FIRST_SYMBOL_FONT_CODE &&
    codePoint <= SYMBOL_FONT_PRIVATE_USE_BASE + LAST_SYMBOL_FONT_CODE
  );
}

function isPrivateUse(text: string): boolean {
  return /^\p{Co}/u.test(text);
}

/**
 * The Symbol glyphs that the Adobe Glyph List gives code points of Adobe's own Private Use Area (U+F6xx and U+F8xx), which name no character, and the Unicode characters that are the same glyphs: the pieces a tall bracket, parenthesis or brace is assembled from, the extensions of the integral, vertical-arrow and horizontal-arrow signs, and the serif and sans-serif registered, copyright and trade mark signs. Keyed by the glyph's PostScript name in the Symbol font's built-in encoding (Adobe's `symbol.txt`, https://www.unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt, archived at https://web.archive.org/web/20261011050748/http://www.unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt), valued by the character of the Unicode Miscellaneous Technical block (https://www.unicode.org/charts/PDF/U2300.pdf, archived at https://web.archive.org/web/2026/https://www.unicode.org/charts/PDF/U2300.pdf) or Latin-1 and Letterlike Symbols block the glyph is. `radicalex`, the extension of the radical sign, is the one such glyph with no Unicode character, and stays as it was written.
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

function symbolCharacter(code: number): string | undefined {
  const name = symbolGlyphName(code);
  if (name === undefined) {
    return undefined;
  }
  const piece = SYMBOL_ASSEMBLY_PIECES.get(name);
  if (piece !== undefined) {
    return piece;
  }
  const text = glyphNameToUnicode(name);
  // A glyph the Adobe Glyph List gives a code point of Adobe's own Private Use Area and the table above does not cover names no character, so it stays as it was written.
  return text !== undefined && text !== "" && !isPrivateUse(text)
    ? text
    : undefined;
}

function wingdingsCharacter(code: number): string | undefined {
  const character = WINGDINGS_CHARACTERS[code];
  return character === undefined || character === "" ? undefined : character;
}

/**
 * `text`, the Unicode a font's /ToUnicode CMap gave for a run of its codes, with each Private Use Area code point that is one of the font's own 8-bit codes (0xF020 to 0xF0FF) replaced by the character the font's glyph at that code is. Nothing else changes: a code point outside that range, one the font has no character at, and every character of a font that is not a symbol font stay as they were.
 * @param font - The symbol font the text was read through, `undefined` for any other font, whose text is returned as it is.
 * @param text - The text a CMap gave for one or more codes.
 * @returns The text with the font's own characters in place of its private-use code points.
 */
export function withSymbolFontCharacters(
  font: SymbolFont | undefined,
  text: string,
): string {
  if (font === undefined) {
    return text;
  }
  const character = font === "symbol" ? symbolCharacter : wingdingsCharacter;
  let out = "";
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    out +=
      codePoint !== undefined && isSymbolFontCode(codePoint)
        ? (character(codePoint - SYMBOL_FONT_PRIVATE_USE_BASE) ?? char)
        : char;
  }
  return out;
}
