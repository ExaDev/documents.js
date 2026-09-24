import { describe, expect, it } from "vitest";
import { decodeText } from "./decode";
import { pointerCodePoint } from "./decode-dbcs";
import { BIG5, EUC_KR, GB18030, GB18030_RANGES, JIS0208 } from "./dbcs-tables";
import {
  big5BytesForPointer,
  codePointToText,
  eucJis0208BytesForPointer,
  eucKrBytesForPointer,
  EXHAUSTIVE_SWEEP_TIMEOUT_MS,
  expectMalformed,
  gb18030FourBytesForPointer,
  gb18030TwoByteBytesForPointer,
  shiftJisBytesForPointer,
} from "./test-support/dbcs-fixtures";

// Big5 and gb18030/GBK, plus the cross-platform-decoder sample that spans all four two-byte encodings (shift_jis, euc-jp, gbk, gb18030) at once: split from decode-dbcs.test.ts's Shift_JIS/EUC-JP/EUC-KR coverage (ExaDev/documents.js#1275, max-lines) along the language family the two-byte encodings actually belong to. The cross-check needs JIS0208 and the Shift_JIS/EUC-JP pointer helpers alongside its own Chinese-encoding ones because it samples all four, not just the two this file's own describes cover. The pointer-arithmetic and refusal-message helpers both files share live in ./test-support/dbcs-fixtures.ts.

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

  it(
    "decodes every single-code-point pointer Big5 defines to the code point the WHATWG index names",
    () => {
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
    },
    EXHAUSTIVE_SWEEP_TIMEOUT_MS,
  );

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
  it(
    "decodes every two-byte pointer GB18030 defines to the code point the WHATWG index names",
    () => {
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
    },
    EXHAUSTIVE_SWEEP_TIMEOUT_MS,
  );

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

  it(
    "agrees with a platform EUC-KR decoder inside the traditional 0xA1-0xFE sub-range",
    () => {
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
    },
    EXHAUSTIVE_SWEEP_TIMEOUT_MS,
  );
});
