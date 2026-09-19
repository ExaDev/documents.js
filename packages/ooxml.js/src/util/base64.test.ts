import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

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

  // The fixtures from here to the end of this block deliberately mix 0x00 and 0xff bytes so a wrong source index (an off-by-one arithmetic mutant) or a wrong loop bound (an off-by-one comparison mutant) reads a different byte than the correct one and changes the asserted character, rather than coincidentally reproducing it.
  it("encodes zero bytes as the empty string", () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
  });

  it("encodes exactly one byte with two '=' padding characters", () => {
    expect(bytesToBase64(new Uint8Array([0xff]))).toBe("/w==");
  });

  it("encodes exactly two bytes with one '=' padding character", () => {
    expect(bytesToBase64(new Uint8Array([0xff, 0x00]))).toBe("/wA=");
  });

  it("encodes exactly three bytes with no padding at all", () => {
    expect(bytesToBase64(new Uint8Array([0xff, 0x00, 0xff]))).toBe("/wD/");
  });

  it("encodes four bytes (one full group plus a one-byte remainder) correctly, proving the loop continues past the first group", () => {
    // Group 1 (bytes 0-2): [0xff, 0x00, 0xff] -> "/wD/" (verified above). Group 2 (byte 3 alone): [0x00] -> "AA==".
    expect(bytesToBase64(new Uint8Array([0xff, 0x00, 0xff, 0x00]))).toBe(
      "/wD/AA==",
    );
  });

  it("never emits an extra trailing group's worth of characters for an input length that is an exact multiple of three", () => {
    expect(bytesToBase64(new Uint8Array([0xff, 0x00, 0xff]))).toHaveLength(4);
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

  it("encodes a view onto part of a larger buffer using only the view's own bytes", () => {
    const backing = seededBytes(64, 7);
    const view = backing.subarray(5, 5 + 20);
    expect(bytesToBase64(view)).toBe(Buffer.from(view).toString("base64"));
  });
});

describe("base64ToBytes", () => {
  it("decodes the empty string to zero bytes", () => {
    expect(base64ToBytes("")).toEqual(new Uint8Array([]));
  });

  it("decodes a one-byte, double-padded group back to its exact byte", () => {
    expect(base64ToBytes("/w==")).toEqual(new Uint8Array([0xff]));
  });

  it("decodes a two-byte, single-padded group back to its exact bytes", () => {
    expect(base64ToBytes("/wA=")).toEqual(new Uint8Array([0xff, 0x00]));
  });

  it("decodes a three-byte, unpadded group back to its exact bytes", () => {
    expect(base64ToBytes("/wD/")).toEqual(new Uint8Array([0xff, 0x00, 0xff]));
  });

  it("decodes four full groups (12 bytes) back to their exact bytes, proving the loop advances correctly past the first group", () => {
    expect(base64ToBytes("/wD//wD//wD//wD/")).toEqual(
      new Uint8Array([
        0xff, 0x00, 0xff, 0xff, 0x00, 0xff, 0xff, 0x00, 0xff, 0xff, 0x00, 0xff,
      ]),
    );
  });

  it("strips characters outside the base64 alphabet (whitespace, newlines) before decoding, rather than including them literally", () => {
    expect(base64ToBytes("/w \n== ")).toEqual(new Uint8Array([0xff]));
  });

  it("round-trips bytesToBase64's own output for every remainder length (0, 1, 2 bytes past a full group)", () => {
    for (const bytes of [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([1, 2, 3, 4, 5]),
      new Uint8Array([1, 2, 3, 4, 5, 6]),
    ]) {
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  it("throws with the exact 'invalid base64 input' message when only the first character of a 4-character group is unmappable", () => {
    // '=' is not a member of the base64 alphabet DECODE maps (it is stripped from TABLE's own 64 characters), so it decodes to the 255 sentinel exactly like a genuinely unmappable character would.
    expect(() => base64ToBytes("=AAA")).toThrow("invalid base64 input");
  });

  it("throws with the exact 'invalid base64 input' message when only the second character of a 4-character group is unmappable", () => {
    expect(() => base64ToBytes("A=AA")).toThrow("invalid base64 input");
  });
});
