import {
  RC4_CRYPTOAPI_SALT_LENGTH,
  RC4_CRYPTOAPI_VERIFIER_HASH_LENGTH,
  RC4_CRYPTOAPI_VERIFIER_LENGTH,
  deriveRc4CryptoApiBlockKey,
  rc4,
  verifyRc4CryptoApiPassword,
} from "archive-codec";
import { PptEncryptedError, PptFormatError } from "./errors";
import { RECORD_HEADER_SIZE } from "./record/header";
import { type PptRecord, readRecordAt } from "./record/tree";
import { RT_CryptSession10Container } from "./record/types";

// PowerPoint binary documents (.ppt) encrypt with [MS-OFFCRYPTO] 2.3.5 "RC4 CryptoAPI Encryption" -- a genuinely different scheme from the MD5-based 2.3.6 "RC4 Encryption" xls-codec's FilePass record and doc-codec's own Table-stream EncryptionHeader share (see archive-codec's own crypto/office-rc4-cryptoapi.ts for the key derivation itself). Two structural differences from both of those, beyond the key derivation: there is no fixed-offset header -- the DocumentEncryptionAtom (record type 0x2F14, [MS-PPT] names it RT_CryptSession10Container) is just another persist object, reached only by walking UserEditAtom.encryptSessionPersistIdRef through the same persist directory every other record uses -- and re-keying happens per PERSIST OBJECT (each top-level record's own persist ID is the RC4 CryptoAPI "block number"), not at fixed byte intervals within one continuous stream. A persist object's own 8-byte record header is itself encrypted too, unlike the shared xls/doc scheme's never-encrypted headers, so this module decrypts a peek of those 8 bytes first to learn the object's real length before decrypting the object in full.
//
// Cross-checked against Apache POI's HSLFSlideShowEncrypted (`decryptRecord`, keyed by `persistId`) and DocumentEncryptionAtom (the on-wire layout: versionMajor/versionMinor/encryptionFlags/headerSize, then the shared [MS-OFFCRYPTO] 2.3.4.5/2.3.4.6 EncryptionHeader/EncryptionVerifier structures CryptoAPIEncryptionHeader/CryptoAPIEncryptionVerifier merely subclass).

// [MS-OFFCRYPTO] 2.3.4.5's own CipherAlgorithm ECMA id for RC4 -- confirmed against Apache POI's `CipherAlgorithm.rc4.ecmaId`. This module refuses any other algId rather than guessing: an AES-flagged DocumentEncryptionAtom is not a shape [MS-PPT] itself specifies, and this module has no code path that could decrypt one correctly.
const ALG_ID_RC4 = 0x6801;
// [MS-OFFCRYPTO] 2.3.4.5's own HashAlgorithm ECMA id for SHA-1 -- confirmed against Apache POI's `HashAlgorithm.sha1.ecmaId`. [MS-OFFCRYPTO] 2.3.5.1 fixes RC4 CryptoAPI's hash to SHA-1 unconditionally, so this is a sanity check on the file rather than a real choice this module makes.
const ALG_ID_HASH_SHA1 = 0x8004;
// [MS-OFFCRYPTO] 2.3.5.1: RC4 CryptoAPI's own EncryptionInfo versionMajor/versionMinor range -- "MUST be 0x0002" for versionMinor, and versionMajor "MUST be 0x02, 0x03, or 0x04" (confirmed against Apache POI's EncryptionInfo, which reads exactly this 2<=major<=4 && minor===2 range to select CryptoAPI/Standard over the fixed-value xor/binaryRC4/agile modes).
const CRYPTOAPI_VERSION_MINOR = 2;
const CRYPTOAPI_VERSION_MAJOR_MIN = 2;
const CRYPTOAPI_VERSION_MAJOR_MAX = 4;
// Byte offsets within a DocumentEncryptionAtom's own data, before the [MS-OFFCRYPTO] 2.3.4.5 EncryptionHeader begins at HEADER_START.
const VERSION_MAJOR_OFFSET = 0;
const VERSION_MINOR_OFFSET = 2;
const HEADER_SIZE_FIELD_OFFSET = 8;
const HEADER_START = 12;
// Byte offsets within the [MS-OFFCRYPTO] 2.3.4.5 EncryptionHeader itself, relative to HEADER_START.
const HEADER_ALG_ID_OFFSET = 8;
const HEADER_ALG_ID_HASH_OFFSET = 12;
const HEADER_KEY_SIZE_OFFSET = 16;
// [MS-OFFCRYPTO] 2.3.4.5: "If set to 0x00000000, it MUST be interpreted as 0x00000028 bits" -- also documented alongside the identical special case in archive-codec's own deriveRc4CryptoApiBlockKey, which this module relies on to apply it during key derivation; this module still needs its own copy to report the effective size faithfully rather than the raw 0.
const DEFAULT_KEY_SIZE_BITS = 0x28;
// The minimum EncryptionHeader length this module needs to read: flags, sizeExtra, algId, algIdHash, keySize, providerType, reserved1, reserved2 -- eight 4-byte fields. A real header also carries a variable-length CSPName after these, which this module never reads: `headerSize` (see HEADER_SIZE_FIELD_OFFSET) already states exactly where the header ends and the EncryptionVerifier begins, so there is no need to parse or skip the CSPName string byte by byte.
const MIN_HEADER_FIELDS_LENGTH = 32;

export interface PptEncryptionInfo {
  readonly keySizeBits: number;
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly encryptedVerifier: Uint8Array<ArrayBuffer>;
  readonly encryptedVerifierHash: Uint8Array<ArrayBuffer>;
}

/** Parses a DocumentEncryptionAtom's own fields -- never encrypted, since it is what a decryptor needs before it can decrypt anything else. */
export function readDocumentEncryptionAtom(
  record: PptRecord,
): PptEncryptionInfo {
  if (record.header.recType !== RT_CryptSession10Container) {
    throw new PptFormatError(
      `expected the DocumentEncryptionAtom's own record type (0x${RT_CryptSession10Container.toString(16)}) at offset ${record.offset}, found 0x${record.header.recType.toString(16)}`,
    );
  }
  const { data } = record;
  if (data.length < HEADER_START) {
    throw new PptFormatError(
      `DocumentEncryptionAtom at offset ${record.offset} carries ${data.length} bytes, fewer than the ${HEADER_START}-byte fixed portion (version, encryptionFlags, headerSize) it requires`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const versionMajor = view.getUint16(VERSION_MAJOR_OFFSET, true);
  const versionMinor = view.getUint16(VERSION_MINOR_OFFSET, true);
  if (
    versionMajor < CRYPTOAPI_VERSION_MAJOR_MIN ||
    versionMajor > CRYPTOAPI_VERSION_MAJOR_MAX ||
    versionMinor !== CRYPTOAPI_VERSION_MINOR
  ) {
    throw new PptEncryptedError(
      `DocumentEncryptionAtom declares version ${versionMajor}.${versionMinor}, outside [MS-OFFCRYPTO] 2.3.5.1's RC4 CryptoAPI range (major 2-4, minor 2); this package only decrypts RC4 CryptoAPI-encrypted presentations`,
    );
  }

  const headerSize = view.getUint32(HEADER_SIZE_FIELD_OFFSET, true);
  const headerEnd = HEADER_START + headerSize;
  if (headerSize < MIN_HEADER_FIELDS_LENGTH || headerEnd > data.length) {
    throw new PptFormatError(
      `DocumentEncryptionAtom at offset ${record.offset} declares a ${headerSize}-byte EncryptionHeader, which is either shorter than the ${MIN_HEADER_FIELDS_LENGTH} fixed fields require or runs past the atom's own ${data.length} bytes`,
    );
  }

  const algId = view.getUint32(HEADER_START + HEADER_ALG_ID_OFFSET, true);
  if (algId !== ALG_ID_RC4) {
    throw new PptEncryptedError(
      `DocumentEncryptionAtom's EncryptionHeader names cipher algorithm 0x${algId.toString(16)}, not RC4 (0x${ALG_ID_RC4.toString(16)}); this package only decrypts RC4 CryptoAPI-encrypted presentations`,
    );
  }
  const algIdHash = view.getUint32(
    HEADER_START + HEADER_ALG_ID_HASH_OFFSET,
    true,
  );
  if (algIdHash !== ALG_ID_HASH_SHA1) {
    throw new PptEncryptedError(
      `DocumentEncryptionAtom's EncryptionHeader names hash algorithm 0x${algIdHash.toString(16)}, not SHA-1 (0x${ALG_ID_HASH_SHA1.toString(16)}) as [MS-OFFCRYPTO] 2.3.5.1 requires of RC4 CryptoAPI`,
    );
  }
  const rawKeySize = view.getUint32(
    HEADER_START + HEADER_KEY_SIZE_OFFSET,
    true,
  );
  const keySizeBits = rawKeySize === 0 ? DEFAULT_KEY_SIZE_BITS : rawKeySize;

  if (headerEnd + 4 > data.length) {
    throw new PptFormatError(
      `DocumentEncryptionAtom at offset ${record.offset} has no room for its EncryptionVerifier's saltSize field after the ${headerSize}-byte header`,
    );
  }
  const saltSize = view.getUint32(headerEnd, true);
  if (saltSize !== RC4_CRYPTOAPI_SALT_LENGTH) {
    throw new PptFormatError(
      `DocumentEncryptionAtom's EncryptionVerifier declares saltSize ${saltSize}, not the mandated ${RC4_CRYPTOAPI_SALT_LENGTH}`,
    );
  }
  const saltStart = headerEnd + 4;
  const encryptedVerifierStart = saltStart + RC4_CRYPTOAPI_SALT_LENGTH;
  const verifierHashSizeFieldStart =
    encryptedVerifierStart + RC4_CRYPTOAPI_VERIFIER_LENGTH;
  const encryptedVerifierHashStart = verifierHashSizeFieldStart + 4;
  const encryptedVerifierHashEnd =
    encryptedVerifierHashStart + RC4_CRYPTOAPI_VERIFIER_HASH_LENGTH;
  if (encryptedVerifierHashEnd > data.length) {
    throw new PptFormatError(
      `DocumentEncryptionAtom at offset ${record.offset} carries ${data.length} bytes, too few for its EncryptionVerifier's salt/encryptedVerifier/encryptedVerifierHash fields`,
    );
  }

  return {
    keySizeBits,
    salt: data.subarray(saltStart, encryptedVerifierStart),
    encryptedVerifier: data.subarray(
      encryptedVerifierStart,
      verifierHashSizeFieldStart,
    ),
    encryptedVerifierHash: data.subarray(
      encryptedVerifierHashStart,
      encryptedVerifierHashEnd,
    ),
  };
}

/**
 * Decrypts a PowerPoint Document stream protected by [MS-OFFCRYPTO] 2.3.5 RC4 CryptoAPI, given the password and the persist directory/`encryptSessionPersistIdRef` `buildPersistDirectory` already resolved -- both come from parsing the stream's own never-encrypted UserEditAtom/PersistDirectoryAtom chain, which is why this module needs them handed in rather than deriving them itself.
 *
 * Returns a new, fully decrypted copy of the stream: every persist object in `directory` except the DocumentEncryptionAtom itself gets its own key, derived from its own persist ID as the RC4 CryptoAPI "block number" (see this file's own top comment), and is decrypted as one continuous keystream covering its header and data together -- the header is encrypted too here, unlike the shared xls/doc RC4 scheme, so each object's own recLen has to be learned by decrypting its header first.
 *
 * Throws `PptEncryptedError` for a missing password, an incorrect one, or an encryption shape this module does not implement (anything other than RC4 CryptoAPI) -- there is no partial or best-effort result to return in any of those cases.
 */
export function decryptPptDocumentStream(
  streamBytes: Uint8Array<ArrayBuffer>,
  directory: ReadonlyMap<number, number>,
  encryptSessionPersistIdRef: number,
  password: string,
): Uint8Array<ArrayBuffer> {
  const encryptionAtomOffset = directory.get(encryptSessionPersistIdRef);
  if (encryptionAtomOffset === undefined) {
    throw new PptFormatError(
      `UserEditAtom.encryptSessionPersistIdRef ${encryptSessionPersistIdRef} references persist object ${encryptSessionPersistIdRef}, which the persist directory does not contain`,
    );
  }
  const info = readDocumentEncryptionAtom(
    readRecordAt(streamBytes, encryptionAtomOffset),
  );
  if (
    !verifyRc4CryptoApiPassword(
      password,
      info.salt,
      info.keySizeBits,
      info.encryptedVerifier,
      info.encryptedVerifierHash,
    )
  ) {
    throw new PptEncryptedError(
      "incorrect password for RC4 CryptoAPI-encrypted presentation",
    );
  }

  const decrypted = new Uint8Array(streamBytes.length);
  decrypted.set(streamBytes);

  for (const [persistId, offset] of directory) {
    if (persistId === encryptSessionPersistIdRef) {
      continue;
    }
    if (offset + RECORD_HEADER_SIZE > streamBytes.length) {
      throw new PptFormatError(
        `persist object ${persistId} at offset ${offset} needs ${RECORD_HEADER_SIZE} bytes for its own record header, but only ${streamBytes.length - offset} remain in the stream`,
      );
    }
    const key = deriveRc4CryptoApiBlockKey(
      password,
      info.salt,
      persistId,
      info.keySizeBits,
    );
    // The 8-byte header is encrypted like everything else here, so recLen has to be learned by decrypting it first; the whole object (header and data together) is then decrypted afresh from the same key rather than resuming a keystream, since this package's own `rc4` always starts its keystream at position 0.
    const headerPlaintext = rc4(
      key,
      streamBytes.subarray(offset, offset + RECORD_HEADER_SIZE),
    );
    const headerView = new DataView(
      headerPlaintext.buffer,
      headerPlaintext.byteOffset,
      headerPlaintext.byteLength,
    );
    const recLen = headerView.getUint32(4, true);
    const objectEnd = offset + RECORD_HEADER_SIZE + recLen;
    if (objectEnd > streamBytes.length) {
      throw new PptFormatError(
        `persist object ${persistId} at offset ${offset} decrypts to a ${recLen}-byte record, which runs past the stream's own ${streamBytes.length} bytes`,
      );
    }
    const plaintext = rc4(key, streamBytes.subarray(offset, objectEnd));
    decrypted.set(plaintext, offset);
  }

  return decrypted;
}
