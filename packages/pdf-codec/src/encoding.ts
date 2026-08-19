import { winAnsiCodeToUnicode } from './winansi';

// The WinAnsiEncoding table (PDF spec ISO 32000-1 Annex D.2, aka CP1252's printable range): PDF character code (0-255) -> PostScript glyph name. Used to resolve a character to its standard-14 glyph name for measurement (afm-widths.ts) and, on the read path, to decode simple-font text when no /ToUnicode CMap is present. An empty string marks an unassigned/control code. Verified against pdf.js's own WinAnsiEncoding table (src/core/encodings.js), not transcribed from memory.
export const WINANSI_GLYPH_NAMES: readonly string[] = [
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
  "space", "exclam", "quotedbl", "numbersign", "dollar", "percent", "ampersand", "quotesingle", "parenleft", "parenright", "asterisk", "plus", "comma", "hyphen", "period", "slash",
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "colon", "semicolon", "less", "equal", "greater", "question",
  "at", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O",
  "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "bracketleft", "backslash", "bracketright", "asciicircum", "underscore",
  "grave", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o",
  "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "braceleft", "bar", "braceright", "asciitilde", "bullet",
  "Euro", "bullet", "quotesinglbase", "florin", "quotedblbase", "ellipsis", "dagger", "daggerdbl", "circumflex", "perthousand", "Scaron", "guilsinglleft", "OE", "bullet", "Zcaron", "bullet",
  "bullet", "quoteleft", "quoteright", "quotedblleft", "quotedblright", "bullet", "endash", "emdash", "tilde", "trademark", "scaron", "guilsinglright", "oe", "bullet", "zcaron", "Ydieresis",
  "space", "exclamdown", "cent", "sterling", "currency", "yen", "brokenbar", "section", "dieresis", "copyright", "ordfeminine", "guillemotleft", "logicalnot", "hyphen", "registered", "macron",
  "degree", "plusminus", "twosuperior", "threesuperior", "acute", "mu", "paragraph", "periodcentered", "cedilla", "onesuperior", "ordmasculine", "guillemotright", "onequarter", "onehalf", "threequarters", "questiondown",
  "Agrave", "Aacute", "Acircumflex", "Atilde", "Adieresis", "Aring", "AE", "Ccedilla", "Egrave", "Eacute", "Ecircumflex", "Edieresis", "Igrave", "Iacute", "Icircumflex", "Idieresis",
  "Eth", "Ntilde", "Ograve", "Oacute", "Ocircumflex", "Otilde", "Odieresis", "multiply", "Oslash", "Ugrave", "Uacute", "Ucircumflex", "Udieresis", "Yacute", "Thorn", "germandbls",
  "agrave", "aacute", "acircumflex", "atilde", "adieresis", "aring", "ae", "ccedilla", "egrave", "eacute", "ecircumflex", "edieresis", "igrave", "iacute", "icircumflex", "idieresis",
  "eth", "ntilde", "ograve", "oacute", "ocircumflex", "otilde", "odieresis", "divide", "oslash", "ugrave", "uacute", "ucircumflex", "udieresis", "yacute", "thorn", "ydieresis",
];

export function winAnsiGlyphName(code: number): string | undefined {
  const name = WINANSI_GLYPH_NAMES[code];
  return name === undefined || name === '' ? undefined : name;
}

let glyphNameToUnicodeTable: ReadonlyMap<string, number> | undefined;

// DEL (0x7F) is labelled "bullet" in WINANSI_GLYPH_NAMES, the same placeholder used for the genuinely-unassigned CP1252 positions -- but unlike those, winansi.ts's own Unicode<->WinAnsi table (built for the write path, via a mechanical TextDecoder('windows-1252') sweep) happens to map 0x7F to itself rather than leaving it undefined. Left unexcluded, that spurious self-mapping would win the "bullet" name ahead of the real one at 0x95 under first-occurrence-wins iteration.
const NON_GLYPH_CODES = new Set([0x7f]);

// Derived, not transcribed: cross-references WINANSI_GLYPH_NAMES (code -> name) against winansi.ts's own code -> Unicode table by code, built once on first use, first occurrence wins. Covers every glyph name WinAnsi itself defines -- the overwhelming common case for a simple font's /Encoding /Differences array, since most real-world non-embedded fonts stay within Latin-1 plus the CP1252 extensions. Two duplication patterns in WINANSI_GLYPH_NAMES are why first-wins matters: a handful of codes repeat the placeholder name "bullet" for CP1252 positions that are genuinely unassigned (see winansi.ts's own note on 0x81/0x8D/0x8F/0x90/0x9D, plus 0x7F excluded above) -- those never appear in the Unicode table this cross-references (0x7F aside), so they're skipped regardless of iteration order; and "space" itself is reused for both the ordinary space (0x20) and the non-breaking space (0xA0), where ascending code order deliberately lets the far more common plain space win. A glyph name outside this set (an exotic PostScript name, or the "uniXXXX" convention some producers emit directly) is the caller's own fallback to handle.
export function glyphNameToUnicode(name: string): number | undefined {
  if (glyphNameToUnicodeTable === undefined) {
    const table = new Map<string, number>();
    for (let code = 0; code < WINANSI_GLYPH_NAMES.length; code++) {
      if (NON_GLYPH_CODES.has(code)) {
        continue;
      }
      const glyphName = WINANSI_GLYPH_NAMES[code];
      if (glyphName === undefined || glyphName === '') {
        continue;
      }
      // First occurrence wins: "space" is the one glyph name genuinely reused for two different code points in this table (0x20, the ordinary space, and 0xA0, the non-breaking space) -- ascending code order means the far more common plain space wins the ambiguity.
      if (table.has(glyphName)) {
        continue;
      }
      const unicode = winAnsiCodeToUnicode(code);
      if (unicode !== undefined) {
        table.set(glyphName, unicode);
      }
    }
    glyphNameToUnicodeTable = table;
  }
  return glyphNameToUnicodeTable.get(name);
}
