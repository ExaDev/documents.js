import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

describe("bytesToBase64", () => {
  it("encodes an empty array as an empty string", () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
  });

  it("encodes a length divisible by three with no padding", () => {
    expect(bytesToBase64(new Uint8Array([0x4d, 0x61, 0x6e]))).toBe("TWFu");
  });

  it("encodes a length one short of a multiple of three with two padding characters", () => {
    expect(bytesToBase64(new Uint8Array([0x4d]))).toBe("TQ==");
  });

  it("encodes a length two short of a multiple of three with one padding character", () => {
    expect(bytesToBase64(new Uint8Array([0x4d, 0x61]))).toBe("TWE=");
  });

  it("encodes several three-byte groups back to back", () => {
    expect(
      bytesToBase64(new Uint8Array([0x4d, 0x61, 0x6e, 0x4d, 0x61, 0x6e])),
    ).toBe("TWFuTWFu");
  });
});

describe("base64ToBytes", () => {
  it("decodes an empty string to an empty array", () => {
    expect(Array.from(base64ToBytes(""))).toEqual([]);
  });

  it("decodes a length divisible by four with no padding", () => {
    expect(Array.from(base64ToBytes("TWFu"))).toEqual([0x4d, 0x61, 0x6e]);
  });

  it("decodes a single '=' of padding to two output bytes", () => {
    expect(Array.from(base64ToBytes("TWE="))).toEqual([0x4d, 0x61]);
  });

  it("decodes a double '==' of padding to one output byte", () => {
    expect(Array.from(base64ToBytes("TQ=="))).toEqual([0x4d]);
  });

  it("strips characters outside the base64 alphabet before decoding", () => {
    expect(Array.from(base64ToBytes("TW\nFu\r\n"))).toEqual([0x4d, 0x61, 0x6e]);
  });

  it("throws when the first character of a quantum decodes to no table entry (a stray '=')", () => {
    expect(() => base64ToBytes("=WFu")).toThrow("invalid base64 input");
  });

  it("throws when the second character of a quantum decodes to no table entry (a stray '=')", () => {
    expect(() => base64ToBytes("T=Fu")).toThrow("invalid base64 input");
  });

  it("round-trips every byte value across a run long enough to hit every padding remainder", () => {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = i * 17;
    }
    for (let length = 0; length <= bytes.length; length += 1) {
      const slice = bytes.subarray(0, length);
      expect(Array.from(base64ToBytes(bytesToBase64(slice)))).toEqual(
        Array.from(slice),
      );
    }
  });
});
