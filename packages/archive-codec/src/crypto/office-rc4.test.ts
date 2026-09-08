import { md5 } from "./md5";
import { describe, expect, it } from "vitest";
import {
  decryptOfficeRc4,
  deriveOfficeRc4BaseHash,
  deriveOfficeRc4BlockKey,
  OFFICE_RC4_BLOCK_SIZE,
  OFFICE_RC4_DOC_BLOCK_SIZE,
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

describe("deriveOfficeRc4BlockKey", () => {
  // A real vector from nolze/msoffcrypto-tool's own `_makekey` doctest (msoffcrypto/method/rc4.py), a third-party, real-world, actively-maintained library -- not authored for this test suite, and not something a bug in this module's own algorithm could pass by construction. This exact vector is what caught this module's own first implementation truncating Hfinal to 5 bytes (matching [MS-OFFCRYPTO] 2.3.6.1's own "encrypted using a 40-bit RC4 cipher" prose, which is wrong): the correct key is Hfinal in full, all 16 bytes, confirmed against this vector byte for byte, and independently against Apache POI's own BinaryRC4Decryptor/CryptoFunctions.generateKey.
  it("matches nolze/msoffcrypto-tool's own doctested block-0 key", () => {
    const salt = fromHex("e8772c1d91c56a37964761b280183217");
    const baseHash = deriveOfficeRc4BaseHash("password1", salt);
    expect(toHex(baseHash)).toBe("775fae570e");
    expect(toHex(deriveOfficeRc4BlockKey(baseHash, 0))).toBe(
      "20bf32ddf540858c513744af0f24e03c",
    );
  });
});

describe("decryptOfficeRc4 password verification", () => {
  // The same reference implementation's own `verifypw` doctest: decrypting a real EncryptedVerifier/EncryptedVerifierHash pair with the block-0 key and confirming MD5(decrypted verifier) equals the decrypted hash -- the exact check xls-codec's own workbook/encryption.ts performs before trusting a password.
  it("recovers a verifier whose MD5 matches its own decrypted hash", () => {
    const salt = fromHex("e8772c1d91c56a37964761b280183217");
    const baseHash = deriveOfficeRc4BaseHash("password1", salt);
    const encryptedVerifier = fromHex("c9e997d454973d310bb1ba701426837e");
    const encryptedVerifierHash = fromHex("b1de178f07e989c44dae5e4cf96ac407");
    const decryptedVerifier = decryptOfficeRc4(baseHash, 0, encryptedVerifier);
    const decryptedVerifierHash = decryptOfficeRc4(
      baseHash,
      16,
      encryptedVerifierHash,
    );
    expect(toHex(decryptedVerifier)).toBe("325385a8caec0e205285c8ec1e315375");
    expect(toHex(decryptedVerifierHash)).toBe(
      "38f471967a53bff56029063c21121b5c",
    );
    expect(md5(decryptedVerifier)).toEqual(decryptedVerifierHash);
  });
});

describe("decryptOfficeRc4", () => {
  // A second password/salt pair, independently recomputed via a from-scratch Python port of the (now-corrected) algorithm, exercising the 1024-byte block-crossing logic the msoffcrypto-tool vector above (single block only) does not reach.
  const PASSWORD = "Test1234";
  const SALT = fromHex("000102030405060708090a0b0c0d0e0f");
  const baseHash = deriveOfficeRc4BaseHash(PASSWORD, SALT);

  it("derives the base hash and block keys the reference implementation derives", () => {
    expect(toHex(baseHash)).toBe("d51ea02125");
    expect(toHex(deriveOfficeRc4BlockKey(baseHash, 0))).toBe(
      "542a0783acefd5a74688516d8a34869e",
    );
    expect(toHex(deriveOfficeRc4BlockKey(baseHash, 1))).toBe(
      "286de68a004bb014917b4f2d801b5a2d",
    );
  });

  it("decrypts a chunk that starts before and ends after a 1024-byte block boundary", () => {
    // streamOffset 1000 + 48 bytes crosses the block-0/block-1 boundary at absolute offset 1024, 24 bytes into this chunk.
    const streamOffset = 1000;
    expect(streamOffset + 48).toBeGreaterThan(OFFICE_RC4_BLOCK_SIZE);
    const plaintext = Uint8Array.from({ length: 48 }, (_, i) => i % 256);
    const ciphertext = fromHex(
      "610bf0648703379561cb42ad1119fa471764eb883d3eab5b215829a5a6f8fdc3df5b2327fbb2b6630cb524c5bac2695f",
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

  it("decrypts across a 512-byte block boundary when passed the [MS-DOC] block size", () => {
    // The same "password1"/salt pair as the msoffcrypto-tool vector above (block 0's key is therefore already independently verified against that doctest), decrypting across a 512-byte boundary at a stream offset a 1024-byte scheme would not have crossed at all.
    const docBaseHash = deriveOfficeRc4BaseHash(
      "password1",
      fromHex("e8772c1d91c56a37964761b280183217"),
    );
    const streamOffset = 500;
    expect(streamOffset + 40).toBeGreaterThan(OFFICE_RC4_DOC_BLOCK_SIZE);
    expect(streamOffset + 40).toBeLessThan(OFFICE_RC4_BLOCK_SIZE);
    const plaintext = Uint8Array.from({ length: 40 }, (_, i) => i % 256);
    const ciphertext = fromHex(
      "85df351d8b44f2caa119ca8f9943cbd2619389354f115027870e6827ee6b2875cefd995357852dbe",
    );
    expect(
      decryptOfficeRc4(
        docBaseHash,
        streamOffset,
        plaintext,
        OFFICE_RC4_DOC_BLOCK_SIZE,
      ),
    ).toEqual(ciphertext);
    expect(
      decryptOfficeRc4(
        docBaseHash,
        streamOffset,
        ciphertext,
        OFFICE_RC4_DOC_BLOCK_SIZE,
      ),
    ).toEqual(plaintext);
  });
});
