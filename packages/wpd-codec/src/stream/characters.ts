// -- WordPerfect's character model, per WPFF "Single-Byte Characters and Functions" and WPFF Document Structure's glossary --
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
const DEFAULT_EXTENDED_INTERNATIONAL: readonly (readonly [
  byteValue: number,
  characterNumber: number,
  glyph: string,
])[] = [
  [0x01, 35, "å"], // a-ring
  [0x02, 34, "Å"], // A-ring
  [0x03, 37, "æ"], // ae
  [0x04, 36, "Æ"], // AE
  [0x05, 31, "ä"], // a-diaeresis
  [0x06, 30, "Ä"], // A-diaeresis
  [0x07, 27, "á"], // a-acute
  [0x08, 33, "à"], // a-grave
  [0x09, 29, "â"], // a-circumflex
  [0x0a, 77, "ã"], // a-tilde
  [0x0b, 76, "Ã"], // A-tilde
  [0x0c, 39, "ç"], // c-cedilla
  [0x0d, 38, "Ç"], // C-cedilla
  [0x0e, 45, "ë"], // e-diaeresis
  [0x0f, 41, "é"], // e-acute
  [0x10, 40, "É"], // E-acute
  [0x11, 47, "è"], // e-grave
  [0x12, 43, "ê"], // e-circumflex
  [0x13, 49, "í"], // i-acute
  [0x14, 57, "ñ"], // n-tilde
  [0x15, 56, "Ñ"], // N-tilde
  [0x16, 81, "ø"], // o-slash
  [0x17, 80, "Ø"], // O-slash
  [0x18, 83, "õ"], // o-tilde
  [0x19, 82, "Õ"], // O-tilde
  [0x1a, 63, "ö"], // o-diaeresis
  [0x1b, 62, "Ö"], // O-diaeresis
  [0x1c, 71, "ü"], // u-diaeresis
  [0x1d, 70, "Ü"], // U-diaeresis
  [0x1e, 67, "ú"], // u-acute
  [0x1f, 73, "ù"], // u-grave
  [0x20, 23, "ß"], // sharp s
];

const SINGLE_BYTE_SHORTHAND: ReadonlyMap<number, string> = new Map(
  DEFAULT_EXTENDED_INTERNATIONAL.map(([byteValue, , glyph]) => [
    byteValue,
    glyph,
  ]),
);

// The lowest byte value that is a literal ASCII character rather than one of the thirty-two international shorthands.
export const FIRST_ASCII_CHARACTER = 0x21;

// The highest byte value that is a character at all; 128 (0x80) and above is a function.
export const LAST_CHARACTER = 0x7f;

// What a character this package cannot name decodes to. U+FFFD is the right glyph precisely because it is visible: a reader looking at the output can see that something was there and was not understood, which silently dropping the character or substituting a plausible-looking one would both hide. Every occurrence is also reported through the diagnostic sink, so a caller can count them rather than having to eyeball the text.
export const UNMAPPED_CHARACTER = "�";

// Character set 0 is ASCII. The SDK's table runs 33 (0x21) to 127 (0x7F) and each entry maps to the identically-numbered ASCII character; the range below starts at 32 because a set-0 character *number* of 32 (reached through the extended-character function, or inside a word string) genuinely is a space -- it is only the single-byte document stream where byte 0x20 means something else.
function decodeAsciiSet(characterNumber: number): string | undefined {
  if (characterNumber < 0x20 || characterNumber > 0x7f) {
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

// A caller with no separate length prefix of its own to bound the read -- it just wants "the rest of this buffer, read as a word string" -- passes this rather than computing its own arithmetic bound from the buffer's own remaining length: decodeWordString already stops at the first null word or the moment `bytes[]` itself answers undefined past the buffer's real end (see its own comment below), so any caller-computed cap merely restates that same stopping point and can never be observed to change the text decoded. `Number.POSITIVE_INFINITY` is a genuine sentinel for "no separate bound", not a magic number: the while loop's own `wordsRead < maxWords` holds for every finite wordsRead, exactly the "keep going until the buffer itself ends" behaviour these callers want.
export const UNBOUNDED_WORDS = Number.POSITIVE_INFINITY;

// Decodes a WP word string: a run of 16-bit values, each "the high byte is the number of the WordPerfect character set, the low byte contains an offset value into the character set", terminated by a null word. Used by packet data (a typeface name, a comment, a bookmark name), never by the document area's own byte stream.
//
// Reads at most `maxWords` words and stops at the first null word or at the end of the available bytes, whichever comes first -- an unterminated string is the packet running out, not a failure to raise, since a WordPerfect packet's own last string legitimately abuts the packet's end.
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
