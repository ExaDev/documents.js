import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  BASE64_ENCODE_CHUNK_CHARS,
  base64ToBytes,
  bytesToBase64,
} from "./base64";

const REFERENCE_TABLE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The straightforward encoder bytesToBase64 is held to: one output character appended at a time, four per three input bytes, with `=` where the final group is short. It is deliberately the slow, obviously-correct formulation, so an optimised implementation can be checked against it rather than against its own reasoning. */
function referenceBytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index] ?? 0;
    const b1 = bytes[index + 1] ?? 0;
    const b2 = bytes[index + 2] ?? 0;
    out += REFERENCE_TABLE.charAt(b0 >> 2);
    out += REFERENCE_TABLE.charAt(((b0 & 0x03) << 4) | (b1 >> 4));
    out +=
      index + 1 < bytes.length
        ? REFERENCE_TABLE.charAt(((b1 & 0x0f) << 2) | (b2 >> 6))
        : "=";
    out += index + 2 < bytes.length ? REFERENCE_TABLE.charAt(b2 & 0x3f) : "=";
  }
  return out;
}

/** Deterministic pseudo-random bytes from Mulberry32 (a 32-bit generator small enough to state in full here), so a failing input reproduces exactly and no test depends on Math.random. */
function seededBytes(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    bytes[index] = (mixed ^ (mixed >>> 14)) & 0xff;
  }
  return bytes;
}

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

describe("bytesToBase64 against independent encoders", () => {
  it("matches the reference encoder and Node's Buffer for every length from 0 to 64 bytes, covering each remainder modulo 3", () => {
    for (let length = 0; length <= 64; length += 1) {
      const bytes = seededBytes(length, length + 1);
      const encoded = bytesToBase64(bytes);
      expect(encoded).toBe(referenceBytesToBase64(bytes));
      expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
    }
  });

  it("matches the reference encoder and Node's Buffer on all 256 byte values in order and in reverse", () => {
    const ascending = Uint8Array.from(
      { length: 256 },
      (_unused, index) => index,
    );
    const descending = Uint8Array.from(ascending).reverse();
    for (const bytes of [ascending, descending]) {
      const encoded = bytesToBase64(bytes);
      expect(encoded).toBe(referenceBytesToBase64(bytes));
      expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
    }
  });

  it("matches the reference encoder and Node's Buffer on an all-zero and an all-0xff buffer", () => {
    for (const fill of [0x00, 0xff]) {
      const bytes = new Uint8Array(1000).fill(fill);
      const encoded = bytesToBase64(bytes);
      expect(encoded).toBe(referenceBytesToBase64(bytes));
      expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
    }
  });

  it("matches the reference encoder and Node's Buffer on a large pseudo-random buffer whose length leaves a two-byte remainder", () => {
    const bytes = seededBytes(1024 * 1024 + 2, 0x5eed);
    const encoded = bytesToBase64(bytes);
    expect(encoded).toBe(referenceBytesToBase64(bytes));
    expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("matches the reference encoder and Node's Buffer for lengths on and around each of the first three chunk boundaries", () => {
    const chunkBytes = (BASE64_ENCODE_CHUNK_CHARS / 4) * 3;
    for (let chunks = 1; chunks <= 3; chunks += 1) {
      for (let offset = -2; offset <= 2; offset += 1) {
        const bytes = seededBytes(
          chunks * chunkBytes + offset,
          chunks * 10 + offset + 2,
        );
        const encoded = bytesToBase64(bytes);
        expect(encoded).toBe(referenceBytesToBase64(bytes));
        expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
      }
    }
  });

  it("encodes a view onto part of a larger buffer using only the view's own bytes", () => {
    const backing = seededBytes(64, 7);
    const view = backing.subarray(5, 5 + 20);
    expect(bytesToBase64(view)).toBe(Buffer.from(view).toString("base64"));
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
