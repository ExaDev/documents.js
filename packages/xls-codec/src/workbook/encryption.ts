import {
  decryptOfficeRc4,
  deriveOfficeRc4BaseHash,
  md5,
  OFFICE_RC4_VERIFIER_LENGTH,
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

// [MS-XLS] 2.4.117's FilePass record, and the [MS-OFFCRYPTO] 2.3.6.1/2.3.6.2 "RC4 encryption header" scheme it names, decrypted end to end: reading FilePass's own header fields, verifying the caller's password against the header's own verifier, then decrypting every other record's data in the workbook stream that [MS-XLS] 2.2.10 requires encrypted. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/cf9ae8d5-4e8c-40a2-95f1-3b31f16b5529
//
// The RC4 CryptoAPI encryption header ([MS-OFFCRYPTO] 2.3.5.1, a different header shape and derivation) and XOR obfuscation ([MS-OFFCRYPTO] 2.3.7) are explicitly out of scope -- see ExaDev/documents.js#922 -- and reported as a distinct, named failure rather than folded into "wrong password" or a generic parse error.

/** [MS-XLS] 2.4.117's own wEncryptionType: RC4 encryption, as opposed to 0x0000 (XOR obfuscation, out of scope). */
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
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly encryptedVerifier: Uint8Array<ArrayBuffer>;
  readonly encryptedVerifierHash: Uint8Array<ArrayBuffer>;
}

/** Reads FilePass's own fields, rejecting the two encryption schemes this module does not implement with a specific message rather than a generic parse failure. */
function readFilePassRc4Header(
  filePassRecord: BiffRecord,
): OfficeRc4EncryptionHeader {
  const cursor = new BlockCursor([filePassRecord.data]);
  const encryptionType = cursor.u16();
  if (encryptionType !== ENCRYPTION_TYPE_RC4) {
    throw new BiffFormatError(
      `workbook uses FilePass wEncryptionType 0x${encryptionType.toString(16).padStart(4, "0")} (XOR obfuscation), which this reader does not decrypt`,
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
    salt: cursor.take(OFFICE_RC4_VERIFIER_LENGTH),
    encryptedVerifier: cursor.take(OFFICE_RC4_VERIFIER_LENGTH),
    encryptedVerifierHash: cursor.take(OFFICE_RC4_VERIFIER_LENGTH),
  };
}

/** [MS-OFFCRYPTO] 2.3.6.4's own password verification: block 0's key decrypts EncryptedVerifier, and MD5 of the result must equal the same block's decryption of EncryptedVerifierHash. Both verifier fields sit in one continuous keystream starting at position 0, not two independently-reset ones -- though decryptOfficeRc4 regenerates its keystream fresh from block start on every call regardless, so decrypting them as two separate 16-byte calls at offsets 0 and 16 is equivalent to one 32-byte call, not merely close to it. */
function verifyOfficeRc4Password(
  baseHash: Uint8Array<ArrayBuffer>,
  header: OfficeRc4EncryptionHeader,
): void {
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
  const matches =
    computedHash.length === decryptedVerifierHash.length &&
    computedHash.every((byte, index) => byte === decryptedVerifierHash[index]);
  if (!matches) {
    throw new BiffFormatError("incorrect password for RC4-encrypted workbook");
  }
}

/** Decrypts one record's own data in place against the derived base hash, honouring every [MS-XLS] 2.2.10 exclusion: a never-encrypted record's data is returned unchanged, BoundSheet8's own lbPlyPos prefix is preserved while the rest of its data is decrypted, and everything else is decrypted whole. `record.offset` is the record's own header start, so its data begins `HEADER_SIZE` bytes further into the stream -- the position [MS-OFFCRYPTO]'s block-keyed keystream is defined against. */
function decryptRecord(
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

/**
 * Decrypts every record of a workbook stream protected by [MS-OFFCRYPTO] 2.3.6.1's RC4 encryption header, given the `FilePass` record already located within `records` and the password to decrypt it with.
 *
 * Throws `BiffFormatError` for a missing password, an incorrect one, or an encryption scheme this module does not implement (RC4 CryptoAPI, XOR obfuscation) -- there is no partial or best-effort result to return in any of those cases.
 */
export function decryptWorkbookRecords(
  records: readonly BiffRecord[],
  filePassRecord: BiffRecord,
  password: string | undefined,
): readonly BiffRecord[] {
  const header = readFilePassRc4Header(filePassRecord);
  if (password === undefined) {
    throw new BiffFormatError(
      "workbook is RC4-encrypted (FilePass record); call readXlsContent with a password to decrypt it",
    );
  }
  const baseHash = deriveOfficeRc4BaseHash(password, header.salt);
  verifyOfficeRc4Password(baseHash, header);
  return records.map((record) => decryptRecord(record, baseHash));
}
