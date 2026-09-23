// ISO-2022-JP (https://encoding.spec.whatwg.org/#iso-2022-jp-decoder), the one legacy CJK encoding in decode-dbcs.ts's own family that is a genuine escape-sequence state machine rather than a byte-width decoder over a lookup table — every other decoder there walks a fixed number of lead/trail bytes and looks up a pointer; this one carries a mode (ASCII, JIS X 0201 Roman, JIS X 0201 Katakana, or JIS X 0208 two-byte) across the whole input, switched by three-byte escape sequences (`ESC ( B`, `ESC ( J`, `ESC ( I`, `ESC $ @`, `ESC $ B`) that can appear between any two characters. Kept in its own file rather than folded into decode-dbcs.ts for exactly that reason: a small parser, not a lookup.
//
// Same departure from the Encoding Standard's own algorithm as every decoder in decode-dbcs.ts: the standard's own decoder never fails outright (a byte that cannot complete the current step is pushed back and reprocessed as the start of a new one, with a single U+FFFD standing in for whatever was already consumed), because a browser's TextDecoder must never throw. This module throws {@link UndecodableTextError} instead, including for the standard's own "redundant designator escape" case (see decodeIso2022Jp's own doc comment) — a state that produces no character and would insert a single U+FFFD under the standard's own algorithm, and which this module's throw-on-malformed house style treats as it does every other case where the bytes have already been proven not to describe the input they were given.

import { fromCodeUnits, UndecodableTextError } from "./decode";
import { JIS0208 } from "./dbcs-tables";

/** ISO-2022-JP's own label — its own union member, kept apart from {@link DbcsEncodingLabel} in decode-dbcs.ts, for the reason this file's own header comment gives. */
export type Iso2022JpEncodingLabel = "iso-2022-jp";

function malformed(detail: string): never {
  throw new UndecodableTextError("malformed", `ISO-2022-JP ${detail}`);
}

function truncated(): never {
  malformed("ends with an incomplete multi-byte or escape sequence");
}

/**
 * The designated character set ISO-2022-JP's own decoder is currently reading bytes as — `escapeStart`/`escape` are themselves states in the Encoding Standard's own algorithm, entered on 0x1B and left once the designator sequence resolves or fails, not merely a flag layered on top of the four real modes.
 */
type Iso2022JpState =
  | "ascii"
  | "roman"
  | "katakana"
  | "leadingByte"
  | "trailingByte"
  | "escapeStart"
  | "escape";

/** The byte value that begins every ISO-2022-JP escape sequence, wherever this decoder is. */
const ESCAPE = 0x1b;

/** JIS X 0201 Katakana's own byte range (0x21-0x5F), mapped directly onto the same halfwidth katakana Unicode block decode-dbcs.ts's Shift_JIS and EUC-JP decoders both compute from their own byte ranges (0xFF61 plus the byte's own offset from the range's first value). */
const KATAKANA_FIRST_BYTE = 0x21;
const KATAKANA_LAST_BYTE = 0x5f;
const HALFWIDTH_KATAKANA_START = 0xff61;

/** JIS X 0208's own index byte range (0x21-0x7E) for both the leading and trailing byte of a two-byte pointer. */
const JIS0208_INDEX_BYTE_MIN = 0x21;
const JIS0208_INDEX_BYTE_MAX = 0x7e;
const JIS0208_INDEX_COLUMNS = 94;

/**
 * Whether `byte` is one this decoder's ASCII and Roman states pass through unchanged: any byte below 0x80 except the two Shift-Out/Shift-In control codes (0x0E, 0x0F) a different ISO-2022 variant uses for a switching mechanism this decoder does not support. No check for {@link ESCAPE} here: both callers (the "ascii" and "roman" cases below) already intercept it with their own `byte === ESCAPE` branch before ever reaching this function, so `byte` here is never that value in the first place.
 */
function isPlainByte(byte: number): boolean {
  return byte <= 0x7f && byte !== 0x0e && byte !== 0x0f;
}

/**
 * Decodes bytes as ISO-2022-JP (https://encoding.spec.whatwg.org/#iso-2022-jp-decoder).
 *
 * A stateful decoder carrying one of four designated character sets across the whole input — ASCII, JIS X 0201 Roman (ASCII with 0x5C and 0x7E replaced by ¥ and ‾), JIS X 0201 Katakana (0x21-0x5F as halfwidth katakana), or JIS X 0208 (a two-byte pointer into {@link JIS0208}) — switched by a three-byte escape sequence: `ESC ( B` for ASCII, `ESC ( J` for Roman, `ESC ( I` for Katakana, and either `ESC $ @` or `ESC $ B` for JIS X 0208 (the Encoding Standard treats both the 1978 and 1983 JIS C 6226 designators identically, decoding through the one JIS0208 index either way). Starts in ASCII.
 *
 * One designator escape is refused even though it is syntactically well-formed: two in a row with no character decoded between them. The Encoding Standard's own decoder tracks this with a boolean (`ISO-2022-JP output`, reset to false by every character emitted, by every error, and by entering a JIS X 0208 pair's leading-byte state, set true by every successful designator switch) and, when a second switch arrives before that flag is reset, treats it as an error step rather than a silent state change — confirmed directly against a real browser engine (Node's own `TextDecoder`, which is ICU-backed and implements this algorithm): two designator escapes back to back decode the second one as U+FFFD, while a designator escape that follows a real character, or a partially-read JIS X 0208 pair, does not. This decoder throws where that reference decoder would emit U+FFFD, matching this module's throw-on-malformed house style.
 * @param bytes - The bytes to decode.
 * @returns The decoded text.
 * @throws UndecodableTextError When the bytes contain a byte, byte pair, or escape sequence ISO-2022-JP leaves undefined, a redundant designator escape, or end with an incomplete multi-byte or escape sequence.
 */
export function decodeIso2022Jp(bytes: Uint8Array): string {
  const units: number[] = [];
  let state: Iso2022JpState = "ascii";
  let pending = 0; // ISO-2022-JP's own "leading" byte: a JIS X 0208 lead byte in "trailingByte", or an escape's own 0x24/0x28 byte in "escape".
  let output = false;

  for (const byte of bytes) {
    switch (state) {
      case "ascii": {
        if (byte === ESCAPE) {
          state = "escapeStart";
          continue;
        }
        output = false;
        if (!isPlainByte(byte)) {
          malformed(
            `has no character for byte 0x${byte.toString(16)} in ASCII mode`,
          );
        }
        units.push(byte);
        continue;
      }
      case "roman": {
        if (byte === ESCAPE) {
          state = "escapeStart";
          continue;
        }
        output = false;
        if (byte === 0x5c) {
          units.push(0x00a5); // ¥ YEN SIGN
          continue;
        }
        if (byte === 0x7e) {
          units.push(0x203e); // ‾ OVERLINE
          continue;
        }
        if (!isPlainByte(byte)) {
          malformed(
            `has no character for byte 0x${byte.toString(16)} in Roman mode`,
          );
        }
        units.push(byte);
        continue;
      }
      case "katakana": {
        if (byte === ESCAPE) {
          state = "escapeStart";
          continue;
        }
        output = false;
        if (byte < KATAKANA_FIRST_BYTE || byte > KATAKANA_LAST_BYTE) {
          malformed(
            `has no character for byte 0x${byte.toString(16)} in Katakana mode`,
          );
        }
        units.push(HALFWIDTH_KATAKANA_START - KATAKANA_FIRST_BYTE + byte);
        continue;
      }
      case "leadingByte": {
        if (byte === ESCAPE) {
          state = "escapeStart";
          continue;
        }
        output = false;
        if (byte < JIS0208_INDEX_BYTE_MIN || byte > JIS0208_INDEX_BYTE_MAX) {
          malformed(
            `has no character for byte 0x${byte.toString(16)} as a JIS X 0208 lead byte`,
          );
        }
        pending = byte;
        state = "trailingByte";
        continue;
      }
      case "trailingByte": {
        // Unlike every other state here, none of this state's own branches touch `output`: the Encoding Standard's own algorithm agrees (https://encoding.spec.whatwg.org/#iso-2022-jp-decoder, the "Trailing byte" state's own steps), and this decoder's own doc comment above explains what that omission is actually for.
        const leadingByte = pending;
        state = "leadingByte";
        if (byte === ESCAPE) {
          malformed(
            `has an incomplete JIS X 0208 two-byte sequence: lead byte 0x${leadingByte.toString(16)} was interrupted by an escape sequence`,
          );
        }
        if (byte < JIS0208_INDEX_BYTE_MIN || byte > JIS0208_INDEX_BYTE_MAX) {
          malformed(
            `has no character for lead byte 0x${leadingByte.toString(16)} trail byte 0x${byte.toString(16)}`,
          );
        }
        const pointer =
          (leadingByte - JIS0208_INDEX_BYTE_MIN) * JIS0208_INDEX_COLUMNS +
          byte -
          JIS0208_INDEX_BYTE_MIN;
        const codePoint = JIS0208[pointer];
        if (codePoint === undefined || codePoint === -1) {
          malformed(
            `has no character for lead byte 0x${leadingByte.toString(16)} trail byte 0x${byte.toString(16)}`,
          );
        }
        units.push(codePoint);
        continue;
      }
      case "escapeStart": {
        if (byte === 0x24 || byte === 0x28) {
          pending = byte;
          state = "escape";
          continue;
        }
        // No revert to a remembered "output state" before this throw: the Encoding Standard's own algorithm carries a separate `decoder output state` precisely so a browser's non-fatal decoder can revert to the right mode and keep going after this exact error, but this decoder never continues past a throw, so that state has nothing left to do and this file carries only the one `state` variable.
        malformed(
          `has no supported designator starting with escape byte 0x${byte.toString(16)}`,
        );
        continue;
      }
      case "escape": {
        const leadingEscapeByte = pending;
        pending = 0;
        const nextState: Iso2022JpState | undefined =
          leadingEscapeByte === 0x28 && byte === 0x42
            ? "ascii"
            : leadingEscapeByte === 0x28 && byte === 0x4a
              ? "roman"
              : leadingEscapeByte === 0x28 && byte === 0x49
                ? "katakana"
                : leadingEscapeByte === 0x24 && (byte === 0x40 || byte === 0x42)
                  ? "leadingByte"
                  : undefined;
        if (nextState === undefined) {
          malformed(
            `has an unsupported designator escape sequence 0x1b 0x${leadingEscapeByte.toString(16)} 0x${byte.toString(16)}`,
          );
        }
        state = nextState;
        if (output) {
          malformed(
            "has a redundant designator escape sequence with no characters decoded since the previous one",
          );
        }
        output = true;
        continue;
      }
    }
  }
  if (
    state === "trailingByte" ||
    state === "escapeStart" ||
    state === "escape"
  ) {
    truncated();
  }
  return fromCodeUnits(units);
}
