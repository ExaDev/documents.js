// The WHATWG Encoding Standard's legacy multi-byte and double-byte CJK encodings (Shift_JIS, EUC-JP, EUC-KR, GBK, gb18030, Big5; https://encoding.spec.whatwg.org/#legacy-multi-byte-chinese--japanese--korean-encodings) that decode.ts's DECODERS record wires in alongside legacy-single-byte-tables.ts's own single-byte code pages — the harder remainder ExaDev/documents.js#1361 deliberately left for ExaDev/documents.js#1388, because these need a variable-width decoder over pointer-keyed index tables with tens of thousands of entries rather than a further fixed 256-byte lookup. ISO-2022-JP, the one encoding in this family that is a genuine escape-sequence state machine rather than a byte-width decoder, lives in decode-iso-2022-jp.ts instead: a different decoder shape again, closer to a small parser than a lookup, and kept apart so this file stays one kind of thing.
//
// Every decoder here is a direct transliteration of its own named section of the Encoding Standard (linked in each function's own doc comment), working against dbcs-tables.ts's generated pointer-keyed index tables (themselves generated from the Encoding Standard's own published indexes.json — see that file's own header comment and scripts/generate-dbcs-tables.mjs). The one deliberate departure from the standard's own algorithms: every one of them is written as a streaming state machine that can recover from a bad byte by re-queuing it and continuing, since a browser's TextDecoder must never throw. This module has no such requirement and, like decodeLegacySingleByte in decode.ts, throws loudly on any byte sequence the encoding does not define rather than silently substituting U+FFFD and carrying on — decodeText's whole design is "malformed input is a loud, actionable refusal", not "always produce some text". Concretely: the Encoding Standard's own decoders never fail the whole stream, since a byte that fails to complete a valid sequence is pushed back and reprocessed as the start of a new one, with a single U+FFFD standing in for the byte(s) already consumed; here, the equivalent condition throws {@link UndecodableTextError} immediately, since the decode has already been proven, by that very condition, not to fully describe the bytes it was given.
//
// Every decoder shares one shape: an explicit byte-position state machine (never more than a small number of pending lead bytes) walking the input once, looking up a pointer in one of dbcs-tables.ts's tables via {@link pointerCodePoint}, and appending the result through decode.ts's own {@link appendCodePoint}/{@link fromCodeUnits} so a supplementary-plane result (Big5's CJK Compatibility Ideographs Supplement entries, gb18030's final algorithmic range) is split into a surrogate pair the same way every other decoder in this package already does.

import { appendCodePoint, fromCodeUnits, UndecodableTextError } from "./decode";
import {
  BIG5,
  EUC_KR,
  GB18030,
  GB18030_RANGES,
  JIS0208,
  JIS0212,
} from "./dbcs-tables";

/**
 * A legacy multi-byte or double-byte CJK encoding {@link decodeText} can decode when the caller declares it explicitly, decoded by this file's own decoders. Never produced by detection, for the same reason a {@link LegacySingleByteEncodingLabel} never is: nothing distinguishes one of these code pages from another, or from any single-byte encoding, without the statistical model this module does not carry (see {@link TextEncodingLabel}). `gbk` and `gb18030` share one decoder ({@link decodeGb18030}) because the Encoding Standard defines GBK's decoder as gb18030's own (https://encoding.spec.whatwg.org/#gbk-decoder).
 */
export type DbcsEncodingLabel =
  "shift_jis" | "euc-jp" | "euc-kr" | "gbk" | "gb18030" | "big5";

/** The value {@link JIS0208}, {@link JIS0212}, {@link BIG5}, {@link EUC_KR} and {@link GB18030} hold at a pointer the Encoding Standard's own index leaves undefined — see dbcs-tables.ts's own header comment for why -1 rather than null or NaN. */
const UNDEFINED_POINTER = -1;

/** The last byte value the Encoding Standard's own "ASCII byte" term covers (0x00 to 0x7F inclusive) in every one of these encodings: below this, and outside each encoding's own designated multi-byte lead range, a byte is its own code point unchanged. */
const ASCII_BYTE_MAX = 0x7f;

/**
 * The Unicode code point {@link JIS0208}, {@link JIS0212}, {@link BIG5}, {@link EUC_KR} or {@link GB18030} holds at `pointer` — the Encoding Standard's own "index code point" (https://encoding.spec.whatwg.org/#index-code-point) operation — or `undefined` when `pointer` lands on {@link UNDEFINED_POINTER}, the table's own gap marker, or falls outside the table entirely.
 *
 * A pointer past the end of the table is never checked for separately: `table[pointer]` for such a pointer is already `undefined` under this project's `noUncheckedIndexedAccess`, exactly the value this function returns for the table's own in-range gap marker too, so there is nothing a dedicated bounds check could return that reading straight through does not already give. No real call from this file's own decoders can produce an out-of-range pointer in any case — every one of them computes `pointer` from a byte pair its own lead/trail ranges bound, and each such range is sized to match its own table's length exactly (JIS0208's 11280 entries are precisely 188 columns × 60 lead-byte rows, and so on for every other table here) — but the type stays honest about it regardless, and this function's own exported unit tests exercise an out-of-range pointer directly rather than leaving that guarantee unverified.
 * @param table - One of dbcs-tables.ts's generated pointer-keyed index tables.
 * @param pointer - The pointer computed from a decoder's lead and trailing bytes.
 * @returns The code point at that pointer, or `undefined` when the table leaves it undefined.
 */
export function pointerCodePoint(
  table: readonly number[],
  pointer: number,
): number | undefined {
  // No separate "is pointer out of range" check: table[pointer] for an out-of-range pointer is already `undefined`, exactly the value this returns for the table's own in-range gap marker, so a check that only ever matched that same already-`undefined` value would return an identical result whether it fired or not.
  const codePoint = table[pointer];
  return codePoint === UNDEFINED_POINTER ? undefined : codePoint;
}

function malformed(label: string, detail: string): never {
  throw new UndecodableTextError("malformed", `${label} ${detail}`);
}

function truncated(label: string): never {
  malformed(label, "ends with an incomplete multi-byte sequence");
}

/**
 * Big5's own four hardcoded pointer exceptions where a single lead/trail byte pair decodes to *two* Unicode code points rather than one — combining-diacritic spellings of vowels HKSCS adds that Big5's own index, limited like every WHATWG index to single code points, cannot hold directly (https://encoding.spec.whatwg.org/#big5-decoder, the table immediately under "If there is a row in the table below whose first column is pointer"). Checked before the general {@link BIG5} lookup, exactly as the standard's own decoder algorithm does.
 */
const BIG5_DOUBLE_CODE_POINT_POINTERS: ReadonlyMap<
  number,
  readonly [number, number]
> = new Map([
  [1133, [0x00ca, 0x0304]], // Ê̄
  [1135, [0x00ca, 0x030c]], // Ê̌
  [1164, [0x00ea, 0x0304]], // ê̄
  [1166, [0x00ea, 0x030c]], // ê̌
]);

/** The number of columns Shift_JIS, Big5 and gb18030 all give their shared low trailing-byte band, 0x40-0x7E — named so {@link twoByteTrailColumn}'s high-band column reads as "continuing on from the low band" rather than restating this same derived count as an unexplained literal. */
const LOW_TRAIL_BYTE_COUNT = 0x7e - 0x40 + 1;

/**
 * The pointer column a trailing byte contributes for Shift_JIS, Big5 and gb18030's own two-byte forms, whose trailing-byte range always splits into the same low band (0x40-0x7E) plus an encoding-specific high band (`highBandStart` to `highBandEnd`) — or `undefined` when `byte` falls in neither. Shared here rather than reimplemented per decoder specifically so every boundary comparison is written against a byte value the range can actually reach (0x40, 0x7E, and each caller's own high-band ends), never a threshold sitting in a gap no valid byte ever lands in: a decoder written the Encoding Standard's own way, subtracting a byte-range-specific "offset" chosen so a boundary byte and its threshold happen to coincide, has no way to make a boundary comparison mutation observable when the coincidence itself is what the surrounding range check already guarantees — this instead keys every column directly off the low band's own reachable extremes, so a single off-by-one in any comparison here changes a real byte's result rather than only a value that string of range checks already ruled out beforehand.
 * @param byte - The trailing byte to place, whatever the lead byte turned out to be.
 * @param highBandStart - The first byte value of this encoding's own high trailing band.
 * @param highBandEnd - The last byte value of this encoding's own high trailing band.
 * @returns The pointer column `byte` contributes, or `undefined` when it names neither band.
 */
function twoByteTrailColumn(
  byte: number,
  highBandStart: number,
  highBandEnd: number,
): number | undefined {
  if (byte >= 0x40 && byte <= 0x7e) {
    return byte - 0x40;
  }
  if (byte >= highBandStart && byte <= highBandEnd) {
    return byte - highBandStart + LOW_TRAIL_BYTE_COUNT;
  }
  return undefined;
}

/**
 * Decodes bytes as Shift_JIS (https://encoding.spec.whatwg.org/#shift_jis-decoder).
 *
 * A single-lead-byte state machine: bytes below 0x80 (plus 0x80 itself) are their own code point, 0xA1-0xDF are halfwidth katakana computed directly rather than through a table, and 0x81-0x9F/0xE0-0xFC lead a second byte whose pair looks up {@link JIS0208} by pointer. A pointer in the 8836-10715 range is Microsoft's own End User Defined Characters (EUDC) block, mapped onto the Unicode Private Use Area rather than through the table at all — interoperable legacy the standard itself calls out by name.
 * @param bytes - The bytes to decode.
 * @returns The decoded text.
 * @throws UndecodableTextError When the bytes contain a byte or byte pair Shift_JIS leaves undefined, or end with an incomplete two-byte sequence.
 */
export function decodeShiftJis(bytes: Uint8Array): string {
  const units: number[] = [];
  let leading = 0;
  for (const byte of bytes) {
    if (leading !== 0) {
      const leadingByte = leading;
      leading = 0;
      const leadingOffset = leadingByte <= 0x9f ? 0x81 : 0xc1;
      const column = twoByteTrailColumn(byte, 0x80, 0xfc);
      const pointer =
        column === undefined
          ? undefined
          : (leadingByte - leadingOffset) * 188 + column;
      if (pointer !== undefined && pointer >= 8836 && pointer <= 10715) {
        appendCodePoint(units, 0xe000 - 8836 + pointer);
        continue;
      }
      const codePoint =
        pointer === undefined ? undefined : pointerCodePoint(JIS0208, pointer);
      if (codePoint === undefined) {
        malformed(
          "Shift_JIS",
          `has no character for lead byte 0x${leadingByte.toString(16)} trail byte 0x${byte.toString(16)}`,
        );
      }
      appendCodePoint(units, codePoint);
      continue;
    }
    if (byte <= ASCII_BYTE_MAX || byte === 0x80) {
      units.push(byte);
    } else if (byte >= 0xa1 && byte <= 0xdf) {
      appendCodePoint(units, 0xff61 - 0xa1 + byte);
      // byte reaching this point is already known to be 0x81 or above (everything below is consumed by the two branches above), so only each band's own upper bound needs checking.
    } else if (byte <= 0x9f || (byte >= 0xe0 && byte <= 0xfc)) {
      leading = byte;
    } else {
      malformed(
        "Shift_JIS",
        `has no character for byte 0x${byte.toString(16)}`,
      );
    }
  }
  if (leading !== 0) {
    truncated("Shift_JIS");
  }
  return fromCodeUnits(units);
}

/**
 * Decodes bytes as EUC-JP (https://encoding.spec.whatwg.org/#euc-jp-decoder).
 *
 * A three-shape state machine: ASCII passes through unchanged, a 0x8E lead byte introduces a single halfwidth-katakana trail byte, a 0x8F lead byte introduces a JIS X 0212 two-byte pair (looked up in {@link JIS0212}), and any other 0xA1-0xFE lead byte introduces a JIS X 0208 two-byte pair (looked up in {@link JIS0208}).
 * @param bytes - The bytes to decode.
 * @returns The decoded text.
 * @throws UndecodableTextError When the bytes contain a byte or byte pair EUC-JP leaves undefined, or end with an incomplete multi-byte sequence.
 */
export function decodeEucJp(bytes: Uint8Array): string {
  const units: number[] = [];
  let leading = 0;
  let jis0212 = false;
  for (const byte of bytes) {
    if (leading === 0x8e && byte >= 0xa1 && byte <= 0xdf) {
      leading = 0;
      appendCodePoint(units, 0xff61 - 0xa1 + byte);
      continue;
    }
    if (leading === 0x8f && byte >= 0xa1 && byte <= 0xfe) {
      jis0212 = true;
      leading = byte;
      continue;
    }
    if (leading !== 0) {
      const leadingByte = leading;
      leading = 0;
      const usedJis0212 = jis0212;
      jis0212 = false;
      // No separate "is leadingByte 0x8E or 0x8F" check: leadingByte reaching here is always 0x8E, 0x8F, or a byte the fallback dispatch below already constrained to 0xA1-0xFE, and for 0x8E/0x8F specifically, (leadingByte - 0xA1) * 94 always comes out deeply negative (both are only a little below 0xA1, but 94 is enough to push the product well past any byte-sized offset byte - 0xA1 could add back), so the pointer this computes for them is always negative and pointerCodePoint always resolves a negative pointer to undefined — exactly the malformed() call a dedicated check would otherwise reach, with an identical message either way, since that call names leadingByte and byte directly rather than why the pointer they produced turned out undefined.
      const inRange = byte >= 0xa1 && byte <= 0xfe;
      const codePoint = inRange
        ? pointerCodePoint(
            usedJis0212 ? JIS0212 : JIS0208,
            (leadingByte - 0xa1) * 94 + byte - 0xa1,
          )
        : undefined;
      if (codePoint === undefined) {
        malformed(
          "EUC-JP",
          `has no character for lead byte 0x${leadingByte.toString(16)} trail byte 0x${byte.toString(16)}`,
        );
      }
      appendCodePoint(units, codePoint);
      continue;
    }
    if (byte <= ASCII_BYTE_MAX) {
      units.push(byte);
    } else if (
      byte === 0x8e ||
      byte === 0x8f ||
      (byte >= 0xa1 && byte <= 0xfe)
    ) {
      leading = byte;
    } else {
      malformed("EUC-JP", `has no character for byte 0x${byte.toString(16)}`);
    }
  }
  if (leading !== 0) {
    truncated("EUC-JP");
  }
  return fromCodeUnits(units);
}

/**
 * Decodes bytes as EUC-KR (https://encoding.spec.whatwg.org/#euc-kr-decoder).
 *
 * The simplest of these decoders: a single lead byte in 0x81-0xFE introduces a single trail byte in 0x41-0xFE, and the pair looks up {@link EUC_KR} by pointer.
 * @param bytes - The bytes to decode.
 * @returns The decoded text.
 * @throws UndecodableTextError When the bytes contain a byte or byte pair EUC-KR leaves undefined, or end with an incomplete two-byte sequence.
 */
export function decodeEucKr(bytes: Uint8Array): string {
  const units: number[] = [];
  let leading = 0;
  for (const byte of bytes) {
    if (leading !== 0) {
      const leadingByte = leading;
      leading = 0;
      const codePoint =
        byte >= 0x41 && byte <= 0xfe
          ? pointerCodePoint(EUC_KR, (leadingByte - 0x81) * 190 + byte - 0x41)
          : undefined;
      if (codePoint === undefined) {
        malformed(
          "EUC-KR",
          `has no character for lead byte 0x${leadingByte.toString(16)} trail byte 0x${byte.toString(16)}`,
        );
      }
      appendCodePoint(units, codePoint);
      continue;
    }
    if (byte <= ASCII_BYTE_MAX) {
      units.push(byte);
    } else if (byte >= 0x81 && byte <= 0xfe) {
      leading = byte;
    } else {
      malformed("EUC-KR", `has no character for byte 0x${byte.toString(16)}`);
    }
  }
  if (leading !== 0) {
    truncated("EUC-KR");
  }
  return fromCodeUnits(units);
}

/**
 * Decodes bytes as Big5 (https://encoding.spec.whatwg.org/#big5-decoder).
 *
 * A single lead byte in 0x81-0xFE introduces a trail byte in 0x40-0x7E or 0xA1-0xFE, and the pair looks up {@link BIG5} by pointer — except for {@link BIG5_DOUBLE_CODE_POINT_POINTERS}'s four pointers, checked first, which decode to two code points rather than one.
 * @param bytes - The bytes to decode.
 * @returns The decoded text.
 * @throws UndecodableTextError When the bytes contain a byte or byte pair Big5 leaves undefined, or end with an incomplete two-byte sequence.
 */
export function decodeBig5(bytes: Uint8Array): string {
  const units: number[] = [];
  let leading = 0;
  for (const byte of bytes) {
    if (leading !== 0) {
      const leadingByte = leading;
      leading = 0;
      const column = twoByteTrailColumn(byte, 0xa1, 0xfe);
      const pointer =
        column === undefined ? undefined : (leadingByte - 0x81) * 157 + column;
      const doubled =
        pointer === undefined
          ? undefined
          : BIG5_DOUBLE_CODE_POINT_POINTERS.get(pointer);
      if (doubled !== undefined) {
        appendCodePoint(units, doubled[0]);
        appendCodePoint(units, doubled[1]);
        continue;
      }
      const codePoint =
        pointer === undefined ? undefined : pointerCodePoint(BIG5, pointer);
      if (codePoint === undefined) {
        malformed(
          "Big5",
          `has no character for lead byte 0x${leadingByte.toString(16)} trail byte 0x${byte.toString(16)}`,
        );
      }
      appendCodePoint(units, codePoint);
      continue;
    }
    if (byte <= ASCII_BYTE_MAX) {
      units.push(byte);
    } else if (byte >= 0x81 && byte <= 0xfe) {
      leading = byte;
    } else {
      malformed("Big5", `has no character for byte 0x${byte.toString(16)}`);
    }
  }
  if (leading !== 0) {
    truncated("Big5");
  }
  return fromCodeUnits(units);
}

/**
 * The number of distinct values gb18030's own third byte (0x81-0xFE) can take, and the number of distinct values its own second and fourth bytes (0x30-0x39) can take — the two factors the Encoding Standard's own gb18030 decoder algorithm multiplies together (as `10 × 126` and `10 × 126 × 10`) to place each of the four bytes in a four-byte pointer's own positional value. Named so the arithmetic in {@link decodeGb18030} reads as the byte-range sizes it actually is, rather than as two bare products of unexplained digits.
 */
const GB18030_SECOND_FOURTH_BYTE_COUNT = 10;
const GB18030_THIRD_BYTE_COUNT = 126;

/**
 * The Unicode code point gb18030's own algorithmic four-byte form holds at `pointer` (https://encoding.spec.whatwg.org/#index-gb18030-ranges-code-point), computed from {@link GB18030_RANGES} rather than looked up directly: that table holds only the code point at the *start* of each contiguous range, so the result is that start plus how far `pointer` sits past it.
 * @param pointer - The four-byte pointer computed from a gb18030 lead, second, third and trailing byte.
 * @returns The code point at that pointer, or `undefined` when gb18030 leaves it undefined.
 */
function gb18030RangesCodePoint(pointer: number): number | undefined {
  const EXCLUDED_RANGE_START = 39419;
  const EXCLUDED_RANGE_END = 189000;
  const MAX_RANGES_POINTER = 1237575;
  const PUA_EXCEPTION_POINTER = 7457;
  const PUA_EXCEPTION_CODE_POINT = 0xe7c7;
  if (
    (pointer > EXCLUDED_RANGE_START && pointer < EXCLUDED_RANGE_END) ||
    pointer > MAX_RANGES_POINTER
  ) {
    return undefined;
  }
  if (pointer === PUA_EXCEPTION_POINTER) {
    return PUA_EXCEPTION_CODE_POINT;
  }
  // The last range whose own pointer is at or below the one being decoded, found from the end of GB18030_RANGES since it is sorted ascending by pointer (dbcs-tables.ts's own header comment): every range covers every pointer from its own start up to (but not including) the next range's start, so this is always the range `pointer` falls inside. A plain scan bounded by GB18030_RANGES's own length rather than a hand-tracked binary-search midpoint: with only 207 ranges the difference is not a performance concern, and it removes the index arithmetic a binary search would otherwise need, which is exactly the kind of thing a single off-by-one mutation turns into an infinite loop rather than a wrong answer.
  const range = GB18030_RANGES.findLast(
    ([rangeStart]) => rangeStart <= pointer,
  );
  if (range === undefined) {
    return undefined;
  }
  const [rangeStart, codePointOffset] = range;
  return codePointOffset + (pointer - rangeStart);
}

/**
 * Decodes bytes as gb18030 (https://encoding.spec.whatwg.org/#gb18030-decoder). GBK's own decoder is defined by the Encoding Standard as identical to gb18030's (https://encoding.spec.whatwg.org/#gbk-decoder: "GBK's decoder is gb18030's decoder"), so this one function serves both `gbk` and `gb18030` in decode.ts's DECODERS record.
 *
 * A four-byte-lookahead state machine: a lead byte in 0x81-0xFE introduces either a two-byte form (a second byte outside 0x30-0x39, looked up in {@link GB18030} by pointer) or gb18030's own algorithmic four-byte form (a second byte in 0x30-0x39, then a third byte in 0x81-0xFE and a fourth byte in 0x30-0x39, resolved through {@link gb18030RangesCodePoint}). Byte 0x80 alone decodes to U+20AC (€), a fixed exception the standard states directly.
 * @param bytes - The bytes to decode.
 * @returns The decoded text.
 * @throws UndecodableTextError When the bytes contain a byte or byte sequence gb18030 leaves undefined, or end with an incomplete multi-byte sequence.
 */
export function decodeGb18030(bytes: Uint8Array): string {
  const units: number[] = [];
  let first = 0;
  let second = 0;
  let third = 0;
  for (const byte of bytes) {
    if (third !== 0) {
      if (byte < 0x30 || byte > 0x39) {
        malformed(
          "gb18030",
          `has no character for four-byte sequence 0x${first.toString(16)} 0x${second.toString(16)} 0x${third.toString(16)} 0x${byte.toString(16)}: fourth byte is not 0x30-0x39`,
        );
      }
      const pointer =
        (first - 0x81) *
          (GB18030_SECOND_FOURTH_BYTE_COUNT *
            GB18030_THIRD_BYTE_COUNT *
            GB18030_SECOND_FOURTH_BYTE_COUNT) +
        (second - 0x30) *
          (GB18030_SECOND_FOURTH_BYTE_COUNT * GB18030_THIRD_BYTE_COUNT) +
        (third - 0x81) * GB18030_SECOND_FOURTH_BYTE_COUNT +
        (byte - 0x30);
      const codePoint = gb18030RangesCodePoint(pointer);
      const failedFirst = first;
      const failedSecond = second;
      const failedThird = third;
      first = 0;
      second = 0;
      third = 0;
      if (codePoint === undefined) {
        malformed(
          "gb18030",
          `has no character for four-byte sequence 0x${failedFirst.toString(16)} 0x${failedSecond.toString(16)} 0x${failedThird.toString(16)} 0x${byte.toString(16)}`,
        );
      }
      appendCodePoint(units, codePoint);
      continue;
    }
    if (second !== 0) {
      if (byte >= 0x81 && byte <= 0xfe) {
        third = byte;
        continue;
      }
      malformed(
        "gb18030",
        `has no character for byte sequence 0x${first.toString(16)} 0x${second.toString(16)} 0x${byte.toString(16)}: third byte is not 0x81-0xFE`,
      );
    }
    if (first !== 0) {
      if (byte >= 0x30 && byte <= 0x39) {
        second = byte;
        continue;
      }
      const leadingByte = first;
      first = 0;
      const column = twoByteTrailColumn(byte, 0x80, 0xfe);
      const pointer =
        column === undefined ? undefined : (leadingByte - 0x81) * 190 + column;
      const codePoint =
        pointer === undefined ? undefined : pointerCodePoint(GB18030, pointer);
      if (codePoint === undefined) {
        malformed(
          "gb18030",
          `has no character for lead byte 0x${leadingByte.toString(16)} trail byte 0x${byte.toString(16)}`,
        );
      }
      appendCodePoint(units, codePoint);
      continue;
    }
    if (byte <= ASCII_BYTE_MAX) {
      units.push(byte);
    } else if (byte === 0x80) {
      units.push(0x20ac);
      // byte reaching this point is already known to be 0x81 or above (everything below is consumed by the two branches above), so only this band's own upper bound needs checking.
    } else if (byte <= 0xfe) {
      first = byte;
    } else {
      malformed("gb18030", `has no character for byte 0x${byte.toString(16)}`);
    }
  }
  // second and third are never assigned outside the `first !== 0` branch above, and every path that resets any one of the three resets all three together, so first !== 0 alone already covers every state this loop can end in with a pending byte still unconsumed — checking second and third here too would only ever repeat a condition first !== 0 has already proven.
  if (first !== 0) {
    truncated("gb18030");
  }
  return fromCodeUnits(units);
}
