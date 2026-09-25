import { expect } from "vitest";
import { UndecodableTextError } from "../decode";
import { pointerCodePoint } from "../decode-dbcs";
import type { DbcsTable } from "../dbcs-tables";

// Shared between decode-dbcs.test.ts (Shift_JIS, EUC-JP, EUC-KR) and decode-dbcs-chinese.test.ts (Big5, gb18030/GBK, and the cross-platform-decoder check spanning all four two-byte encodings): the WHATWG index-pointer arithmetic and refusal-message assertions apply identically regardless of which encoding a given describe block covers.

/**
 * Runs `action` expecting it to throw {@link UndecodableTextError}, and asserts its message contains every one of `substrings` — the label and the specific detail decode-dbcs.ts's own `malformed`/`truncated` helpers build the message from. A bare `.toThrow(UndecodableTextError)` only proves *some* refusal happened; several genuinely different byte patterns in these decoders refuse via different code paths that all throw the same error class (a byte that fails a two-byte pair versus the exact same bytes read as a truncated single lead byte, for instance), so only the message actually distinguishes which one fired.
 */
export function expectMalformed(
  action: () => unknown,
  ...substrings: readonly string[]
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(UndecodableTextError);
    const message = (error as UndecodableTextError).message;
    for (const substring of substrings) {
      expect(message).toContain(substring);
    }
    return;
  }
  expect.unreachable("expected decodeText to throw UndecodableTextError");
}

/**
 * Reconstructs the lead/trail byte pair the Encoding Standard's own decoder would need to produce `pointer` for a `(leading - leadOffset(byte)) * columns + byte - trailOffset(byte)` shaped index, the inverse of every two-byte decoder in decode-dbcs.ts. `splitColumn` is the first index whose own trailing byte falls in the encoding's second contiguous trail range (0xA1+ for Big5, 0x80+ for gb18030/GBK), so the two encodings that skip a gap in the byte range (Big5 has none between 0x7E and 0xA1; gb18030/GBK's own gap is only 0x7F) both fall out of the same formula rather than needing their own.
 */
export function twoByteBytesForPointer(
  pointer: number,
  leadStart: number,
  columns: number,
  splitColumn: number,
  lowTrailStart: number,
  highTrailStart: number,
): readonly [number, number] {
  const leading = leadStart + Math.floor(pointer / columns);
  const column = pointer % columns;
  const trail =
    column < splitColumn
      ? lowTrailStart + column
      : highTrailStart + (column - splitColumn);
  return [leading, trail];
}

const SHIFT_JIS_COLUMNS = 188;
const SHIFT_JIS_TRAIL_SPLIT_COLUMN = 63;
const SHIFT_JIS_LOW_TRAIL_START = 0x40;
const SHIFT_JIS_HIGH_TRAIL_START = 0x41;
const SHIFT_JIS_LOW_LEAD_START = 0x81;
const SHIFT_JIS_LOW_LEAD_END = 0x9f;
const SHIFT_JIS_HIGH_LEAD_START = 0xc1;

export function shiftJisBytesForPointer(
  pointer: number,
): readonly [number, number] {
  // Two disjoint lead-byte bands (0x81-0x9F, 0xE0-0xFC) share one 188-column pointer space, so the lead offset has to be picked from whichever band the reconstructed lead byte actually falls in, not assumed up front the way every other encoding's single contiguous lead band lets twoByteBytesForPointer assume it.
  const leadIndex = Math.floor(pointer / SHIFT_JIS_COLUMNS);
  const column = pointer % SHIFT_JIS_COLUMNS;
  const trail =
    column < SHIFT_JIS_TRAIL_SPLIT_COLUMN
      ? SHIFT_JIS_LOW_TRAIL_START + column
      : SHIFT_JIS_HIGH_TRAIL_START + column;
  const lowBandLeading = SHIFT_JIS_LOW_LEAD_START + leadIndex;
  if (lowBandLeading <= SHIFT_JIS_LOW_LEAD_END) {
    return [lowBandLeading, trail];
  }
  return [SHIFT_JIS_HIGH_LEAD_START + leadIndex, trail];
}

const EUC_JIS0208_START = 0xa1;
const EUC_JIS0208_COLUMNS = 94;

export function eucJis0208BytesForPointer(
  pointer: number,
): readonly [number, number] {
  return [
    EUC_JIS0208_START + Math.floor(pointer / EUC_JIS0208_COLUMNS),
    EUC_JIS0208_START + (pointer % EUC_JIS0208_COLUMNS),
  ];
}

const EUC_KR_LEAD_START = 0x81;
const EUC_KR_COLUMNS = 190;
const EUC_KR_TRAIL_START = 0x41;

export function eucKrBytesForPointer(
  pointer: number,
): readonly [number, number] {
  return twoByteBytesForPointer(
    pointer,
    EUC_KR_LEAD_START,
    EUC_KR_COLUMNS,
    EUC_KR_COLUMNS,
    EUC_KR_TRAIL_START,
    EUC_KR_TRAIL_START,
  );
}

const BIG5_LEAD_START = 0x81;
const BIG5_COLUMNS = 157;
const BIG5_TRAIL_SPLIT_COLUMN = 63;
const BIG5_LOW_TRAIL_START = 0x40;
const BIG5_HIGH_TRAIL_START = 0xa1;

export function big5BytesForPointer(
  pointer: number,
): readonly [number, number] {
  return twoByteBytesForPointer(
    pointer,
    BIG5_LEAD_START,
    BIG5_COLUMNS,
    BIG5_TRAIL_SPLIT_COLUMN,
    BIG5_LOW_TRAIL_START,
    BIG5_HIGH_TRAIL_START,
  );
}

const GB18030_LEAD_START = 0x81;
const GB18030_COLUMNS = 190;
const GB18030_TRAIL_SPLIT_COLUMN = 63;
const GB18030_LOW_TRAIL_START = 0x40;
const GB18030_HIGH_TRAIL_START = 0x80;

export function gb18030TwoByteBytesForPointer(
  pointer: number,
): readonly [number, number] {
  return twoByteBytesForPointer(
    pointer,
    GB18030_LEAD_START,
    GB18030_COLUMNS,
    GB18030_TRAIL_SPLIT_COLUMN,
    GB18030_LOW_TRAIL_START,
    GB18030_HIGH_TRAIL_START,
  );
}

/** The four raw bytes gb18030's own algorithmic four-byte form needs to produce `pointer`, the inverse of the arithmetic decode-dbcs.ts's decodeGb18030 computes forwards from a real byte sequence. */
const GB18030_FOUR_BYTE_FIRST_START = 0x81;
const GB18030_FOUR_BYTE_FIRST_COLUMNS = 12600;
const GB18030_FOUR_BYTE_SECOND_START = 0x30;
const GB18030_FOUR_BYTE_SECOND_COLUMNS = 1260;
const GB18030_FOUR_BYTE_THIRD_START = 0x81;
const GB18030_FOUR_BYTE_THIRD_COLUMNS = 10;
const GB18030_FOUR_BYTE_FOURTH_START = 0x30;

export function gb18030FourBytesForPointer(
  pointer: number,
): readonly [number, number, number, number] {
  const first =
    GB18030_FOUR_BYTE_FIRST_START +
    Math.floor(pointer / GB18030_FOUR_BYTE_FIRST_COLUMNS);
  const remainder1 = pointer % GB18030_FOUR_BYTE_FIRST_COLUMNS;
  const second =
    GB18030_FOUR_BYTE_SECOND_START +
    Math.floor(remainder1 / GB18030_FOUR_BYTE_SECOND_COLUMNS);
  const remainder2 = remainder1 % GB18030_FOUR_BYTE_SECOND_COLUMNS;
  const third =
    GB18030_FOUR_BYTE_THIRD_START +
    Math.floor(remainder2 / GB18030_FOUR_BYTE_THIRD_COLUMNS);
  const fourth =
    GB18030_FOUR_BYTE_FOURTH_START +
    (remainder2 % GB18030_FOUR_BYTE_THIRD_COLUMNS);
  return [first, second, third, fourth];
}

export function codePointToText(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}

/** The timeout an exhaustive full-table sweep test needs, passed as `it`'s own third argument. Vitest's 5000ms default is sized for an ordinary unit test, not a loop that calls decodeText tens of thousands of times (EUC_KR and GB18030 each define around 24000 pointers, and the GB18030 sweep below calls decodeText twice per pointer to cross-check its gbk alias); under `vitest run --coverage`'s v8 instrumentation on a loaded CI runner this suite's own GB18030 sweep has been observed taking upwards of 7 seconds even though the same sweep completes in under 20ms uninstrumented locally, so the margin here is generous rather than tuned to a single observed figure. */
export const EXHAUSTIVE_SWEEP_TIMEOUT_MS = 30000;

/** The first pointer in `table` for which {@link pointerCodePoint} returns a defined code point, or -1 if none does. Iterates `[...table.codeUnits].keys()` rather than a hand-written `pointer < table.codeUnits.length` bound: a pointer one past the table's own end is indistinguishable from an in-range gap through {@link pointerCodePoint} alone (both resolve `undefined`), so a length comparison here is a genuine off-by-one that no test can observe — letting the string's own iterator protocol bound the loop removes the comparison instead of leaving it as untestable defensive code. */
export function firstDefinedPointer(table: DbcsTable): number {
  for (const pointer of [...table.codeUnits].keys()) {
    if (pointerCodePoint(table, pointer) !== undefined) {
      return pointer;
    }
  }
  return -1;
}

/** The first pointer in `table` for which {@link pointerCodePoint} returns undefined, or -1 if none does. See {@link firstDefinedPointer}'s own doc comment for why this iterates `[...table.codeUnits].keys()` rather than a hand-written length bound. */
export function firstGapPointer(table: DbcsTable): number {
  for (const pointer of [...table.codeUnits].keys()) {
    if (pointerCodePoint(table, pointer) === undefined) {
      return pointer;
    }
  }
  return -1;
}
