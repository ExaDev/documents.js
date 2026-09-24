import { describe, expect, it } from "vitest";
import {
  CFF_DICT_OP_ROS,
  CFF_ESCAPED_OPERATOR_BASE,
  CFF_STANDARD_STRINGS,
  cffStringForSid,
  parseCffDict,
  readCffIndex,
} from "./cff";

// Direct byte-level tests for the two container structures every CFF font is built from. The existing coverage reaches this module only through cff-probe.ts and cff-bounds.ts against whole fonts, which exercises the happy paths a real font toolchain emits and nothing else: every operand encoding's boundary values, every malformed shape the readers refuse, and the real-number nibble stream have no test that isolates them.

function dictOf(...bytes: number[]): ReturnType<typeof parseCffDict> {
  return parseCffDict(Uint8Array.from(bytes));
}

describe("readCffIndex", () => {
  it("reads an empty INDEX as its own two count bytes and nothing more", () => {
    const index = readCffIndex(Uint8Array.from([0, 0]), 0);
    expect(index).toMatchObject({ count: 0, endOffset: 2 });
    expect(index?.entry(0)).toBeUndefined();
  });

  it("reads one entry through each of the four offset sizes", () => {
    // The same one-entry INDEX spelled with offSize 1 through 4: count 1, offSize n, offsets [1, 2], then the single data byte. Reading it back through each spelling pins every branch of the offset reader.
    for (const offSize of [1, 2, 3, 4]) {
      const offsetBytes = [1, 2].flatMap((value) =>
        Array.from(
          { length: offSize },
          (_, i) => (value >>> (8 * (offSize - 1 - i))) & 0xff,
        ),
      );
      const index = readCffIndex(
        Uint8Array.from([0, 1, offSize, ...offsetBytes, 0x41]),
        0,
      );
      expect(index).toMatchObject({ count: 1, endOffset: 3 + offSize * 2 + 1 });
      expect(Array.from(index?.entry(0) ?? [])).toEqual([0x41]);
    }
  });

  it("carves entries wherever the offsets say, including a zero-length one", () => {
    // Offsets [1, 1, 2]: the first entry is empty (two equal offsets) and the second holds the one data byte. Equal adjacent offsets describe an empty entry, which is well-formed, where a DESCENDING pair is not.
    const index = readCffIndex(Uint8Array.from([0, 2, 1, 1, 1, 2, 0x41]), 0);
    expect(index?.count).toBe(2);
    expect(Array.from(index?.entry(0) ?? [1])).toEqual([]);
    expect(Array.from(index?.entry(1) ?? [])).toEqual([0x41]);
    expect(index?.endOffset).toBe(7);
  });

  it("refuses an index whose first offset is not the 1 the format defines", () => {
    // Offsets [2, 3]: internally consistent and non-descending, but INDEX offsets are 1-based against the byte before the data, so a first offset of anything but 1 means these are not INDEX offsets. The three trailing bytes make the offsets otherwise satisfiable, so only this check refuses the INDEX.
    expect(
      readCffIndex(Uint8Array.from([0, 1, 1, 2, 3, 0x41, 0x42, 0x43]), 0),
    ).toBeUndefined();
  });

  it("refuses an offset size of zero, even though its offset array then fits", () => {
    // offSize 0 with a two-entry offset array of zero bytes: the array-length check passes vacuously, and the offset reader's own fallback (four bytes) happens to read a 1 and a 2 from the bytes that follow, so only the range check on offSize itself refuses this.
    expect(
      readCffIndex(Uint8Array.from([0, 1, 0, 0, 0, 0, 1]), 0),
    ).toBeUndefined();
  });

  it("refuses an offset size of five, even with a full five-byte-wide offset array present", () => {
    // count 1, offSize 5, then ten bytes the reader would carve into two offsets of 1 and 2 (through its four-byte fallback), a pad byte where the format's own one-short data origin lands, and one data byte beyond it: everything downstream of the range check would accept this, so the range check is the only refusal.
    expect(
      readCffIndex(
        Uint8Array.from([0, 1, 5, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0x41]),
        0,
      ),
    ).toBeUndefined();
  });

  it("refuses a descending offset pair wherever it sits, including the very last pair", () => {
    // Offsets [1, 3, 2]: the second entry would have negative length. The last-pair variant matters because the check loop's own bound is the classic off-by-one shape: a loop stopping one pair early accepts exactly this.
    const middle = readCffIndex(
      Uint8Array.from([0, 2, 1, 1, 3, 2, 0x41, 0x42]),
      0,
    );
    expect(middle).toBeUndefined();
    const last = readCffIndex(
      Uint8Array.from([0, 3, 1, 1, 3, 5, 2, 0x41, 0x42]),
      0,
    );
    expect(last).toBeUndefined();
  });

  it("refuses data running past the end of the bytes it is read from", () => {
    // Offsets [1, 5] with only two data bytes following the offset array: the entry claims four bytes that are not there.
    expect(
      readCffIndex(Uint8Array.from([0, 1, 1, 1, 5, 0x41, 0x42]), 0),
    ).toBeUndefined();
  });

  it("refuses a truncated count, offset-size byte, offset array, and an out-of-range offset size", () => {
    expect(readCffIndex(Uint8Array.from([0]), 0)).toBeUndefined();
    expect(readCffIndex(Uint8Array.from([0, 1]), 0)).toBeUndefined(); // count without its offSize byte
    expect(readCffIndex(Uint8Array.from([0, 1, 1, 1]), 0)).toBeUndefined(); // offset array cut short
    for (const offSize of [0, 5]) {
      expect(
        readCffIndex(Uint8Array.from([0, 1, offSize, 1, 2, 0x41]), 0),
      ).toBeUndefined();
    }
  });

  it("reads an INDEX at a non-zero offset and reports its end from there", () => {
    // Two bytes of prefix, then the one-entry INDEX: everything the reader does is relative to the offset it is given, not to zero.
    const index = readCffIndex(
      Uint8Array.from([0xff, 0xfe, 0, 1, 1, 1, 2, 0x41]),
      2,
    );
    expect(index?.endOffset).toBe(8);
    expect(Array.from(index?.entry(0) ?? [])).toEqual([0x41]);
  });

  it("declines an entry index outside the INDEX, in either direction", () => {
    const index = readCffIndex(Uint8Array.from([0, 1, 1, 1, 2, 0x41]), 0);
    expect(index?.entry(-1)).toBeUndefined();
    expect(index?.entry(1)).toBeUndefined();
    expect(index?.entry(0)).toBeDefined();
  });
});

describe("parseCffDict: integer operands", () => {
  it("decodes the small single-byte range at both of its ends and its midpoint", () => {
    const dict = dictOf(32, 246, 139, 0); // -107, 107, 0, then operator 0
    expect(dict?.get(0)).toEqual([-107, 107, 0]);
  });

  it("decodes the positive medium range at both of its ends", () => {
    // 247 with a zero continuation byte is 108; 250 with 0xff is (250-247)*256 + 255 + 108 = 1131.
    const dict = dictOf(247, 0, 250, 0xff, 0);
    expect(dict?.get(0)).toEqual([108, 1131]);
  });

  it("decodes the negative medium range at both of its ends", () => {
    // 251 with a zero continuation byte is -108; 254 with 0xff is -(3*256) - 255 - 108 = -1131.
    const dict = dictOf(251, 0, 254, 0xff, 0);
    expect(dict?.get(0)).toEqual([-108, -1131]);
  });

  it("decodes the 16-bit integer form as signed, at both boundaries", () => {
    const dict = dictOf(
      28,
      0x7f,
      0xff, // 32767
      28,
      0x80,
      0x00, // -32768
      28,
      0x30,
      0x39, // 12345
      0,
    );
    expect(dict?.get(0)).toEqual([32767, -32768, 12345]);
  });

  it("decodes the 32-bit integer form as two's complement", () => {
    const dict = dictOf(
      29,
      0x00,
      0xbc,
      0x61,
      0x4e, // 12345678
      29,
      0xff,
      0xff,
      0xff,
      0xff, // -1
      0,
    );
    expect(dict?.get(0)).toEqual([12345678, -1]);
  });

  it("refuses a truncated integer operand of every width", () => {
    expect(dictOf(28, 0x30)).toBeUndefined();
    expect(dictOf(29, 0x00, 0x00, 0x00)).toBeUndefined();
    expect(dictOf(247)).toBeUndefined(); // medium without its continuation byte
    expect(dictOf(251)).toBeUndefined(); // negative medium without its continuation byte
  });
});

describe("parseCffDict: real operands", () => {
  it("decodes digits, a decimal point, and a terminator in either nibble", () => {
    // Nibbles 2 '.' 5 end: 2.5, with the terminator in the low nibble of the second byte.
    expect(dictOf(30, 0x2a, 0x5f, 0)?.get(0)).toEqual([2.5]);
    // Nibbles 1 end: 1, with the terminator in the high nibble, so the operand ends mid-byte and the next byte is already new input.
    expect(dictOf(30, 0x1f, 139, 0)?.get(0)).toEqual([1, 0]);
    // Nibbles 1 2 end across two bytes: 12, with the terminator in its own byte's high nibble.
    expect(dictOf(30, 0x12, 0xff, 0)?.get(0)).toEqual([12]);
  });

  it("decodes an exponent, a negative exponent, and a leading minus", () => {
    // Nibbles 1 E 2 end: 1E2 = 100.
    expect(dictOf(30, 0x1b, 0x2f, 0)?.get(0)).toEqual([100]);
    // Nibbles 1 E- 2 end: 1E-2 = 0.01.
    expect(dictOf(30, 0x1c, 0x2f, 0)?.get(0)).toEqual([0.01]);
    // Nibbles - 2 end: -2.
    expect(dictOf(30, 0xe2, 0xff, 0)?.get(0)).toEqual([-2]);
    // Nibble 9, the last digit: a reader off by one on the digit range would drop it and decode 0.
    expect(dictOf(30, 0x9f, 0)?.get(0)).toEqual([9]);
  });

  it("yields NaN for a nibble stream that spells no finite number, without failing the DICT", () => {
    // Nibbles 0 E- 1 - end: "0E-1-", which is not a number. The DICT still parses and the operator still carries its (NaN) operand, so a caller that never reads this operand loses nothing.
    const dict = dictOf(30, 0x0c, 0x1e, 0xff, 0);
    const operands = dict?.get(0);
    expect(operands).toHaveLength(1);
    expect(Number.isNaN(operands?.[0])).toBe(true);
  });

  it("refuses the reserved nibble and a real running off the end of the DICT", () => {
    // Nibble 0xd is reserved and appears in no valid real.
    expect(dictOf(30, 0x1d, 0xff, 0)).toBeUndefined();
    // No terminator anywhere: the stream runs off the end.
    expect(dictOf(30, 0x12)).toBeUndefined();
  });
});

describe("parseCffDict: operators", () => {
  it("keys a one-byte operator to the operands that preceded it", () => {
    const dict = dictOf(139, 140, 5);
    expect(dict?.get(5)).toEqual([0, 1]);
    expect(dict?.size).toBe(1);
  });

  it("keys a two-byte escaped operator above every one-byte operator's range", () => {
    // 12 30 is ROS, keyed as 1200 + 30 so it can never collide with a one-byte operator.
    const dict = dictOf(12, 30);
    expect(dict?.has(CFF_ESCAPED_OPERATOR_BASE + 30)).toBe(true);
    expect(dict?.has(CFF_DICT_OP_ROS)).toBe(true);
    expect(dict?.size).toBe(1);
  });

  it("accepts an operator with no operands at all, and operator 21 (the last one-byte operator)", () => {
    expect(dictOf(0)?.get(0)).toEqual([]);
    expect(dictOf(21)?.get(21)).toEqual([]);
  });

  it("keeps only the last operand list when an operator repeats", () => {
    const dict = dictOf(139, 5, 140, 5);
    expect(dict?.get(5)).toEqual([1]);
    expect(dict?.size).toBe(1);
  });

  it("refuses an escape byte with no second byte and each reserved first byte, followed by another byte", () => {
    // The trailing byte matters: it is what a range check that wrongly admitted a reserved first byte would go on to read as a two-byte operand's continuation, producing a DICT instead of a refusal.
    expect(dictOf(12)).toBeUndefined();
    for (const reserved of [22, 27, 31, 255]) {
      expect(dictOf(reserved, 0)).toBeUndefined();
    }
  });
});

describe("cffStringForSid", () => {
  it("resolves a standard SID and the first SID past the standard strings", () => {
    const lastIndex = CFF_STANDARD_STRINGS.length - 1;
    expect(CFF_STANDARD_STRINGS[lastIndex]).toBe("Semibold");
    expect(cffStringForSid(lastIndex, undefined)).toBe("Semibold");
    // One past the standard strings is the font's own String INDEX entry 0.
    const index = readCffIndex(Uint8Array.from([0, 1, 1, 1, 3, 0x68, 0x69]), 0);
    expect(cffStringForSid(CFF_STANDARD_STRINGS.length, index)).toBe("hi");
  });

  it("declines a SID past both the standard strings and the font's own INDEX", () => {
    const index = readCffIndex(Uint8Array.from([0, 1, 1, 1, 2, 0x68]), 0);
    expect(
      cffStringForSid(CFF_STANDARD_STRINGS.length + 1, index),
    ).toBeUndefined();
    expect(
      cffStringForSid(CFF_STANDARD_STRINGS.length, undefined),
    ).toBeUndefined();
  });
});
