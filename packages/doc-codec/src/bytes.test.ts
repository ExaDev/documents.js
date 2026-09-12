import { describe, expect, it } from "vitest";
import { DocFormatError } from "./errors";
import {
  readInt16LE,
  readInt32LE,
  readUint16LE,
  readUint32LE,
  readUint8,
  slice,
} from "./bytes";

describe("readUint8", () => {
  it("reads a single byte", () => {
    expect(readUint8(new Uint8Array([0x00, 0xab, 0xff]), 1)).toBe(0xab);
  });

  it("reads the very last byte of a buffer without running past it", () => {
    expect(readUint8(new Uint8Array([0x01, 0x02]), 1)).toBe(0x02);
  });

  it("rejects an offset one byte past the end of the buffer, naming 'uint8'", () => {
    expect(() => readUint8(new Uint8Array([0x01]), 1)).toThrow(DocFormatError);
    expect(() => readUint8(new Uint8Array([0x01]), 1)).toThrow(/uint8/);
  });

  it("rejects a negative offset", () => {
    expect(() => readUint8(new Uint8Array([0x01]), -1)).toThrow(
      /not a non-negative integer/,
    );
  });

  it("rejects a non-integer offset", () => {
    expect(() => readUint8(new Uint8Array([0x01, 0x02]), 0.5)).toThrow(
      /not a non-negative integer/,
    );
  });
});

describe("readUint16LE", () => {
  it("reads a little-endian unsigned 16-bit value", () => {
    expect(readUint16LE(new Uint8Array([0x34, 0x12]), 0)).toBe(0x1234);
  });

  it("respects a subarray's own byteOffset rather than reading from the underlying buffer's start", () => {
    const backing = new Uint8Array([0xff, 0xff, 0x34, 0x12, 0xff]);
    const view = backing.subarray(2, 4);
    expect(readUint16LE(view, 0)).toBe(0x1234);
  });

  it("rejects a read running past the end, naming 'uint16'", () => {
    expect(() => readUint16LE(new Uint8Array([0x01]), 0)).toThrow(/uint16/);
  });
});

describe("readInt16LE", () => {
  it("reads a little-endian signed 16-bit value, negative included", () => {
    expect(readInt16LE(new Uint8Array([0xff, 0xff]), 0)).toBe(-1);
  });

  it("rejects a read running past the end, naming 'int16'", () => {
    expect(() => readInt16LE(new Uint8Array([0x01]), 0)).toThrow(/int16/);
  });
});

describe("readUint32LE", () => {
  it("reads a little-endian unsigned 32-bit value", () => {
    expect(readUint32LE(new Uint8Array([0x78, 0x56, 0x34, 0x12]), 0)).toBe(
      0x12345678,
    );
  });

  it("rejects a read running past the end, naming 'uint32'", () => {
    expect(() => readUint32LE(new Uint8Array([0x01, 0x02, 0x03]), 0)).toThrow(
      /uint32/,
    );
  });
});

describe("readInt32LE", () => {
  it("reads a little-endian signed 32-bit value, negative included", () => {
    expect(readInt32LE(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 0)).toBe(-1);
  });

  it("rejects a read running past the end, naming 'int32'", () => {
    expect(() => readInt32LE(new Uint8Array([0x01, 0x02, 0x03]), 0)).toThrow(
      /int32/,
    );
  });
});

describe("slice", () => {
  it("returns a bounds-checked subarray of the requested length", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(Array.from(slice(bytes, 1, 3, "test"))).toEqual([2, 3, 4]);
  });

  it("allows a zero-length slice at the very end of the buffer", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(Array.from(slice(bytes, 3, 0, "test"))).toEqual([]);
  });

  it("rejects a negative length, naming the structure via 'what'", () => {
    expect(() => slice(new Uint8Array([1, 2, 3]), 0, -1, "MyField")).toThrow(
      /MyField declares a length of -1/,
    );
  });

  it("rejects a non-integer length", () => {
    expect(() => slice(new Uint8Array([1, 2, 3]), 0, 1.5, "MyField")).toThrow(
      /MyField declares a length of 1.5/,
    );
  });

  it("rejects a length that runs past the end of the buffer, naming 'what' in the error", () => {
    expect(() => slice(new Uint8Array([1, 2, 3]), 1, 10, "MyField")).toThrow(
      /MyField read of 10 bytes at offset 1 runs past the end of a 3-byte stream/,
    );
  });
});
