import { passwordToUtf16LeBytes } from "./office-rc4";
import { rc4 } from "./rc4";
import { sha1 } from "./sha1";

// The RC4 key derivation PowerPoint binary documents (.ppt) use for their own password-to-open encryption ([MS-OFFCRYPTO] 2.3.5.2 "RC4 CryptoAPI Encryption Key Generation") -- a different scheme from office-rc4.ts's own 2.3.6.2 derivation despite both ending in an RC4 keystream: SHA-1 rather than MD5, no intermediate 336-byte buffer, and (per 2.3.5.2's own prose) explicitly NOT iterated -- one SHA-1 of the salt+password, one more SHA-1 folding in the block number, done. .doc/.xls never use this scheme; .ppt never uses the other one. Cross-checked against Apache POI's `EncryptionInfo`/`StandardEncryptionHeader`/`CryptoAPIEncryptionHeader` (which parses the on-disk header this module's caller, ppt-codec, reads out of a DocumentEncryptionAtom) and nolze/msoffcrypto-tool's `method/rc4_cryptoapi.py`, whose `_makekey`/`verifypw` this module's own derivation and verification mirror.
//
// Unlike office-rc4.ts's per-1024-or-512-byte re-keying within one continuous stream, RC4 CryptoAPI re-keys per *persist object*: [MS-PPT] hands each top-level record its own persist identifier, and that identifier -- not a running byte offset -- is the "block number" this module's key derivation takes. A whole persist object (header and data together, whatever its length) is decrypted under the one key its own persist ID derives; there is no block-boundary splitting to do here, so this module has no decrypt-with-rekeying entry point the way office-rc4.ts's `decryptOfficeRc4` does -- a caller derives the one key it needs and applies this package's own `rc4` directly.

/** [MS-OFFCRYPTO] 2.3.5.1: "If set to 0x00000000, [keySize] MUST be interpreted as 0x00000028 bits" -- confirmed against Apache POI's `StandardEncryptionHeader` constructor, which special-cases exactly this value before calling `setKeySize`. */
export const RC4_CRYPTOAPI_DEFAULT_KEY_SIZE_BITS = 0x28;
/** The salt length [MS-OFFCRYPTO] 2.3.4.6's EncryptionVerifier (shared by the CryptoAPI and Standard/AES schemes alike) fixes for every cipher: "the SaltSize field... MUST be 0x00000010" -- confirmed against Apache POI's `StandardEncryptionVerifier`, which throws if the on-disk saltSize field disagrees. */
export const RC4_CRYPTOAPI_SALT_LENGTH = 16;
/** The EncryptedVerifier field's own fixed length, [MS-OFFCRYPTO] 2.3.4.6/2.3.4.9: "an array of 16 bytes." */
export const RC4_CRYPTOAPI_VERIFIER_LENGTH = 16;
/** EncryptedVerifierHash's length for RC4 specifically (as opposed to AES's 32): [MS-OFFCRYPTO] 2.3.4.9 -- "If the encryption algorithm is RC4, the length MUST be 20 bytes" -- confirmed against Apache POI's `CipherAlgorithm.rc4.encryptedVerifierHashLength`. This module implements RC4 only, so this constant is unconditional here (a caller finding algId names AES instead has found a file outside this module's scope, per the top comment). */
export const RC4_CRYPTOAPI_VERIFIER_HASH_LENGTH = 20;

function keySizeBitsOf(keySizeBits: number): number {
  return keySizeBits === 0 ? RC4_CRYPTOAPI_DEFAULT_KEY_SIZE_BITS : keySizeBits;
}

// Constant-shape comparison, deliberately with no length check: this module's own sole call site (verifyRc4CryptoApiPassword below) always compares a SHA-1 digest (always 20 bytes) against a slice already fixed to that same RC4_CRYPTOAPI_VERIFIER_HASH_LENGTH -- a mismatched-length pair can never actually reach this private helper, so guarding against one would be dead code for a case this module cannot produce.
function bytesEqual(
  a: Uint8Array<ArrayBuffer>,
  b: Uint8Array<ArrayBuffer>,
): boolean {
  return a.every((byte, index) => byte === b[index]);
}

/** The per-persist-object RC4 key: SHA1(SHA1(salt + UTF-16LE password) + the block number as 4 little-endian bytes), truncated to `keySizeBits`. [MS-OFFCRYPTO] 2.3.5.1's own 40-bit special case is real, not a rounding artefact: a 40-bit key is still carried in a 16-byte buffer (the derived hash's own first 5 bytes, zero-padded to 16), confirmed directly against nolze/msoffcrypto-tool's `_makekey` (`key = hfinal[:5] + b"\x00" * 11`) -- the "effective" key strength is 40 bits, but the RC4 key schedule this package's own `rc4` runs still consumes all 16 bytes of it. */
export function deriveRc4CryptoApiBlockKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  block: number,
  keySizeBits: number,
): Uint8Array<ArrayBuffer> {
  const passwordBytes = passwordToUtf16LeBytes(password);
  const saltAndPassword = new Uint8Array(salt.length + passwordBytes.length);
  saltAndPassword.set(salt, 0);
  saltAndPassword.set(passwordBytes, salt.length);
  const h0 = sha1(saltAndPassword);

  const blockBytes = new Uint8Array(4);
  blockBytes[0] = block & 0xff;
  blockBytes[1] = (block >>> 8) & 0xff;
  blockBytes[2] = (block >>> 16) & 0xff;
  blockBytes[3] = (block >>> 24) & 0xff;
  const h0AndBlock = new Uint8Array(h0.length + blockBytes.length);
  h0AndBlock.set(h0, 0);
  h0AndBlock.set(blockBytes, h0.length);
  const hfinal = sha1(h0AndBlock);

  const effectiveKeySizeBits = keySizeBitsOf(keySizeBits);
  if (effectiveKeySizeBits === 40) {
    const key = new Uint8Array(16);
    key.set(hfinal.subarray(0, 5), 0);
    return key;
  }
  return hfinal.subarray(0, effectiveKeySizeBits / 8);
}

/** Verifies a candidate password against a DocumentEncryptionAtom's own EncryptionVerifier fields ([MS-OFFCRYPTO] 2.3.4.9): the block-0 key decrypts `encryptedVerifier` immediately followed by `encryptedVerifierHash` as ONE continuous 36-byte RC4 keystream application -- not two independent decryptions, each of which would wrongly restart the keystream at its own start -- and the password is correct exactly when SHA1 of the decrypted 16-byte verifier equals the decrypted hash's own first 20 bytes. */
export function verifyRc4CryptoApiPassword(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  keySizeBits: number,
  encryptedVerifier: Uint8Array<ArrayBuffer>,
  encryptedVerifierHash: Uint8Array<ArrayBuffer>,
): boolean {
  const key = deriveRc4CryptoApiBlockKey(password, salt, 0, keySizeBits);
  const combined = new Uint8Array(
    encryptedVerifier.length + encryptedVerifierHash.length,
  );
  combined.set(encryptedVerifier, 0);
  combined.set(encryptedVerifierHash, encryptedVerifier.length);
  const decrypted = rc4(key, combined);
  const verifier = decrypted.subarray(0, encryptedVerifier.length);
  const hash = decrypted.subarray(
    encryptedVerifier.length,
    encryptedVerifier.length + RC4_CRYPTOAPI_VERIFIER_HASH_LENGTH,
  );
  return bytesEqual(sha1(verifier), hash);
}
