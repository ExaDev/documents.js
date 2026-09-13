import { describe, expect, it } from "vitest";

import { md4 } from "./md4";

// RFC 1320's own test suite (section A.5), verbatim -- the one authority for what MD4 is. A digest implementation with no independent vector is a transcript of the pseudocode, not a decoder.

describe("md4", () => {
  it("matches every RFC 1320 A.5 test vector", () => {
    const vectors: readonly [string, string][] = [
      ["", "31d6cfe0d16ae931b73c59d7e0c089c0"],
      ["a", "bde52cb31de33e46245e05fbdbd6fb24"],
      ["abc", "a448017aaf21d8525fc10ae87aa6729d"],
      ["message digest", "d9130a8164549fe818874806e1c7014b"],
      ["abcdefghijklmnopqrstuvwxyz", "d79e1c308aa5bbcdeea8ed63df412da9"],
      [
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
        "043f8582f241db351ce627e153e7f0e4",
      ],
      [
        "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
        "e33b4ddc9c38f2199c3e7b164fcc0536",
      ],
    ];
    for (const [message, digest] of vectors) {
      expect(md4(new TextEncoder().encode(message))).toBe(digest);
    }
  });

  it("pads a 56-byte message correctly, the one length RFC 1320's own vectors never exercise", () => {
    // The padding scheme (RFC 1320 section 3.1) appends a 0x80 byte then zero bytes up to a 64-byte block boundary minus 8, leaving room for the 8-byte length field -- so a message of exactly 56 bytes leaves zero bytes of room in its own block for that 0x80 plus the length field, and must instead pad out to a whole second block. None of RFC 1320's own A.5 vectors (lengths 0, 1, 3, 14, 26, 62, 80) land on 56 or 57 bytes, the narrow window where an off-by-one in the padding-length arithmetic changes which block boundary is chosen. Digest independently computed via OpenSSL's own MD4 implementation (`openssl dgst -md4 -provider legacy -provider default`), not derived from this package's own code.
    const message = "abcdefgh".repeat(7); // 56 bytes
    expect(md4(new TextEncoder().encode(message))).toBe(
      "480276f2170f9668bc949a7fc46b5ead",
    );
  });
});
