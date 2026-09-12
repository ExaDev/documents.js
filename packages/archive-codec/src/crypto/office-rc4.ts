import { md5 } from "./md5";
import { rc4 } from "./rc4";

// The RC4 key derivation for legacy Office binary documents (.doc/.xls/.ppt) protected by the original "RC4 encryption header" ([MS-OFFCRYPTO] 2.3.6.1, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/cf9ae8d5-4e8c-40a2-95f1-3b31f16b5529 names it for .xls's own FilePass record) -- NOT the newer "RC4 CryptoAPI encryption header" (2.3.5.1), a different header shape and derivation this module does not implement. [MS-OFFCRYPTO] 2.3.6.2 (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-offcrypto/09a537cc-44ba-4ffe-af8a-e1c866ed4221) specifies the algorithm itself: H0 = MD5(password), then a 21-byte buffer (H0's own first 5 bytes + the 16-byte salt) repeated 16 times into a 336-byte buffer, H1 = MD5(that), then per block: Hfinal = MD5(H1's own first 5 bytes + the block number as 4 little-endian bytes).
//
// The real derived RC4 key is Hfinal in full -- all 16 bytes (128 bits) MD5 produces, with no truncation -- despite [MS-OFFCRYPTO] 2.3.6.1's own EncryptedVerifier/EncryptedVerifierHash field descriptions both stating "encrypted using a 40-bit RC4 cipher": that specific sentence is wrong, a genuine defect in the published spec text rather than an implementation choice this module is free to pick either way on. This was gotten wrong once already in this package's own history (truncating to 5 bytes/40 bits, matching the spec's own prose) and corrected after cross-checking two independent, real, actively-maintained implementations against a real doctested test vector neither one merely asserts but actually verifies at import time: Apache POI's `BinaryRC4Decryptor`/`CryptoFunctions.generateKey` (github.com/apache/poi, org.apache.poi.poifs.crypt.binaryrc4 and org.apache.poi.poifs.crypt -- `EncryptionMode.binaryRC4`, versionMajor=1/versionMinor=1, is the same mode both xls-codec's FilePass and doc-codec's own EncryptionHeader resolve to, so this one derivation genuinely serves both), and nolze/msoffcrypto-tool's `msoffcrypto/method/rc4.py` (github.com/nolze/msoffcrypto-tool), whose own `_makekey` carries a runnable doctest: password `"password1"`, a fixed 16-byte salt, block 0, asserting the exact 16-byte output `20bf32ddf540858c513744af0f24e03c` -- reproduced independently against this module's own algorithm before this fix landed, byte for byte. The block re-keying interval (1024 bytes) is unrelated to this and was already correct, confirmed separately against the same POI source (`Biff8DecryptingStream.RC4_REKEYING_INTERVAL`).

/** [MS-OFFCRYPTO] 2.3.6.1's own EncryptedVerifier/EncryptedVerifierHash length, and the salt length the same header carries. */
export const OFFICE_RC4_VERIFIER_LENGTH = 16;
/** [MS-XLS]'s own FilePass-protected RC4 scheme's re-keying interval -- confirmed against Apache POI's Biff8DecryptingStream.RC4_REKEYING_INTERVAL, since [MS-OFFCRYPTO] 2.3.6.2's own prose does not state it. `decryptOfficeRc4`'s own default `blockSize`. */
export const OFFICE_RC4_BLOCK_SIZE = 1024;
/** [MS-DOC] 2.2.6.2's own re-keying interval for its identical RC4 encryption header scheme -- stated directly in the spec's own prose ("encrypted in 512-byte blocks"), confirmed independently against Apache POI's BinaryRC4Decryptor (`chunkSize = 512`). Genuinely different from OFFICE_RC4_BLOCK_SIZE, not a duplicate of it -- pass this as decryptOfficeRc4's own `blockSize` argument when decrypting a .doc stream. */
export const OFFICE_RC4_DOC_BLOCK_SIZE = 512;
/** The intermediate H0/H1 truncation [MS-OFFCRYPTO] 2.3.6.2 states explicitly ("H0's own first 5 bytes", "H1's own first 5 bytes") -- distinct from the FINAL per-block key length, which is Hfinal in full (see this file's own top comment) and is never truncated. */
const INTERMEDIATE_HASH_LENGTH_BYTES = 5;

/** UTF-16LE password encoding, shared with office-rc4-cryptoapi.ts: both [MS-OFFCRYPTO] key-derivation schemes this package implements hash a password in this same encoding, per their own respective specs (2.3.6.2 and 2.3.5.2). */
export function passwordToUtf16LeBytes(
  password: string,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(password.length * 2);
  // A DataView write, not raw indexed assignment: an out-of-range DataView offset throws, where a plain `bytes[i] = …` past the array's own end silently does nothing -- so a loop bound one iteration too long fails loudly here instead of leaving the same, indistinguishable output.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < password.length; i += 1) {
    view.setUint16(i * 2, password.charCodeAt(i), true);
  }
  return bytes;
}

/** The per-workbook intermediate hash (H1's own first 5 bytes) every block's key derives from -- computed once per password+salt pair, then reused across every block via deriveOfficeRc4BlockKey, since recomputing H0/H1 per block would be needless repeated work over the identical 336-byte buffer. */
export function deriveOfficeRc4BaseHash(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const h0 = md5(passwordToUtf16LeBytes(password));
  const truncated = h0.subarray(0, INTERMEDIATE_HASH_LENGTH_BYTES);
  const unit = new Uint8Array(
    INTERMEDIATE_HASH_LENGTH_BYTES + OFFICE_RC4_VERIFIER_LENGTH,
  );
  unit.set(truncated, 0);
  unit.set(salt, INTERMEDIATE_HASH_LENGTH_BYTES);
  const buffer336 = new Uint8Array(unit.length * 16);
  for (let i = 0; i < 16; i += 1) {
    buffer336.set(unit, i * unit.length);
  }
  const h1 = md5(buffer336);
  return h1.subarray(0, INTERMEDIATE_HASH_LENGTH_BYTES);
}

/** The real, block-specific RC4 key: MD5(baseHash + the block number as 4 little-endian bytes) in full -- all 16 bytes, never truncated (see this file's own top comment for why that matters). */
export function deriveOfficeRc4BlockKey(
  baseHash: Uint8Array<ArrayBuffer>,
  blockNumber: number,
): Uint8Array<ArrayBuffer> {
  const input = new Uint8Array(baseHash.length + 4);
  input.set(baseHash, 0);
  input[baseHash.length] = blockNumber & 0xff;
  input[baseHash.length + 1] = (blockNumber >>> 8) & 0xff;
  input[baseHash.length + 2] = (blockNumber >>> 16) & 0xff;
  input[baseHash.length + 3] = (blockNumber >>> 24) & 0xff;
  return md5(input);
}

/**
 * Decrypts `data` -- a byte range of the underlying OLE stream starting at `streamOffset` bytes from the very start of that stream -- against the RC4 encryption header scheme, re-deriving the block key at every `blockSize`-byte boundary `data` crosses (`OFFICE_RC4_BLOCK_SIZE`, 1024, when omitted -- the value every caller but [MS-DOC]'s own RC4 scheme uses; [MS-DOC] 2.2.6.2 re-keys every 512 bytes instead, a real difference from [MS-XLS]'s own FilePass scheme rather than a shared constant, confirmed against Apache POI's own `BinaryRC4Decryptor` (`chunkSize = 512`) directly contrasted with `Biff8DecryptingStream.RC4_REKEYING_INTERVAL` (1024) -- two genuinely separate implementations, not one shared class with a parameter). RC4 is symmetric, so this same function also encrypts; nothing in this package uses it that way, since nothing in this family writes an encrypted legacy binary document.
 *
 * `streamOffset` matters because the block number is the byte's own absolute position in the stream divided by `blockSize`, not its position within whatever slice `data` happens to be -- decrypting a stream in arbitrary chunks (not just from offset 0) still lands on the correct per-block key this way.
 */
export function decryptOfficeRc4(
  baseHash: Uint8Array<ArrayBuffer>,
  streamOffset: number,
  data: Uint8Array<ArrayBuffer>,
  blockSize: number = OFFICE_RC4_BLOCK_SIZE,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length);
  let position = 0;
  while (position < data.length) {
    const absolute = streamOffset + position;
    const blockNumber = Math.floor(absolute / blockSize);
    const blockStartAbsolute = blockNumber * blockSize;
    const offsetWithinBlock = absolute - blockStartAbsolute;
    const bytesLeftInBlock = blockSize - offsetWithinBlock;
    const chunkLength = Math.min(bytesLeftInBlock, data.length - position);
    const key = deriveOfficeRc4BlockKey(baseHash, blockNumber);
    // RC4 is a keystream cipher: decrypting a chunk that starts partway through a block still needs the keystream from that block's own start, so the whole block-aligned prefix up to this chunk is generated and discarded -- there is no way to "seek" an RC4 keystream, only replay it from block start.
    const keystreamPrefixAndChunk = rc4(
      key,
      new Uint8Array(offsetWithinBlock + chunkLength),
    );
    const chunk = data.subarray(position, position + chunkLength);
    const chunkView = new DataView(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength,
    );
    const keystreamView = new DataView(
      keystreamPrefixAndChunk.buffer,
      keystreamPrefixAndChunk.byteOffset,
      keystreamPrefixAndChunk.byteLength,
    );
    for (let i = 0; i < chunkLength; i += 1) {
      out[position + i] =
        chunkView.getUint8(i) ^ keystreamView.getUint8(offsetWithinBlock + i);
    }
    position += chunkLength;
  }
  return out;
}
