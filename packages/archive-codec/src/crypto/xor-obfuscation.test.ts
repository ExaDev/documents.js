import { describe, expect, it } from "vitest";
import {
  createXorObfuscationArray,
  createXorObfuscationKey,
  createXorObfuscationPasswordVerifier,
  decryptXorObfuscationMethod1,
  decryptXorObfuscationMethod2,
  XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
  XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2,
} from "./xor-obfuscation";

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

describe("createXorObfuscationKey / createXorObfuscationPasswordVerifier", () => {
  // Every vector below was computed independently in a from-scratch Python port of [MS-OFFCRYPTO] 2.3.7.1/2.3.7.2's own pseudocode, then cross-checked against Apache POI's own createXorKey1/createXorVerifier1 (CryptoFunctions.java) -- not inverted from this module's own implementation. The "123456789012345" vector is additionally the real password to a genuine Excel-generated XOR-obfuscated .xls fixture (nolze/msoffcrypto-tool's own tests/inputs/xor_password_123456789012345.xls, sourced from the openwall/john-samples corpus): 0x8265/0x9eb1 are that file's own stored FilePass key/verificationBytes fields, matched exactly.
  it.each([
    ["Test1234", 0xf7ff, 0xec87],
    ["a", 0x9d77, 0xce88],
    ["ab", 0x69f0, 0xcf03],
    ["abc", 0x514a, 0xcc1a],
    ["password1", 0x0ec7, 0xe1ae],
    ["123456789012345", 0x8265, 0x9eb1],
  ] as const)("password %s", (password, expectedKey, expectedVerifier) => {
    expect(createXorObfuscationKey(password)).toBe(expectedKey);
    expect(createXorObfuscationPasswordVerifier(password)).toBe(
      expectedVerifier,
    );
  });

  it("rejects a password longer than 15 characters", () => {
    // The exact message, not just the error class: a downstream out-of-range table lookup a few lines later also throws a RangeError for a 16-character password, so an assertion on the error class alone would not actually prove this guard fired.
    expect(() => createXorObfuscationKey("1234567890123456")).toThrow(
      "XOR obfuscation passwords must be 1-15 characters, got 16",
    );
  });

  it("rejects an empty password", () => {
    expect(() => createXorObfuscationKey("")).toThrow(
      "XOR obfuscation passwords must be 1-15 characters, got 0",
    );
  });

  it("rejects a password with a character outside single-byte ASCII/Latin-1", () => {
    expect(() => createXorObfuscationKey("pässwörd")).not.toThrow();
    // U+00FF is the highest single-byte Latin-1 code point this module accepts -- the exact boundary the ASCII/Latin-1 check must get right.
    expect(() => createXorObfuscationKey("ÿ")).not.toThrow();
    // charCodeAt reads UTF-16 code units, so the emoji's own high surrogate (0xD83D = 55357) is what surfaces at index 4, not its full code point.
    expect(() => createXorObfuscationKey("pass\u{1F600}word")).toThrow(
      "XOR obfuscation passwords must be single-byte ASCII/Latin-1 characters, got code point 55357 at index 4",
    );
  });
});

describe("createXorObfuscationArray", () => {
  // Independently computed (Python port of the POI/LibreOffice-validated construction, not this module's own code) and, for "123456789012345" at rotate distance 2, matched against the real Excel-generated fixture's own decryption (see this suite's "Method 1 against a real Excel-generated fixture" below).
  it("Method 1 (rotate distance 2)", () => {
    const array = createXorObfuscationArray(
      "123456789012345",
      XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
    );
    expect(toHex(array)).toBe("51c259da41d249ea71ca51c259da41e4");
  });

  it("Method 2 (rotate distance 7)", () => {
    const array = createXorObfuscationArray(
      "Test1234",
      XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2,
    );
    expect(toHex(array)).toBe("d54946c167e266e1220400a6000423bb");
  });
});

describe("decryptXorObfuscationMethod1", () => {
  // A real ciphertext span lifted directly from the genuine Excel-generated fixture above: FilePass's own key/verificationBytes (0x8265/0x9eb1) match password "123456789012345" (confirmed in the suite above), and this is that same workbook's own BoundSheet8 record data (after its own never-obfuscated 4-byte lbPlyPos prefix), 7 bytes starting at absolute Workbook-stream offset 1378 -- [MS-XLS] 2.2.10's own `(streamOffset + recordDataLength) % 16` rule (recordDataLength 11, the record's own full declared size including lbPlyPos) gives XorArrayIndex 13, independently confirmed against Apache POI's own `XORDecryptor.invokeCipher` comment ("XorArrayIndex = (FileOffset + Data.Length) % 16") and LibreOffice's `XclImpBiff5Decrypter::OnUpdate` (`Skip((nNewStrmPos + nRecSize) & 0x0F)`).
  it("decrypts a real Excel-generated BoundSheet8 span", () => {
    const array = createXorObfuscationArray(
      "123456789012345",
      XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
    );
    const ciphertext = fromHex("5b28fc2ade6d5d");
    const plaintext = decryptXorObfuscationMethod1(array, ciphertext, 13);
    // grbit(2, both zero) + cch(1, 3 characters) + grbitChr(1, 0 = compressed/single-byte) + "420"
    expect(toHex(plaintext.subarray(0, 4))).toBe("00000300");
    expect(new TextDecoder().decode(plaintext.subarray(4))).toBe("420");
  });

  it("round-trips against a synthetic vector", () => {
    const array = createXorObfuscationArray(
      "Test1234",
      XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
    );
    const plaintext = new TextEncoder().encode("round-trip test data");
    // Method 1's transform is rotate-then-XOR for decrypt, so its own inverse (XOR-then-rotate-right) is exercised only here, locally, to build the round trip -- this package exports no encrypt direction (see xor-obfuscation.ts's own top comment).
    const encode = (
      data: Uint8Array<ArrayBuffer>,
      initialIndex: number,
    ): Uint8Array<ArrayBuffer> => {
      const out = new Uint8Array(data.length);
      const dataView = new DataView(
        data.buffer,
        data.byteOffset,
        data.byteLength,
      );
      const arrayView = new DataView(
        array.buffer,
        array.byteOffset,
        array.byteLength,
      );
      let index = initialIndex % 16;
      for (let i = 0; i < data.length; i += 1) {
        const withKey = dataView.getUint8(i) ^ arrayView.getUint8(index);
        out[i] = ((withKey >>> 3) | (withKey << 5)) & 0xff;
        index = (index + 1) % 16;
      }
      return out;
    };
    const ciphertext = encode(plaintext, 7);
    const decrypted = decryptXorObfuscationMethod1(array, ciphertext, 7);
    expect(decrypted).toEqual(plaintext);
  });
});

describe("decryptXorObfuscationMethod2", () => {
  // Independently computed (Python port of [MS-OFFCRYPTO] 2.3.7.6's own plain-XOR-with-zero-exception description, not this module's own code); this transform is self-inverse (see xor-obfuscation.ts's own top comment), so the same vectors serve as both an encrypt and a decrypt check.
  it.each([
    [
      "Test1234",
      5,
      "aa038d4e6b2c86584b719b982c32a9088646d3027065d5742455deb63d29b346",
    ],
    [
      "password",
      5,
      "f561548c9aee779abab36a48dff0dbe9d9240ac081a724b6d5972f66ceebc1a7",
    ],
    [
      "abc123",
      5,
      "df6d9d463c06d151018771285a10fea3f328c30a274f827d6ea334064b0be4ed",
    ],
  ] as const)("password %s", (password, startIndex, expectedHex) => {
    const array = createXorObfuscationArray(
      password,
      XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2,
    );
    const plaintext = new TextEncoder().encode(
      "Hello, XOR Method 2 test vector!",
    );
    const ciphertext = decryptXorObfuscationMethod2(
      array,
      plaintext,
      startIndex,
    );
    expect(toHex(ciphertext)).toBe(expectedHex);
    const roundTrip = decryptXorObfuscationMethod2(
      array,
      ciphertext,
      startIndex,
    );
    expect(roundTrip).toEqual(plaintext);
  });

  it("leaves a zero byte unmodified", () => {
    const array = createXorObfuscationArray(
      "Test1234",
      XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2,
    );
    const data = new Uint8Array([0x00, 0x00, 0x00]);
    const decrypted = decryptXorObfuscationMethod2(array, data, 0);
    expect(decrypted).toEqual(data);
  });

  it("leaves a non-zero byte unmodified when XORing it against the array happens to produce zero", () => {
    // [MS-OFFCRYPTO] 2.3.7.6's own zero-exception applies whenever EITHER the original byte or the transformed result is zero, not only when the input already was -- a byte that XORs to zero against its own array entry (transformed === 0) must stay as its own original, non-zero value, exactly as a genuinely zero input byte does.
    const array = createXorObfuscationArray(
      "Test1234",
      XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2,
    );
    const firstArrayByte = array[0] ?? 0;
    expect(firstArrayByte).not.toBe(0);
    const data = new Uint8Array([firstArrayByte]);
    const decrypted = decryptXorObfuscationMethod2(array, data, 0);
    expect(decrypted).toEqual(data);
  });
});
