// — WordPerfect's character model, per WPFF "Single-Byte Characters and Functions" and WPFF Document Structure's glossary --
//
// A character in a WordPerfect document is a (character set, character number) pair. The document area encodes that pair three ways, and this module owns all three:
//
//   1. A byte in 33 (0x21) through 127 (0x7F) is that ASCII character directly — character set 0.
//   2. A byte in 1 (0x01) through 32 (0x20) is one of thirty-two "Default Extended International Characters", a shorthand for a set-1 (Multinational) character that would otherwise cost the four-byte extended-character function. The SDK's own table gives both the glyph and the (set, number) pair each shorthand stands for, and DEFAULT_EXTENDED_INTERNATIONAL below transcribes it verbatim.
//   3. Any other character is the fixed-length Extended Character function 0xF0, whose two payload bytes are the character number and the character set number.
//
// THE ONE COUNTER-INTUITIVE CONSEQUENCE, stated here because it looks like a bug on first reading: byte 0x20 is NOT a space in this stream — it is ß, the last of the thirty-two shorthands. A space is the single-byte Soft Space function 0x80, which the SDK describes as "Equivalent of an ASCII 0x20", or the Hard Space function 0x81. That is why the shorthand range runs to 32 rather than stopping at 31, and why the ASCII range is documented as starting at 33 rather than 32. Both statements appear twice in the SDK — once in the glossary's "Text Characters" and once at the head of the single-byte page — and the design reason is plain from the function list: WordPerfect has to distinguish a justifiable soft space from a hard one, so neither can be a plain text byte.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_SingleByte.htm
//
// Character sets 1 through 14 (Multinational, Phonetic Symbols, Box Drawing, Typographic Symbols, Iconic Symbols, Math/Scientific, Math/Scientific Extended, Greek, Hebrew, Cyrillic, Japanese, Tibetan, Arabic, and Arabic Script) decode through WP6_CHARACTER_SETS in ./character-sets, transcribed from libwpd's own WP6-to-Unicode tables since the mirrored SDK pages state the (set, number) mechanism but tabulate no character-set table of their own beyond the thirty-two shorthands above. See that module's own top-of-file comment for the source and how it was cross-checked.

import { WP6_CHARACTER_SETS } from "./character-sets";

// The SDK's "Default Extended International Characters" table, byte value 1..32 in order, each with the (character set, character number) pair the table states in parentheses beside the glyph. Both halves matter: the glyph decodes the single-byte shorthand, and the pair is one of the two independent sources WP6_CHARACTER_SETS' own set-1 table is cross-checked against (see ./character-sets) — every one of these thirty-two entries, transcribed here directly from the SDK rather than from libwpd, resolves to the identical glyph at the identical character number in that table.
// Set-1 character numbers for the thirty-two shorthands, straight from the SDK's own table, named by the glyph each stands for.
const SET1_A_RING = 35;
const SET1_A_RING_2 = 34;
const SET1_AE = 37;
const SET1_AE_2 = 36;
const SET1_A_DIAERESIS = 31;
const SET1_A_DIAERESIS_2 = 30;
const SET1_A_ACUTE = 27;
const SET1_A_GRAVE = 33;
const SET1_A_CIRCUMFLEX = 29;
const SET1_A_TILDE = 77;
const SET1_A_TILDE_2 = 76;
const SET1_C_CEDILLA = 39;
const SET1_C_CEDILLA_2 = 38;
const SET1_E_DIAERESIS = 45;
const SET1_E_ACUTE = 41;
const SET1_E_ACUTE_2 = 40;
const SET1_E_GRAVE = 47;
const SET1_E_CIRCUMFLEX = 43;
const SET1_I_ACUTE = 49;
const SET1_N_TILDE = 57;
const SET1_N_TILDE_2 = 56;
const SET1_O_SLASH = 81;
const SET1_O_SLASH_2 = 80;
const SET1_O_TILDE = 83;
const SET1_O_TILDE_2 = 82;
const SET1_O_DIAERESIS = 63;
const SET1_O_DIAERESIS_2 = 62;
const SET1_U_DIAERESIS = 71;
const SET1_U_DIAERESIS_2 = 70;
const SET1_U_ACUTE = 67;
const SET1_U_GRAVE = 73;
const SET1_SHARP_S = 23;

// The shorthands in byte order, 1 through 32: the byte value each carries is its position in this list plus one, so it is not restated per row.
const DEFAULT_EXTENDED_INTERNATIONAL: readonly (readonly [
  characterNumber: number,
  glyph: string,
])[] = [
  [SET1_A_RING, "å"],
  [SET1_A_RING_2, "Å"],
  [SET1_AE, "æ"],
  [SET1_AE_2, "Æ"],
  [SET1_A_DIAERESIS, "ä"],
  [SET1_A_DIAERESIS_2, "Ä"],
  [SET1_A_ACUTE, "á"],
  [SET1_A_GRAVE, "à"],
  [SET1_A_CIRCUMFLEX, "â"],
  [SET1_A_TILDE, "ã"],
  [SET1_A_TILDE_2, "Ã"],
  [SET1_C_CEDILLA, "ç"],
  [SET1_C_CEDILLA_2, "Ç"],
  [SET1_E_DIAERESIS, "ë"],
  [SET1_E_ACUTE, "é"],
  [SET1_E_ACUTE_2, "É"],
  [SET1_E_GRAVE, "è"],
  [SET1_E_CIRCUMFLEX, "ê"],
  [SET1_I_ACUTE, "í"],
  [SET1_N_TILDE, "ñ"],
  [SET1_N_TILDE_2, "Ñ"],
  [SET1_O_SLASH, "ø"],
  [SET1_O_SLASH_2, "Ø"],
  [SET1_O_TILDE, "õ"],
  [SET1_O_TILDE_2, "Õ"],
  [SET1_O_DIAERESIS, "ö"],
  [SET1_O_DIAERESIS_2, "Ö"],
  [SET1_U_DIAERESIS, "ü"],
  [SET1_U_DIAERESIS_2, "Ü"],
  [SET1_U_ACUTE, "ú"],
  [SET1_U_GRAVE, "ù"],
  [SET1_SHARP_S, "ß"],
];

const SINGLE_BYTE_SHORTHAND: ReadonlyMap<number, string> = new Map(
  DEFAULT_EXTENDED_INTERNATIONAL.map(([, glyph], index) => [index + 1, glyph]),
);

// The lowest byte value that is a literal ASCII character rather than one of the thirty-two international shorthands.
export const FIRST_ASCII_CHARACTER = 0x21;

// The highest byte value that is a character at all; 128 (0x80) and above is a function.
export const LAST_CHARACTER = 0x7f;

// What a character this package cannot name decodes to. U+FFFD is the right glyph precisely because it is visible: a reader looking at the output can see that something was there and was not understood, which silently dropping the character or substituting a plausible-looking one would both hide. Every occurrence is also reported through the diagnostic sink, so a caller can count them rather than having to eyeball the text.
export const UNMAPPED_CHARACTER = "�";

// Character set 0 is ASCII. The SDK's table runs 33 (0x21) to 127 (0x7F) and each entry maps to the identically-numbered ASCII character; the range below starts at 32 because a set-0 character *number* of 32 (reached through the extended-character function, or inside a word string) genuinely is a space — it is only the single-byte document stream where byte 0x20 means something else.
function decodeAsciiSet(characterNumber: number): string | undefined {
  // A set-0 character number is printable ASCII: 0x20 (a space as a number, even though byte 0x20 in the single-byte stream is not) through 0x7f.
  const FIRST_ASCII_CHARACTER_NUMBER = 0x20;
  const LAST_ASCII_CHARACTER_NUMBER = 0x7f;
  const isAsciiNumber = (candidate: number): boolean =>
    candidate >= FIRST_ASCII_CHARACTER_NUMBER &&
    candidate <= LAST_ASCII_CHARACTER_NUMBER;
  if (!isAsciiNumber(characterNumber)) {
    return undefined;
  }
  return String.fromCharCode(characterNumber);
}

// Decodes one (character set, character number) pair, as carried by the Extended Character function 0xF0 and by every WP word string. Returns undefined — never a substitute glyph — when this package holds no entry for the pair, leaving the caller to decide between reporting it and rendering UNMAPPED_CHARACTER.
export function decodeWpCharacter(
  characterSet: number,
  characterNumber: number,
): string | undefined {
  if (characterSet === 0) {
    return decodeAsciiSet(characterNumber);
  }
  return WP6_CHARACTER_SETS.get(characterSet)?.get(characterNumber);
}

// Decodes one byte of the document area's literal-character range, 1 (0x01) through 127 (0x7F). Byte 0 is excluded by the caller, not here: "The character 0 (0x00) has special meaning as the null character and is always deleted by WordPerfect", which is a stream-level rule about skipping a byte rather than a character that decodes to nothing.
export function decodeSingleByteCharacter(byte: number): string | undefined {
  const shorthand = SINGLE_BYTE_SHORTHAND.get(byte);
  if (shorthand !== undefined) {
    return shorthand;
  }
  if (byte >= FIRST_ASCII_CHARACTER && byte <= LAST_CHARACTER) {
    return String.fromCharCode(byte);
  }
  return undefined;
}

// A caller with no separate length prefix of its own to bound the read — it just wants "the rest of this buffer, read as a word string" — passes this rather than computing its own arithmetic bound from the buffer's own remaining length: decodeWordString already stops at the first null word or the moment `bytes[]` itself answers undefined past the buffer's real end (see its own comment below), so any caller-computed cap merely restates that same stopping point and can never be observed to change the text decoded. `Number.POSITIVE_INFINITY` is a genuine sentinel for "no separate bound", not a magic number: the while loop's own `wordsRead < maxWords` holds for every finite wordsRead, exactly the "keep going until the buffer itself ends" behaviour these callers want.
export const UNBOUNDED_WORDS = Number.POSITIVE_INFINITY;

// Decodes a WP word string: a run of 16-bit values, each "the high byte is the number of the WordPerfect character set, the low byte contains an offset value into the character set", terminated by a null word. Used by packet data (a typeface name, a comment, a bookmark name), never by the document area's own byte stream.
//
// Reads at most `maxWords` words and stops at the first null word or at the end of the available bytes, whichever comes first — an unterminated string is the packet running out, not a failure to raise, since a WordPerfect packet's own last string legitimately abuts the packet's end.
export function decodeWordString(
  bytes: Uint8Array,
  offset: number,
  maxWords: number,
): { text: string; wordsRead: number } {
  let text = "";
  let wordsRead = 0;
  while (wordsRead < maxWords) {
    const low = bytes[offset + wordsRead * 2];
    const high = bytes[offset + wordsRead * 2 + 1];
    if (low === undefined || high === undefined) {
      break;
    }
    wordsRead += 1;
    if (low === 0 && high === 0) {
      break;
    }
    text += decodeWpCharacter(high, low) ?? UNMAPPED_CHARACTER;
  }
  return { text, wordsRead };
}
