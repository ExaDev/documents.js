import { describe, expect, it } from "vitest";
import { decryptDocStreams } from "./encryption";
import { DocUnsupportedError } from "./errors";
import { FIB_LKEY_OFFSET } from "./fib/offsets";

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// The same password/salt/EncryptedVerifier/EncryptedVerifierHash as nolze/msoffcrypto-tool's own doctested vector already verified in archive-codec's own office-rc4.test.ts (msoffcrypto/method/rc4.py's _makekey/verifypw doctests) -- block 0's own key is therefore already independently confirmed byte for byte. The WordDocument/Table ciphertext bytes here are independently recomputed via a from-scratch Python port of the (now-corrected) algorithm, not derived from this module's own code.
const PASSWORD = "password1";
const SALT = fromHex("e8772c1d91c56a37964761b280183217");
const ENCRYPTED_VERIFIER = fromHex("c9e997d454973d310bb1ba701426837e");
const ENCRYPTED_VERIFIER_HASH = fromHex("b1de178f07e989c44dae5e4cf96ac407");
const LKEY = 52;

const WORD_DOCUMENT_PREFIX_LENGTH = 68;

function buildWordDocument(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(WORD_DOCUMENT_PREFIX_LENGTH + 32);
  const view = new DataView(bytes.buffer);
  view.setUint16(10, 0x0100, true); // fEncrypted, per FIB_BASE_FLAG.
  view.setUint32(FIB_LKEY_OFFSET, LKEY, true);
  bytes.set(
    fromHex("82dff41c78265ca952541b0d07eadece39b4f93cdd4c46859b29a352fde2d1c5"),
    WORD_DOCUMENT_PREFIX_LENGTH,
  );
  return bytes;
}

function buildTable(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(LKEY + 40);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true); // vMajor
  view.setUint16(2, 1, true); // vMinor
  bytes.set(SALT, 4);
  bytes.set(ENCRYPTED_VERIFIER, 20);
  bytes.set(ENCRYPTED_VERIFIER_HASH, 36);
  bytes.set(
    fromHex(
      "dd72536dc2606b33c8c98599264883c4b5e4cb5f3f6513e2150f445e50b9b1a54ecf865fba2f29ee",
    ),
    LKEY,
  );
  return bytes;
}

describe("decryptDocStreams (RC4)", () => {
  it("throws when no password is given", () => {
    expect(() =>
      decryptDocStreams(buildWordDocument(), buildTable(), undefined, false),
    ).toThrow(DocUnsupportedError);
  });

  it("throws given the wrong password", () => {
    expect(() =>
      decryptDocStreams(
        buildWordDocument(),
        buildTable(),
        "the wrong password",
        false,
      ),
    ).toThrow(DocUnsupportedError);
  });

  it("decrypts WordDocument from byte 68 and Table from FibBase.lKey, given the correct password", () => {
    const { wordDocument, table } = decryptDocStreams(
      buildWordDocument(),
      buildTable(),
      PASSWORD,
      false,
    );
    expect(wordDocument.subarray(68)).toEqual(
      Uint8Array.from({ length: 32 }, (_, i) => i),
    );
    expect(table.subarray(LKEY)).toEqual(
      Uint8Array.from({ length: 40 }, (_, i) => (i * 3 + 7) % 256),
    );
  });

  it("leaves the WordDocument prefix and the Table EncryptionHeader untouched", () => {
    const wordDocumentBefore = buildWordDocument();
    const tableBefore = buildTable();
    const { wordDocument, table } = decryptDocStreams(
      wordDocumentBefore,
      tableBefore,
      PASSWORD,
      false,
    );
    expect(wordDocument.subarray(0, 68)).toEqual(
      wordDocumentBefore.subarray(0, 68),
    );
    expect(table.subarray(0, LKEY)).toEqual(tableBefore.subarray(0, LKEY));
  });
});

describe("decryptDocStreams (XOR obfuscation)", () => {
  // Independently computed (Python port of the POI/LibreOffice-validated Method 1 algorithm archive-codec's own crypto/xor-obfuscation.ts implements, adapted to Method 2's own rotate distance (7) and data transform (plain XOR with a zero-byte exception, no rotation), matching [MS-OFFCRYPTO] 2.3.7.6's own published spec text and LibreOffice's MSCodec_XorWord95::Decode exactly -- not derived from this module's own code) -- see also archive-codec's own xor-obfuscation.test.ts "decryptXorObfuscationMethod2" suite for the same vectors' own primitive-level derivation.
  const XOR_PASSWORD = "Test1234";
  const XOR_KEY = 0xf7ff; // createXorObfuscationKey("Test1234")
  const XOR_VERIFIER1 = 0xec87; // createXorObfuscationPasswordVerifier("Test1234")
  const XOR_LKEY = (XOR_KEY << 16) | XOR_VERIFIER1;

  function buildXorWordDocument(): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(WORD_DOCUMENT_PREFIX_LENGTH + 32);
    const view = new DataView(bytes.buffer);
    view.setUint16(10, 0x8100, true); // fEncrypted (0x0100) and fObfuscated (0x8000), per FIB_BASE_FLAG.
    view.setUint32(FIB_LKEY_OFFSET, XOR_LKEY, true);
    // Plaintext "Hello, XOR Method 2 test vector!" XOR-obfuscated at initial index 68 % 16 = 4 -- see archive-codec's own xor-obfuscation.test.ts "decryptXorObfuscationMethod2" suite, password "Test1234", for the underlying per-byte derivation this vector reuses at a different starting index.
    bytes.set(
      fromHex(
        "2f870a8d4d2820fe4f5603f6b03d2eae03c254c1566173d2207246d8a12634e0",
      ),
      WORD_DOCUMENT_PREFIX_LENGTH,
    );
    return bytes;
  }

  function buildXorTable(): Uint8Array<ArrayBuffer> {
    // The Table stream carries no unencrypted prefix under XOR obfuscation -- obfuscated in full from byte 0, initial index 0.
    return fromHex(
      "9d2c2aad08ce46b96d5620eb65704bd4b16974e113871595027265c5746b519a",
    );
  }

  it("throws when no password is given", () => {
    expect(() =>
      decryptDocStreams(
        buildXorWordDocument(),
        buildXorTable(),
        undefined,
        true,
      ),
    ).toThrow(DocUnsupportedError);
  });

  it("throws given the wrong password", () => {
    expect(() =>
      decryptDocStreams(
        buildXorWordDocument(),
        buildXorTable(),
        "the wrong password",
        true,
      ),
    ).toThrow(DocUnsupportedError);
  });

  it("decrypts WordDocument from byte 68 and Table from byte 0, given the correct password", () => {
    const { wordDocument, table } = decryptDocStreams(
      buildXorWordDocument(),
      buildXorTable(),
      XOR_PASSWORD,
      true,
    );
    const expectedText = "Hello, XOR Method 2 test vector!";
    expect(new TextDecoder().decode(wordDocument.subarray(68))).toBe(
      expectedText,
    );
    expect(new TextDecoder().decode(table)).toBe(expectedText);
  });

  it("leaves the WordDocument prefix untouched", () => {
    const wordDocumentBefore = buildXorWordDocument();
    const { wordDocument } = decryptDocStreams(
      wordDocumentBefore,
      buildXorTable(),
      XOR_PASSWORD,
      true,
    );
    expect(wordDocument.subarray(0, 68)).toEqual(
      wordDocumentBefore.subarray(0, 68),
    );
  });
});
