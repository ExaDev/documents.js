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
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      `expected the DocumentEncryptionAtom's own record type (0x${RT_CryptSession10Container.toString(16)}) at offset 0, found 0x${RT_DocumentAtom.toString(16)}`,
    );
  });

  it("rejects a record too short for its fixed version/encryptionFlags/headerSize portion", () => {
    const bytes = atom(RT_CryptSession10Container, new Uint8Array(11));
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      "DocumentEncryptionAtom at offset 0 carries 11 bytes, fewer than the 12-byte fixed portion (version, encryptionFlags, headerSize) it requires",
    );
  });

  it("accepts exactly the 12-byte fixed portion, at the boundary the length guard names", () => {
    // versionMajor 2, versionMinor 2 (valid), headerSize 0 (invalid, but from a different, later check) -- proves the atom's own length passed the fixed-portion guard rather than failing it, by the specific error that fires instead.
    const bytes = atom(
      RT_CryptSession10Container,
      concatBytes(u16le(2), u16le(2), u32le(0x04), u32le(0)),
      { recVer: 0xf },
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      "declares a 0-byte EncryptionHeader",
    );
  });

  it.each([
    [1, 2],
    [5, 2],
    [2, 1],
    [2, 3],
  ])(
    "rejects version major %i minor %i, outside RC4 CryptoAPI's own major 2-4/minor 2 range",
    (versionMajor, versionMinor) => {
      const bytes = atom(
        RT_CryptSession10Container,
        encryptionAtomBody({ versionMajor, versionMinor }),
        { recVer: 0xf },
      );
      expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
        PptEncryptedError,
      );
      expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
        `DocumentEncryptionAtom declares version ${versionMajor}.${versionMinor}, outside [MS-OFFCRYPTO] 2.3.5.1's RC4 CryptoAPI range (major 2-4, minor 2); this package only decrypts RC4 CryptoAPI-encrypted presentations`,
      );
    },
  );

  it.each([2, 3, 4])(
    "accepts every version major %i the spec's own 2-4 range allows",
    (versionMajor) => {
      const bytes = atom(
        RT_CryptSession10Container,
        encryptionAtomBody({ versionMajor }),
        { recVer: 0xf },
      );
      expect(() =>
        readDocumentEncryptionAtom(readRecordAt(bytes, 0)),
      ).not.toThrow();
    },
  );

  it("rejects a cipher algorithm other than RC4", () => {
    const bytes = atom(
      RT_CryptSession10Container,
      encryptionAtomBody({ algId: 0x660e }), // AES-128, per [MS-OFFCRYPTO] 2.3.4.5's own ECMA id table
      { recVer: 0xf },
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptEncryptedError,
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      "DocumentEncryptionAtom's EncryptionHeader names cipher algorithm 0x660e, not RC4 (0x6801); this package only decrypts RC4 CryptoAPI-encrypted presentations",
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
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      "DocumentEncryptionAtom's EncryptionHeader names hash algorithm 0x8003, not SHA-1 (0x8004) as [MS-OFFCRYPTO] 2.3.5.1 requires of RC4 CryptoAPI",
    );
  });

  it("rejects a headerSize shorter than the fixed EncryptionHeader fields require", () => {
    const bytes = atom(
      RT_CryptSession10Container,
      concatBytes(
        u16le(2),
        u16le(2),
        u32le(0x04),
        u32le(20), // headerSize: shorter than the mandated 32
        new Uint8Array(20),
      ),
      { recVer: 0xf },
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      "declares a 20-byte EncryptionHeader, which is either shorter than the 32 fixed fields require or runs past the atom's own 32 bytes",
    );
  });

  it("rejects a headerSize that runs past the atom's own data", () => {
    const bytes = atom(
      RT_CryptSession10Container,
      concatBytes(
        u16le(2),
        u16le(2),
        u32le(0x04),
        u32le(1000), // headerSize: far past this atom's own 12 remaining bytes
        new Uint8Array(8),
      ),
      { recVer: 0xf },
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
  });

  it("rejects an EncryptionVerifier with no room for its own saltSize field", () => {
    const header = concatBytes(
      u32le(0x04),
      u32le(0),
      u32le(0x6801),
      u32le(0x8004),
      u32le(KEY_SIZE_BITS),
      u32le(0x01),
      u32le(0),
      u32le(0),
    );
    const bytes = atom(
      RT_CryptSession10Container,
      concatBytes(
        u16le(2),
        u16le(2),
        u32le(0x04),
        u32le(header.length),
        header,
      ),
      { recVer: 0xf },
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      "has no room for its EncryptionVerifier's saltSize field after the 32-byte header",
    );
  });

  it("accepts exactly enough room for the saltSize field, at the boundary the room check names", () => {
    // Truncated to precisely 12-byte fixed portion + 32-byte header + 4-byte saltSize field, with no bytes to spare: the saltSize field itself (the real, correct value 16) is still readable here, so a later, distinct check (salt/verifier/verifierHash truncation) is what must fire instead of the room-for-saltSize guard.
    const body = encryptionAtomBody();
    const truncatedBody = body.subarray(0, 12 + 32 + 4);
    const bytes = atom(RT_CryptSession10Container, truncatedBody, {
      recVer: 0xf,
    });
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      "too few for its EncryptionVerifier's salt/encryptedVerifier/encryptedVerifierHash fields",
    );
  });

  it("rejects a saltSize other than the mandated 16", () => {
    const bytes = atom(RT_CryptSession10Container, encryptionAtomBody(), {
      recVer: 0xf,
    });
    const withWrongSaltSize = new Uint8Array(bytes.length);
    withWrongSaltSize.set(bytes);
    // saltSize sits right after the 32-byte EncryptionHeader, itself right after the 12-byte fixed portion.
    new DataView(withWrongSaltSize.buffer).setUint32(8 + 12 + 32, 20, true);
    expect(() =>
      readDocumentEncryptionAtom(readRecordAt(withWrongSaltSize, 0)),
    ).toThrow(PptFormatError);
    expect(() =>
      readDocumentEncryptionAtom(readRecordAt(withWrongSaltSize, 0)),
    ).toThrow("EncryptionVerifier declares saltSize 20, not the mandated 16");
  });

  it("rejects an EncryptionVerifier truncated before its own salt/verifier/verifierHash fields", () => {
    const body = encryptionAtomBody();
    // Truncate just past the saltSize field (12-byte fixed portion + 32-byte header + 4-byte saltSize), leaving no room for salt/encryptedVerifier/encryptedVerifierHash -- and rebuild the atom so its own recLen matches the truncated body rather than disagreeing with it.
    const truncatedBody = body.subarray(0, 12 + 32 + 4);
    const bytes = atom(RT_CryptSession10Container, truncatedBody, {
      recVer: 0xf,
    });
    expect(() => readDocumentEncryptionAtom(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
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
    expect(() =>
      decryptPptDocumentStream(stream, directory, 9, "wrong password"),
    ).toThrow("incorrect password for RC4 CryptoAPI-encrypted presentation");
  });

  it("rejects an encryptSessionPersistIdRef the persist directory does not contain", () => {
    const { stream, directory } = buildStream();
    expect(() =>
      decryptPptDocumentStream(stream, directory, 42, PASSWORD),
    ).toThrow(PptFormatError);
    expect(() =>
      decryptPptDocumentStream(stream, directory, 42, PASSWORD),
    ).toThrow(
      "UserEditAtom.encryptSessionPersistIdRef 42 references persist object 42, which the persist directory does not contain",
    );
  });

  it("leaves a byte outside every persist object's own range untouched, proving the whole stream is copied before any object is decrypted in place", () => {
    const { stream, directory } = buildStream();
    // A sentinel byte beyond the encryption atom itself (past the end of every persist object this directory names) must survive into the decrypted copy unchanged.
    const withSentinel = new Uint8Array(stream.length + 1);
    withSentinel.set(stream);
    withSentinel[stream.length] = 0xab;
    const decrypted = decryptPptDocumentStream(
      withSentinel,
      directory,
      9,
      PASSWORD,
    );
    expect(decrypted[stream.length]).toBe(0xab);
  });

  it("rejects a persist object whose own record header runs past the stream", () => {
    // Placed at the very end of the stream with only 4 bytes left -- fewer than RECORD_HEADER_SIZE (8) -- so the header-room guard itself is what fires, not the later recLen/objectEnd guard a persist object merely overlapping the encryption atom would trigger instead.
    const encryptionAtom = atom(
      RT_CryptSession10Container,
      encryptionAtomBody(),
      { recVer: 0xf },
    );
    const stream = concatBytes(encryptionAtom, new Uint8Array(4));
    const directory = new Map<number, number>([
      [9, 0],
      [7, stream.length - 4],
    ]);
    expect(() =>
      decryptPptDocumentStream(stream, directory, 9, PASSWORD),
    ).toThrow(PptFormatError);
    expect(() =>
      decryptPptDocumentStream(stream, directory, 9, PASSWORD),
    ).toThrow(
      `persist object 7 at offset ${stream.length - 4} needs 8 bytes for its own record header, but only 4 remain in the stream`,
    );
  });

  it("accepts a persist object whose record header ends exactly at the stream's own end", () => {
    // Exactly RECORD_HEADER_SIZE (8) bytes remain after this offset -- offset + 8 equals the stream length precisely, the boundary the header-room guard's own comparison must not misfire on.
    const key = deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 7, KEY_SIZE_BITS);
    const encryptionAtom = atom(
      RT_CryptSession10Container,
      encryptionAtomBody(),
      { recVer: 0xf },
    );
    const header = rc4(key, concatBytes(u32le(0), u32le(0))); // recLen 0: the object ends where its header does
    const stream = concatBytes(encryptionAtom, header);
    const directory = new Map<number, number>([
      [9, 0],
      [7, encryptionAtom.length],
    ]);
    expect(() =>
      decryptPptDocumentStream(stream, directory, 9, PASSWORD),
    ).not.toThrow();
  });

  it("accepts a persist object whose own decrypted record ends exactly at the stream's own end", () => {
    // The persist object is the very last thing in the stream, so objectEnd equals streamBytes.length precisely -- the boundary the recLen/objectEnd guard's own comparison must not misfire on.
    const key = deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 7, KEY_SIZE_BITS);
    const plainObject = atom(RT_DocumentAtom, new Uint8Array(40).fill(0x42));
    const encryptedObject = rc4(key, plainObject);
    const encryptionAtom = atom(
      RT_CryptSession10Container,
      encryptionAtomBody(),
      { recVer: 0xf },
    );
    const stream = concatBytes(encryptionAtom, encryptedObject);
    const directory = new Map<number, number>([
      [9, 0],
      [7, encryptionAtom.length],
    ]);
    const decrypted = decryptPptDocumentStream(stream, directory, 9, PASSWORD);
    expect(
      Array.from(
        decrypted.subarray(
          encryptionAtom.length,
          encryptionAtom.length + plainObject.length,
        ),
      ),
    ).toEqual(Array.from(plainObject));
  });

  it("rejects a persist object whose decrypted recLen runs past the stream", () => {
    const key = deriveRc4CryptoApiBlockKey(PASSWORD, SALT, 7, KEY_SIZE_BITS);
    // A record header declaring far more data than the stream actually carries after it.
    const header = concatBytes(u32le(0), u32le(1000));
    const encryptionAtom = atom(
      RT_CryptSession10Container,
      encryptionAtomBody(),
      { recVer: 0xf },
    );
    const stream = concatBytes(rc4(key, header), encryptionAtom);
    const directory = new Map<number, number>([
      [7, 0],
      [9, header.length],
    ]);
    expect(() =>
      decryptPptDocumentStream(stream, directory, 9, PASSWORD),
    ).toThrow(PptFormatError);
    expect(() =>
      decryptPptDocumentStream(stream, directory, 9, PASSWORD),
    ).toThrow(
      `persist object 7 at offset 0 decrypts to a 1000-byte record, which runs past the stream's own ${stream.length} bytes`,
    );
  });
});
