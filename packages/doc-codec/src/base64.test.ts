import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

describe("bytesToBase64", () => {
  it("encodes the classic 'Man' example with no padding (a length divisible by 3)", () => {
    expect(bytesToBase64(new TextEncoder().encode("Man"))).toBe("TWFu");
  });

  it("encodes one trailing byte with two padding characters", () => {
    expect(bytesToBase64(new Uint8Array([0x4d]))).toBe("TQ==");
  });

  it("encodes two trailing bytes with one padding character", () => {
    expect(bytesToBase64(new Uint8Array([0x4d, 0x61]))).toBe("TWE=");
  });

  it("encodes an empty byte array as an empty string", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });

  it("encodes every byte value 0-255 and decodes back to the identical bytes", () => {
    const bytes = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) bytes[index] = index;
    const encoded = bytesToBase64(bytes);
    expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(bytes));
  });
});

describe("base64ToBytes", () => {
  it("decodes the classic 'Man' example", () => {
    expect(Array.from(base64ToBytes("TWFu"))).toEqual(
      Array.from(new TextEncoder().encode("Man")),
    );
  });

  it("decodes a two-padding-character string back to one byte", () => {
    expect(Array.from(base64ToBytes("TQ=="))).toEqual([0x4d]);
  });

  it("decodes a one-padding-character string back to two bytes", () => {
    expect(Array.from(base64ToBytes("TWE="))).toEqual([0x4d, 0x61]);
  });

  it("decodes an empty string to an empty byte array", () => {
    expect(base64ToBytes("").length).toBe(0);
  });

  it("strips a character outside the base64 alphabet (a newline) rather than corrupting the decoded bytes", () => {
    expect(Array.from(base64ToBytes("TW\nFu"))).toEqual(
      Array.from(new TextEncoder().encode("Man")),
    );
  });

  it("rejects an incomplete quartet whose second character is missing entirely", () => {
    // A single leftover character has no second position to decode at all -- charCodeAt on an out-of-range index returns NaN, which the DECODE table has no entry for, resolving through its own `?? 255` fallback to the same "invalid" sentinel a genuinely wrong character would.
    expect(() => base64ToBytes("T")).toThrow(/invalid base64 input/);
  });

  it("rejects a quartet whose first character is a bare padding sign, valid in the alphabet regex but absent from the decode table", () => {
    expect(() => base64ToBytes("=bcd")).toThrow(/invalid base64 input/);
  });

  it("round-trips every length from 0 to 8 bytes", () => {
    for (let length = 0; length <= 8; length += 1) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        bytes[index] = (index * 37 + 5) % 256;
      }
      const encoded = bytesToBase64(bytes);
      expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(bytes));
    }
  });
});
