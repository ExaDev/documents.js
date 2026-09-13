import { byteAt } from "../bytes/view";
import { describe, expect, it } from "vitest";
import { buildWpdFile } from "../test-support/build-wpd";
import {
  WpdEncryptedDocumentError,
  WpdFormatError,
  WpdWrongPasswordError,
} from "../errors";
import { readWpd, readWpdContent } from "../read";
import type { WpdFileHeader } from "./header";
import {
  applyWpdStandardEncryption,
  decryptWpdDocument,
  encryptWpdDocumentForTests,
  normaliseWpdPassword,
  passwordByteAt,
  wpdPasswordChecksum16,
} from "./encryption";

describe("normaliseWpdPassword", () => {
  it("uppercases ASCII lowercase and leaves everything else verbatim", () => {
    expect(normaliseWpdPassword("abC1!")).toEqual([
      0x41, 0x42, 0x43, 0x31, 0x21,
    ]);
  });

  it("refuses characters the byte-keyed cipher cannot encode", () => {
    // 'ß' (U+00DF) IS Latin-1 and passes; a character beyond U+00FF cannot become the single byte the cipher keys with.
    expect(normaliseWpdPassword("paßword").slice(0, 3)).toEqual([
      0x50, 0x41, 0xdf,
    ]);
    expect(() => normaliseWpdPassword("passwörd日")).toThrow(/Latin-1/);
  });

  it("accepts U+00FF, the last code unit Latin-1 can encode", () => {
    expect(normaliseWpdPassword(String.fromCharCode(0xff))).toEqual([0xff]);
  });

  it("refuses U+0100, one past the last code unit Latin-1 can encode", () => {
    expect(() => normaliseWpdPassword(String.fromCharCode(0x100))).toThrow(
      WpdFormatError,
    );
  });

  it("states the offending code unit in uppercase hex, padded to four digits, and its position", () => {
    expect(() =>
      normaliseWpdPassword(`ok${String.fromCharCode(0xabc)}`),
    ).toThrow(
      "A password with characters outside Latin-1 cannot be encoded into the byte-keyed WordPerfect cipher (code unit U+0ABC at position 2).",
    );
  });
});

describe("wpdPasswordChecksum16", () => {
  // Hand-derived, not self-computed: the fold is checkSum = rotateRight16(checkSum, 1) ^ (char << 8).
  it("answers 0 for the empty password", () => {
    expect(wpdPasswordChecksum16(normaliseWpdPassword(""))).toBe(0);
  });

  it("derives the single-character and two-character values by hand", () => {
    // "A": rotateRight16(0, 1) ^ 0x4100 = 0x4100.
    expect(wpdPasswordChecksum16(normaliseWpdPassword("A"))).toBe(0x4100);
    // "B" (already uppercase in the source): "AB" -> rotateRight16(0x4100, 1) = 0x2080, ^ 0x4200 = 0x6280.
    expect(wpdPasswordChecksum16(normaliseWpdPassword("aB"))).toBe(0x6280);
    // "Zz" normalises to "ZZ": 0x5A00, then rotateRight16 = 0x2D00, ^ 0x5A00 = 0x7700.
    expect(wpdPasswordChecksum16(normaliseWpdPassword("Zz"))).toBe(0x7700);
  });
});

describe("applyWpdStandardEncryption", () => {
  // The ascending mask starts at password length + 1 and the password bytes cycle from the start offset: for password "aB" -> [0x41, 0x42], maskBase 3, the first three transformed bytes key against (0x41, 3), (0x42, 4), (0x41, 5).
  const password = normaliseWpdPassword("aB");

  function filled(length: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = (i * 7) & 0xff;
    }
    return bytes;
  }

  it("leaves bytes before the start offset untouched", () => {
    const bytes = filled(520);
    const transformed = applyWpdStandardEncryption(bytes, password, 512);
    expect(Array.from(transformed.subarray(0, 512))).toEqual(
      Array.from(bytes.subarray(0, 512)),
    );
  });

  it("keys each byte with the cycling password and the ascending mask", () => {
    const bytes = filled(515);
    const transformed = applyWpdStandardEncryption(bytes, password, 512);
    expect(transformed[512]).toBe(byteAt(bytes, 512) ^ 0x41 ^ 0x03);
    expect(transformed[513]).toBe(byteAt(bytes, 513) ^ 0x42 ^ 0x04);
    expect(transformed[514]).toBe(byteAt(bytes, 514) ^ 0x41 ^ 0x05);
  });

  it("wraps the mask at the byte boundary", () => {
    // relative offset 253 lands on mask (3 + 253) & 0xff = 0, password byte 0x41 (253 % 2 = 1 -> 0x42). Check: 253 odd -> password byte [1] = 0x42, mask (3 + 253) & 0xff = 0x00.
    const bytes = filled(512 + 254);
    const transformed = applyWpdStandardEncryption(bytes, password, 512);
    expect(transformed[512 + 253]).toBe(byteAt(bytes, 512 + 253) ^ 0x42 ^ 0x00);
  });

  it("is its own inverse", () => {
    const bytes = filled(600);
    const once = applyWpdStandardEncryption(bytes, password, 512);
    const twice = applyWpdStandardEncryption(once, password, 512);
    expect(Array.from(twice)).toEqual(Array.from(bytes));
  });

  it("never mutates the input buffer", () => {
    const bytes = filled(520);
    const before = Array.from(bytes);
    applyWpdStandardEncryption(bytes, password, 512);
    expect(Array.from(bytes)).toEqual(before);
  });

  it("refuses an empty password, which the cipher cannot key with", () => {
    expect(() => applyWpdStandardEncryption(filled(520), [], 512)).toThrow(
      "The WordPerfect cipher is keyed by the password's own bytes, so an empty password decrypts nothing.",
    );
  });
});

describe("passwordByteAt", () => {
  // applyWpdStandardEncryption's own empty-password guard means no real caller ever reaches this with an empty array, but the function is a plain exported contract with its own behaviour to prove directly, the same way decryptWpdDocument is tested on its own terms above.
  it("throws when the password it is asked to cycle through is empty", () => {
    expect(() => passwordByteAt([], 0)).toThrow(
      "The password normalised to no bytes, which the cipher cannot key with.",
    );
  });

  it("wraps around the password's own length rather than reading past it", () => {
    expect(passwordByteAt([0x41, 0x42, 0x43], 3)).toBe(0x41);
    expect(passwordByteAt([0x41, 0x42, 0x43], 4)).toBe(0x42);
  });
});

describe("decryptWpdDocument", () => {
  // decryptWpdDocument's own doc comment says it is "called only for ... a non-empty password", but it is a plain exported function with its own contract, tested directly here rather than only through the container-level guarantee that happens to hold today.
  //
  // The header's own encryption word is deliberately 0 here (never a real encrypted document's actual value, but this function never inspects that invariant itself): an empty password's checksum is always 0 too, so any non-zero encryption word would already fail the checksum comparison the normal flow performs anyway, masking whether the dedicated empty-password guard ran at all. Only encryption === 0 lets the guard's absence actually be observed -- without it, the empty password would fall through to applyWpdStandardEncryption and throw a WpdFormatError there instead, not a WpdWrongPasswordError.
  it("treats an empty password as a wrong password rather than an empty-cipher-key error", () => {
    const bytes = buildWpdFile([0]);
    const header: WpdFileHeader = {
      documentAreaOffset: 0,
      productType: 1,
      fileType: 0x0a,
      majorVersion: 2,
      minorVersion: 1,
      indexAreaOffset: 512,
      fileSize: bytes.length,
      encryption: 0,
    };
    expect(() => decryptWpdDocument(bytes, header, "")).toThrow(
      WpdWrongPasswordError,
    );
  });
});

describe("reading an encrypted document", () => {
  const plain = buildWpdFile([
    0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xcc, 0x57, 0x6f, 0x72, 0x6c, 0x64,
  ]);
  const encrypted = encryptWpdDocumentForTests(plain, "sECret");

  it("reads the same document with the password as without encryption", () => {
    const decrypted = readWpdContent(encrypted, { password: "sECret" });
    const unencrypted = readWpdContent(plain);
    expect(decrypted.kind).toBe("wordprocessing");
    expect(unencrypted.kind).toBe("wordprocessing");
    if (
      decrypted.kind !== "wordprocessing" ||
      unencrypted.kind !== "wordprocessing"
    ) {
      return;
    }
    expect(decrypted.sections[0]?.blocks).toEqual(
      unencrypted.sections[0]?.blocks,
    );
  });

  // readWpd threads its own password option through to the same openWpdDocument call readWpdContent uses -- proven separately, since readWpd builds its own tree-form read from scratch rather than delegating to readWpdContent.
  it("reads the tree form of the same encrypted document with the password", () => {
    const tree = readWpd(encrypted, { password: "sECret" });
    expect(tree.kind).toBe("wordprocessing");
  });

  it("throws WpdEncryptedDocumentError without a password", () => {
    expect(() => readWpdContent(encrypted)).toThrow(WpdEncryptedDocumentError);
  });

  it("treats an empty-string password as no password", () => {
    expect(() => readWpdContent(encrypted, { password: "" })).toThrow(
      WpdEncryptedDocumentError,
    );
  });

  it("throws WpdWrongPasswordError for a wrong password, carrying both checksums", () => {
    try {
      readWpdContent(encrypted, { password: "wrong" });
      expect.unreachable("a wrong password must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(WpdWrongPasswordError);
      const wrong = error as WpdWrongPasswordError;
      expect(wrong.headerEncryptionWord).toBe(
        wpdPasswordChecksum16(normaliseWpdPassword("secret")),
      );
      expect(wrong.passwordChecksum).toBe(
        wpdPasswordChecksum16(normaliseWpdPassword("wrong")),
      );
    }
  });

  it("ignores a password on an unencrypted document", () => {
    const withPassword = readWpdContent(plain, { password: "anything" });
    const without = readWpdContent(plain);
    expect(withPassword.kind).toBe("wordprocessing");
    expect(without.kind).toBe("wordprocessing");
    if (
      withPassword.kind !== "wordprocessing" ||
      without.kind !== "wordprocessing"
    ) {
      return;
    }
    expect(withPassword.sections[0]?.blocks).toEqual(
      without.sections[0]?.blocks,
    );
  });
});
