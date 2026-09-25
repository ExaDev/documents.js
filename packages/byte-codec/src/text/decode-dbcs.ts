// The WHATWG Encoding Standard's legacy multi-byte and double-byte CJK encodings (Shift_JIS, EUC-JP, EUC-KR, GBK, gb18030, Big5; https://encoding.spec.whatwg.org/#legacy-multi-byte-chinese--japanese--korean-encodings) that decode.ts's DECODERS record wires in alongside legacy-single-byte-tables.ts's own single-byte code pages — the harder remainder ExaDev/documents.js#1361 deliberately left for ExaDev/documents.js#1388, because these need a variable-width decoder over pointer-keyed index tables with tens of thousands of entries rather than a further fixed 256-byte lookup. ISO-2022-JP, the one encoding in this family that is a genuine escape-sequence state machine rather than a byte-width decoder, lives in decode-iso-2022-jp.ts instead: a different decoder shape again, closer to a small parser than a lookup, and kept apart so this file stays one kind of thing.
//
// Every decoder here is a direct transliteration of its own named section of the Encoding Standard (linked in each function's own doc comment), working against dbcs-tables.ts's generated pointer-keyed index tables (themselves generated from the Encoding Standard's own published indexes.json — see that file's own header comment and scripts/generate-dbcs-tables.mjs). The one deliberate departure from the standard's own algorithms: every one of them is written as a streaming state machine that can recover from a bad byte by re-queuing it and continuing, since a browser's TextDecoder must never throw. This module has no such requirement and, like decodeLegacySingleByte in decode.ts, throws loudly on any byte sequence the encoding does not define rather than silently substituting U+FFFD and carrying on — decodeText's whole design is "malformed input is a loud, actionable refusal", not "always produce some text". Concretely: the Encoding Standard's own decoders never fail the whole stream, since a byte that fails to complete a valid sequence is pushed back and reprocessed as the start of a new one, with a single U+FFFD standing in for the byte(s) already consumed; here, the equivalent condition throws {@link UndecodableTextError} immediately, since the decode has already been proven, by that very condition, not to fully describe the bytes it was given.
//
// Every decoder shares one shape: an explicit byte-position state machine (never more than a small number of pending lead bytes) walking the input once, looking up a pointer in one of dbcs-tables.ts's tables via {@link pointerCodePoint}, and appending the result through decode.ts's own {@link appendCodePoint}/{@link fromCodeUnits} so a supplementary-plane result (Big5's CJK Compatibility Ideographs Supplement entries, gb18030's final algorithmic range) is split into a surrogate pair the same way every other decoder in this package already does.

import {
  appendCodePoint,
  fromCodeUnits,
  UndecodableTextError,
  type CodeUnitSink,
} from "./decode";
import {
  BIG5,
  EUC_KR,
  GB18030,
  GB18030_RANGES,
  JIS0208,
  JIS0212,
  type DbcsTable,
} from "./dbcs-tables";

/**
 * A legacy multi-byte or double-byte CJK encoding {@link decodeText} can decode when the caller declares it explicitly, decoded by this file's own decoders. Never produced by detection, for the same reason a {@link LegacySingleByteEncodingLabel} never is: nothing distinguishes one of these code pages from another, or from any single-byte encoding, without the statistical model this module does not carry (see {@link TextEncodingLabel}). `gbk` and `gb18030` share one decoder ({@link decodeGb18030}) because the Encoding Standard defines GBK's decoder as gb18030's own (https://encoding.spec.whatwg.org/#gbk-decoder).
 */
export type DbcsEncodingLabel =
  "shift_jis" | "euc-jp" | "euc-kr" | "gbk" | "gb18030" | "big5";

/** The code unit {@link JIS0208}, {@link JIS0212}, {@link BIG5}, {@link EUC_KR} and {@link GB18030}'s own `codeUnits` strings hold at a pointer that is either genuinely undefined or holds an astral code point — see dbcs-tables.ts's own header comment for why U+FFFD is safe as a sentinel here. */
const REPLACEMENT_CHARACTER_CODE_UNIT = 0xfffd;

/** The last byte value the Encoding Standard's own "ASCII byte" term covers (0x00 to 0x7F inclusive) in every one of these encodings: below this, and outside each encoding's own designated multi-byte lead range, a byte is its own code point unchanged. */
const ASCII_BYTE_MAX = 0x7f;
const HEX_RADIX = 16;
/** The halfwidth-katakana byte range JIS X 0201 shares across Shift_JIS and EUC-JP's own single-byte katakana forms, and the Unicode block it maps onto directly (0xFF61 plus the byte's own offset from the range's first value). */
const KATAKANA_BYTE_START = 0xa1;
const KATAKANA_BYTE_END = 0xdf;
const HALFWIDTH_KATAKANA_START = 0xff61;

/**
 * The Unicode code point {@link JIS0208}, {@link JIS0212}, {@link BIG5}, {@link EUC_KR} or {@link GB18030} holds at `pointer` — the Encoding Standard's own "index code point" (https://encoding.spec.whatwg.org/#index-code-point) operation — or `undefined` when `pointer` lands on the table's own gap marker, needs disambiguating against `astral` and turns out to have no entry there either, or falls outside the table entirely.
 *
 * A pointer past the end of `table.codeUnits` is never checked for separately: `String.prototype.charCodeAt` already returns `NaN` for such a pointer, which is never {@link REPLACEMENT_CHARACTER_CODE_UNIT} (a real numeric value), so it falls through to the final `astral.get(pointer)` the same way a genuinely undefined in-range pointer does, and an out-of-range pointer was never inserted into `astral` either — so both cases resolve to `undefined` through the same path without a dedicated bounds check. No real call from this file's own decoders can produce an out-of-range pointer in any case — every one of them computes `pointer` from a byte pair its own lead/trail ranges bound, and each such range is sized to match its own table's length exactly (JIS0208's 11280 entries are precisely 188 columns × 60 lead-byte rows, and so on for every other table here) — but the function stays honest about it regardless, and this function's own exported unit tests exercise an out-of-range pointer directly rather than leaving that guarantee unverified.
 * @param table - One of dbcs-tables.ts's generated pointer-keyed index tables.
 * @param pointer - The pointer computed from a decoder's lead and trailing bytes.
 * @returns The code point at that pointer, or `undefined` when the table leaves it undefined.
 */
export function pointerCodePoint(
  table: DbcsTable,
  pointer: number,
): number | undefined {
  const codeUnit = table.codeUnits.charCodeAt(pointer);
  if (codeUnit !== REPLACEMENT_CHARACTER_CODE_UNIT) {
    return Number.isNaN(codeUnit) ? undefined : codeUnit;
  }
  return table.astral.get(pointer);
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
const BIG5_DOUBLE_POINTER_E_CIRCUMFLEX_MACRON = 1133;
const BIG5_DOUBLE_POINTER_E_CIRCUMFLEX_CARON = 1135;
const BIG5_DOUBLE_POINTER_E_CIRCUMFLEX_MACRON_LOWER = 1164;
const BIG5_DOUBLE_POINTER_E_CIRCUMFLEX_CARON_LOWER = 1166;
const LATIN_E_CIRCUMFLEX = 0x00ca;
const LATIN_E_CIRCUMFLEX_LOWER = 0x00ea;
const COMBINING_MACRON = 0x0304;
const COMBINING_CARON = 0x030c;

const BIG5_DOUBLE_CODE_POINT_POINTERS: ReadonlyMap<
  number,
  readonly [number, number]
> = new Map([
  [
    BIG5_DOUBLE_POINTER_E_CIRCUMFLEX_MACRON,
    [LATIN_E_CIRCUMFLEX, COMBINING_MACRON],
  ], // Ê̄
  [
    BIG5_DOUBLE_POINTER_E_CIRCUMFLEX_CARON,
    [LATIN_E_CIRCUMFLEX, COMBINING_CARON],
  ], // Ê̌
  [
    BIG5_DOUBLE_POINTER_E_CIRCUMFLEX_MACRON_LOWER,
    [LATIN_E_CIRCUMFLEX_LOWER, COMBINING_MACRON],
  ], // ê̄
  [
    BIG5_DOUBLE_POINTER_E_CIRCUMFLEX_CARON_LOWER,
    [LATIN_E_CIRCUMFLEX_LOWER, COMBINING_CARON],
  ], // ê̌
]);

/** The number of columns Shift_JIS, Big5 and gb18030 all give their shared low trailing-byte band, 0x40-0x7E — named so {@link twoByteTrailColumn}'s high-band column reads as "continuing on from the low band" rather than restating this same derived count as an unexplained literal. */
const LOW_TRAIL_BYTE_START = 0x40;
const LOW_TRAIL_BYTE_END = 0x7e;
const LOW_TRAIL_BYTE_COUNT = LOW_TRAIL_BYTE_END - LOW_TRAIL_BYTE_START + 1;

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
  if (byte >= LOW_TRAIL_BYTE_START && byte <= LOW_TRAIL_BYTE_END) {
    return byte - LOW_TRAIL_BYTE_START;
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
const SHIFT_JIS_LOW_LEAD_START = 0x81;
const SHIFT_JIS_LOW_LEAD_END = 0x9f;
// The high lead-byte band's own detection range (0xE0-0xFC) differs from the offset anchor (0xC1) subtracted in the pointer formula: the high band's column space continues on from where the low band's own count ends, so the arithmetic anchor is not the same byte as the band's own first real value.
const SHIFT_JIS_HIGH_LEAD_DETECT_START = 0xe0;
const SHIFT_JIS_HIGH_LEAD_OFFSET_ANCHOR = 0xc1;
const SHIFT_JIS_TRAIL_HIGH_START = 0x80;
const SHIFT_JIS_TRAIL_HIGH_END = 0xfc;
const SHIFT_JIS_COLUMNS = 188;
// A pointer in this range is Microsoft's own End User Defined Characters (EUDC) block, mapped onto the Unicode Private Use Area rather than through JIS0208 at all.
const SHIFT_JIS_EUDC_POINTER_START = 8836;
const SHIFT_JIS_EUDC_POINTER_END = 10715;
const UNICODE_PUA_START = 0xe000;
// The one single byte above ASCII that still passes through unchanged, per the Encoding Standard's own Shift_JIS decoder.
const SHIFT_JIS_SINGLE_BYTE_EXTRA = 0x80;

export function decodeShiftJis(bytes: Uint8Array): string {
  const sink: CodeUnitSink = { units: [] };
  let leading = 0;
  for (const byte of bytes) {
    if (leading !== 0) {
      const leadingByte = leading;
      leading = 0;
      const leadingOffset =
        leadingByte <= SHIFT_JIS_LOW_LEAD_END
          ? SHIFT_JIS_LOW_LEAD_START
          : SHIFT_JIS_HIGH_LEAD_OFFSET_ANCHOR;
      const column = twoByteTrailColumn(
        byte,
        SHIFT_JIS_TRAIL_HIGH_START,
        SHIFT_JIS_TRAIL_HIGH_END,
      );
      const pointer =
        column === undefined
          ? undefined
          : (leadingByte - leadingOffset) * SHIFT_JIS_COLUMNS + column;
      if (
        pointer !== undefined &&
        pointer >= SHIFT_JIS_EUDC_POINTER_START &&
        pointer <= SHIFT_JIS_EUDC_POINTER_END
      ) {
        appendCodePoint(
          sink,
          UNICODE_PUA_START - SHIFT_JIS_EUDC_POINTER_START + pointer,
        );
        continue;
      }
      const codePoint =
        pointer === undefined ? undefined : pointerCodePoint(JIS0208, pointer);
      if (codePoint === undefined) {
        malformed(
          "Shift_JIS",
          `has no character for lead byte 0x${leadingByte.toString(HEX_RADIX)} trail byte 0x${byte.toString(HEX_RADIX)}`,
        );
      }
      appendCodePoint(sink, codePoint);
      continue;
    }
    if (byte <= ASCII_BYTE_MAX || byte === SHIFT_JIS_SINGLE_BYTE_EXTRA) {
      sink.units.push(byte);
    } else if (byte >= KATAKANA_BYTE_START && byte <= KATAKANA_BYTE_END) {
      appendCodePoint(
        sink,
        HALFWIDTH_KATAKANA_START - KATAKANA_BYTE_START + byte,
      );
      // byte reaching this point is already known to be 0x81 or above (everything below is consumed by the two branches above), so only each band's own upper bound needs checking.
    } else if (
      byte <= SHIFT_JIS_LOW_LEAD_END ||
      (byte >= SHIFT_JIS_HIGH_LEAD_DETECT_START &&
        byte <= SHIFT_JIS_TRAIL_HIGH_END)
    ) {
      leading = byte;
    } else {
      malformed(
        "Shift_JIS",
        `has no character for byte 0x${byte.toString(HEX_RADIX)}`,
      );
    }
  }
  if (leading !== 0) {
    truncated("Shift_JIS");
  }
  return fromCodeUnits(sink.units);
}

/**
 * Decodes bytes as EUC-JP (https://encoding.spec.whatwg.org/#euc-jp-decoder).
 *
 * A three-shape state machine: ASCII passes through unchanged, a 0x8E lead byte introduces a single halfwidth-katakana trail byte, a 0x8F lead byte introduces a JIS X 0212 two-byte pair (looked up in {@link JIS0212}), and any other 0xA1-0xFE lead byte introduces a JIS X 0208 two-byte pair (looked up in {@link JIS0208}).
 * @param bytes - The bytes to decode.
 * @returns The decoded text.
 * @throws UndecodableTextError When the bytes contain a byte or byte pair EUC-JP leaves undefined, or end with an incomplete multi-byte sequence.
 */
const EUC_JP_KATAKANA_LEAD = 0x8e;
const EUC_JP_JIS0212_LEAD = 0x8f;
const EUC_JP_INDEX_BYTE_MIN = 0xa1;
const EUC_JP_INDEX_BYTE_MAX = 0xfe;
const EUC_JIS_COLUMNS = 94;

export function decodeEucJp(bytes: Uint8Array): string {
  const sink: CodeUnitSink = { units: [] };
  let leading = 0;
  let jis0212 = false;
  for (const byte of bytes) {
    if (
      leading === EUC_JP_KATAKANA_LEAD &&
      byte >= KATAKANA_BYTE_START &&
      byte <= KATAKANA_BYTE_END
    ) {
      leading = 0;
      appendCodePoint(
        sink,
        HALFWIDTH_KATAKANA_START - KATAKANA_BYTE_START + byte,
      );
      continue;
    }
    if (
      leading === EUC_JP_JIS0212_LEAD &&
      byte >= EUC_JP_INDEX_BYTE_MIN &&
      byte <= EUC_JP_INDEX_BYTE_MAX
    ) {
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
      const inRange =
        byte >= EUC_JP_INDEX_BYTE_MIN && byte <= EUC_JP_INDEX_BYTE_MAX;
      const codePoint = inRange
        ? pointerCodePoint(
            usedJis0212 ? JIS0212 : JIS0208,
            (leadingByte - EUC_JP_INDEX_BYTE_MIN) * EUC_JIS_COLUMNS +
              byte -
              EUC_JP_INDEX_BYTE_MIN,
          )
        : undefined;
      if (codePoint === undefined) {
        malformed(
          "EUC-JP",
          `has no character for lead byte 0x${leadingByte.toString(HEX_RADIX)} trail byte 0x${byte.toString(HEX_RADIX)}`,
        );
      }
      appendCodePoint(sink, codePoint);
      continue;
    }
    if (byte <= ASCII_BYTE_MAX) {
      sink.units.push(byte);
    } else if (
      byte === EUC_JP_KATAKANA_LEAD ||
      byte === EUC_JP_JIS0212_LEAD ||
      (byte >= EUC_JP_INDEX_BYTE_MIN && byte <= EUC_JP_INDEX_BYTE_MAX)
    ) {
      leading = byte;
    } else {
      malformed(
        "EUC-JP",
        `has no character for byte 0x${byte.toString(HEX_RADIX)}`,
      );
    }
  }
  if (leading !== 0) {
    truncated("EUC-JP");
  }
  return fromCodeUnits(sink.units);
}

/**
 * Decodes bytes as EUC-KR (https://encoding.spec.whatwg.org/#euc-kr-decoder).
 *
 * The simplest of these decoders: a single lead byte in 0x81-0xFE introduces a single trail byte in 0x41-0xFE, and the pair looks up {@link EUC_KR} by pointer.
 * @param bytes - The bytes to decode.
 * @returns The decoded text.
 * @throws UndecodableTextError When the bytes contain a byte or byte pair EUC-KR leaves undefined, or end with an incomplete two-byte sequence.
 */
const EUC_KR_LEAD_START = 0x81;
const EUC_KR_LEAD_END = 0xfe;
const EUC_KR_TRAIL_START = 0x41;
const EUC_KR_TRAIL_END = 0xfe;
const EUC_KR_COLUMNS = 190;

export function decodeEucKr(bytes: Uint8Array): string {
  const sink: CodeUnitSink = { units: [] };
  let leading = 0;
  for (const byte of bytes) {
    if (leading !== 0) {
      const leadingByte = leading;
      leading = 0;
      const codePoint =
        byte >= EUC_KR_TRAIL_START && byte <= EUC_KR_TRAIL_END
          ? pointerCodePoint(
              EUC_KR,
              (leadingByte - EUC_KR_LEAD_START) * EUC_KR_COLUMNS +
                byte -
                EUC_KR_TRAIL_START,
            )
          : undefined;
      if (codePoint === undefined) {
        malformed(
          "EUC-KR",
          `has no character for lead byte 0x${leadingByte.toString(HEX_RADIX)} trail byte 0x${byte.toString(HEX_RADIX)}`,
        );
      }
      appendCodePoint(sink, codePoint);
      continue;
    }
    if (byte <= ASCII_BYTE_MAX) {
      sink.units.push(byte);
    } else if (byte >= EUC_KR_LEAD_START && byte <= EUC_KR_LEAD_END) {
      leading = byte;
    } else {
      malformed(
        "EUC-KR",
        `has no character for byte 0x${byte.toString(HEX_RADIX)}`,
      );
    }
  }
  if (leading !== 0) {
    truncated("EUC-KR");
  }
  return fromCodeUnits(sink.units);
}

/**
 * Decodes bytes as Big5 (https://encoding.spec.whatwg.org/#big5-decoder).
 *
 * A single lead byte in 0x81-0xFE introduces a trail byte in 0x40-0x7E or 0xA1-0xFE, and the pair looks up {@link BIG5} by pointer — except for {@link BIG5_DOUBLE_CODE_POINT_POINTERS}'s four pointers, checked first, which decode to two code points rather than one.
 * @param bytes - The bytes to decode.
 * @returns The decoded text.
 * @throws UndecodableTextError When the bytes contain a byte or byte pair Big5 leaves undefined, or end with an incomplete two-byte sequence.
 */
const BIG5_LEAD_START = 0x81;
const BIG5_LEAD_END = 0xfe;
const BIG5_TRAIL_HIGH_START = 0xa1;
const BIG5_TRAIL_HIGH_END = 0xfe;
const BIG5_COLUMNS = 157;

export function decodeBig5(bytes: Uint8Array): string {
  const sink: CodeUnitSink = { units: [] };
  let leading = 0;
  for (const byte of bytes) {
    if (leading !== 0) {
      const leadingByte = leading;
      leading = 0;
      const column = twoByteTrailColumn(
        byte,
        BIG5_TRAIL_HIGH_START,
        BIG5_TRAIL_HIGH_END,
      );
      const pointer =
        column === undefined
          ? undefined
          : (leadingByte - BIG5_LEAD_START) * BIG5_COLUMNS + column;
      const doubled =
        pointer === undefined
          ? undefined
          : BIG5_DOUBLE_CODE_POINT_POINTERS.get(pointer);
      if (doubled !== undefined) {
        appendCodePoint(sink, doubled[0]);
        appendCodePoint(sink, doubled[1]);
        continue;
      }
      const codePoint =
        pointer === undefined ? undefined : pointerCodePoint(BIG5, pointer);
      if (codePoint === undefined) {
        malformed(
          "Big5",
          `has no character for lead byte 0x${leadingByte.toString(HEX_RADIX)} trail byte 0x${byte.toString(HEX_RADIX)}`,
        );
      }
      appendCodePoint(sink, codePoint);
      continue;
    }
    if (byte <= ASCII_BYTE_MAX) {
      sink.units.push(byte);
    } else if (byte >= BIG5_LEAD_START && byte <= BIG5_LEAD_END) {
      leading = byte;
    } else {
      malformed(
        "Big5",
        `has no character for byte 0x${byte.toString(HEX_RADIX)}`,
      );
    }
  }
  if (leading !== 0) {
    truncated("Big5");
  }
  return fromCodeUnits(sink.units);
}

/**
 * The number of distinct values gb18030's own third byte (0x81-0xFE) can take, and the number of distinct values its own second and fourth bytes (0x30-0x39) can take — the two factors the Encoding Standard's own gb18030 decoder algorithm multiplies together (as `10 × 126` and `10 × 126 × 10`) to place each of the four bytes in a four-byte pointer's own positional value. Named so the arithmetic in {@link decodeGb18030} reads as the byte-range sizes it actually is, rather than as two bare products of unexplained digits.
 */
const GB18030_SECOND_FOURTH_BYTE_COUNT = 10;
const GB18030_THIRD_BYTE_COUNT = 126;

/** gb18030's own lead-byte band for both its two-byte and four-byte forms: a first byte outside 0x00-0x7F ASCII starts a multi-byte sequence only when it falls in 0x81-0xFE (0x80 alone is the fixed Euro-sign exception below). Also the third byte's own valid range in a four-byte sequence. */
const GB18030_LEAD_START = 0x81;
const GB18030_LEAD_END = 0xfe;

/** The digit-only byte band (ASCII '0'-'9') gb18030 requires of its own second and fourth bytes in a four-byte sequence, and the band that tells the decoder a two-byte lead's second byte is starting a four-byte form rather than a two-byte trail. */
const GB18030_DIGIT_BYTE_MIN = 0x30;
const GB18030_DIGIT_BYTE_MAX = 0x39;

/** The trailing-byte band gb18030's own two-byte form shares with Big5 and Shift_JIS (see {@link twoByteTrailColumn}), and the column count that band spans: 190 distinct trail values per lead byte. */
const GB18030_TRAIL_HIGH_START = 0x80;
const GB18030_TRAIL_HIGH_END = 0xfe;
const GB18030_TWO_BYTE_COLUMNS = 190;

/** The one single-byte value gb18030 decodes outside plain ASCII: byte 0x80 alone is the Euro sign, U+20AC, a fixed exception the Encoding Standard states directly rather than deriving from any table. */
const GB18030_SINGLE_BYTE_EURO = 0x80;
const EURO_SIGN_CODE_POINT = 0x20ac;

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
  const sink: CodeUnitSink = { units: [] };
  let first = 0;
  let second = 0;
  let third = 0;
  for (const byte of bytes) {
    if (third !== 0) {
      if (byte < GB18030_DIGIT_BYTE_MIN || byte > GB18030_DIGIT_BYTE_MAX) {
        malformed(
          "gb18030",
          `has no character for four-byte sequence 0x${first.toString(HEX_RADIX)} 0x${second.toString(HEX_RADIX)} 0x${third.toString(HEX_RADIX)} 0x${byte.toString(HEX_RADIX)}: fourth byte is not 0x30-0x39`,
        );
      }
      const pointer =
        (first - GB18030_LEAD_START) *
          (GB18030_SECOND_FOURTH_BYTE_COUNT *
            GB18030_THIRD_BYTE_COUNT *
            GB18030_SECOND_FOURTH_BYTE_COUNT) +
        (second - GB18030_DIGIT_BYTE_MIN) *
          (GB18030_SECOND_FOURTH_BYTE_COUNT * GB18030_THIRD_BYTE_COUNT) +
        (third - GB18030_LEAD_START) * GB18030_SECOND_FOURTH_BYTE_COUNT +
        (byte - GB18030_DIGIT_BYTE_MIN);
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
          `has no character for four-byte sequence 0x${failedFirst.toString(HEX_RADIX)} 0x${failedSecond.toString(HEX_RADIX)} 0x${failedThird.toString(HEX_RADIX)} 0x${byte.toString(HEX_RADIX)}`,
        );
      }
      appendCodePoint(sink, codePoint);
      continue;
    }
    if (second !== 0) {
      if (byte >= GB18030_LEAD_START && byte <= GB18030_LEAD_END) {
        third = byte;
        continue;
      }
      malformed(
        "gb18030",
        `has no character for byte sequence 0x${first.toString(HEX_RADIX)} 0x${second.toString(HEX_RADIX)} 0x${byte.toString(HEX_RADIX)}: third byte is not 0x81-0xFE`,
      );
    }
    if (first !== 0) {
      if (byte >= GB18030_DIGIT_BYTE_MIN && byte <= GB18030_DIGIT_BYTE_MAX) {
        second = byte;
        continue;
      }
      const leadingByte = first;
      first = 0;
      const column = twoByteTrailColumn(
        byte,
        GB18030_TRAIL_HIGH_START,
        GB18030_TRAIL_HIGH_END,
      );
      const pointer =
        column === undefined
          ? undefined
          : (leadingByte - GB18030_LEAD_START) * GB18030_TWO_BYTE_COLUMNS +
            column;
      const codePoint =
        pointer === undefined ? undefined : pointerCodePoint(GB18030, pointer);
      if (codePoint === undefined) {
        malformed(
          "gb18030",
          `has no character for lead byte 0x${leadingByte.toString(HEX_RADIX)} trail byte 0x${byte.toString(HEX_RADIX)}`,
        );
      }
      appendCodePoint(sink, codePoint);
      continue;
    }
    if (byte <= ASCII_BYTE_MAX) {
      sink.units.push(byte);
    } else if (byte === GB18030_SINGLE_BYTE_EURO) {
      sink.units.push(EURO_SIGN_CODE_POINT);
      // byte reaching this point is already known to be 0x81 or above (everything below is consumed by the two branches above), so only this band's own upper bound needs checking.
    } else if (byte <= GB18030_LEAD_END) {
      first = byte;
    } else {
      malformed(
        "gb18030",
        `has no character for byte 0x${byte.toString(HEX_RADIX)}`,
      );
    }
  }
  // second and third are never assigned outside the `first !== 0` branch above, and every path that resets any one of the three resets all three together, so first !== 0 alone already covers every state this loop can end in with a pending byte still unconsumed — checking second and third here too would only ever repeat a condition first !== 0 has already proven.
  if (first !== 0) {
    truncated("gb18030");
  }
  return fromCodeUnits(sink.units);
}
