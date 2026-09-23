import { describe, expect, it } from "vitest";
import { decodeText, UndecodableTextError } from "./decode";
import { pointerCodePoint } from "./decode-dbcs";
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
 * Runs `action` expecting it to throw {@link UndecodableTextError}, and asserts its message contains every one of `substrings` — the label and the specific detail decode-dbcs.ts's own `malformed`/`truncated` helpers build the message from. A bare `.toThrow(UndecodableTextError)` only proves *some* refusal happened; several genuinely different byte patterns in these decoders refuse via different code paths that all throw the same error class (a byte that fails a two-byte pair versus the exact same bytes read as a truncated single lead byte, for instance), so only the message actually distinguishes which one fired.
 */
function expectMalformed(
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
function twoByteBytesForPointer(
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

function shiftJisBytesForPointer(pointer: number): readonly [number, number] {
  // Two disjoint lead-byte bands (0x81-0x9F, 0xE0-0xFC) share one 188-column pointer space, so the lead offset has to be picked from whichever band the reconstructed lead byte actually falls in, not assumed up front the way every other encoding's single contiguous lead band lets twoByteBytesForPointer assume it.
  const leadIndex = Math.floor(pointer / 188);
  const column = pointer % 188;
  const trail = column < 63 ? 0x40 + column : 0x41 + column;
  const lowBandLeading = 0x81 + leadIndex;
  if (lowBandLeading <= 0x9f) {
    return [lowBandLeading, trail];
  }
  return [0xc1 + leadIndex, trail];
}

function eucJis0208BytesForPointer(pointer: number): readonly [number, number] {
  return [0xa1 + Math.floor(pointer / 94), 0xa1 + (pointer % 94)];
}

function eucKrBytesForPointer(pointer: number): readonly [number, number] {
  return twoByteBytesForPointer(pointer, 0x81, 190, 190, 0x41, 0x41);
}

function big5BytesForPointer(pointer: number): readonly [number, number] {
  return twoByteBytesForPointer(pointer, 0x81, 157, 63, 0x40, 0xa1);
}

function gb18030TwoByteBytesForPointer(
  pointer: number,
): readonly [number, number] {
  return twoByteBytesForPointer(pointer, 0x81, 190, 63, 0x40, 0x80);
}

/** The four raw bytes gb18030's own algorithmic four-byte form needs to produce `pointer`, the inverse of the arithmetic decode-dbcs.ts's decodeGb18030 computes forwards from a real byte sequence. */
function gb18030FourBytesForPointer(
  pointer: number,
): readonly [number, number, number, number] {
  const first = 0x81 + Math.floor(pointer / 12600);
  const remainder1 = pointer % 12600;
  const second = 0x30 + Math.floor(remainder1 / 1260);
  const remainder2 = remainder1 % 1260;
  const third = 0x81 + Math.floor(remainder2 / 10);
  const fourth = 0x30 + (remainder2 % 10);
  return [first, second, third, fourth];
}

function codePointToText(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}

/** The first pointer in `table` for which {@link pointerCodePoint} returns a defined code point, or -1 if none does. */
function firstDefinedPointer(table: DbcsTable): number {
  for (let pointer = 0; pointer < table.codeUnits.length; pointer += 1) {
    if (pointerCodePoint(table, pointer) !== undefined) {
      return pointer;
    }
  }
  return -1;
}

/** The first pointer in `table` for which {@link pointerCodePoint} returns undefined, or -1 if none does. */
function firstGapPointer(table: DbcsTable): number {
  for (let pointer = 0; pointer < table.codeUnits.length; pointer += 1) {
    if (pointerCodePoint(table, pointer) === undefined) {
      return pointer;
    }
  }
  return -1;
}

describe("pointerCodePoint", () => {
  it("returns the table's own value at an in-range, defined pointer", () => {
    const definedPointer = firstDefinedPointer(JIS0208);
    expect(definedPointer).toBeGreaterThanOrEqual(0);
    expect(pointerCodePoint(JIS0208, definedPointer)).toBe(
      JIS0208.codeUnits.charCodeAt(definedPointer),
    );
  });

  it("returns undefined at a pointer the table leaves as its own gap marker", () => {
    const gapPointer = firstGapPointer(JIS0208);
    expect(gapPointer).toBeGreaterThanOrEqual(0);
    expect(pointerCodePoint(JIS0208, gapPointer)).toBeUndefined();
  });

  it("returns undefined for a pointer past the end of the table entirely", () => {
    // No real decoder call in this file can ever produce a pointer this large (every one of them bounds pointer to its own table's exact length by construction — see this function's own doc comment) — tested directly here rather than left as untestable defensive code.
    expect(pointerCodePoint(JIS0208, JIS0208.codeUnits.length)).toBeUndefined();
    expect(pointerCodePoint(JIS0208, -1)).toBeUndefined();
  });
});

describe("decodeText Shift_JIS", () => {
  it("decodes every defined JIS X 0208 pointer to the code point the WHATWG index names", () => {
    for (let pointer = 0; pointer < JIS0208.codeUnits.length; pointer += 1) {
      const codePoint = pointerCodePoint(JIS0208, pointer);
      if (codePoint === undefined) {
        continue;
      }
      const [leading, trail] = shiftJisBytesForPointer(pointer);
      expect(
        decodeText(Uint8Array.of(leading, trail), { encoding: "shift_jis" })
          .text,
        `pointer ${String(pointer)}, bytes 0x${leading.toString(16)} 0x${trail.toString(16)}`,
      ).toBe(codePointToText(codePoint));
    }
  });

  it("decodes every ASCII byte and 0x80 as its own code point", () => {
    for (let byte = 0x00; byte <= 0x80; byte += 1) {
      expect(
        decodeText(Uint8Array.of(byte), { encoding: "shift_jis" }).text,
        `byte 0x${byte.toString(16)}`,
      ).toBe(String.fromCharCode(byte));
    }
  });

  it("decodes 0xA1-0xDF as halfwidth katakana", () => {
    for (let byte = 0xa1; byte <= 0xdf; byte += 1) {
      expect(
        decodeText(Uint8Array.of(byte), { encoding: "shift_jis" }).text,
        `byte 0x${byte.toString(16)}`,
      ).toBe(String.fromCharCode(0xff61 - 0xa1 + byte));
    }
  });

  it("maps Microsoft's EUDC pointer range (8836-10715) onto the Unicode Private Use Area", () => {
    const firstEudcPointer = 8836;
    const lastEudcPointer = 10715;
    for (const pointer of [
      firstEudcPointer,
      firstEudcPointer + 1,
      lastEudcPointer - 1,
      lastEudcPointer,
    ]) {
      const [leading, trail] = shiftJisBytesForPointer(pointer);
      expect(
        decodeText(Uint8Array.of(leading, trail), { encoding: "shift_jis" })
          .text,
        `EUDC pointer ${String(pointer)}`,
      ).toBe(String.fromCharCode(0xe000 - 8836 + pointer));
    }
  });

  it("does not treat the pointer just below the EUDC range as EUDC", () => {
    // Pointer 8647, the highest defined JIS X 0208 pointer below the EUDC band (8836): a real table entry, resolved through the ordinary table lookup rather than the 0xE000 Private Use Area formula.
    const pointer = 8647;
    const codePoint = pointerCodePoint(JIS0208, pointer);
    if (codePoint === undefined) {
      throw new Error(
        "JIS0208 fixture pointer 8647 is out of range or undefined",
      );
    }
    const [leading, trail] = shiftJisBytesForPointer(pointer);
    expect(
      decodeText(Uint8Array.of(leading, trail), { encoding: "shift_jis" }).text,
    ).toBe(codePointToText(codePoint));
  });

  it("decodes a real Japanese greeting", () => {
    // "こんにちは" (konnichiwa, "hello"), the same word this suite's platform cross-check verified.
    const bytes = Uint8Array.of(
      0x82,
      0xb1,
      0x82,
      0xf1,
      0x82,
      0xc9,
      0x82,
      0xbf,
      0x82,
      0xcd,
    );
    expect(decodeText(bytes, { encoding: "shift_jis" }).text).toBe(
      "こんにちは",
    );
  });

  it("decodes a string mixing ASCII, halfwidth katakana and a two-byte kanji", () => {
    // "A" (ASCII), "ｱ" (halfwidth katakana A, 0xB1), "亜" (the first JIS X 0208 kanji, pointer 0).
    const bytes = Uint8Array.of(0x41, 0xb1, 0x88, 0x9f);
    expect(decodeText(bytes, { encoding: "shift_jis" }).text).toBe("Aｱ亜");
  });

  it("throws with a message naming the byte for each byte no Shift_JIS lead position defines", () => {
    // 0x80 is ASCII-adjacent (handled separately); 0xA0 sits between the low lead band and halfwidth katakana; 0xDF is the last katakana byte, so 0xE0 is the first byte of the high lead band and 0xDF itself must never be treated as a lead byte; 0xFD-0xFF sit past the high lead band's own end.
    for (const byte of [0xa0, 0xfd, 0xfe, 0xff]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(byte), { encoding: "shift_jis" }),
        "Shift_JIS",
        `has no character for byte 0x${byte.toString(16)}`,
      );
    }
  });

  it("throws when a lead byte's own trailing byte is not one Shift_JIS defines for it", () => {
    // 0x81 is a valid lead byte; 0x3F and 0x7F sit just outside the low trailing band ([0x40,0x7E]) on either side, and 0xFD sits just past the high trailing band's own end ([0x80,0xFC]).
    for (const trail of [0x3f, 0x7f, 0xfd]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(0x81, trail), { encoding: "shift_jis" }),
        "Shift_JIS",
        `has no character for lead byte 0x81 trail byte 0x${trail.toString(16)}`,
      );
    }
  });

  it("rejects an out-of-band trailing byte even when the pointer arithmetic would otherwise wrap onto a real, defined pointer belonging to a neighbouring lead byte", () => {
    // twoByteTrailColumn's own doc comment explains why every boundary here is written against a reachable byte value, but a wrong column computed for an OUT-OF-BAND byte is a distinct risk from a wrong boundary: with lead byte 0x81 specifically, an out-of-range column can only ever produce a negative pointer (nothing to wrap onto, since pointer 0 is 0x81's own first column), which is why 0x81 alone cannot catch a column formula that silently starts counting from the wrong place. Lead byte 0x82 can: 0x82's own row starts at pointer 188, so a column of exactly 188 or -1 lands one past the end of 0x81's row or one before the start of 0x82's own, and both of those pointers are real, defined JIS X 0208 entries — bytes 0x3F and 0xFD have to be refused as invalid trailing bytes outright, not silently reinterpreted as a valid pointer one row over.
    expect(pointerCodePoint(JIS0208, 187)).not.toBeUndefined(); // 0x81's own last column, reachable by wrapping 0x3F backwards from lead byte 0x82
    expect(pointerCodePoint(JIS0208, 376)).not.toBeUndefined(); // lead byte 0x83's own first column, reachable by wrapping 0xFD forwards from lead byte 0x82
    for (const trail of [0x3f, 0xfd]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(0x82, trail), { encoding: "shift_jis" }),
        "Shift_JIS",
        `has no character for lead byte 0x82 trail byte 0x${trail.toString(16)}`,
      );
    }
  });

  it("throws when a lead byte's trailing byte is in range but the pair is undefined", () => {
    // 0xFC is the highest valid Shift_JIS lead byte; its own trailing range runs well past where JIS X 0208 actually assigns anything, so the pointer resolves but the table gap marker does.
    expectMalformed(
      () => decodeText(Uint8Array.of(0xfc, 0xfc), { encoding: "shift_jis" }),
      "Shift_JIS",
      "has no character for lead byte 0xfc trail byte 0xfc",
    );
  });

  it("throws for a lead byte with nothing after it", () => {
    expectMalformed(
      () => decodeText(Uint8Array.of(0x81), { encoding: "shift_jis" }),
      "Shift_JIS",
      "ends with an incomplete multi-byte sequence",
    );
  });
});

describe("decodeText EUC-JP", () => {
  it("decodes every defined JIS X 0208 pointer EUC-JP's own byte range can reach", () => {
    const maxTwoBytePointer = 93 * 94 + 93;
    for (let pointer = 0; pointer <= maxTwoBytePointer; pointer += 1) {
      const codePoint = pointerCodePoint(JIS0208, pointer);
      if (codePoint === undefined) {
        continue;
      }
      const [leading, trail] = eucJis0208BytesForPointer(pointer);
      expect(
        decodeText(Uint8Array.of(leading, trail), { encoding: "euc-jp" }).text,
        `pointer ${String(pointer)}`,
      ).toBe(codePointToText(codePoint));
    }
  });

  it("decodes every defined JIS X 0212 pointer behind its own 0x8F lead byte", () => {
    for (let pointer = 0; pointer < JIS0212.codeUnits.length; pointer += 1) {
      const codePoint = pointerCodePoint(JIS0212, pointer);
      if (codePoint === undefined) {
        continue;
      }
      const [leading, trail] = eucJis0208BytesForPointer(pointer);
      if (leading > 0xfe) {
        continue;
      }
      expect(
        decodeText(Uint8Array.of(0x8f, leading, trail), { encoding: "euc-jp" })
          .text,
        `jis0212 pointer ${String(pointer)}`,
      ).toBe(codePointToText(codePoint));
    }
  });

  it("decodes 0x8E-prefixed halfwidth katakana", () => {
    for (let byte = 0xa1; byte <= 0xdf; byte += 1) {
      expect(
        decodeText(Uint8Array.of(0x8e, byte), { encoding: "euc-jp" }).text,
        `byte 0x${byte.toString(16)}`,
      ).toBe(String.fromCharCode(0xff61 - 0xa1 + byte));
    }
  });

  it("decodes every ASCII byte as its own code point", () => {
    for (let byte = 0x00; byte <= 0x7f; byte += 1) {
      expect(decodeText(Uint8Array.of(byte), { encoding: "euc-jp" }).text).toBe(
        String.fromCharCode(byte),
      );
    }
  });

  it("decodes a real Japanese word", () => {
    // "ありがとう" (arigatou, "thank you").
    const bytes = Uint8Array.of(
      0xa4,
      0xa2,
      0xa4,
      0xea,
      0xa4,
      0xac,
      0xa4,
      0xc8,
      0xa4,
      0xa6,
    );
    expect(decodeText(bytes, { encoding: "euc-jp" }).text).toBe("ありがとう");
  });

  it("throws when 0x8E's own trailing byte is not halfwidth katakana", () => {
    // 0xA0 sits just below the halfwidth katakana band ([0xA1,0xDF]); 0xE0 sits just above it.
    for (const trail of [0xa0, 0xe0]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(0x8e, trail), { encoding: "euc-jp" }),
        "EUC-JP",
        `has no character for lead byte 0x8e trail byte 0x${trail.toString(16)}`,
      );
    }
  });

  it("throws when 0x8F's own second byte is not a valid JIS X 0212 index byte", () => {
    // 0xA0 sits just below the JIS X 0212 index band ([0xA1,0xFE]); 0xFF sits just above it.
    for (const second of [0xa0, 0xff]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(0x8f, second), { encoding: "euc-jp" }),
        "EUC-JP",
        `has no character for lead byte 0x8f trail byte 0x${second.toString(16)}`,
      );
    }
  });

  it("accepts 0xFE, the JIS X 0212 index band's own top byte, as 0x8F's own second byte", () => {
    // No JIS X 0212 pointer with leading byte 0xFE is actually defined, so 0xFE has to be genuinely accepted here (advancing into a JIS X 0212 pair state) rather than merely happening to decode the same either way: the message that follows names 0xFE as a lead byte in its own right, which only happens once it has already been accepted as the JIS X 0212 index byte, not rejected outright as 0x8F's own second byte.
    expectMalformed(
      () => decodeText(Uint8Array.of(0x8f, 0xfe, 0xa1), { encoding: "euc-jp" }),
      "EUC-JP",
      "has no character for lead byte 0xfe trail byte 0xa1",
    );
  });

  it("throws when a JIS X 0212 pair's own trailing byte is out of range", () => {
    for (const trail of [0xa0, 0xff]) {
      expectMalformed(
        () =>
          decodeText(Uint8Array.of(0x8f, 0xa1, trail), { encoding: "euc-jp" }),
        "EUC-JP",
        `has no character for lead byte 0xa1 trail byte 0x${trail.toString(16)}`,
      );
    }
  });

  it("throws when a JIS X 0208 pair's own trailing byte is out of range", () => {
    for (const trail of [0xa0, 0xff]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(0xa1, trail), { encoding: "euc-jp" }),
        "EUC-JP",
        `has no character for lead byte 0xa1 trail byte 0x${trail.toString(16)}`,
      );
    }
  });

  it("rejects a trailing byte just below the JIS X 0208 index band even when the pointer arithmetic would otherwise wrap onto a real, defined pointer belonging to the row below", () => {
    // Lead byte 0xA1 alone (the lowest valid lead byte) can only wrap a too-low trailing byte to a negative pointer, nothing to land on; lead byte 0xA2 can, since 0xA2's own row starts immediately after 0xA1's, so a trailing byte of 0xA0 (one below the valid [0xA1,0xFE] band) must not silently resolve to 0xA1's own last column.
    expect(pointerCodePoint(JIS0208, 93)).not.toBeUndefined();
    expectMalformed(
      () => decodeText(Uint8Array.of(0xa2, 0xa0), { encoding: "euc-jp" }),
      "EUC-JP",
      "has no character for lead byte 0xa2 trail byte 0xa0",
    );
  });

  it("throws for an undefined byte outside every lead range", () => {
    // 0x80 sits just below the JIS X 0208 lead band ([0xA1,0xFE]) and is neither 0x8E nor 0x8F; 0xFF sits just above that same band.
    for (const byte of [0x80, 0xff]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(byte), { encoding: "euc-jp" }),
        "EUC-JP",
        `has no character for byte 0x${byte.toString(16)}`,
      );
    }
  });

  it("accepts 0xFE, the JIS X 0208 lead byte range's own top byte, as a fresh lead byte", () => {
    // As with 0x8F's own second byte above, no JIS X 0208 pointer with leading byte 0xFE is actually defined, so this proves 0xFE was genuinely accepted as a fresh lead byte (the message names it as a lead byte) rather than rejected outright as an undefined standalone byte (which would instead name it as "byte 0xfe").
    expectMalformed(
      () => decodeText(Uint8Array.of(0xfe, 0xa1), { encoding: "euc-jp" }),
      "EUC-JP",
      "has no character for lead byte 0xfe trail byte 0xa1",
    );
  });

  it("throws when the input ends inside each of EUC-JP's own pending states", () => {
    for (const truncated of [[0x8e], [0x8f], [0x8f, 0xa1], [0xa1]]) {
      expectMalformed(
        () => decodeText(Uint8Array.from(truncated), { encoding: "euc-jp" }),
        "EUC-JP",
        "ends with an incomplete multi-byte sequence",
      );
    }
  });
});

describe("decodeText EUC-KR", () => {
  it("decodes every pointer EUC_KR defines to the code point the WHATWG index names", () => {
    for (let pointer = 0; pointer < EUC_KR.codeUnits.length; pointer += 1) {
      const codePoint = pointerCodePoint(EUC_KR, pointer);
      if (codePoint === undefined) {
        continue;
      }
      const [leading, trail] = eucKrBytesForPointer(pointer);
      expect(
        decodeText(Uint8Array.of(leading, trail), { encoding: "euc-kr" }).text,
        `pointer ${String(pointer)}, bytes 0x${leading.toString(16)} 0x${trail.toString(16)}`,
      ).toBe(codePointToText(codePoint));
    }
  });

  it("decodes every ASCII byte as its own code point", () => {
    for (let byte = 0x00; byte <= 0x7f; byte += 1) {
      expect(decodeText(Uint8Array.of(byte), { encoding: "euc-kr" }).text).toBe(
        String.fromCharCode(byte),
      );
    }
  });

  it("decodes a real Korean greeting", () => {
    // "안녕하세요" (annyeonghaseyo, "hello").
    const bytes = Uint8Array.of(
      0xbe,
      0xc8,
      0xb3,
      0xe7,
      0xc7,
      0xcf,
      0xbc,
      0xbc,
      0xbf,
      0xe4,
    );
    expect(decodeText(bytes, { encoding: "euc-kr" }).text).toBe("안녕하세요");
  });

  it("throws when the trailing byte is outside 0x41-0xFE", () => {
    for (const trail of [0x40, 0xff]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(0x81, trail), { encoding: "euc-kr" }),
        "EUC-KR",
        `has no character for lead byte 0x81 trail byte 0x${trail.toString(16)}`,
      );
    }
  });

  it("rejects an out-of-band trailing byte even when the pointer arithmetic would otherwise wrap onto a real, defined pointer belonging to a neighbouring lead byte", () => {
    // The same risk twoByteTrailColumn's own doc comment describes for Shift_JIS, Big5 and gb18030, but EUC-KR computes its own single-band column directly rather than through that shared helper, so it needs its own version of the same check: lead byte 0x82 (not the lowest possible lead byte, 0x81, which can only wrap to a negative pointer with nothing real to land on) with a trailing byte just outside [0x41,0xFE] on either side.
    expect(pointerCodePoint(EUC_KR, 189)).not.toBeUndefined(); // 0x81's own last column, reachable by wrapping 0x40 backwards from lead byte 0x82
    expect(pointerCodePoint(EUC_KR, 380)).not.toBeUndefined(); // lead byte 0x83's own first column, reachable by wrapping 0xFF forwards from lead byte 0x82
    for (const trail of [0x40, 0xff]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(0x82, trail), { encoding: "euc-kr" }),
        "EUC-KR",
        `has no character for lead byte 0x82 trail byte 0x${trail.toString(16)}`,
      );
    }
  });

  it("throws when the lead byte and trailing byte pair to an undefined pointer", () => {
    // 0xFE is the highest valid lead byte; paired with the highest valid trailing byte it lands well past where EUC_KR assigns anything.
    expectMalformed(
      () => decodeText(Uint8Array.of(0xfe, 0xfe), { encoding: "euc-kr" }),
      "EUC-KR",
      "has no character for lead byte 0xfe trail byte 0xfe",
    );
  });

  it("throws for a byte outside the lead byte range with nothing else around it", () => {
    for (const byte of [0x80, 0xff]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(byte), { encoding: "euc-kr" }),
        "EUC-KR",
        `has no character for byte 0x${byte.toString(16)}`,
      );
    }
  });

  it("throws for a lead byte with nothing after it", () => {
    expectMalformed(
      () => decodeText(Uint8Array.of(0x81), { encoding: "euc-kr" }),
      "EUC-KR",
      "ends with an incomplete multi-byte sequence",
    );
  });
});

describe("decodeText Big5", () => {
  const DOUBLE_CODE_POINT_POINTERS: ReadonlyMap<
    number,
    readonly [number, number]
  > = new Map([
    [1133, [0x00ca, 0x0304]],
    [1135, [0x00ca, 0x030c]],
    [1164, [0x00ea, 0x0304]],
    [1166, [0x00ea, 0x030c]],
  ]);

  it("decodes every single-code-point pointer Big5 defines to the code point the WHATWG index names", () => {
    for (let pointer = 0; pointer < BIG5.codeUnits.length; pointer += 1) {
      if (DOUBLE_CODE_POINT_POINTERS.has(pointer)) {
        continue;
      }
      const codePoint = pointerCodePoint(BIG5, pointer);
      if (codePoint === undefined) {
        continue;
      }
      const [leading, trail] = big5BytesForPointer(pointer);
      expect(
        decodeText(Uint8Array.of(leading, trail), { encoding: "big5" }).text,
        `pointer ${String(pointer)}, bytes 0x${leading.toString(16)} 0x${trail.toString(16)}`,
      ).toBe(codePointToText(codePoint));
    }
  });

  it("decodes a supplementary-plane pointer as a real surrogate pair", () => {
    // The first BIG5 pointer above the Basic Multilingual Plane, from the CJK Compatibility Ideographs Supplement block: the lowest key BIG5.astral holds, since dbcs-tables.ts's own generator inserts astral entries in ascending pointer order (see that file's own header comment) and every astral pointer's real code point is, by construction, above 0xFFFF.
    const supplementaryPointer = BIG5.astral.keys().next().value;
    if (supplementaryPointer === undefined) {
      throw new Error("BIG5.astral is unexpectedly empty");
    }
    expect(supplementaryPointer).toBeGreaterThan(0);
    const codePoint = pointerCodePoint(BIG5, supplementaryPointer);
    expect(codePoint).toBeDefined();
    const [leading, trail] = big5BytesForPointer(supplementaryPointer);
    const text = decodeText(Uint8Array.of(leading, trail), {
      encoding: "big5",
    }).text;
    expect(Array.from(text).length).toBe(1);
    expect(text.codePointAt(0)).toBe(codePoint);
    expect(text.length).toBe(2); // a genuine surrogate pair, not one BMP code unit
  });

  it("decodes each of Big5's own four hardcoded double-code-point pointers", () => {
    // Values from the Encoding Standard's own Big5 decoder table (https://encoding.spec.whatwg.org/#big5-decoder), not from a platform TextDecoder: Node's own ICU-backed big5 decoder maps these four pointers onto Private Use Area code points instead, a real, confirmed divergence from the standard rather than a difference this module could paper over by delegating.
    for (const [pointer, [first, second]] of DOUBLE_CODE_POINT_POINTERS) {
      const [leading, trail] = big5BytesForPointer(pointer);
      expect(
        decodeText(Uint8Array.of(leading, trail), { encoding: "big5" }).text,
        `pointer ${String(pointer)}`,
      ).toBe(String.fromCodePoint(first) + String.fromCodePoint(second));
    }
  });

  it("decodes every ASCII byte as its own code point", () => {
    for (let byte = 0x00; byte <= 0x7f; byte += 1) {
      expect(decodeText(Uint8Array.of(byte), { encoding: "big5" }).text).toBe(
        String.fromCharCode(byte),
      );
    }
  });

  it("decodes a real Traditional Chinese word", () => {
    // "謝謝" (xièxiè, "thank you").
    const bytes = Uint8Array.of(0xc1, 0xc2, 0xc1, 0xc2);
    expect(decodeText(bytes, { encoding: "big5" }).text).toBe("謝謝");
  });

  it("throws when the trailing byte is outside Big5's own two trailing bands", () => {
    // 0x3F sits just below the low band ([0x40,0x7E]); 0x7F and 0xA0 sandwich the gap between the two bands; 0xFF sits just above the high band ([0xA1,0xFE]).
    for (const trail of [0x3f, 0x7f, 0xa0, 0xff]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(0x81, trail), { encoding: "big5" }),
        "Big5",
        `has no character for lead byte 0x81 trail byte 0x${trail.toString(16)}`,
      );
    }
  });

  it("throws when the lead byte and trailing byte pair to an undefined pointer", () => {
    // Pointer 0 (bytes 0x81 0x40), the very first pointer Big5's own byte range can produce and one the WHATWG index leaves undefined.
    expectMalformed(
      () => decodeText(Uint8Array.of(0x81, 0x40), { encoding: "big5" }),
      "Big5",
      "has no character for lead byte 0x81 trail byte 0x40",
    );
  });

  it("throws for a byte outside the lead byte range with nothing else around it", () => {
    for (const byte of [0x80, 0xff]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(byte), { encoding: "big5" }),
        "Big5",
        `has no character for byte 0x${byte.toString(16)}`,
      );
    }
  });

  it("throws for a lead byte with nothing after it", () => {
    expectMalformed(
      () => decodeText(Uint8Array.of(0x81), { encoding: "big5" }),
      "Big5",
      "ends with an incomplete multi-byte sequence",
    );
  });
});

describe("decodeText gb18030 and GBK", () => {
  it("decodes every two-byte pointer GB18030 defines to the code point the WHATWG index names", () => {
    for (let pointer = 0; pointer < GB18030.codeUnits.length; pointer += 1) {
      const codePoint = pointerCodePoint(GB18030, pointer);
      if (codePoint === undefined) {
        continue;
      }
      const [leading, trail] = gb18030TwoByteBytesForPointer(pointer);
      const bytes = Uint8Array.of(leading, trail);
      expect(
        decodeText(bytes, { encoding: "gb18030" }).text,
        `pointer ${String(pointer)}, bytes 0x${leading.toString(16)} 0x${trail.toString(16)}`,
      ).toBe(codePointToText(codePoint));
      // GBK's decoder is defined by the Encoding Standard as identical to gb18030's own (https://encoding.spec.whatwg.org/#gbk-decoder), so every two-byte pointer decodes the same way under either label.
      expect(
        decodeText(bytes, { encoding: "gbk" }).text,
        `gbk pointer ${String(pointer)}`,
      ).toBe(codePointToText(codePoint));
    }
  });

  it("decodes every ASCII byte as its own code point", () => {
    for (let byte = 0x00; byte <= 0x7f; byte += 1) {
      expect(
        decodeText(Uint8Array.of(byte), { encoding: "gb18030" }).text,
      ).toBe(String.fromCharCode(byte));
    }
  });

  it("decodes 0x80 alone as U+20AC (€)", () => {
    expect(decodeText(Uint8Array.of(0x80), { encoding: "gb18030" }).text).toBe(
      "€",
    );
  });

  it("decodes a real Simplified Chinese word", () => {
    // "谢谢" (xièxiè, "thank you").
    const bytes = Uint8Array.of(0xd0, 0xbb, 0xd0, 0xbb);
    expect(decodeText(bytes, { encoding: "gb18030" }).text).toBe("谢谢");
  });

  it("decodes gb18030's own algorithmic four-byte form at an offset past the start of a range", () => {
    // A real, non-zero offset into a range (not just its own start pointer), so the code point this produces genuinely depends on adding, rather than subtracting or ignoring, how far the pointer sits past the range's own start.
    const rangeIndex = 5;
    const range = GB18030_RANGES[rangeIndex];
    const nextRange = GB18030_RANGES[rangeIndex + 1];
    if (range === undefined || nextRange === undefined) {
      throw new Error(
        `GB18030_RANGES fixture indices ${String(rangeIndex)}/${String(rangeIndex + 1)} are out of range`,
      );
    }
    const [rangeStart, codePointOffset] = range;
    const rangeWidth = nextRange[0] - rangeStart;
    expect(rangeWidth).toBeGreaterThan(1);
    const withinRangeOffset = Math.min(50, rangeWidth - 1);
    const pointer = rangeStart + withinRangeOffset;
    const bytes = Uint8Array.from(gb18030FourBytesForPointer(pointer));
    expect(decodeText(bytes, { encoding: "gb18030" }).text).toBe(
      codePointToText(codePointOffset + withinRangeOffset),
    );
  });

  it("decodes every hardcoded gb18030 range's own start pointer, and the one PUA exception inside it", () => {
    for (const [rangeStart, codePointOffset] of GB18030_RANGES) {
      const bytes = Uint8Array.from(gb18030FourBytesForPointer(rangeStart));
      expect(
        decodeText(bytes, { encoding: "gb18030" }).text,
        `range starting at pointer ${String(rangeStart)}`,
      ).toBe(codePointToText(codePointOffset));
    }
    // Pointer 7457, the one PUA exception the ranges table itself cannot express because it falls inside a range whose own offset arithmetic would otherwise produce a different code point (https://encoding.spec.whatwg.org/#index-gb18030-ranges-code-point).
    expect(
      decodeText(Uint8Array.from(gb18030FourBytesForPointer(7457)), {
        encoding: "gb18030",
      }).text,
    ).toBe("");
  });

  it("decodes the last pointer of gb18030's own algorithmic range, U+10FFFF", () => {
    // The final GB18030_RANGES entry covers the whole of Unicode's supplementary plane (0x10000-0x10FFFF); its own last pointer decodes to the highest code point Unicode defines, through a genuine surrogate pair.
    const lastRange = GB18030_RANGES[GB18030_RANGES.length - 1];
    if (lastRange === undefined) {
      throw new Error("GB18030_RANGES is unexpectedly empty");
    }
    const [rangeStart, codePointOffset] = lastRange;
    const maxCodePoint = 0x10ffff;
    const lastPointer = rangeStart + (maxCodePoint - codePointOffset);
    const bytes = Uint8Array.from(gb18030FourBytesForPointer(lastPointer));
    const text = decodeText(bytes, { encoding: "gb18030" }).text;
    expect(text.codePointAt(0)).toBe(maxCodePoint);
    expect(text.length).toBe(2);
  });

  it("throws for the pointer immediately below gb18030's own excluded band, and resolves the pointer immediately below where the band ends", () => {
    // The excluded band is (39419, 189000): 39419 itself resolves normally (it is the very pointer EXCLUDED_RANGE_START names, not yet excluded), 39420 is the first excluded value, 188999 is the last excluded value, and 189000 itself resolves again (the supplementary- plane range's own start, per the last GB18030_RANGES entry).
    const definedJustBeforeExclusion = 39419;
    expect(
      decodeText(
        Uint8Array.from(gb18030FourBytesForPointer(definedJustBeforeExclusion)),
        { encoding: "gb18030" },
      ).text,
    ).not.toBe("");

    for (const pointer of [39420, 188999]) {
      expectMalformed(
        () =>
          decodeText(Uint8Array.from(gb18030FourBytesForPointer(pointer)), {
            encoding: "gb18030",
          }),
        "gb18030",
        "has no character for four-byte sequence",
      );
    }

    const text = decodeText(
      Uint8Array.from(gb18030FourBytesForPointer(189000)),
      { encoding: "gb18030" },
    ).text;
    expect(text.codePointAt(0)).toBe(0x10000);
  });

  it("throws for a pointer past gb18030's own maximum ranges pointer", () => {
    // gb18030's own four-byte lead/second/third/fourth byte range can reach pointers well past MAX_RANGES_POINTER (1237575); the highest byte sequence (0xFE 0x39 0xFE 0x39) resolves to a pointer far beyond it.
    const maxReachablePointer =
      (0xfe - 0x81) * 12600 + 9 * 1260 + (0xfe - 0x81) * 10 + 9;
    expect(maxReachablePointer).toBeGreaterThan(1237575);
    expectMalformed(
      () =>
        decodeText(Uint8Array.of(0xfe, 0x39, 0xfe, 0x39), {
          encoding: "gb18030",
        }),
      "gb18030",
      "has no character for four-byte sequence",
    );
  });

  it("throws when the second byte of a would-be four-byte sequence is not 0x30-0x39 and the pair is also not a valid two-byte pointer", () => {
    // 0x2F sits just below the four-byte form's own second-byte band ([0x30,0x39]); 0x7F sits well above it, in the gap between the two-byte form's own low and high trailing bands.
    for (const trail of [0x2f, 0x7f]) {
      expectMalformed(
        () => decodeText(Uint8Array.of(0x81, trail), { encoding: "gb18030" }),
        "gb18030",
        `has no character for lead byte 0x81 trail byte 0x${trail.toString(16)}`,
      );
    }
  });

  it("throws when the third byte of a four-byte sequence is not 0x81-0xFE", () => {
    for (const third of [0x2f, 0xff]) {
      expectMalformed(
        () =>
          decodeText(Uint8Array.of(0x81, 0x30, third), {
            encoding: "gb18030",
          }),
        "gb18030",
        "third byte is not 0x81-0xFE",
      );
    }
  });

  it("throws when the fourth byte of a four-byte sequence is not 0x30-0x39", () => {
    for (const fourth of [0x2f, 0x3a]) {
      expectMalformed(
        () =>
          decodeText(Uint8Array.of(0x81, 0x30, 0x81, fourth), {
            encoding: "gb18030",
          }),
        "gb18030",
        "fourth byte is not 0x30-0x39",
      );
    }
  });

  it("throws for a byte outside every lead-byte case with nothing else around it", () => {
    expectMalformed(
      () => decodeText(Uint8Array.of(0xff), { encoding: "gb18030" }),
      "gb18030",
      "has no character for byte 0xff",
    );
  });

  it("throws for a lead byte with nothing after it", () => {
    expectMalformed(
      () => decodeText(Uint8Array.of(0x81), { encoding: "gb18030" }),
      "gb18030",
      "ends with an incomplete multi-byte sequence",
    );
  });

  it("throws when the input ends inside each of gb18030's own pending states", () => {
    for (const truncated of [[0x81], [0x81, 0x30], [0x81, 0x30, 0x81]]) {
      expectMalformed(
        () => decodeText(Uint8Array.from(truncated), { encoding: "gb18030" }),
        "gb18030",
        "ends with an incomplete multi-byte sequence",
      );
    }
  });
});

describe("decodeText DBCS encodings, cross-checked against a platform TextDecoder", () => {
  // A secondary, best-effort confidence layer alongside the exhaustive WHATWG-index-table sweeps above, which are this suite's real source of truth (dbcs-tables.ts is generated from and verified against the Encoding Standard's own published indexes.json, not from any platform's ICU build — see that file's own header comment for why). Scoped rather than exhaustive because a platform TextDecoder is not a reliable oracle for the full WHATWG domain: checking this suite's own EUC-KR sweep against Node's TextDecoder("euc-kr") found it only implements traditional 94x94 EUC-KR (both bytes 0xA1-0xFE), silently failing to decode roughly a third of the pointers the WHATWG standard's own extended index defines outside that sub-range — exactly the kind of host-ICU divergence ExaDev/documents.js#1361 already found for the single-byte encodings, and the reason this module never delegates to TextDecoder at all.
  const SUPPORTED_LABELS: readonly (
    "shift_jis" | "euc-jp" | "gbk" | "gb18030"
  )[] = ["shift_jis", "euc-jp", "gbk", "gb18030"];

  // EUC-JP's own two-byte JIS X 0208 lead/trail byte range (0xA1-0xFE for both) reaches only pointers 0 to 93*94+93 = 8835; JIS0208 itself runs to 11279, the rest being Shift_JIS's own EUDC range and beyond, which EUC-JP's byte range cannot produce at all.
  const EUC_JP_MAX_POINTER = 93 * 94 + 93;

  const SAMPLE_STEP = 37;

  it.each(SUPPORTED_LABELS)(
    "agrees with a platform %s decoder for a sample of defined pointers",
    (label) => {
      const table = label === "gbk" || label === "gb18030" ? GB18030 : JIS0208;
      const bytesForPointer =
        label === "shift_jis"
          ? shiftJisBytesForPointer
          : label === "euc-jp"
            ? eucJis0208BytesForPointer
            : gb18030TwoByteBytesForPointer;
      const maxPointer =
        label === "euc-jp" ? EUC_JP_MAX_POINTER : table.codeUnits.length - 1;
      const platform = new TextDecoder(label, { fatal: true });
      let sampled = 0;
      for (let pointer = 0; pointer <= maxPointer; pointer += SAMPLE_STEP) {
        const codePoint = pointerCodePoint(table, pointer);
        if (codePoint === undefined) {
          continue;
        }
        const [leading, trail] = bytesForPointer(pointer);
        const bytes = Uint8Array.of(leading, trail);
        sampled += 1;
        expect(platform.decode(bytes), `pointer ${String(pointer)}`).toBe(
          decodeText(bytes, { encoding: label }).text,
        );
      }
      expect(sampled).toBeGreaterThan(100);
    },
  );

  it("agrees with a platform EUC-KR decoder inside the traditional 0xA1-0xFE sub-range", () => {
    const platform = new TextDecoder("euc-kr", { fatal: true });
    let sampled = 0;
    for (let pointer = 0; pointer < EUC_KR.codeUnits.length; pointer += 1) {
      const codePoint = pointerCodePoint(EUC_KR, pointer);
      if (codePoint === undefined) {
        continue;
      }
      const [leading, trail] = eucKrBytesForPointer(pointer);
      if (leading < 0xa1 || trail < 0xa1) {
        continue;
      }
      const bytes = Uint8Array.of(leading, trail);
      let platformResult: string;
      try {
        platformResult = platform.decode(bytes);
      } catch {
        // A small number of pointers even inside the traditional sub-range are undefined in Node's own ICU build (the Euro sign and registered-trademark sign among them); skip rather than assert agreement where there is demonstrably none to check.
        continue;
      }
      sampled += 1;
      expect(platformResult, `pointer ${String(pointer)}`).toBe(
        decodeText(bytes, { encoding: "euc-kr" }).text,
      );
    }
    expect(sampled).toBeGreaterThan(100);
  });
});
