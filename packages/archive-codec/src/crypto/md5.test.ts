import { describe, expect, it } from "vitest";
import { md5, splitBitLength64, writeBitLength64 } from "./md5";

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

describe("splitBitLength64", () => {
  it("keeps the whole value in the low half when it fits in 32 bits", () => {
    expect(splitBitLength64(640)).toEqual({ low: 640, high: 0 });
  });

  it("carries the excess into the high half once the bit length passes 2^32", () => {
    // A message longer than 512 MiB overflows the low 32-bit half -- exercised here directly against a fabricated bit length, since hashing an actual 512 MiB buffer to reach this boundary would make the suite itself pathologically slow.
    expect(splitBitLength64(0x100000005)).toEqual({ low: 5, high: 1 });
  });

  it("keeps splitting correctly for a bit length spanning several high-half units", () => {
    expect(splitBitLength64(0x300000010)).toEqual({ low: 0x10, high: 3 });
  });
});

describe("writeBitLength64", () => {
  it("writes both halves little-endian, including a non-zero high half", () => {
    // A bit length whose high half is non-zero and distinct from its low half, written directly rather than via an actual >512 MiB message -- proving the high half's own byte order without hashing anything pathologically large. A big-endian mistake on the high half would write 0x02000000 here, not 0x00000002.
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    writeBitLength64(view, 0, 0x200000005);
    expect(view.getUint32(0, true)).toBe(5);
    expect(view.getUint32(4, true)).toBe(2);
    expect([...new Uint8Array(buffer)]).toEqual([5, 0, 0, 0, 2, 0, 0, 0]);
  });

  it("writes at a non-zero offset", () => {
    const buffer = new ArrayBuffer(10);
    const view = new DataView(buffer);
    writeBitLength64(view, 2, 640);
    expect(view.getUint32(2, true)).toBe(640);
    expect(view.getUint32(6, true)).toBe(0);
  });
});
