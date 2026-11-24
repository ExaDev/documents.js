// Glyph tables for embedded font subsets whose glyphs have been checked one by one against the font program's own outlines, because the font dictionary cannot be trusted to say what they are.
//
// Some producers (the typesetter whose Type 1C subsets are named AdvMT_SY, AdvP4C4E74 and the like) give each glyph an arbitrary name, write a /Differences array that assigns the names to codes, and then write a /ToUnicode CMap that reads each name as if it meant what it says: the glyph named /onequarter is drawn as an equals sign, /exclam as an omega or an arrow, and the glyphs named /C25 and so on, which no name list knows, as U+FFFD. The document's own tables are valid and wrong, so nothing in the text or the names can recover the symbol. What can is the glyph's own outline. A subset converted from a TrueType symbol face whose glyphs are named `G` and the glyph's id in that face, with no `/ToUnicode`, is the same case from the other side: its names say nothing, the core-face glyph orders (`core-font-glyph-orders.ts`) cover only text faces, and the outline again is what settles each glyph.
//
// So a table here is keyed by the SHA-256 of the decoded font program, the exact subset that was checked, and applies to that subset only: any other subset of the same font family, and any glyph name the table does not list, is read as it always was. A table lists glyphs by the program's own glyph name, not by character code, because these producers share one program between many font dictionaries that assign its glyphs to different codes; the name a dictionary's /Differences gives a code is what selects the glyph. An entry is added only for a glyph whose outline was rendered and checked against the symbol it stands for; the rendered glyph sheets are in `docs/verified-glyph-tables/`, one per table, each cell showing the glyph, its name and the character it is read as.

import { sha256 } from "./crypto/sha2";

const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;

/**
 * The SHA-256 of a decoded font program as lower-case hex, the key the verified subsets are filed under.
 * @param bytes - The decoded bytes of the embedded font program.
 * @returns The digest.
 */
export function programDigest(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(sha256(bytes), (byte) =>
    byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, "0"),
  ).join("");
}

/** One verified subset: the font family its `/BaseFont` names (the subset tag taken off) and the character each listed glyph draws, by the program's own glyph name. */
export interface VerifiedGlyphTable {
  readonly family: string;
  readonly glyphs: ReadonlyMap<string, string>;
}

export interface VerifiedGlyphTableSource {
  readonly family: string;
  readonly glyphs: Readonly<Record<string, string>>;
}

/** The subsets checked so far, by the SHA-256 of the decoded font program. */
export const VERIFIED_SOURCES: ReadonlyMap<string, VerifiedGlyphTableSource> =
  new Map<string, VerifiedGlyphTableSource>([
    [
      "f483d278b1ade68af30ba62e57752933bccea6ee61d388fbf73ed2047feb620c",
      {
        family: "AdvP4C4E74",
        glyphs: { onequarter: "=", thorn: "+" },
      },
    ],
    [
      "40b088a33057f42fdb763f1eb9e849574a925ce59e413a0e94617b3333b40056",
      {
        family: "AdvMT_MI",
        glyphs: {
          C11: "\u03b1",
          C12: "\u03b2",
          C13: "\u03b3",
          C14: "\u03b4",
          C15: "\u03f5",
          C17: "\u03b7",
          C18: "\u03b8",
          C20: "\u03ba",
          C21: "\u03bb",
          C22: "\u03bc",
          C23: "\u03bd",
          C25: "\u03c0",
          C26: "\u03c1",
          C27: "\u03c3",
          C28: "\u03c4",
          C30: "\u03d5",
          C31: "\u03c7",
          at: "\u2202",
          colon: ".",
          equal: "/",
          exclam: "\u03c9",
          greater: ">",
          less: "<",
          quotedbl: "\u03b5",
          semicolon: ",",
        },
      },
    ],
    [
      "99212d4f61280dcc8ca4377fca8259451eb05e0867a0017c0c41a521cd9fffac",
      {
        family: "AdvMT_SY",
        glyphs: {
          C0: "\u2212",
          C1: "\u22c5",
          C138: "]",
          C14: "\u25cb",
          C17: "\u2261",
          C18: "\u2286",
          C2: "\u00d7",
          C20: "\u2264",
          C21: "\u2265",
          C22: "\u227c",
          C25: "\u2248",
          C26: "\u2282",
          C27: "\u2283",
          C28: "\u226a",
          C29: "\u226b",
          C3: "\u2217",
          C30: "\u227a",
          C6: "\u00b1",
          R: "\u211b",
          Thorn: ")",
          b: "\u230a",
          backslash: "\u2229",
          bracketleft: "\u222a",
          c: "\u230b",
          dollar: "\u2194",
          eth: "(",
          exclam: "\u2192",
          f: "{",
          ff: "\u2220",
          ffi: "\u2245",
          g: "}",
          j: "|",
          k: "\u2016",
          numbersign: "\u2193",
          one: "\u221e",
          onehalf: "[",
          onequarter: "=",
          p: "\u221a",
          parenright: "\u21d2",
          quoteright: "\u2243",
          r: "\u2207",
          six: "/",
          thorn: "+",
          two: "\u2208",
          zero: "\u2032",
        },
      },
    ],
    [
      "53ea45831e6c9133d4bb030d84cc8888bfa065dc98a66b9229b2b578f7a2f615",
      {
        family: "AdvP4C4E46",
        glyphs: {
          C0: "(",
          C1: ")",
          C16: "(",
          C17: ")",
          C18: "(",
          C19: ")",
          p: "\u221a",
          q: "\u221a",
          r: "\u221a",
          s: "\u221a",
        },
      },
    ],
    [
      "6071bcddbb9aa9d41a695f93ec76b9aacd2fee29325cc5a75e05ec39cbe419ac",
      {
        family: "AdvP4C4E46",
        glyphs: {
          C0: "(",
          C1: ")",
          C16: "(",
          C17: ")",
          C18: "(",
          C19: ")",
          p: "\u221a",
          r: "\u221a",
        },
      },
    ],
    [
      "60efa155cc8d0a1bbe67f3926b42c856e503074caff150fd2ff6075f0b723ef2",
      {
        family: "AdvP4C4E46",
        glyphs: {
          C0: "(",
          C1: ")",
          C16: "(",
          C17: ")",
          C18: "(",
          C19: ")",
          C20: "[",
          C21: "]",
          C26: "{",
          C27: "}",
          Eth: "\u222b",
          P: "\u2211",
          X: "\u2211",
          asciicircum: "\u22c0",
          backslash: "\u22c2",
          eth: "\u222b",
          exclam: ")",
          five: "\u23a6",
          four: "\u23a3",
          h: "[",
          i: "]",
          numbersign: "]",
          p: "\u221a",
          parenleft: "{",
          q: "\u221a",
          quotedbl: "[",
          r: "\u221a",
          s: "\u221a",
          space: "(",
          three: "\u23a4",
          two: "\u23a1",
        },
      },
    ],
    [
      "a8442ad73af43eb9abec5cb790fe053953caf2cba069038689c1091a8bf1da57",
      {
        family: "AdvP4C4E46",
        glyphs: {
          C0: "(",
          C1: ")",
          C16: "(",
          C17: ")",
          C18: "(",
          C19: ")",
          C20: "[",
          C21: "]",
          C26: "{",
          C27: "}",
          Eth: "\u222b",
          P: "\u2211",
          eth: "\u222b",
          five: "\u23a6",
          four: "\u23a3",
          h: "[",
          i: "]",
          p: "\u221a",
          q: "\u221a",
          r: "\u221a",
          three: "\u23a4",
          two: "\u23a1",
        },
      },
    ],
    [
      "f2c12f17afd97014ccf6002befb9a7fa5c9156788bb9a616a5f9d31f8b5aaedd",
      {
        family: "AdvP4C4E46",
        glyphs: {
          C16: "(",
          C17: ")",
          C18: "(",
          C19: ")",
          C20: "[",
          C21: "]",
          exclam: ")",
          five: "\u23a6",
          four: "\u23a3",
          h: "[",
          i: "]",
          p: "\u221a",
          q: "\u221a",
          r: "\u221a",
          space: "(",
          three: "\u23a4",
          two: "\u23a1",
        },
      },
    ],
    [
      "93463c42e9491b79f82f761b522ae2de72b6217efccd186930df7237ef8002ef",
      {
        family: "AdvP4C4E51",
        glyphs: {
          colon: ".",
          equal: "/",
          greater: ">",
          less: "<",
          semicolon: ",",
        },
      },
    ],
    [
      "78448cb71772342dba968e5467a55b5df184815aabe509ccf2f4ec7b923aebe4",
      {
        family: "AdvP4C4E51",
        glyphs: {
          colon: ".",
          equal: "/",
          greater: ">",
          less: "<",
          semicolon: ",",
        },
      },
    ],
    [
      "967c167a737966cddc29a62e6f0601efc797d1f9453d0f3df558306b2d8b91e2",
      {
        family: "AdvP4C4E59",
        glyphs: {
          C1: "\u0394",
          C10: "\u03a9",
        },
      },
    ],
    [
      "38c8aa8ccee56512b9816a6c93c2e2b166166b672560b5f827eef19c43626bd3",
      {
        family: "AdvP4C4E74",
        glyphs: {
          C0: "\u2212",
          C14: "\u25cb",
          C2: "\u00d7",
          C20: "\u2264",
          C21: "\u2265",
          C3: "\u2217",
          C6: "\u00b1",
          Thorn: ")",
          eth: "(",
          onequarter: "=",
          p: "\u221a",
          slash: "\u221d",
          thorn: "+",
          zero: "\u2032",
        },
      },
    ],
    [
      "4061cae07e31ac6441fef12114942a58d0bae5f64a0789932ee703654990a769",
      {
        family: "AdvP4C4E74",
        glyphs: {
          C0: "\u2212",
          C1: "\u22c5",
          C138: "]",
          C14: "\u25cb",
          C2: "\u00d7",
          C20: "\u2264",
          C21: "\u2265",
          C6: "\u00b1",
          C8: "\u2295",
          Thorn: ")",
          eth: "(",
          f: "{",
          ff: "\u2220",
          g: "}",
          j: "|",
          onehalf: "[",
          onequarter: "=",
          p: "\u221a",
          parenright: "\u21d2",
          slash: "\u221d",
          thorn: "+",
          zero: "\u2032",
        },
      },
    ],
    [
      "4983c0bc19d073482c226511409622f6009444f10660bd4d6fd146e876af1eb0",
      {
        family: "AdvP4C4E74",
        glyphs: {
          C0: "\u2212",
          C1: "\u22c5",
          C138: "]",
          C14: "\u25cb",
          C2: "\u00d7",
          C20: "\u2264",
          C3: "\u2217",
          C6: "\u00b1",
          Thorn: ")",
          eth: "(",
          f: "{",
          ff: "\u2220",
          g: "}",
          numbersign: "\u2193",
          onehalf: "[",
          onequarter: "=",
          p: "\u221a",
          slash: "\u221d",
          thorn: "+",
        },
      },
    ],
    [
      "ccf77c4a71142b8025af5b751a4cc473204521ea2eddcf1d91f1713182c5aecf",
      {
        family: "AdvP4C4E74",
        glyphs: {
          C0: "\u2212",
          C1: "\u22c5",
          C138: "]",
          C14: "\u25cb",
          C15: "\u25cf",
          C2: "\u00d7",
          C20: "\u2264",
          C21: "\u2265",
          C24: "\u223c",
          C25: "\u2248",
          C29: "\u226b",
          C3: "\u2217",
          C6: "\u00b1",
          Thorn: ")",
          b: "\u230a",
          c: "\u230b",
          eth: "(",
          exclam: "\u2192",
          f: "{",
          ff: "\u2220",
          ffi: "\u2245",
          g: "}",
          j: "|",
          one: "\u221e",
          onehalf: "[",
          onequarter: "=",
          p: "\u221a",
          parenright: "\u21d2",
          r: "\u2207",
          six: "/",
          slash: "\u221d",
          space: "\u2190",
          thorn: "+",
          two: "\u2208",
          zero: "\u2032",
        },
      },
    ],
    [
      "dc3008dbca19a91b63116bcfed491a45776faffadc2c8063b5367c71bf1657d1",
      {
        family: "AdvP4C4E74",
        glyphs: {
          C0: "\u2212",
          C138: "]",
          C14: "\u25cb",
          C2: "\u00d7",
          C20: "\u2264",
          C21: "\u2265",
          C4: "\u00f7",
          C6: "\u00b1",
          Thorn: ")",
          eth: "(",
          onehalf: "[",
          onequarter: "=",
          p: "\u221a",
          slash: "\u221d",
          thorn: "+",
        },
      },
    ],
    [
      "2ca2dba1e1e9b00e0910f1ac2f9c042f54e7a786d4feab4cbe85755a68f77fb1",
      {
        family: "AdvMT_EX",
        glyphs: {
          C0: "(",
          C1: ")",
          C12: "\u23d0",
          C13: "\u2016",
          C16: "(",
          C17: ")",
          C18: "(",
          C19: ")",
          C2: "[",
          C20: "[",
          C21: "]",
          C26: "{",
          C27: "}",
          C3: "]",
          C4: "\u230a",
          C5: "\u230b",
          C8: "{",
          C9: "}",
          P: "\u2211",
          Q: "\u220f",
          X: "\u2211",
          Z: "\u222b",
          eth: "\u222b",
          exclam: ")",
          ffi: "\u203e",
          five: "\u230b",
          four: "\u230a",
          h: "[",
          i: "]",
          j: "\u230a",
          k: "\u230b",
          n: "{",
          numbersign: "]",
          p: "\u221a",
          parenleft: "{",
          parenright: "}",
          q: "\u221a",
          quotedbl: "[",
          r: "\u221a",
          s: "\u221a",
          seven: "\u23d0",
          six: "\u23d0",
          space: "(",
          t: "\u221a",
          three: "\u2309",
          two: "\u2308",
          u: "\u23d0",
          v: "\u2308",
        },
      },
    ],
    [
      "f705a315e1683ec7d00aae0d42861ee3610923a1057995017d2253dbf5a3a996",
      {
        family: "AdvMT_RM",
        glyphs: {
          C0: "\u0393",
          C1: "\u0394",
          C10: "\u03a9",
          C18: "`",
          C2: "\u0398",
          C22: "\u00af",
          C5: "\u03a0",
          C8: "\u03a6",
          underscore: "\u00b7",
        },
      },
    ],
    [
      "988c6d2ea90959baf5ed8f013f6dd21b6e4137145a2e2f75c117591aeca44927",
      {
        family: "Symbol092",
        glyphs: {
          G149: "\u00b0",
          G156: "\u2022",
          G181: "\u2220",
          G187: "\u221a",
          G203: "\u239b",
          G204: "\u239c",
          G205: "\u239d",
          G215: "\u222b",
          G219: "\u239e",
          G220: "\u239f",
          G221: "\u23a0",
          G32: " ",
          G40: "(",
          G41: ")",
          G43: "+",
          G45: "\u2212",
          G61: "=",
          G65: "A",
          G87: "\u03a9",
        },
      },
    ],
  ]);

function tableOf(source: VerifiedGlyphTableSource): VerifiedGlyphTable {
  return {
    family: source.family,
    glyphs: new Map(Object.entries(source.glyphs)),
  };
}

/** The font families some verified subset belongs to: a font of any other family is not hashed. */
export const VERIFIED_GLYPH_FAMILIES: ReadonlySet<string> = new Set(
  [...VERIFIED_SOURCES.values()].map((source) => source.family),
);

/**
 * The verified table for an embedded font program given its digest, or `undefined` for any program that is not exactly one that was checked.
 * @param family - The font's family as `styleFromBaseFontName` reads it: the table is used only for a font whose family is the one it was checked for.
 * @param digest - The SHA-256 of the decoded font program (`programDigest`).
 * @param tables - The verified subsets to look in, by program SHA-256; the checked ones unless a test supplies its own.
 * @returns The table for that subset, or `undefined`.
 */
export function verifiedGlyphTableOfDigest(
  family: string,
  digest: string,
  tables: ReadonlyMap<string, VerifiedGlyphTableSource> = VERIFIED_SOURCES,
): VerifiedGlyphTable | undefined {
  const source = tables.get(digest);
  return source?.family === family ? tableOf(source) : undefined;
}

/**
 * The verified table for an embedded font program, or `undefined` for any program that is not exactly one that was checked.
 * @param family - The font's family as `styleFromBaseFontName` reads it: the table is used only for a font whose family is the one it was checked for.
 * @param program - The decoded bytes of the embedded font program.
 * @param tables - The verified subsets to look in, by program SHA-256; the checked ones unless a test supplies its own.
 * @returns The table for that subset, or `undefined`.
 */
export function verifiedGlyphTableFor(
  family: string,
  program: Uint8Array<ArrayBuffer>,
  tables: ReadonlyMap<string, VerifiedGlyphTableSource> = VERIFIED_SOURCES,
): VerifiedGlyphTable | undefined {
  return verifiedGlyphTableOfDigest(family, programDigest(program), tables);
}
