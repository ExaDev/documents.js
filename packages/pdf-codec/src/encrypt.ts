import { concatBytes } from './bytes/writer';
import { AES_BLOCK_BYTES, aesCbcDecrypt, aesCbcEncrypt } from './crypto/aes';
import { md5 } from './crypto/md5';
import { rc4 } from './crypto/rc4';
import { sha256, sha384, sha512 } from './crypto/sha2';
import { PdfEncryptedError, PdfPasswordRequiredError } from './diagnostics';
import type { PdfDiagnosticSink } from './diagnostics';
import type { PdfDict, PdfObject } from './objects';
import { asDict, asName, asNumber, dictGet } from './objects';

// The PDF standard security handler (ISO 32000-1 7.6.3, extended by ISO 32000-2 7.6.4.3 for revisions 5 and 6), scoped deliberately to the *empty user password* case: a permissions-only PDF, where an owner password may well be set but opening the file needs no password at all. That is overwhelmingly the encryption a document-conversion pipeline actually meets in the wild -- a file marked "no printing"/"no copying" by whoever exported it.
//
// What this module does NOT do, and will not be quietly extended to do: crack, guess, or brute-force a password. If the empty user password fails to verify against /U, it throws PdfPasswordRequiredError and stops. Only the *user* password is tried; a file whose user password is non-empty is not openable here even if its owner password happens to be empty, because authenticating as owner is a permissions escalation, not a way to read a file you were already allowed to read.
//
// Every primitive this needs (MD5, SHA-2, RC4, AES-CBC) is hand-written under src/crypto/ rather than imported from node:crypto -- see those modules' own headers for why that is a hard requirement of this package's platform-neutral build rather than a preference.

export type CipherMethod = 'identity' | 'rc4' | 'aes';

export interface PdfDecryptor {
  // Decrypts one string object's raw bytes, given the indirect object it was found inside.
  decryptString(bytes: Uint8Array<ArrayBuffer>, num: number, gen: number): Uint8Array<ArrayBuffer>;
  // Decrypts one stream's still-filter-encoded bytes. The stream's own dictionary is needed to honour /EncryptMetadata false, under which a /Type /Metadata stream is the one stream in the file left in the clear.
  decryptStream(bytes: Uint8Array<ArrayBuffer>, dict: PdfDict, num: number, gen: number): Uint8Array<ArrayBuffer>;
}

// ISO 32000-1 7.6.3.3, Algorithm 2, step (a): the 32-byte padding string every password (including the empty one) is padded to or truncated at.
const PASSWORD_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

// Algorithm 1's own trailing salt, appended to the per-object key input for an AES (but not an RC4) crypt filter -- the four bytes of the ASCII string "sAlT".
const AES_OBJECT_KEY_SALT = new Uint8Array([0x73, 0x41, 0x6c, 0x54]);

const MD5_DIGEST_BYTES = 16;
const OBJECT_KEY_EXTRA_BYTES = 5; // Algorithm 1: three object-number bytes plus two generation bytes
const LEGACY_KEY_ITERATIONS = 50; // Algorithm 2 step (h), revision 3 and later
const ALGORITHM_5_ITERATIONS = 19; // Algorithm 5 step (d): 19 further RC4 passes after the first
const R6_MINIMUM_ROUNDS = 64; // Algorithm 2.B: at least 64 rounds before the last-byte termination test applies
const R6_ROUND_REPEATS = 64; // Algorithm 2.B step (a): K1 is 64 repetitions of the round input
const R6_TERMINATION_MARGIN = 32; // Algorithm 2.B: stop once the last byte of E is at most (round - 32)
const AESV3_KEY_BYTES = 32;
const AESV3_SALT_BYTES = 8;
const RC4_40_KEY_BYTES = 5;
const AESV2_KEY_BYTES = 16;
const DEFAULT_KEY_BITS = 40;
const BITS_PER_BYTE = 8;
const MAX_RC4_KEY_BYTES = 16;
const ZERO_IV = new Uint8Array(AES_BLOCK_BYTES);

interface HandlerSetup {
  readonly fileKey: Uint8Array<ArrayBuffer>;
  readonly streamMethod: CipherMethod;
  readonly stringMethod: CipherMethod;
  // Revisions up to 4 derive a distinct key per object (Algorithm 1); AESV3 uses the 32-byte file key directly for every object.
  readonly perObjectKeys: boolean;
  readonly encryptMetadata: boolean;
}

function requireStringBytes(dict: PdfDict, key: string): Uint8Array<ArrayBuffer> {
  const value: PdfObject | undefined = dictGet(dict, key);
  if (value?.kind !== 'string') {
    throw new PdfEncryptedError(`the /Encrypt dictionary's /${key} entry is missing or is not a direct string; this file's encryption cannot be read`);
  }
  return value.bytes;
}

function bytesEqual(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>, length: number): boolean {
  if (a.length < length || b.length < length) {
    return false;
  }
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

// /P is a signed 32-bit integer whose *unsigned* four bytes go into the key derivation low-order byte first (Algorithm 2 step (d)).
function permissionsBytes(p: number): Uint8Array<ArrayBuffer> {
  const unsigned = Math.trunc(p) >>> 0;
  return new Uint8Array([unsigned & 0xff, (unsigned >>> 8) & 0xff, (unsigned >>> 16) & 0xff, (unsigned >>> 24) & 0xff]);
}

// ISO 32000-1 7.6.3.3, Algorithm 2, for the empty user password: the padded password is the padding string itself, so there is no password argument here at all.
function computeLegacyFileKey(encryptDict: PdfDict, fileId: Uint8Array<ArrayBuffer>, revision: number, keyBytes: number, encryptMetadata: boolean): Uint8Array<ArrayBuffer> {
  const owner = requireStringBytes(encryptDict, 'O');
  const permissions = asNumber(dictGet(encryptDict, 'P')) ?? 0;
  const parts: Uint8Array<ArrayBuffer>[] = [PASSWORD_PADDING, owner.subarray(0, PASSWORD_PADDING.length), permissionsBytes(permissions), fileId];
  if (revision >= 4 && !encryptMetadata) {
    // Algorithm 2 step (f): four 0xFF bytes stand in for the metadata-is-not-encrypted flag.
    parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
  }
  let digest = md5(concatBytes(parts));
  if (revision >= 3) {
    for (let i = 0; i < LEGACY_KEY_ITERATIONS; i++) {
      digest = md5(digest.subarray(0, keyBytes));
    }
  }
  return digest.subarray(0, keyBytes);
}

// ISO 32000-1 7.6.3.4, Algorithm 4 (revision 2) and Algorithm 5 (revision 3+), run forwards and compared against the stored /U -- which is exactly Algorithm 6's "does the empty user password open this file" test.
function legacyUserPasswordVerifies(encryptDict: PdfDict, fileId: Uint8Array<ArrayBuffer>, revision: number, fileKey: Uint8Array<ArrayBuffer>): boolean {
  const storedUser = requireStringBytes(encryptDict, 'U');
  if (revision === 2) {
    return bytesEqual(rc4(fileKey, PASSWORD_PADDING), storedUser, PASSWORD_PADDING.length);
  }
  let value = rc4(fileKey, md5(concatBytes([PASSWORD_PADDING, fileId])));
  for (let i = 1; i <= ALGORITHM_5_ITERATIONS; i++) {
    const roundKey = Uint8Array.from(fileKey, (byte) => byte ^ i);
    value = rc4(roundKey, value);
  }
  // Only the first 16 bytes are meaningful: Algorithm 5 pads its 16-byte result out to 32 with arbitrary bytes, so a full-length comparison would reject valid files.
  return bytesEqual(value, storedUser, MD5_DIGEST_BYTES);
}

// ISO 32000-2 7.6.4.3.4, Algorithm 2.B: the revision-6 hardened password hash. Revision 5 (a deprecated Adobe extension that shipped before revision 6 was standardised) stops at the plain SHA-256 of the same input.
function hardenedHash(password: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, userData: Uint8Array<ArrayBuffer>, revision: number): Uint8Array<ArrayBuffer> {
  let k = sha256(concatBytes([password, salt, userData]));
  if (revision === 5) {
    return k;
  }
  let e = new Uint8Array([0]);
  let round = 0;
  while (round < R6_MINIMUM_ROUNDS || e[e.length - 1]! > round - R6_TERMINATION_MARGIN) {
    const roundInput = concatBytes([password, k, userData]);
    const k1 = new Uint8Array(roundInput.length * R6_ROUND_REPEATS);
    for (let i = 0; i < R6_ROUND_REPEATS; i++) {
      k1.set(roundInput, i * roundInput.length);
    }
    e = aesCbcEncrypt(k.subarray(0, AES_BLOCK_BYTES), k.subarray(AES_BLOCK_BYTES, AES_BLOCK_BYTES * 2), k1);
    // "The first 16 bytes of E taken as an unsigned big-endian integer, modulo 3." Because 256 is congruent to 1 modulo 3, that value's remainder equals the remainder of the plain sum of those bytes -- the same shortcut every mainstream implementation uses, and exact rather than approximate.
    let sum = 0;
    for (let i = 0; i < AES_BLOCK_BYTES; i++) {
      sum += e[i]!;
    }
    const selector = sum % 3;
    k = selector === 0 ? sha256(e) : selector === 1 ? sha384(e) : sha512(e);
    round++;
  }
  return k.subarray(0, AESV3_KEY_BYTES);
}

// ISO 32000-2 7.6.4.3.3, Algorithm 2.A, for the empty user password: verify against /U's validation salt, then unwrap the real 32-byte file key out of /UE with the key derived from /U's key salt.
function computeAesV3FileKey(encryptDict: PdfDict, revision: number): Uint8Array<ArrayBuffer> {
  const storedUser = requireStringBytes(encryptDict, 'U');
  const expectedLength = AESV3_KEY_BYTES + AESV3_SALT_BYTES * 2;
  if (storedUser.length < expectedLength) {
    throw new PdfEncryptedError(`the /Encrypt dictionary's /U entry is ${String(storedUser.length)} bytes; revision ${String(revision)} requires ${String(expectedLength)}`);
  }
  const empty = new Uint8Array(0);
  const validationSalt = storedUser.subarray(AESV3_KEY_BYTES, AESV3_KEY_BYTES + AESV3_SALT_BYTES);
  const keySalt = storedUser.subarray(AESV3_KEY_BYTES + AESV3_SALT_BYTES, expectedLength);
  if (!bytesEqual(hardenedHash(empty, validationSalt, empty, revision), storedUser, AESV3_KEY_BYTES)) {
    throw new PdfPasswordRequiredError();
  }
  const intermediateKey = hardenedHash(empty, keySalt, empty, revision);
  const wrappedKey = requireStringBytes(encryptDict, 'UE');
  if (wrappedKey.length < AESV3_KEY_BYTES) {
    throw new PdfEncryptedError(`the /Encrypt dictionary's /UE entry is ${String(wrappedKey.length)} bytes; revision ${String(revision)} requires ${String(AESV3_KEY_BYTES)}`);
  }
  // Algorithm 2.A step (e): AES-256 in CBC mode with a zero initialisation vector and no padding.
  return aesCbcDecrypt(intermediateKey, ZERO_IV, wrappedKey.subarray(0, AESV3_KEY_BYTES));
}

function methodFromCryptFilterName(encryptDict: PdfDict, entryKey: string): CipherMethod {
  const name = asName(dictGet(encryptDict, entryKey)) ?? 'Identity';
  if (name === 'Identity') {
    return 'identity';
  }
  const filters = asDict(dictGet(encryptDict, 'CF'));
  const filter = filters !== undefined ? asDict(dictGet(filters, name)) : undefined;
  if (filter === undefined) {
    throw new PdfEncryptedError(`the /Encrypt dictionary names a crypt filter /${name} for /${entryKey} that its own /CF dictionary does not define`);
  }
  const method = asName(dictGet(filter, 'CFM'));
  if (method === 'None') {
    return 'identity';
  }
  if (method === 'V2') {
    return 'rc4';
  }
  if (method === 'AESV2' || method === 'AESV3') {
    return 'aes';
  }
  throw new PdfEncryptedError(`crypt filter /${name} uses an unsupported /CFM ${method === undefined ? '(absent)' : `/${method}`}`);
}

// /CF's own /Length is famously written in bytes by some producers and bits by others. AESV2 and AESV3 have exactly one legal key size each, so they never need the guess; only a /CFM /V2 (RC4) filter does, where a value at or above 40 can only sensibly be bits.
function cryptFilterKeyBytes(encryptDict: PdfDict, declaredBits: number): number {
  const streamFilterName = asName(dictGet(encryptDict, 'StmF')) ?? 'Identity';
  const filters = asDict(dictGet(encryptDict, 'CF'));
  const filter = filters !== undefined ? asDict(dictGet(filters, streamFilterName)) : undefined;
  const method = filter !== undefined ? asName(dictGet(filter, 'CFM')) : undefined;
  if (method === 'AESV2') {
    return AESV2_KEY_BYTES;
  }
  const declared = filter !== undefined ? asNumber(dictGet(filter, 'Length')) : undefined;
  if (declared === undefined) {
    return Math.floor(declaredBits / BITS_PER_BYTE);
  }
  return declared >= DEFAULT_KEY_BITS ? Math.floor(declared / BITS_PER_BYTE) : declared;
}

function setUpHandler(encryptDict: PdfDict, fileId: Uint8Array<ArrayBuffer>): HandlerSetup {
  const version = asNumber(dictGet(encryptDict, 'V')) ?? 0;
  const revision = asNumber(dictGet(encryptDict, 'R')) ?? 0;
  const declaredBits = asNumber(dictGet(encryptDict, 'Length')) ?? DEFAULT_KEY_BITS;
  const encryptMetadataEntry = dictGet(encryptDict, 'EncryptMetadata');
  const encryptMetadata = encryptMetadataEntry?.kind === 'bool' ? encryptMetadataEntry.value : true;

  if (version === 5) {
    if (revision !== 5 && revision !== 6) {
      throw new PdfEncryptedError(`/V 5 encryption with an unsupported revision /R ${String(revision)}`);
    }
    const fileKey = computeAesV3FileKey(encryptDict, revision);
    return { fileKey, streamMethod: methodFromCryptFilterName(encryptDict, 'StmF'), stringMethod: methodFromCryptFilterName(encryptDict, 'StrF'), perObjectKeys: false, encryptMetadata };
  }

  if (version !== 1 && version !== 2 && version !== 4) {
    // /V 0 (undocumented), /V 3 (an unpublished algorithm Adobe never specified), and anything beyond 5 are all genuinely unimplementable from the published spec rather than merely unimplemented.
    throw new PdfEncryptedError(`unsupported standard security handler version /V ${String(version)}`);
  }
  if (revision < 2 || revision > 4) {
    throw new PdfEncryptedError(`unsupported standard security handler revision /R ${String(revision)}`);
  }

  // /V 1 and /V 2 have no crypt-filter machinery at all: RC4 applies uniformly to every string and every stream. Resolving the filters first, before the key length, means a file naming a /CFM this codec cannot implement says so, rather than failing earlier with a misleading complaint about that filter's key size.
  const streamMethod: CipherMethod = version === 4 ? methodFromCryptFilterName(encryptDict, 'StmF') : 'rc4';
  const stringMethod: CipherMethod = version === 4 ? methodFromCryptFilterName(encryptDict, 'StrF') : 'rc4';
  const keyBytes = version === 1 ? RC4_40_KEY_BYTES : version === 2 ? Math.floor(declaredBits / BITS_PER_BYTE) : cryptFilterKeyBytes(encryptDict, declaredBits);
  if (keyBytes < RC4_40_KEY_BYTES || keyBytes > MAX_RC4_KEY_BYTES) {
    throw new PdfEncryptedError(`the /Encrypt dictionary declares a ${String(keyBytes * BITS_PER_BYTE)}-bit file key, outside the 40-128 bit range /V ${String(version)} permits`);
  }
  const fileKey = computeLegacyFileKey(encryptDict, fileId, revision, keyBytes, encryptMetadata);
  if (!legacyUserPasswordVerifies(encryptDict, fileId, revision, fileKey)) {
    throw new PdfPasswordRequiredError();
  }
  return { fileKey, streamMethod, stringMethod, perObjectKeys: true, encryptMetadata };
}

// ISO 32000-1 7.6.2, Algorithm 1: mix the object and generation numbers into the file key so no two objects share a keystream.
function objectKey(fileKey: Uint8Array<ArrayBuffer>, num: number, gen: number, method: CipherMethod): Uint8Array<ArrayBuffer> {
  const extra = new Uint8Array(OBJECT_KEY_EXTRA_BYTES);
  extra[0] = num & 0xff;
  extra[1] = (num >>> 8) & 0xff;
  extra[2] = (num >>> 16) & 0xff;
  extra[3] = gen & 0xff;
  extra[4] = (gen >>> 8) & 0xff;
  const parts = method === 'aes' ? [fileKey, extra, AES_OBJECT_KEY_SALT] : [fileKey, extra];
  const digest = md5(concatBytes(parts));
  return digest.subarray(0, Math.min(fileKey.length + OBJECT_KEY_EXTRA_BYTES, MD5_DIGEST_BYTES));
}

// ISO 32000-1 7.6.2: AES content carries its own initialisation vector as the first block, and is padded per RFC 2898 (PKCS#5/#7) to a whole number of blocks.
function decryptAes(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>, sink: PdfDiagnosticSink): Uint8Array<ArrayBuffer> {
  if (data.length <= AES_BLOCK_BYTES) {
    if (data.length !== 0 && data.length !== AES_BLOCK_BYTES) {
      sink({ code: 'pdf/decrypt-truncated', severity: 'warning', message: `an AES-encrypted value is ${String(data.length)} bytes, too short to carry even its own initialisation vector; treating it as empty` });
    }
    return new Uint8Array(0);
  }
  const body = data.subarray(AES_BLOCK_BYTES);
  if (body.length % AES_BLOCK_BYTES !== 0) {
    sink({ code: 'pdf/decrypt-truncated', severity: 'warning', message: `an AES-encrypted value's ciphertext is ${String(body.length)} bytes, not a whole number of 16-byte blocks; the trailing partial block is being dropped` });
  }
  const plain = aesCbcDecrypt(key, data.subarray(0, AES_BLOCK_BYTES), body);
  const padLength = plain[plain.length - 1] ?? 0;
  if (padLength < 1 || padLength > AES_BLOCK_BYTES || padLength > plain.length) {
    sink({ code: 'pdf/decrypt-bad-padding', severity: 'warning', message: 'an AES-encrypted value did not end in valid PKCS#7 padding; keeping the decrypted bytes unstripped' });
    return plain;
  }
  return plain.subarray(0, plain.length - padLength);
}

function applyMethod(method: CipherMethod, fileKey: Uint8Array<ArrayBuffer>, perObjectKeys: boolean, bytes: Uint8Array<ArrayBuffer>, num: number, gen: number, sink: PdfDiagnosticSink): Uint8Array<ArrayBuffer> {
  if (method === 'identity') {
    return bytes;
  }
  const key = perObjectKeys ? objectKey(fileKey, num, gen, method) : fileKey;
  return method === 'rc4' ? rc4(key, bytes) : decryptAes(key, bytes, sink);
}

// Builds a decryptor for a document's /Encrypt dictionary, or throws: PdfEncryptedError when the file uses a handler, version, or crypt filter this codec cannot read at all, and PdfPasswordRequiredError when the encryption itself is supported but the file genuinely needs a user password. `fileId` is the first element of the trailer's /ID array, which the pre-revision-5 key derivations mix in (a file missing it entirely is malformed; an empty array is used, matching what every mainstream reader does rather than refusing the file).
export function createStandardDecryptor(encryptDict: PdfDict, fileId: Uint8Array<ArrayBuffer>, sink: PdfDiagnosticSink): PdfDecryptor {
  const filter = asName(dictGet(encryptDict, 'Filter'));
  if (filter !== 'Standard') {
    throw new PdfEncryptedError(`this PDF uses the ${filter === undefined ? 'unnamed' : `/${filter}`} security handler; only the standard security handler is supported`);
  }
  const setup = setUpHandler(encryptDict, fileId);
  return {
    decryptString(bytes, num, gen) {
      return applyMethod(setup.stringMethod, setup.fileKey, setup.perObjectKeys, bytes, num, gen, sink);
    },
    decryptStream(bytes, dict, num, gen) {
      // ISO 32000-1 7.6.3.2: with /EncryptMetadata false, the document's own /Type /Metadata stream is the one stream left in the clear while everything else stays encrypted.
      if (!setup.encryptMetadata && asName(dictGet(dict, 'Type')) === 'Metadata') {
        return bytes;
      }
      return applyMethod(setup.streamMethod, setup.fileKey, setup.perObjectKeys, bytes, num, gen, sink);
    },
  };
}
