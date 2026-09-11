import { describe, expect, it } from "vitest";
import { WpdFormatError } from "../errors";
import { byteAt, int16At, sliceAt, uint16At, uint32At } from "./view";

describe("byteAt", () => {
  it("reads the byte at the given offset", () => {
    expect(byteAt(new Uint8Array([0x12, 0x34]), 1)).toBe(0x34);
  });

  it("throws, naming the offset and file length, past the end of the buffer", () => {
    expect(() => byteAt(new Uint8Array([0x12]), 1)).toThrow(WpdFormatError);
    expect(() => byteAt(new Uint8Array([0x12]), 1)).toThrow(
      "Byte read at offset 1 is past the end of a 1-byte file.",
    );
  });
});

describe("uint16At / uint32At", () => {
  it("reads a little-endian 16-bit value", () => {
    expect(uint16At(new Uint8Array([0x34, 0x12]), 0)).toBe(0x1234);
  });

  it("reads a little-endian 32-bit value without sign-extending a high bit", () => {
    expect(uint32At(new Uint8Array([0x00, 0x00, 0x00, 0x80]), 0)).toBe(
      0x80000000,
    );
  });
});

describe("int16At", () => {
  it("reads the largest positive value, 0x7fff, without reinterpreting it", () => {
    expect(int16At(new Uint8Array([0xff, 0x7f]), 0)).toBe(0x7fff);
  });

  it("reinterprets 0x8000, the smallest value whose sign bit is set, as negative", () => {
    expect(int16At(new Uint8Array([0x00, 0x80]), 0)).toBe(-0x8000);
  });

  it("reinterprets 0xffff as -1", () => {
    expect(int16At(new Uint8Array([0xff, 0xff]), 0)).toBe(-1);
  });
});

describe("sliceAt", () => {
  it("returns a view onto the same buffer, not a copy", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const slice = sliceAt(bytes, 1, 2);
    expect(slice).toEqual(new Uint8Array([2, 3]));
    bytes[1] = 9;
    expect(slice[0]).toBe(9);
  });

  it("accepts a slice that exactly reaches the end of the buffer", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(sliceAt(bytes, 2, 2)).toEqual(new Uint8Array([3, 4]));
  });

  it("rejects a negative offset", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(() => sliceAt(bytes, -1, 1)).toThrow(WpdFormatError);
    expect(() => sliceAt(bytes, -1, 1)).toThrow(
      "A 1-byte read at offset -1 does not fit inside a 3-byte file.",
    );
  });

  it("rejects a negative length", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(() => sliceAt(bytes, 0, -1)).toThrow(WpdFormatError);
  });

  it("rejects a length that runs one byte past the end of the buffer", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(() => sliceAt(bytes, 2, 2)).toThrow(WpdFormatError);
    expect(() => sliceAt(bytes, 2, 2)).toThrow(
      "A 2-byte read at offset 2 does not fit inside a 3-byte file.",
    );
  });
});
