// Glyph tables for embedded font subsets whose glyphs have been checked one by one against the font program's own outlines, because the font dictionary cannot be trusted to say what they are.
//
// Some producers (the typesetter whose Type 1C subsets are named AdvMT_SY, AdvP4C4E74 and the like) give each glyph an arbitrary name, write a /Differences array that assigns the names to codes, and then write a /ToUnicode CMap that reads each name as if it meant what it says: the glyph named /onequarter is drawn as an equals sign, /exclam as an omega or an arrow, and the glyphs named /C25 and so on, which no name list knows, as U+FFFD. The document's own tables are valid and wrong, so nothing in the text or the names can recover the symbol. What can is the glyph's own outline. A subset converted from a TrueType symbol face whose glyphs are named `G` and the glyph's id in that face (or, in the subsets a printer driver names `TT12FCo00` and the like, `G` and the glyph's character code in hexadecimal), with no `/ToUnicode`, is the same case from the other side: its names say nothing, the core-face glyph orders (`core-font-glyph-orders.ts`) cover only text faces, and the outline again is what settles each glyph.
//
// So a table here is keyed by the SHA-256 of the decoded font program, the exact subset that was checked, and applies to that subset only: any other subset of the same font family, and any glyph name the table does not list, is read as it always was. A table lists glyphs by the program's own glyph name, not by character code, because these producers share one program between many font dictionaries that assign its glyphs to different codes; the name a dictionary's /Differences gives a code is what selects the glyph. An entry is added only for a glyph whose outline was rendered and checked against the symbol it stands for; the rendered glyph sheets are in `docs/verified-glyph-tables/`, one per table, each cell showing the glyph, its name and the character it is read as.

import { sha256 } from "./crypto/sha2";
import { ADVENT_SOURCES } from "./verified-glyph-tables-advent";
import { TRUETYPE_SOURCES } from "./verified-glyph-tables-truetype";

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
    ...ADVENT_SOURCES,
    ...TRUETYPE_SOURCES,
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
