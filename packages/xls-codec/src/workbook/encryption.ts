import {
  createXorObfuscationArray,
  createXorObfuscationKey,
  createXorObfuscationPasswordVerifier,
  decryptOfficeRc4,
  decryptXorObfuscationMethod1,
  deriveOfficeRc4BaseHash,
  md5,
  OFFICE_RC4_VERIFIER_LENGTH,
  XOR_OBFUSCATION_ARRAY_LENGTH,
  XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
} from "archive-codec";
import { BlockCursor } from "../biff/cursor";
import { BiffFormatError, HEADER_SIZE, type BiffRecord } from "../biff/records";
import {
  RECORD_BOF,
  RECORD_BOUNDSHEET8,
  RECORD_FILELOCK,
  RECORD_FILEPASS,
  RECORD_INTERFACEHDR,
  RECORD_RRDHEAD,
  RECORD_RRDINFO,
  RECORD_USREXCL,
} from "../biff/record-types";

// [MS-XLS] 2.4.117's FilePass record, and the two [MS-OFFCRYPTO] schemes it can name, decrypted end to end: reading FilePass's own header fields, verifying the caller's password against the header's own verifier, then decrypting every other record's data in the workbook stream that [MS-XLS] 2.2.10 requires encrypted -- the RC4 encryption header (2.3.6.1/2.3.6.2) and XOR obfuscation Method 1 (2.3.7, see archive-codec's own crypto/xor-obfuscation.ts for the real, cross-validated algorithm and why it diverges from the published spec text). https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/cf9ae8d5-4e8c-40a2-95f1-3b31f16b5529
//
// The RC4 CryptoAPI encryption header ([MS-OFFCRYPTO] 2.3.5.1, a different header shape and derivation entirely -- ppt-codec's own scheme, tracked separately as ExaDev/documents.js#1116) is explicitly out of scope, and reported as a distinct, named failure rather than folded into "wrong password" or a generic parse error.

/** [MS-XLS] 2.4.117's own wEncryptionType. */
const ENCRYPTION_TYPE_XOR = 0x0000;
const ENCRYPTION_TYPE_RC4 = 0x0001;
/** [MS-OFFCRYPTO] 2.3.6.1's own EncryptionVersionInfo: vMajor/vMinor MUST both be 1 for the "RC4 encryption header" this module reads. vMajor 2/3/4 with vMinor 2 names the RC4 CryptoAPI encryption header instead (2.3.5.1), a different, unimplemented header shape. */
const RC4_HEADER_VERSION_MAJOR = 1;
const RC4_HEADER_VERSION_MINOR = 1;
/** The first four bytes of a BoundSheet8 record's own data ([MS-XLS] 2.4.28): lbPlyPos, the one field [MS-XLS] 2.2.10 names as never encrypted even though the rest of the record is. */
const BOUNDSHEET8_LBPLYPOS_SIZE = 4;

/** [MS-XLS] 2.2.10's own list of records that "MUST NOT be obfuscated or encrypted" wherever they occur in the workbook stream -- BOF and FilePass are checked ahead of this set by their callers, since both matter beyond encryption too. */
const NEVER_ENCRYPTED_RECORD_TYPES = new Set<number>([
  RECORD_BOF,
  RECORD_FILEPASS,
  RECORD_USREXCL,
  RECORD_FILELOCK,
  RECORD_INTERFACEHDR,
  RECORD_RRDINFO,
  RECORD_RRDHEAD,
]);

interface OfficeRc4EncryptionHeader {
  readonly kind: "rc4";
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly encryptedVerifier: Uint8Array<ArrayBuffer>;
  readonly encryptedVerifierHash: Uint8Array<ArrayBuffer>;
}

/** [MS-XLS] 2.4.117's own XORObfuscation structure (encryptionInfo when wEncryptionType is 0x0000): `key` is createXorObfuscationKey's own output, `verificationBytes` is createXorObfuscationPasswordVerifier's own output, both recomputed from the caller's password and compared directly -- there is no encrypted-verifier round trip to decrypt the way RC4's own EncryptedVerifier/EncryptedVerifierHash needs, since XOR obfuscation's own verifier fields are plain, unencrypted checksums of the password itself. */
interface XorObfuscationHeader {
  readonly kind: "xor";
  readonly key: number;
  readonly verificationBytes: number;
}

type FilePassHeader = OfficeRc4EncryptionHeader | XorObfuscationHeader;

/** Reads FilePass's own fields, dispatching on wEncryptionType, and rejecting RC4 CryptoAPI (the one scheme this module does not implement) with a specific message rather than a generic parse failure. */
function readFilePassHeader(filePassRecord: BiffRecord): FilePassHeader {
  const cursor = new BlockCursor([filePassRecord.data]);
  const encryptionType = cursor.u16();
  if (encryptionType === ENCRYPTION_TYPE_XOR) {
    return {
      kind: "xor",
      key: cursor.u16(),
      verificationBytes: cursor.u16(),
    };
  }
  if (encryptionType !== ENCRYPTION_TYPE_RC4) {
    throw new BiffFormatError(
      `workbook uses FilePass wEncryptionType 0x${encryptionType.toString(16).padStart(4, "0")}, which this reader does not decrypt`,
    );
  }
  const versionMajor = cursor.u16();
  const versionMinor = cursor.u16();
  if (
    versionMajor !== RC4_HEADER_VERSION_MAJOR ||
    versionMinor !== RC4_HEADER_VERSION_MINOR
  ) {
    throw new BiffFormatError(
      `workbook uses RC4 CryptoAPI encryption (EncryptionVersionInfo ${versionMajor}.${versionMinor}), which this reader does not decrypt`,
    );
  }
  return {
    kind: "rc4",
    salt: cursor.take(OFFICE_RC4_VERIFIER_LENGTH),
    encryptedVerifier: cursor.take(OFFICE_RC4_VERIFIER_LENGTH),
    encryptedVerifierHash: cursor.take(OFFICE_RC4_VERIFIER_LENGTH),
  };
}

/** Decrypts one record's own data against the derived RC4 base hash, honouring every [MS-XLS] 2.2.10 exclusion: a never-encrypted record's data is returned unchanged, BoundSheet8's own lbPlyPos prefix is preserved while the rest of its data is decrypted, and everything else is decrypted whole. `record.offset` is the record's own header start, so its data begins `HEADER_SIZE` bytes further into the stream -- the position [MS-OFFCRYPTO]'s block-keyed keystream is defined against. */
function decryptRecordRc4(
  record: BiffRecord,
  baseHash: Uint8Array<ArrayBuffer>,
): BiffRecord {
  if (NEVER_ENCRYPTED_RECORD_TYPES.has(record.type)) {
    return record;
  }
  const dataOffset = record.offset + HEADER_SIZE;
  if (record.type === RECORD_BOUNDSHEET8) {
    const lbPlyPos = record.data.subarray(0, BOUNDSHEET8_LBPLYPOS_SIZE);
    const decryptedRest = decryptOfficeRc4(
      baseHash,
      dataOffset + BOUNDSHEET8_LBPLYPOS_SIZE,
      record.data.subarray(BOUNDSHEET8_LBPLYPOS_SIZE),
    );
    const data = new Uint8Array(record.data.length);
    data.set(lbPlyPos, 0);
    data.set(decryptedRest, BOUNDSHEET8_LBPLYPOS_SIZE);
    return { ...record, data };
  }
  return {
    ...record,
    data: decryptOfficeRc4(baseHash, dataOffset, record.data),
  };
}

/** [MS-XLS] 2.2.10's own XorArrayIndex rule for a record's decrypted span starting `spanOffset` bytes into the Workbook stream: `(streamOffset + recordDataLength) % 16`, where `recordDataLength` is the record's own FULL declared data length -- not the length of `spanOffset`'s own remaining span, which for BoundSheet8 is 4 bytes shorter than the record's own declared size. Confirmed against Apache POI's own `XORDecryptor.invokeCipher` comment ("XorArrayIndex = (FileOffset + Data.Length) % 16") and LibreOffice's `XclImpBiff5Decrypter::OnUpdate`, and directly against a real Excel-generated XOR-obfuscated fixture -- see archive-codec's own crypto/xor-obfuscation.test.ts. */
function xorArrayIndexFor(
  spanOffset: number,
  recordDataLength: number,
): number {
  return (spanOffset + recordDataLength) % XOR_OBFUSCATION_ARRAY_LENGTH;
}

/** Decrypts one record's own data against the derived XOR obfuscation array, honouring the same [MS-XLS] 2.2.10 exclusions decryptRecordRc4 does. */
function decryptRecordXor(
  record: BiffRecord,
  array: Uint8Array<ArrayBuffer>,
): BiffRecord {
  if (NEVER_ENCRYPTED_RECORD_TYPES.has(record.type)) {
    return record;
  }
  const dataOffset = record.offset + HEADER_SIZE;
  if (record.type === RECORD_BOUNDSHEET8) {
    const lbPlyPos = record.data.subarray(0, BOUNDSHEET8_LBPLYPOS_SIZE);
    const spanOffset = dataOffset + BOUNDSHEET8_LBPLYPOS_SIZE;
    const decryptedRest = decryptXorObfuscationMethod1(
      array,
      record.data.subarray(BOUNDSHEET8_LBPLYPOS_SIZE),
      xorArrayIndexFor(spanOffset, record.data.length),
    );
    const data = new Uint8Array(record.data.length);
    data.set(lbPlyPos, 0);
    data.set(decryptedRest, BOUNDSHEET8_LBPLYPOS_SIZE);
    return { ...record, data };
  }
  return {
    ...record,
    data: decryptXorObfuscationMethod1(
      array,
      record.data,
      xorArrayIndexFor(dataOffset, record.data.length),
    ),
  };
}

/** [MS-OFFCRYPTO] 2.3.6.4's own password verification: block 0's key decrypts EncryptedVerifier, and MD5 of the result must equal the same block's decryption of EncryptedVerifierHash. Both verifier fields sit in one continuous keystream starting at position 0, not two independently-reset ones -- though decryptOfficeRc4 regenerates its keystream fresh from block start on every call regardless, so decrypting them as two separate 16-byte calls at offsets 0 and 16 is equivalent to one 32-byte call, not merely close to it. */
function decryptWorkbookRecordsRc4(
  records: readonly BiffRecord[],
  header: OfficeRc4EncryptionHeader,
  password: string,
): readonly BiffRecord[] {
  const baseHash = deriveOfficeRc4BaseHash(password, header.salt);
  const decryptedVerifier = decryptOfficeRc4(
    baseHash,
    0,
    header.encryptedVerifier,
  );
  const decryptedVerifierHash = decryptOfficeRc4(
    baseHash,
    OFFICE_RC4_VERIFIER_LENGTH,
    header.encryptedVerifierHash,
  );
  const computedHash = md5(decryptedVerifier);
  // No length check first: md5's own digest is always exactly 16 bytes, and decryptedVerifierHash is always exactly OFFICE_RC4_VERIFIER_LENGTH (16) bytes too -- decrypted from a fixed-size EncryptedVerifierHash field readFilePassHeader already took with take(OFFICE_RC4_VERIFIER_LENGTH). The two are never a different length to compare in the first place.
  const matches = computedHash.every(
    (byte, index) => byte === decryptedVerifierHash[index],
  );
  if (!matches) {
    throw new BiffFormatError("incorrect password for RC4-encrypted workbook");
  }
  return records.map((record) => decryptRecordRc4(record, baseHash));
}

/** Verifies the password against both of XORObfuscation's own fields (its `key` and `verificationBytes`, matching Apache POI's own `XORDecryptor.verifyPassword`, which checks both rather than either alone) before decrypting every record. */
function decryptWorkbookRecordsXor(
  records: readonly BiffRecord[],
  header: XorObfuscationHeader,
  password: string,
): readonly BiffRecord[] {
  // A password too long or carrying a character outside single-byte ASCII/Latin-1 cannot be the real one -- XOR obfuscation has no representation for it -- so archive-codec's own RangeError is folded into the same "incorrect password" report a caller sees for any other wrong password, rather than surfacing as a different error type.
  let computedKey: number;
  let computedVerifier: number;
  try {
    computedKey = createXorObfuscationKey(password);
    computedVerifier = createXorObfuscationPasswordVerifier(password);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new BiffFormatError(
        "incorrect password for XOR-obfuscated workbook",
      );
    }
    throw error;
  }
  if (
    computedKey !== header.key ||
    computedVerifier !== header.verificationBytes
  ) {
    throw new BiffFormatError("incorrect password for XOR-obfuscated workbook");
  }
  const array = createXorObfuscationArray(
    password,
    XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
  );
  return records.map((record) => decryptRecordXor(record, array));
}

/**
 * Decrypts every record of a workbook stream protected by [MS-XLS] 2.4.117's FilePass record, under whichever of the two schemes it names (the [MS-OFFCRYPTO] 2.3.6.1 RC4 encryption header, or 2.3.7's XOR obfuscation), given the `FilePass` record already located within `records` and the password to decrypt it with.
 *
 * Throws `BiffFormatError` for a missing password, an incorrect one, or an encryption scheme this module does not implement (RC4 CryptoAPI) -- there is no partial or best-effort result to return in any of those cases.
 */
export function decryptWorkbookRecords(
  records: readonly BiffRecord[],
  filePassRecord: BiffRecord,
  password: string | undefined,
): readonly BiffRecord[] {
  const header = readFilePassHeader(filePassRecord);
  if (password === undefined) {
    throw new BiffFormatError(
      `workbook is ${header.kind === "xor" ? "XOR-obfuscated" : "RC4-encrypted"} (FilePass record); call readXlsContent with a password to decrypt it`,
    );
  }
  return header.kind === "xor"
    ? decryptWorkbookRecordsXor(records, header, password)
    : decryptWorkbookRecordsRc4(records, header, password);
}
