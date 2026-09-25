import { describe, expect, it } from "vitest";
import { dword, NO_TEXT, startWpgData, startWpgDataXY, wpg, word } from "./wpg";

// Direct coverage for the WPG fixture-building helpers themselves (src/test-support/wpg.ts), beyond what stream/wpg.test.ts and its split siblings exercise in passing: startWpgData's default precision, startWpgDataXY's default extent, wpg's own total-length field, and NO_TEXT's stub callback, none of which the decoder-driven tests happen to read back precisely enough to catch a corrupted builder.

function readWord(bytes: readonly number[], offset: number): number {
  const low = bytes[offset];
  const high = bytes[offset + 1];
  if (low === undefined || high === undefined) {
    throw new Error("offset past the end of the array");
  }
  return low | (high << 8);
}

function readDword(bytes: readonly number[], offset: number): number {
  return (readWord(bytes, offset) | (readWord(bytes, offset + 2) << 16)) >>> 0;
}

describe("word", () => {
  it("splits a two-byte value into its low and high bytes, little-endian", () => {
    expect(word(0x1234)).toEqual([0x34, 0x12]);
  });
});

describe("dword", () => {
  it("splits a four-byte value into four little-endian bytes", () => {
    expect(dword(0x12345678)).toEqual([0x78, 0x56, 0x34, 0x12]);
  });
});

describe("startWpgData", () => {
  it("defaults the precision byte to 0 (single precision) when omitted", () => {
    const bytes = startWpgData({});
    expect(bytes[4]).toBe(0);
  });

  it("carries an explicit non-zero precision byte through unchanged", () => {
    // Distinguishes the `??` default from an `&&` mutant: a truthy precision must survive as itself, not collapse to 0.
    const bytes = startWpgData({ precision: 1 });
    expect(bytes[4]).toBe(1);
  });

  it("encodes the given ppi identically on both axes and the given extent verbatim", () => {
    const bytes = startWpgData({ ppi: 300, extent: [1, 2, 3, 4] });
    expect(readWord(bytes, 0)).toBe(300);
    expect(readWord(bytes, 2)).toBe(300);
    // Bytes 5-12 are the fixed viewport (0, 0, 0x7fff, 0x7fff), stepped over by every reader; the extent itself starts at byte 13.
    expect(readWord(bytes, 13)).toBe(1);
    expect(readWord(bytes, 15)).toBe(2);
    expect(readWord(bytes, 17)).toBe(3);
    expect(readWord(bytes, 19)).toBe(4);
  });
});

describe("startWpgDataXY", () => {
  it("defaults the extent to [0, 0, 288, 144] when omitted", () => {
    const bytes = startWpgDataXY(72, 72);
    expect(readWord(bytes, 13)).toBe(0);
    expect(readWord(bytes, 15)).toBe(0);
    expect(readWord(bytes, 17)).toBe(288);
    expect(readWord(bytes, 19)).toBe(144);
  });

  it("carries independently given x/y ppi and an explicit extent, not the paired default", () => {
    const bytes = startWpgDataXY(150, 300, 1, [10, 20, 30, 40]);
    expect(readWord(bytes, 0)).toBe(150);
    expect(readWord(bytes, 2)).toBe(300);
    expect(bytes[4]).toBe(1);
    expect(readWord(bytes, 13)).toBe(10);
    expect(readWord(bytes, 15)).toBe(20);
    expect(readWord(bytes, 17)).toBe(30);
    expect(readWord(bytes, 19)).toBe(40);
  });
});

describe("wpg", () => {
  it("states the total document length as 26 (the prefix) plus every record byte", () => {
    const records = [
      [0x0f, 0x01, 0x00, 0x03, 0xaa, 0xbb, 0xcc],
      [0x0f, 0x02, 0x00, 0x02, 0xdd, 0xee],
    ];
    const bytes = Array.from(wpg(records));
    // The total-length dword sits at offset 20, per the prefix layout wpg() itself builds.
    expect(readDword(bytes, 20)).toBe(26 + 7 + 6);
  });

  it("defaults the major version to 2 and carries an explicit one through unchanged", () => {
    expect(Array.from(wpg([]))[10]).toBe(2);
    expect(Array.from(wpg([], 1))[10]).toBe(1);
  });

  it("flattens every record into one contiguous byte stream after the 26-byte prefix", () => {
    const bytes = Array.from(
      wpg([
        [1, 2],
        [3, 4, 5],
      ]),
    );
    expect(bytes.slice(26)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("NO_TEXT", () => {
  it("folds to an empty block list", () => {
    expect(NO_TEXT.foldTextData()).toEqual([]);
  });
});
