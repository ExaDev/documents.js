import { describe, expect, it } from "vitest";
import { md5 } from "./md5";

function toHex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

describe("md5", () => {
  // RFC 1321 A.5's own test suite, the reference vectors the spec itself publishes.
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "d174ab98d277d9f5a5611c2c9f419d9f",
    ],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ])("hashes %j to %s", (input, expected) => {
    expect(toHex(md5(ascii(input)))).toBe(expected);
  });

  it("hashes a block-boundary-crossing message (exactly 64 bytes)", () => {
    const input = ascii("x".repeat(64));
    expect(toHex(md5(input))).toBe("c1bb4f81d892b2d57947682aeb252456");
  });
});
