import { symbolGlyphName } from "./encoding-symbol-tables";
import {
  glyphNameToUnicode,
  symbolPieceOfAdobePrivateUse,
} from "./glyph-names";
import {
  WEBDINGS_CHARACTERS,
  WINGDINGS_2_CHARACTERS,
  WINGDINGS_3_CHARACTERS,
} from "./dingbat-characters";
import { WINGDINGS_CHARACTERS } from "./wingdings-characters";

// A symbol font's glyphs have no Unicode of their own, so a producer that writes a /ToUnicode CMap for one (Word does, when it embeds Symbol or Wingdings as a CID font) gives each glyph the font's 8-bit code added to 0xF000, the Private Use Area code point the OpenType recommendations for symbol fonts derive from a code (https://learn.microsoft.com/en-us/typography/opentype/spec/recom, "Non-Standard (Symbol) Fonts", archived at https://web.archive.org/web/20261011050748/https://learn.microsoft.com/en-us/typography/opentype/spec/recom). That code point names the glyph only within its font: 0xFC is a check mark in Wingdings (U+2713) and a piece of a right brace in Symbol, and text that has left the font cannot say which. So the mapping is made here, where the font is known, and is keyed by it.
const SYMBOL_FONT_PRIVATE_USE_BASE = 0xf000;

const FIRST_SYMBOL_FONT_CODE = 0x20;
const LAST_SYMBOL_FONT_CODE = 0xff;

/** The symbol fonts whose 8-bit codes are mapped: Symbol, and the four Windows dingbat fonts Unicode's Wingdings document covers (Wingdings, Wingdings 2, Wingdings 3 and Webdings). ZapfDingbats is read through its own standard encoding (ISO 32000-1 Annex D.6) instead, and any other font's text is left as the producer wrote it. */
export type SymbolFont =
  "symbol" | "wingdings" | "wingdings2" | "wingdings3" | "webdings";

// The symbol font each family spelling stands for, compared with spaces, underscores and hyphens removed and case folded. `SymbolOOEnc` is a name producers give the Symbol font itself. `EuclidSymbol` is MathType's Euclid Symbol, which is read in Symbol's encoding on the evidence of three glyphs whose codes were checked against Symbol's (the equals sign, the bullet and a bracket extension); the rest of its layout is assumed to follow Symbol's, not checked.
function symbolFontOfSpelling(name: string): SymbolFont | undefined {
  switch (name.replace(/[\s_-]/gu, "").toLowerCase()) {
    case "symbol":
    case "symbolmt":
    case "symbolooenc":
    case "euclidsymbol":
      return "symbol";
    case "wingdings":
      return "wingdings";
    case "wingdings2":
      return "wingdings2";
    case "wingdings3":
      return "wingdings3";
    case "webdings":
      return "webdings";
    default:
      return undefined;
  }
}

/**
 * The symbol font a font family name stands for, whichever way the producer spells it ("Symbol", "SymbolMT", "SymbolOOEnc", "EuclidSymbol", "Wingdings", "Wingdings 2" or "Wingdings2", "Wingdings 3", "Webdings"), or `undefined` for any other font.
 *
 * Two decorations some producers add to a name are looked past. A variant tag of `-OV-` and six capital letters at the end (`SymbolMT-OV-JQGJHA`). And a pseudo subset tag of one capital and five small letters run straight onto the name, with no `+` (`SmmfqrSymbol`), which is read off only when a capital follows it directly and what follows is itself one of the spellings above, so a family that merely contains one of them (`SymbolicSans`, `SegoeUISymbol`, `OpenSymbol`, `Lucida Symbol`) is never taken for it.
 * @param family - The font's family as `styleFromBaseFontName` reads it from `/BaseFont` or from an embedded program's PostScript name: the subset tag and style suffix already removed.
 * @returns The symbol font the family names, or `undefined`.
 */
export function symbolFontOf(family: string): SymbolFont | undefined {
  // Declared here rather than at module scope so each is ordinary executable code a test of this function distinguishes (see `ignoreStatic` in ../../stryker.shared.ts).
  const variantTag = /-OV-[A-Z]{6}$/u;
  // The name follows the tag directly, so a capital comes next: a separator there (`Lucida Symbol`, `Tahoma-Symbol`) marks a family word, not a tag, and the spelling comparison below would otherwise drop it.
  const pseudoSubsetTag = /^[A-Z][a-z]{5}(?=[A-Z])/u;
  const untagged = family.replace(variantTag, "");
  return (
    symbolFontOfSpelling(untagged) ??
    symbolFontOfSpelling(untagged.replace(pseudoSubsetTag, ""))
  );
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

// Each dingbat font's table of the character its glyph at each code is: wingdings-characters.ts and dingbat-characters.ts.
const DINGBAT_TABLES: Readonly<
  Record<Exclude<SymbolFont, "symbol">, readonly string[]>
> = {
  wingdings: WINGDINGS_CHARACTERS,
  wingdings2: WINGDINGS_2_CHARACTERS,
  wingdings3: WINGDINGS_3_CHARACTERS,
  webdings: WEBDINGS_CHARACTERS,
};

function fontCharacter(font: SymbolFont): (code: number) => string | undefined {
  if (font === "symbol") {
    return symbolCharacter;
  }
  const table = DINGBAT_TABLES[font];
  return (code) => {
    const character = table[code];
    return character === undefined || character === "" ? undefined : character;
  };
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
  const character = fontCharacter(font);
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

function hasPrivateUse(text: string): boolean {
  return /\p{Co}/u.test(text);
}

/**
 * A reader of the text a font's /ToUnicode CMap gives, through `withSymbolFontCharacters`, for the symbol font the font is: the one its family names, else the one its embedded program's own PostScript name names (a producer can give `/BaseFont` a placeholder such as `CIDFont+F1` and leave the real name only in the program). The program's name is read only for text holding a private-use code point, and at most once, since reading it decodes the program.
 * @param family - The font's family as `styleFromBaseFontName` reads it from `/BaseFont`.
 * @param programFamily - The family `styleFromBaseFontName` reads from the embedded program's PostScript name, `undefined` for a font with no program or a program that states no name.
 * @returns The reader.
 */
export function symbolFontTextReader(
  family: string,
  programFamily: () => string | undefined,
): (text: string) => string {
  const resolve = (): SymbolFont | undefined => {
    const named = symbolFontOf(family);
    if (named !== undefined) {
      return named;
    }
    const fromProgram = programFamily();
    return fromProgram === undefined ? undefined : symbolFontOf(fromProgram);
  };
  let font: { readonly symbolFont: SymbolFont | undefined } | undefined;
  return (text) => {
    if (!hasPrivateUse(text)) {
      return text;
    }
    font ??= { symbolFont: resolve() };
    return withSymbolFontCharacters(font.symbolFont, text);
  };
}
