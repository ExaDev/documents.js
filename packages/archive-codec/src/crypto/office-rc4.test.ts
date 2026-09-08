import { describe, expect, it } from "vitest";
import {
  decryptOfficeRc4,
  deriveOfficeRc4BaseHash,
  deriveOfficeRc4BlockKey,
  OFFICE_RC4_BLOCK_SIZE,
} from "./office-rc4";

function toHex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// A password/salt pair and its expected derived hashes, independently computed via a from-scratch Python port of [MS-OFFCRYPTO] 2.3.6.2 (H0 = MD5(UTF-16LE password), H1 = MD5(16x-repeated (H0[0:5] + salt)), block key = MD5(H1[0:5] + LE32 block number)[0:5]), not against this module's own code.
const PASSWORD = "Test1234";
const SALT = fromHex("000102030405060708090a0b0c0d0e0f");
const BASE_HASH_HEX = "d51ea02125";
const BLOCK_0_KEY_HEX = "542a0783ac";
const BLOCK_1_KEY_HEX = "286de68a00";

describe("deriveOfficeRc4BaseHash", () => {
  it("matches an independent MS-OFFCRYPTO 2.3.6.2 implementation", () => {
    expect(toHex(deriveOfficeRc4BaseHash(PASSWORD, SALT))).toBe(BASE_HASH_HEX);
  });
});

describe("deriveOfficeRc4BlockKey", () => {
  it("derives the block 0 and block 1 keys the reference implementation derives", () => {
    const baseHash = fromHex(BASE_HASH_HEX);
    expect(toHex(deriveOfficeRc4BlockKey(baseHash, 0))).toBe(BLOCK_0_KEY_HEX);
    expect(toHex(deriveOfficeRc4BlockKey(baseHash, 1))).toBe(BLOCK_1_KEY_HEX);
  });
});

describe("decryptOfficeRc4", () => {
  const baseHash = fromHex(BASE_HASH_HEX);

  it("decrypts a chunk that starts before and ends after a 1024-byte block boundary", () => {
    // streamOffset 1000 + 48 bytes crosses the block-0/block-1 boundary at absolute offset 1024, 24 bytes into this chunk.
    const streamOffset = 1000;
    expect(streamOffset + 48).toBeGreaterThan(OFFICE_RC4_BLOCK_SIZE);
    const plaintext = Uint8Array.from({ length: 48 }, (_, i) => i % 256);
    const ciphertext = fromHex(
      "510ae92f50a6b568f545da7c7aafe2e0e91eaf63e6646ff676c5ff6153f1db9e0489e94f49556c055a46119050823dae",
    );
    expect(decryptOfficeRc4(baseHash, streamOffset, plaintext)).toEqual(
      ciphertext,
    );
    expect(decryptOfficeRc4(baseHash, streamOffset, ciphertext)).toEqual(
      plaintext,
    );
  });

  it("decrypting a stream in two separate chunks matches decrypting it as one, when both chunks stay in the same block", () => {
    const streamOffset = 100;
    const plaintext = Uint8Array.from({ length: 40 }, (_, i) => (i * 7) % 256);
    const whole = decryptOfficeRc4(baseHash, streamOffset, plaintext);
    const first = decryptOfficeRc4(
      baseHash,
      streamOffset,
      plaintext.subarray(0, 15),
    );
    const second = decryptOfficeRc4(
      baseHash,
      streamOffset + 15,
      plaintext.subarray(15),
    );
    expect(new Uint8Array([...first, ...second])).toEqual(whole);
  });
});
