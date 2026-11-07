import { symbolGlyphName } from "./encoding-symbol-tables";
import {
  glyphNameToUnicode,
  symbolPieceOfAdobePrivateUse,
} from "./glyph-names";
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

function symbolCharacter(code: number): string | undefined {
  const name = symbolGlyphName(code);
  if (name === undefined) {
    return undefined;
  }
  const text = glyphNameToUnicode(name);
  // A glyph the Adobe Glyph List gives a code point of Adobe's own Private Use Area that `glyphNameToUnicode` does not replace with a Unicode character (the radical extension) names no character, so it stays as it was written.
  return text !== undefined && text !== "" && !isPrivateUse(text)
    ? text
    : undefined;
}

function wingdingsCharacter(code: number): string | undefined {
  const character = WINGDINGS_CHARACTERS[code];
  return character === undefined || character === "" ? undefined : character;
}

/**
 * `text`, the Unicode a font's /ToUnicode CMap gave for a run of its codes, with each Private Use Area code point that is one of the font's own 8-bit codes (0xF020 to 0xF0FF) replaced by the character the font's glyph at that code is, and, for Symbol, each code point the Adobe Glyph List gives one of Symbol's bracket, brace and sign pieces (U+F8E6 to U+F8FE, U+F6D9 to U+F6DB) replaced by the piece's Unicode character. Nothing else changes: any other code point, one the font has no character at, and every character of a font that is not a symbol font stay as they were.
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
  const replacement = (codePoint: number): string | undefined => {
    if (isSymbolFontCode(codePoint)) {
      return character(codePoint - SYMBOL_FONT_PRIVATE_USE_BASE);
    }
    // A producer that maps Symbol's glyphs to text through the Adobe Glyph List writes a piece's private-use code point from that list, not the font's own code plus 0xF000.
    return font === "symbol"
      ? symbolPieceOfAdobePrivateUse(codePoint)
      : undefined;
  };
  let out = "";
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    out +=
      (codePoint === undefined ? undefined : replacement(codePoint)) ?? char;
  }
  return out;
}
