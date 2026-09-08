import { deriveRc4CryptoApiBlockKey, rc4, sha1 } from "archive-codec";
import { describe, expect, it } from "vitest";
import {
  decryptPptDocumentStream,
  readDocumentEncryptionAtom,
} from "./encryption";
import { PptEncryptedError, PptFormatError } from "./errors";
import { concatBytes, u16le, u32le, writeAtom as atom } from "./record/write";
import { readRecordAt } from "./record/tree";
import { RT_CryptSession10Container, RT_DocumentAtom } from "./record/types";

const PASSWORD = "hunter2";
const KEY_SIZE_BITS = 128;
// A fixed, non-random salt: reproducibility matters far more to this fixture than the confidentiality property a real salt provides.
const SALT = (() => {
  const salt = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    salt[i] = i * 13 + 1;
  }
  return salt;
})();

function encryptionAtomBody(
  overrides: {
    versionMajor?: number;
    versionMinor?: number;
    algId?: number;
    algIdHash?: number;
    keySizeBits?: number;
    salt?: Uint8Array<ArrayBuffer>;
    password?: string;
  } = {},
): Uint8Array<ArrayBuffer> {
  const versionMajor = overrides.versionMajor ?? 2;
  const versionMinor = overrides.versionMinor ?? 2;
  const algId = overrides.algId ?? 0x6801;
  const algIdHash = overrides.algIdHash ?? 0x8004;
  const keySizeBits = overrides.keySizeBits ?? KEY_SIZE_BITS;
  const salt = overrides.salt ?? SALT;
  const password = overrides.password ?? PASSWORD;

  const key = deriveRc4CryptoApiBlockKey(password, salt, 0, keySizeBits);
  const verifier = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    verifier[i] = i * 5 + 2;
  }
  const verifierHash = sha1(verifier);
  const encryptedCombined = rc4(key, concatBytes(verifier, verifierHash));

  const header = concatBytes(
    u32le(0x04),
    u32le(0),
    u32le(algId),
    u32le(algIdHash),
    u32le(keySizeBits),
    u32le(0x01),
    u32le(0),
    u32le(0),
  );
  return concatBytes(
    u16le(versionMajor),
    u16le(versionMinor),
    u32le(0x04),
    u32le(header.length),
    header,
    u32le(16),
    salt,
    encryptedCombined.subarray(0, 16),
    u32le(20),
    encryptedCombined.subarray(16, 36),
  );
}

describe("readDocumentEncryptionAtom", () => {
  it("parses a well-formed RC4 CryptoAPI DocumentEncryptionAtom", () => {
    const bytes = concatBytes(
      atom(RT_CryptSession10Container, encryptionAtomBody(), { recVer: 0xf }),
      new Uint8Array(0),
    );
    const info = readDocumentEncryptionAtom(readRecordAt(bytes, 0));
    expect(info.keySizeBits).toBe(KEY_SIZE_BITS);
    expect(Array.from(info.salt)).toEqual(Array.from(SALT));
    expect(info.encryptedVerifier).toHaveLength(16);
    expect(info.encryptedVerifierHash).toHaveLength(20);
  });

  it("interprets a keySize of 0 as the mandated 40-bit default", () => {
    const bytes = atom(
      RT_CryptSession10Container,
      encryptionAtomBody({ keySizeBits: 0 }),
      { recVer: 0xf },
    );
    // keySizeBits 0 was never really written by the header (the header states the raw 0), but the derivation used to build the fixture's own verifier still needs the true 40-bit key -- encryptionAtomBody itself passes keySizeBits straight through to deriveRc4CryptoApiBlockKey, which already treats 0 the same as 40 (see office-rc4-cryptoapi.test.ts), so the fixture and the reader agree without this test needing to special-case anything.
    const info = readDocumentEncryptionAtom(readRecordAt(bytes, 0));
    expect(info.keySizeBits).toBe(0x28);
  });

  it("rejects a record that is not the DocumentEncryptionAtom's own type", () => {
    const bytes = atom(RT_DocumentAtom, encryptionAtomBody());
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
  });

  it("rejects a version outside RC4 CryptoAPI's own major 2-4/minor 2 range", () => {
    const bytes = atom(
      RT_CryptSession10Container,
      encryptionAtomBody({ versionMajor: 1, versionMinor: 1 }),
      { recVer: 0xf },
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptEncryptedError,
    );
  });

  it("rejects a cipher algorithm other than RC4", () => {
    const bytes = atom(
      RT_CryptSession10Container,
      encryptionAtomBody({ algId: 0x660e }), // AES-128, per [MS-OFFCRYPTO] 2.3.4.5's own ECMA id table
      { recVer: 0xf },
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptEncryptedError,
    );
  });

  it("rejects a hash algorithm other than SHA-1", () => {
    const bytes = atom(
      RT_CryptSession10Container,
      encryptionAtomBody({ algIdHash: 0x8003 }), // MD5, per the same ECMA id table
      { recVer: 0xf },
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptEncryptedError,
    );
  });
});

describe("decryptPptDocumentStream", () => {
  function buildStream() {
    const key = deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 7, KEY_SIZE_BITS);
    const plainObject = atom(RT_DocumentAtom, new Uint8Array(40).fill(0x42));
    const encryptedObject = rc4(key, plainObject);
    const encryptionAtom = atom(
      RT_CryptSession10Container,
      encryptionAtomBody(),
      { recVer: 0xf },
    );
    const stream = concatBytes(encryptedObject, encryptionAtom);
    const directory = new Map<number, number>([
      [7, 0],
      [9, encryptedObject.length],
    ]);
    return { stream, directory, plainObject };
  }

  it("decrypts every persist object except the DocumentEncryptionAtom itself, given the correct password", () => {
    const { stream, directory, plainObject } = buildStream();
    const decrypted = decryptPptDocumentStream(stream, directory, 9, PASSWORD);
    expect(Array.from(decrypted.subarray(0, plainObject.length))).toEqual(
      Array.from(plainObject),
    );
  });

  it("throws PptEncryptedError given an incorrect password", () => {
    const { stream, directory } = buildStream();
    expect(() =>
      decryptPptDocumentStream(stream, directory, 9, "wrong password"),
    ).toThrow(PptEncryptedError);
  });
});
