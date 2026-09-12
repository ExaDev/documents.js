import { describe, expect, it } from "vitest";
import {
  deriveRc4CryptoApiBlockKey,
  verifyRc4CryptoApiPassword,
} from "./office-rc4-cryptoapi";
import { rc4 } from "./rc4";
import { sha1 } from "./sha1";

function toHex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// A fixed, independently-derived reference: this module's own [MS-OFFCRYPTO] 2.3.5.1/2.3.5.2 key-derivation algorithm, reimplemented from scratch in Python's stdlib hashlib (a second, genuinely independent implementation of the same published spec, not this module's own logic reflected back at itself) for a fixed password/salt/block combination, following the same makekey/RC4 shape nolze/msoffcrypto-tool's own `method/rc4_cryptoapi.py` uses. Every value below was computed by that independent script and never hand-adjusted.
const PASSWORD = "Password1234_";
const SALT = fromHex("000102030405060708090a0b0c0d0e0f");

describe("deriveRc4CryptoApiBlockKey", () => {
  it("derives the block-0 128-bit key", () => {
    expect(toHex(deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 0, 128))).toBe(
      "1184656f67dc864faad91a39f8d6f16f",
    );
  });

  it("derives a 40-bit key padded to a 16-byte RC4 key, per [MS-OFFCRYPTO] 2.3.5.1's own 40-bit special case", () => {
    expect(toHex(deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 0, 40))).toBe(
      "1184656f670000000000000000000000",
    );
  });

  it("treats keySizeBits 0 the same as 40, per [MS-OFFCRYPTO] 2.3.5.1", () => {
    expect(toHex(deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 0, 0))).toBe(
      toHex(deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 0, 40)),
    );
  });

  it("derives a different key for every block number, since RC4 CryptoAPI re-keys per persist object rather than per byte offset", () => {
    expect(toHex(deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 5, 128))).toBe(
      "077011554e6ac596d06811bae86dbfd2",
    );
    expect(toHex(deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 3, 128))).toBe(
      "fac2d39e82208158fa908bd5998fd6f1",
    );
  });
});

describe("verifyRc4CryptoApiPassword", () => {
  // Built by RC4-encrypting a fixed 16-byte verifier and its SHA-1 hash, as ONE continuous 36-byte keystream application under the same reference script's block-0 key -- exactly what a real EncryptionVerifier's encryptedVerifier/encryptedVerifierHash fields hold, and exactly what verifyRc4CryptoApiPassword must invert.
  const encryptedVerifier = fromHex("ab69bbd68757b0b96e237479d34f1aa0");
  const encryptedVerifierHash = fromHex(
    "cae71c7e77e7db599a06e8ba09303fbb52a47207",
  );

  it("accepts the correct password", () => {
    expect(
      verifyRc4CryptoApiPassword(
        PASSWORD,
        SALT,
        128,
        encryptedVerifier,
        encryptedVerifierHash,
      ),
    ).toBe(true);
  });

  it("rejects an incorrect password", () => {
    expect(
      verifyRc4CryptoApiPassword(
        "wrong password",
        SALT,
        128,
        encryptedVerifier,
        encryptedVerifierHash,
      ),
    ).toBe(false);
  });

  it("rejects a decrypted hash that shares one byte with the verifier's own SHA-1 but otherwise disagrees, not just a wholesale mismatch", () => {
    // A verifier/hash pair built to share exactly one byte (index 0) at whatever position a byte-by-byte comparison checks first, with every other byte of the hash deliberately complemented (`0xff - b` can never equal `b`, so every other position is guaranteed to differ) -- this is exactly the input that would fool a comparison using `.some` (true the moment any single byte matches) where only `.every` (true only when every byte matches) is correct.
    const verifier = new Uint8Array(16).fill(0x42);
    const correctHash = sha1(verifier);
    const tamperedHash = correctHash.map((byte, index) =>
      index === 0 ? byte : 0xff - byte,
    );
    const key = deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 0, 128);
    const combined = new Uint8Array(36);
    combined.set(verifier, 0);
    combined.set(tamperedHash, 16);
    const ciphertext = rc4(key, combined);
    expect(
      verifyRc4CryptoApiPassword(
        PASSWORD,
        SALT,
        128,
        ciphertext.subarray(0, 16),
        ciphertext.subarray(16, 36),
      ),
    ).toBe(false);
  });
});

describe("deriveRc4CryptoApiBlockKey combined with this package's own rc4", () => {
  it("decrypts a persist object's bytes under its own persist-ID-derived key", () => {
    const key = deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 3, 128);
    const ciphertext = fromHex("eeb487843ab6d42c24f5c36cb1acc1c089a1");
    const plaintext = rc4(key, ciphertext);
    expect(new TextDecoder().decode(plaintext)).toBe("Hello, PowerPoint!");
  });
});
