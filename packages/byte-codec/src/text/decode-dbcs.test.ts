import { describe, expect, it } from "vitest";
import { decodeText } from "./decode";
import { pointerCodePoint } from "./decode-dbcs";
import { EUC_KR, JIS0208, JIS0212 } from "./dbcs-tables";
import {
  codePointToText,
  eucJis0208BytesForPointer,
  eucKrBytesForPointer,
  EXHAUSTIVE_SWEEP_TIMEOUT_MS,
  expectMalformed,
  firstDefinedPointer,
  firstGapPointer,
  shiftJisBytesForPointer,
} from "./test-support/dbcs-fixtures";

// Shift_JIS, EUC-JP, and EUC-KR: split from decode-dbcs-chinese.test.ts's Big5/gb18030/GBK coverage (ExaDev/documents.js#1275, max-lines) along the language family the two-byte encodings actually belong to. The pointer-arithmetic and refusal-message helpers both files share live in ./test-support/dbcs-fixtures.ts.

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
  it(
    "decodes every defined JIS X 0208 pointer to the code point the WHATWG index names",
    () => {
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
    },
    EXHAUSTIVE_SWEEP_TIMEOUT_MS,
  );

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
  it(
    "decodes every defined JIS X 0208 pointer EUC-JP's own byte range can reach",
    () => {
      const maxTwoBytePointer = 93 * 94 + 93;
      for (let pointer = 0; pointer <= maxTwoBytePointer; pointer += 1) {
        const codePoint = pointerCodePoint(JIS0208, pointer);
        if (codePoint === undefined) {
          continue;
        }
        const [leading, trail] = eucJis0208BytesForPointer(pointer);
        expect(
          decodeText(Uint8Array.of(leading, trail), { encoding: "euc-jp" })
            .text,
          `pointer ${String(pointer)}`,
        ).toBe(codePointToText(codePoint));
      }
    },
    EXHAUSTIVE_SWEEP_TIMEOUT_MS,
  );

  it(
    "decodes every defined JIS X 0212 pointer behind its own 0x8F lead byte",
    () => {
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
          decodeText(Uint8Array.of(0x8f, leading, trail), {
            encoding: "euc-jp",
          }).text,
          `jis0212 pointer ${String(pointer)}`,
        ).toBe(codePointToText(codePoint));
      }
    },
    EXHAUSTIVE_SWEEP_TIMEOUT_MS,
  );

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
  it(
    "decodes every pointer EUC_KR defines to the code point the WHATWG index names",
    () => {
      for (let pointer = 0; pointer < EUC_KR.codeUnits.length; pointer += 1) {
        const codePoint = pointerCodePoint(EUC_KR, pointer);
        if (codePoint === undefined) {
          continue;
        }
        const [leading, trail] = eucKrBytesForPointer(pointer);
        expect(
          decodeText(Uint8Array.of(leading, trail), { encoding: "euc-kr" })
            .text,
          `pointer ${String(pointer)}, bytes 0x${leading.toString(16)} 0x${trail.toString(16)}`,
        ).toBe(codePointToText(codePoint));
      }
    },
    EXHAUSTIVE_SWEEP_TIMEOUT_MS,
  );

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
