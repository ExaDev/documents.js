import {
  createXorObfuscationArray,
  createXorObfuscationKey,
  createXorObfuscationPasswordVerifier,
  decryptOfficeRc4,
  decryptXorObfuscationMethod1,
  deriveOfficeRc4BaseHash,
  md5,
  XOR_OBFUSCATION_ARRAY_LENGTH,
  XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
} from "archive-codec";
import { describe, expect, it } from "vitest";

import type { BiffRecord } from "../biff/records";
import { BiffFormatError, HEADER_SIZE } from "../biff/records";
import {
  RECORD_BOF,
  RECORD_BOUNDSHEET8,
  RECORD_FILELOCK,
  RECORD_FILEPASS,
  RECORD_NUMBER,
  RECORD_USREXCL,
} from "../biff/record-types";
import { decryptWorkbookRecords } from "./encryption";

/** Re-derived independently of workbook/encryption.ts's own private xorArrayIndexFor, so a test asserting against it does not vacuously agree with a mutated version of the real implementation. */
function xorArrayIndexFor(
  spanOffset: number,
  recordDataLength: number,
): number {
  return (spanOffset + recordDataLength) % XOR_OBFUSCATION_ARRAY_LENGTH;
}

/** Wraps bytes and an offset as a BiffRecord -- the record's own type is the only field decryptWorkbookRecords dispatches on; data and offset carry the payload and its stream position. */
function biffRecord(
  type: number,
  data: readonly number[],
  offset: number,
): BiffRecord {
  return { type, data: new Uint8Array(data), offset };
}

const PASSWORD = "correct horse";
const SALT = new Uint8Array(16).map((_, i) => i + 1);

function rc4FilePassData(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): number[] {
  const baseHash = deriveOfficeRc4BaseHash(password, salt);
  const verifier = new Uint8Array(16).map((_, i) => i * 7 + 3);
  const verifierHash = md5(verifier);
  const encryptedVerifier = decryptOfficeRc4(baseHash, 0, verifier);
  const encryptedVerifierHash = decryptOfficeRc4(baseHash, 16, verifierHash);
  return [
    1,
    0, // wEncryptionType = 1 (RC4), little-endian u16
    1,
    0, // vMajor = 1
    1,
    0, // vMinor = 1
    ...salt,
    ...encryptedVerifier,
    ...encryptedVerifierHash,
  ];
}

function xorFilePassData(password: string): number[] {
  const key = createXorObfuscationKey(password);
  const verifier = createXorObfuscationPasswordVerifier(password);
  return [
    0,
    0, // wEncryptionType = 0 (XOR obfuscation)
    key & 0xff,
    (key >> 8) & 0xff,
    verifier & 0xff,
    (verifier >> 8) & 0xff,
  ];
}

describe("decryptWorkbookRecords", () => {
  describe("FilePass header validation", () => {
    it("refuses an encryption type this reader does not recognise", () => {
      const filePass = biffRecord(RECORD_FILEPASS, [2, 0], 0);

      expect(() =>
        decryptWorkbookRecords([filePass], filePass, PASSWORD),
      ).toThrow(BiffFormatError);
      expect(() =>
        decryptWorkbookRecords([filePass], filePass, PASSWORD),
      ).toThrow(/0x0002/);
    });

    it("refuses RC4 CryptoAPI's own EncryptionVersionInfo rather than misreading it as the RC4 scheme this reader implements", () => {
      const filePass = biffRecord(RECORD_FILEPASS, [1, 0, 2, 0, 2, 0], 0);

      expect(() =>
        decryptWorkbookRecords([filePass], filePass, PASSWORD),
      ).toThrow(/RC4 CryptoAPI/);
    });

    it("refuses RC4 EncryptionVersionInfo with a valid major but wrong minor", () => {
      const filePass = biffRecord(RECORD_FILEPASS, [1, 0, 1, 0, 2, 0], 0);

      expect(() =>
        decryptWorkbookRecords([filePass], filePass, PASSWORD),
      ).toThrow(/RC4 CryptoAPI/);
    });
  });

  describe("password verification", () => {
    it("requires a password for an RC4-encrypted workbook, naming the scheme", () => {
      const filePass = biffRecord(
        RECORD_FILEPASS,
        rc4FilePassData(PASSWORD, SALT),
        0,
      );

      expect(() =>
        decryptWorkbookRecords([filePass], filePass, undefined),
      ).toThrow(/RC4-encrypted/);
    });

    it("requires a password for an XOR-obfuscated workbook, naming the scheme", () => {
      const filePass = biffRecord(
        RECORD_FILEPASS,
        xorFilePassData(PASSWORD),
        0,
      );

      expect(() =>
        decryptWorkbookRecords([filePass], filePass, undefined),
      ).toThrow(/XOR-obfuscated/);
    });

    it("refuses the wrong password against an RC4-encrypted workbook", () => {
      const filePass = biffRecord(
        RECORD_FILEPASS,
        rc4FilePassData(PASSWORD, SALT),
        0,
      );

      expect(() =>
        decryptWorkbookRecords([filePass], filePass, "wrong password"),
      ).toThrow(/incorrect password/);
    });

    it("refuses the wrong password against an XOR-obfuscated workbook", () => {
      const filePass = biffRecord(
        RECORD_FILEPASS,
        xorFilePassData(PASSWORD),
        0,
      );

      expect(() =>
        decryptWorkbookRecords([filePass], filePass, "wrong password"),
      ).toThrow(/incorrect password/);
    });

    it("refuses an XOR password too long for obfuscation to represent, as an incorrect password rather than a raw RangeError", () => {
      const filePass = biffRecord(
        RECORD_FILEPASS,
        xorFilePassData(PASSWORD),
        0,
      );
      const tooLong = "x".repeat(64);

      expect(() =>
        decryptWorkbookRecords([filePass], filePass, tooLong),
      ).toThrow(BiffFormatError);
      expect(() =>
        decryptWorkbookRecords([filePass], filePass, tooLong),
      ).toThrow(/incorrect password/);
    });
  });

  describe("RC4 record decryption", () => {
    it("decrypts an ordinary record's data", () => {
      const baseHash = deriveOfficeRc4BaseHash(PASSWORD, SALT);
      const filePassData = rc4FilePassData(PASSWORD, SALT);
      const filePassOffset = 0;
      const filePass = biffRecord(
        RECORD_FILEPASS,
        filePassData,
        filePassOffset,
      );
      const plain = [10, 20, 30, 40, 50];
      const recordOffset = filePassOffset + HEADER_SIZE + filePassData.length;
      const dataOffset = recordOffset + HEADER_SIZE;
      const ciphertext = [
        ...decryptOfficeRc4(baseHash, dataOffset, new Uint8Array(plain)),
      ];
      const record = biffRecord(RECORD_NUMBER, ciphertext, recordOffset);

      const [, decrypted] = decryptWorkbookRecords(
        [filePass, record],
        filePass,
        PASSWORD,
      );

      expect([...(decrypted?.data ?? [])]).toStrictEqual(plain);
    });

    it("leaves a never-encrypted record type's data untouched", () => {
      const filePassData = rc4FilePassData(PASSWORD, SALT);
      const filePass = biffRecord(RECORD_FILEPASS, filePassData, 0);
      // Bytes that would decrypt to something else entirely if the guard were bypassed -- proving the bypass, rather than a coincidental match, is what leaves them alone.
      const untouchedBytes = [1, 2, 3, 4];
      const record = biffRecord(RECORD_USREXCL, untouchedBytes, 1000);

      const [, decrypted] = decryptWorkbookRecords(
        [filePass, record],
        filePass,
        PASSWORD,
      );

      expect([...(decrypted?.data ?? [])]).toStrictEqual(untouchedBytes);
    });

    it("leaves BOF's own data untouched even though it is not the FilePass record", () => {
      const filePassData = rc4FilePassData(PASSWORD, SALT);
      const filePass = biffRecord(RECORD_FILEPASS, filePassData, 0);
      const bofBytes = [9, 9, 9, 9];
      const record = biffRecord(RECORD_BOF, bofBytes, 2000);

      const [, decrypted] = decryptWorkbookRecords(
        [filePass, record],
        filePass,
        PASSWORD,
      );

      expect([...(decrypted?.data ?? [])]).toStrictEqual(bofBytes);
    });

    it("preserves a BoundSheet8 record's own unencrypted lbPlyPos prefix while decrypting the rest", () => {
      const baseHash = deriveOfficeRc4BaseHash(PASSWORD, SALT);
      const filePassData = rc4FilePassData(PASSWORD, SALT);
      const filePass = biffRecord(RECORD_FILEPASS, filePassData, 0);
      const lbPlyPos = [11, 22, 33, 44];
      const restPlain = [55, 66, 77];
      const recordOffset = 3000;
      const dataOffset = recordOffset + HEADER_SIZE;
      const restCipher = [
        ...decryptOfficeRc4(
          baseHash,
          dataOffset + lbPlyPos.length,
          new Uint8Array(restPlain),
        ),
      ];
      const record = biffRecord(
        RECORD_BOUNDSHEET8,
        [...lbPlyPos, ...restCipher],
        recordOffset,
      );

      const [, decrypted] = decryptWorkbookRecords(
        [filePass, record],
        filePass,
        PASSWORD,
      );

      expect([...(decrypted?.data ?? [])]).toStrictEqual([
        ...lbPlyPos,
        ...restPlain,
      ]);
    });
  });

  describe("XOR obfuscation record decryption", () => {
    it("decrypts an ordinary record's data", () => {
      const array = createXorObfuscationArray(
        PASSWORD,
        XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
      );
      const filePassData = xorFilePassData(PASSWORD);
      const filePass = biffRecord(RECORD_FILEPASS, filePassData, 0);
      const recordOffset = 4000;
      const dataOffset = recordOffset + HEADER_SIZE;
      const cipher = [7, 8, 9, 10];
      const expectedPlain = [
        ...decryptXorObfuscationMethod1(
          array,
          new Uint8Array(cipher),
          xorArrayIndexFor(dataOffset, cipher.length),
        ),
      ];
      const record = biffRecord(RECORD_NUMBER, cipher, recordOffset);

      const [, decrypted] = decryptWorkbookRecords(
        [filePass, record],
        filePass,
        PASSWORD,
      );

      expect([...(decrypted?.data ?? [])]).toStrictEqual(expectedPlain);
    });

    it("leaves a never-encrypted record type's data untouched", () => {
      const filePassData = xorFilePassData(PASSWORD);
      const filePass = biffRecord(RECORD_FILEPASS, filePassData, 0);
      const untouchedBytes = [4, 3, 2, 1];
      const record = biffRecord(RECORD_FILELOCK, untouchedBytes, 5000);

      const [, decrypted] = decryptWorkbookRecords(
        [filePass, record],
        filePass,
        PASSWORD,
      );

      expect([...(decrypted?.data ?? [])]).toStrictEqual(untouchedBytes);
    });

    it("preserves a BoundSheet8 record's own unencrypted lbPlyPos prefix while decrypting the rest", () => {
      const array = createXorObfuscationArray(
        PASSWORD,
        XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
      );
      const filePassData = xorFilePassData(PASSWORD);
      const filePass = biffRecord(RECORD_FILEPASS, filePassData, 0);
      const lbPlyPos = [1, 2, 3, 4];
      const restCipher = [21, 22, 23];
      const recordOffset = 6000;
      const dataOffset = recordOffset + HEADER_SIZE;
      const fullLength = lbPlyPos.length + restCipher.length;
      const expectedRestPlain = [
        ...decryptXorObfuscationMethod1(
          array,
          new Uint8Array(restCipher),
          xorArrayIndexFor(dataOffset + lbPlyPos.length, fullLength),
        ),
      ];
      const record = biffRecord(
        RECORD_BOUNDSHEET8,
        [...lbPlyPos, ...restCipher],
        recordOffset,
      );

      const [, decrypted] = decryptWorkbookRecords(
        [filePass, record],
        filePass,
        PASSWORD,
      );

      expect([...(decrypted?.data ?? [])]).toStrictEqual([
        ...lbPlyPos,
        ...expectedRestPlain,
      ]);
    });
  });
});
