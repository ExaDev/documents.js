// — WordPerfect character sets 1-14, transcribed from libwpd's own WP6-to-Unicode conversion tables —
//
// stream/characters.ts documents the character model (set, number) itself and the SDK's own mirrored pages; this module is the transcribed table those pages do not carry — the SDK's own "Single-Byte Characters and Functions" page states the mechanism (a character set and a character number byte) and tabulates the thirty-two Default Extended International Characters, but carries no character-set table of its own for any set. Every table below is a direct transcription of libwpd's own WP6 tables, not an inference: libwpd is the mature LGPL/MPL WordPerfect reader used by AbiWord and LibreOffice, and the numbering it uses for the fourteen named character sets (WP6_MULTINATIONAL_CHARACTER_SET = 1 through WP6_ARABIC_SCRIPT_CHARACTER_SET = 14) is Corel's own, not libwpd's invention — WP6FileStructure.h states each constant's value directly, and set 1 in particular is independently cross-checked below.
//
// Source (official upstream, not a mirror): https://sourceforge.net/p/libwpd/code/ci/master/tree/src/lib/libwpd_internal.cpp (the WP6 tables, "WP6 Extended Character -> Unicode (UCS4) Mappings by Ariya Hidayat <ariyahidayat@yahoo.de> for the KWord project") and https://sourceforge.net/p/libwpd/code/ci/master/tree/src/lib/WP6TibetanMap.h (set 12, generated from Ted Lemon's own Tibetan transliteration table). Both are licensed MPL 2.0 / LGPLv2.1+; only the factual (character set, character number) -> Unicode code point correspondence is transcribed here, not libwpd's own C++ code. Confirmed byte-for-byte identical (aside from a `nullptr`-for-`0` modernisation with no data change) against the community GitHub mirror at https://github.com/cpjreynolds/libwpd/blob/master/src/lib/libwpd_internal.cpp.
//
// Cross-checked two ways before being trusted: (1) all thirty-two Default Extended International Characters this package already transcribed independently from the Corel SDK itself (see DEFAULT_EXTENDED_INTERNATIONAL in characters.ts) match this table's own set-1 entries at the same character numbers exactly, character for character — a genuine two-independent-source agreement, not a single-source transcription. (2) a sample spanning every set was looked up against the Unicode Character Database itself (Python's unicodedata module, generated from the Unicode Consortium's own UCD — a source independent of both libwpd and Corel) and each resolved to the expected script and letter, e.g. Greek(8)[0] = U+0391 GREEK CAPITAL LETTER ALPHA, Hebrew(9)[0] = U+05D0 HEBREW LETTER ALEF, Cyrillic(10)[0] = U+0410 CYRILLIC CAPITAL LETTER A, Arabic(13)[50] = U+0627 ARABIC LETTER ALEF, Japanese(11)[0..62] = U+FF61..U+FF9F (the Halfwidth Katakana block, exactly and contiguously), BoxDrawing(3)[8] = U+2500 BOX DRAWINGS LIGHT HORIZONTAL.
//
// Each table below is libwpd's own array, 0-based index = WordPerfect character number, one entry per line group with its starting index noted exactly as libwpd's own source comments it. `0x0000` marks a position libwpd itself carries no mapping for (omitted from the built map, decoding through the unmapped path); every other value, including `0x0020` (space), is libwpd's own transcription of that position — several of these sets have long stretches of genuinely reserved/blank slots in Corel's own character-map dialog, which libwpd (and this table) represent as a real, cited space rather than an invented gap.

import { ARABIC_13, ARABIC_SCRIPT_14 } from "./character-sets-13-14";
import {
  BOX_DRAWING_3,
  MULTINATIONAL_1,
  MULTINATIONAL_1_SEQUENCES,
  PHONETIC_2,
  TYPOGRAPHIC_4,
} from "./character-sets-1-4";
import {
  GREEK_8,
  HEBREW_9,
  CYRILLIC_10,
  JAPANESE_11,
} from "./character-sets-8-11";
import { TIBETAN_12, TIBETAN_12_SEQUENCES } from "./character-sets-12";
import {
  ICONIC_5,
  MATH_SCIENTIFIC_6,
  MATH_SCIENTIFIC_EXTENDED_7,
} from "./character-sets-5-7";

function buildCharacterSet(
  table: readonly number[],
  sequences?: ReadonlyMap<number, readonly number[]>,
): ReadonlyMap<number, string> {
  const map = new Map<number, string>();
  table.forEach((codePoint, characterNumber) => {
    if (codePoint !== 0) {
      map.set(characterNumber, String.fromCodePoint(codePoint));
    }
  });
  if (sequences !== undefined) {
    for (const [characterNumber, codePoints] of sequences) {
      map.set(characterNumber, String.fromCodePoint(...codePoints));
    }
  }
  return map;
}

// The complete set of WordPerfect 6.x's own named character sets (its character-map dialog offers exactly these fourteen, per libwpd's own WP6FileStructure.h numbering), keyed by the character-set byte the Extended Character function and every WP word string carry. Character set 0 (ASCII) is not here: it is handled directly in decodeWpCharacter, since it is documented by the SDK itself rather than transcribed from libwpd.
export const WP6_CHARACTER_SETS: ReadonlyMap<
  number,
  ReadonlyMap<number, string>
> = new Map([
  [1, buildCharacterSet(MULTINATIONAL_1, MULTINATIONAL_1_SEQUENCES)],
  [2, buildCharacterSet(PHONETIC_2)],
  [3, buildCharacterSet(BOX_DRAWING_3)],
  [4, buildCharacterSet(TYPOGRAPHIC_4)],
  [5, buildCharacterSet(ICONIC_5)],
  [6, buildCharacterSet(MATH_SCIENTIFIC_6)],
  [7, buildCharacterSet(MATH_SCIENTIFIC_EXTENDED_7)],
  [8, buildCharacterSet(GREEK_8)],
  [9, buildCharacterSet(HEBREW_9)],
  [10, buildCharacterSet(CYRILLIC_10)],
  [11, buildCharacterSet(JAPANESE_11)],
  [12, buildCharacterSet(TIBETAN_12, TIBETAN_12_SEQUENCES)],
  [13, buildCharacterSet(ARABIC_13)],
  [14, buildCharacterSet(ARABIC_SCRIPT_14)],
]);
