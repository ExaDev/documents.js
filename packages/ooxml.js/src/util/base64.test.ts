import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

// Every fixture below deliberately mixes 0x00 and 0xff bytes so a wrong source index (an off-by-one arithmetic mutant) or a wrong loop bound (an off-by-one comparison mutant) reads a different byte than the correct one and changes the asserted character, rather than coincidentally reproducing it.

describe("bytesToBase64", () => {
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
