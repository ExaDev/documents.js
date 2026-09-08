import { describe, expect, it } from "vitest";
import { sha1 } from "./sha1";

function toHex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

describe("sha1", () => {
  // RFC 3174 7.3's own test suite, the reference vectors the spec itself publishes.
  it.each([
    ["", "da39a3ee5e6b4b0d3255bfef95601890afd80709"],
    ["abc", "a9993e364706816aba3e25717850c26c9cd0d89d"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "84983e441c3bd26ebaae4aa1f95129e5e54670f1",
    ],
  ])("hashes %j to %s", (input, expected) => {
    expect(toHex(sha1(ascii(input)))).toBe(expected);
  });

  it("hashes a block-boundary-crossing message (exactly 64 bytes)", () => {
    const input = ascii("x".repeat(64));
    expect(toHex(sha1(input))).toBe("bb2fa3ee7afb9f54c6dfb5d021f14b1ffe40c163");
  });

  // RFC 3174 7.3's own third vector: one million repetitions of "a". Heavier than the others deliberately -- it is the one vector in the published suite that exercises the multi-block message schedule across many blocks rather than just one or two.
  it("hashes one million repetitions of 'a'", () => {
    const input = ascii("a".repeat(1_000_000));
    expect(toHex(sha1(input))).toBe("34aa973cd4c4daa4f61eeb2bdbad27316534016f");
  });
});
