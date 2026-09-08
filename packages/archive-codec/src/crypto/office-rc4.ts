import { md5 } from "./md5";
import { rc4 } from "./rc4";

// The RC4 key derivation for legacy Office binary documents (.doc/.xls/.ppt) protected by the original "RC4 encryption header" ([MS-OFFCRYPTO] 2.3.6.1, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/cf9ae8d5-4e8c-40a2-95f1-3b31f16b5529 names it for .xls's own FilePass record) -- NOT the newer "RC4 CryptoAPI encryption header" (2.3.5.1), a different header shape and derivation this module does not implement. [MS-OFFCRYPTO] 2.3.6.2 (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-offcrypto/09a537cc-44ba-4ffe-af8a-e1c866ed4221) specifies the algorithm itself: H0 = MD5(password), then a 21-byte buffer (H0's own first 5 bytes + the 16-byte salt) repeated 16 times into a 336-byte buffer, H1 = MD5(that), then per block: Hfinal = MD5(H1's own first 5 bytes + the block number as 4 little-endian bytes).
//
// Two real parameters the published spec text alone does not settle unambiguously -- the exact byte count of the final derived key, and the byte span of the underlying stream each key covers -- are taken from Apache POI's own Biff8EncryptionKey, a mature, independent, production implementation, rather than guessed: the key is Hfinal's own first 5 bytes (40 bits, matching the RC4 Encryption Header's own field description "encrypted using a 40-bit RC4 cipher" -- despite 2.3.6.2's own more generic prose mentioning "the first 128 bits of Hfinal", which does not describe this specific header variant), and the key changes every 1024 bytes of the underlying decrypted stream, keyed by a zero-based block number that increments once per 1024-byte span.

/** [MS-OFFCRYPTO] 2.3.6.1's own EncryptedVerifier/EncryptedVerifierHash length, and the salt length the same header carries. */
export const OFFICE_RC4_VERIFIER_LENGTH = 16;
/** The span of the underlying decrypted stream one derived RC4 key covers before the next block's key takes over -- confirmed against Apache POI's Biff8EncryptionKey, since [MS-OFFCRYPTO] 2.3.6.2's own prose does not state it. */
export const OFFICE_RC4_BLOCK_SIZE = 1024;
/** The real derived RC4 key length for this scheme (40 bits) -- confirmed against Apache POI's Biff8EncryptionKey, since [MS-OFFCRYPTO] 2.3.6.2's own generic prose ("the first 128 bits of Hfinal") describes a different, longer-key variant this header shape does not use. */
const KEY_LENGTH_BYTES = 5;

function passwordToUtf16LeBytes(password: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(password.length * 2);
  for (let i = 0; i < password.length; i += 1) {
    const code = password.charCodeAt(i);
    bytes[i * 2] = code & 0xff;
    bytes[i * 2 + 1] = (code >>> 8) & 0xff;
  }
  return bytes;
}

/** The per-workbook intermediate hash (H1's own first 5 bytes) every block's key derives from -- computed once per password+salt pair, then reused across every block via deriveOfficeRc4BlockKey, since recomputing H0/H1 per block would be needless repeated work over the identical 336-byte buffer. */
export function deriveOfficeRc4BaseHash(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const h0 = md5(passwordToUtf16LeBytes(password));
  const truncated = h0.subarray(0, KEY_LENGTH_BYTES);
  const unit = new Uint8Array(KEY_LENGTH_BYTES + OFFICE_RC4_VERIFIER_LENGTH);
  unit.set(truncated, 0);
  unit.set(salt, KEY_LENGTH_BYTES);
  const buffer336 = new Uint8Array(unit.length * 16);
  for (let i = 0; i < 16; i += 1) {
    buffer336.set(unit, i * unit.length);
  }
  const h1 = md5(buffer336);
  return h1.subarray(0, KEY_LENGTH_BYTES);
}

/** The real, block-specific 40-bit RC4 key: MD5(baseHash + the block number as 4 little-endian bytes), truncated to 5 bytes. */
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
  const hash = md5(input);
  return hash.subarray(0, KEY_LENGTH_BYTES);
}

/**
 * Decrypts `data` -- a byte range of the underlying OLE stream starting at `streamOffset` bytes from the very start of that stream -- against the RC4 encryption header scheme, re-deriving the block key at every 1024-byte boundary `data` crosses. RC4 is symmetric, so this same function also encrypts; nothing in this package uses it that way, since nothing in this family writes an encrypted legacy binary document.
 *
 * `streamOffset` matters because the block number is the byte's own absolute position in the stream divided by 1024, not its position within whatever slice `data` happens to be -- decrypting a stream in arbitrary chunks (not just from offset 0) still lands on the correct per-block key this way.
 */
export function decryptOfficeRc4(
  baseHash: Uint8Array<ArrayBuffer>,
  streamOffset: number,
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length);
  let position = 0;
  while (position < data.length) {
    const absolute = streamOffset + position;
    const blockNumber = Math.floor(absolute / OFFICE_RC4_BLOCK_SIZE);
    const blockStartAbsolute = blockNumber * OFFICE_RC4_BLOCK_SIZE;
    const offsetWithinBlock = absolute - blockStartAbsolute;
    const bytesLeftInBlock = OFFICE_RC4_BLOCK_SIZE - offsetWithinBlock;
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
