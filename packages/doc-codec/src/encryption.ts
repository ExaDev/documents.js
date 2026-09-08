import {
  decryptOfficeRc4,
  deriveOfficeRc4BaseHash,
  md5,
  OFFICE_RC4_DOC_BLOCK_SIZE,
  OFFICE_RC4_VERIFIER_LENGTH,
} from "archive-codec";
import { readUint16LE, readUint32LE } from "./bytes";
import { DocFormatError, DocUnsupportedError } from "./errors";
import { FIB_LKEY_OFFSET } from "./fib/offsets";

// [MS-DOC] 2.2.6 "Encryption and Obfuscation (Password to Open)" (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/37639397-6451-427b-9cf2-01d56e927f25) names three schemes, selected by FibBase's own fEncrypted/fObfuscated flags (fib/fib.ts's peekFibBaseFlags): fObfuscated=1 is XOR obfuscation (2.2.6.1, out of scope, matching ExaDev/documents.js#1108's own scoping for xls-codec's identical XOR case), fObfuscated=0 is RC4 encryption (2.2.6.2, this module) or RC4 CryptoAPI (2.2.6.3, a different EncryptionHeader shape this module does not implement, rejected below by its own EncryptionVersionInfo).
//
// [MS-DOC] 2.2.6.2's own EncryptionHeader *is* [MS-OFFCRYPTO] 2.3.6.1's RC4 encryption header, byte-identical to what xls-codec's own workbook/encryption.ts already reads for FilePass -- EncryptionVersionInfo(4) + Salt(16) + EncryptedVerifier(16) + EncryptedVerifierHash(16), confirmed via Apache POI's own EncryptionMode.binaryRC4 (versionMajor=1/versionMinor=1) resolving both FilePassRecord's and doc-codec's own EncryptionHeader reads through the identical path -- so this module needs no new crypto, only the doc-specific container layout, which differs from BIFF8's in three real ways:
//
// 1. Location: unlike FilePass (an inline record within the Workbook stream), the EncryptionHeader here sits unencrypted at the very start of the Table stream (0Table/1Table, whichever FibBase.fWhichTblStm selects), its own byte length given by FibBase.lKey (fib/offsets.ts's own FIB_LKEY_OFFSET) -- 52 bytes for this scheme, though this module trusts the file's own stated lKey as the authoritative unencrypted-prefix length rather than hardcoding 52, in case a producer pads it.
// 2. Re-keying interval: 512 bytes, not xls-codec's 1024 -- archive-codec's OFFICE_RC4_DOC_BLOCK_SIZE, a real [MS-DOC]-specific value confirmed independently against Apache POI's BinaryRC4Decryptor (chunkSize = 512), contrasted directly with Biff8DecryptingStream.RC4_REKEYING_INTERVAL (1024) for xls-codec -- two genuinely separate implementations, not one shared class with a parameter.
// 3. Per-stream block-zero origin: WordDocument and Table are each encrypted independently, each with its own block-number counter starting at zero at that stream's own byte 0 ("the block number MUST be set to zero at the beginning of the stream", stated for both) -- unlike xls-codec's single continuous Workbook-stream offset. WordDocument's own unencrypted prefix is a fixed 68 bytes, a literal both 2.2.6.1 and 2.2.6.2 state identically ("the initial 68 bytes MUST be written out with their untransformed values") rather than a computed FIB-relative size; Table's own unencrypted prefix is FibBase.lKey, since the EncryptionHeader occupying it has to be readable before any key can be derived at all. The Data stream is also encrypted in full per the spec, but this reader does not read the Data stream at all today, so decrypting it is out of scope until something needs to.

/** [MS-DOC] 2.2.6.2's own EncryptionHeader field layout, byte offsets within the Table stream's own first FibBase.lKey bytes: EncryptionVersionInfo (vMajor/vMinor, 2 bytes each) at 0, then Salt/EncryptedVerifier/EncryptedVerifierHash, each OFFICE_RC4_VERIFIER_LENGTH (16) bytes, back to back. */
const HEADER_OFFSET = {
  versionMajor: 0,
  versionMinor: 2,
  salt: 4,
  encryptedVerifier: 4 + OFFICE_RC4_VERIFIER_LENGTH,
  encryptedVerifierHash: 4 + OFFICE_RC4_VERIFIER_LENGTH * 2,
} as const;
/** The RC4 (non-CryptoAPI) EncryptionHeader's own total size -- EncryptionVersionInfo(4) + Salt(16) + EncryptedVerifier(16) + EncryptedVerifierHash(16). Used only to slice the header's own fields out of the Table stream; the actual unencrypted-prefix boundary for decrypting the rest of the Table stream is FibBase.lKey itself (see this file's own top comment), not this constant. */
const RC4_HEADER_SIZE = 4 + OFFICE_RC4_VERIFIER_LENGTH * 3;
/** [MS-DOC] 2.2.6.2/2.2.6.1's own literal, stated identically in both sections: the WordDocument stream's initial 68 bytes are never encrypted regardless of scheme. Not further decomposed by the spec into named sub-fields covering exactly this span, so it is carried here as the constant the spec itself states rather than derived from FibBase's own field sizes (which do not sum to 68). */
const WORD_DOCUMENT_UNENCRYPTED_PREFIX = 68;
/** [MS-OFFCRYPTO] 2.3.6.1's own EncryptionVersionInfo values naming the plain "RC4 encryption header" this module implements; vMajor 2-4 with vMinor 2 names RC4 CryptoAPI (2.2.6.3) instead, a different header shape this module rejects rather than misreads. */
const RC4_HEADER_VERSION_MAJOR = 1;
const RC4_HEADER_VERSION_MINOR = 1;

interface DocRc4Header {
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly encryptedVerifier: Uint8Array<ArrayBuffer>;
  readonly encryptedVerifierHash: Uint8Array<ArrayBuffer>;
}

/** A bounds-checked subarray that keeps the `Uint8Array<ArrayBuffer>` generic parameter archive-codec's own crypto functions require -- bytes.ts's own `slice` returns a bare `Uint8Array`, which is doc-codec's own convention everywhere else but too wide here, since `md5`/`rc4` construct a `DataView` directly over the buffer and need to know it genuinely is one, not just ArrayBufferLike. */
function checkedSubarray(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
  length: number,
  what: string,
): Uint8Array<ArrayBuffer> {
  if (offset + length > bytes.length) {
    throw new DocFormatError(
      `${what} read of ${length} bytes at offset ${offset} runs past the end of a ${bytes.length}-byte stream`,
    );
  }
  return bytes.subarray(offset, offset + length);
}

/** Reads the EncryptionHeader from the Table stream's own first RC4_HEADER_SIZE bytes, rejecting RC4 CryptoAPI by its own EncryptionVersionInfo rather than misreading it as the plain RC4 header. */
function readRc4Header(table: Uint8Array<ArrayBuffer>): DocRc4Header {
  const header = checkedSubarray(table, 0, RC4_HEADER_SIZE, "EncryptionHeader");
  const versionMajor = readUint16LE(header, HEADER_OFFSET.versionMajor);
  const versionMinor = readUint16LE(header, HEADER_OFFSET.versionMinor);
  if (
    versionMajor !== RC4_HEADER_VERSION_MAJOR ||
    versionMinor !== RC4_HEADER_VERSION_MINOR
  ) {
    throw new DocUnsupportedError(
      `this document uses RC4 CryptoAPI encryption (EncryptionVersionInfo ${versionMajor}.${versionMinor}, [MS-DOC] 2.2.6.3), which this reader does not decrypt`,
    );
  }
  return {
    salt: checkedSubarray(
      header,
      HEADER_OFFSET.salt,
      OFFICE_RC4_VERIFIER_LENGTH,
      "EncryptionHeader.Salt",
    ),
    encryptedVerifier: checkedSubarray(
      header,
      HEADER_OFFSET.encryptedVerifier,
      OFFICE_RC4_VERIFIER_LENGTH,
      "EncryptionHeader.EncryptedVerifier",
    ),
    encryptedVerifierHash: checkedSubarray(
      header,
      HEADER_OFFSET.encryptedVerifierHash,
      OFFICE_RC4_VERIFIER_LENGTH,
      "EncryptionHeader.EncryptedVerifierHash",
    ),
  };
}

/** [MS-OFFCRYPTO] 2.3.6.4's own password verification, identical to xls-codec's own workbook/encryption.ts: block 0's key decrypts EncryptedVerifier, then EncryptedVerifierHash continuing the same keystream, and MD5 of the decrypted verifier must equal the decrypted hash. */
function verifyPassword(
  baseHash: Uint8Array<ArrayBuffer>,
  header: DocRc4Header,
): void {
  const decryptedVerifier = decryptOfficeRc4(
    baseHash,
    0,
    header.encryptedVerifier,
    OFFICE_RC4_DOC_BLOCK_SIZE,
  );
  const decryptedVerifierHash = decryptOfficeRc4(
    baseHash,
    OFFICE_RC4_VERIFIER_LENGTH,
    header.encryptedVerifierHash,
    OFFICE_RC4_DOC_BLOCK_SIZE,
  );
  const computedHash = md5(decryptedVerifier);
  const matches =
    computedHash.length === decryptedVerifierHash.length &&
    computedHash.every((byte, index) => byte === decryptedVerifierHash[index]);
  if (!matches) {
    throw new DocUnsupportedError(
      "incorrect password for RC4-encrypted document",
    );
  }
}

/** Decrypts everything after `prefixLength` bytes of `stream`, leaving the prefix itself untouched -- WORD_DOCUMENT_UNENCRYPTED_PREFIX for WordDocument, FibBase.lKey for Table, each stream's own block-number counter starting fresh at its own byte 0 (this file's own top comment, point 3). */
function decryptStream(
  baseHash: Uint8Array<ArrayBuffer>,
  stream: Uint8Array<ArrayBuffer>,
  prefixLength: number,
): Uint8Array<ArrayBuffer> {
  const decrypted = new Uint8Array(stream.length);
  decrypted.set(stream.subarray(0, prefixLength), 0);
  decrypted.set(
    decryptOfficeRc4(
      baseHash,
      prefixLength,
      stream.subarray(prefixLength),
      OFFICE_RC4_DOC_BLOCK_SIZE,
    ),
    prefixLength,
  );
  return decrypted;
}

export interface DecryptedDocStreams {
  readonly wordDocument: Uint8Array<ArrayBuffer>;
  readonly table: Uint8Array<ArrayBuffer>;
}

/**
 * Decrypts an RC4-encrypted (fEncrypted=1, fObfuscated=0) document's WordDocument and Table streams given the password, verifying it first against the Table stream's own EncryptionHeader.
 *
 * Throws `DocUnsupportedError` for a missing password, an incorrect one, or an encryption scheme this module does not implement (RC4 CryptoAPI) -- there is no partial or best-effort result to return in any of those cases.
 */
export function decryptDocStreams(
  wordDocument: Uint8Array<ArrayBuffer>,
  table: Uint8Array<ArrayBuffer>,
  password: string | undefined,
): DecryptedDocStreams {
  if (password === undefined) {
    throw new DocUnsupportedError(
      "this document is RC4-encrypted ([MS-DOC] 2.2.6.2); call readDocContent with a password to decrypt it",
    );
  }
  const header = readRc4Header(table);
  const baseHash = deriveOfficeRc4BaseHash(password, header.salt);
  verifyPassword(baseHash, header);

  const lKey = readUint32LE(wordDocument, FIB_LKEY_OFFSET);
  return {
    wordDocument: decryptStream(
      baseHash,
      wordDocument,
      WORD_DOCUMENT_UNENCRYPTED_PREFIX,
    ),
    table: decryptStream(baseHash, table, lKey),
  };
}
