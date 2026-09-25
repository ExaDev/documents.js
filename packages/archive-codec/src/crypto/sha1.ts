// SHA-1 (RFC 3174 / FIPS 180-1), hand-written for the same reason every other layer of this package is hand-written: [MS-OFFCRYPTO] 2.3.5.2's own "RC4 CryptoAPI Encryption Key Generation" algorithm — the scheme PowerPoint binary documents (.ppt) use for password-to-open encryption, genuinely distinct from the MD5-based 2.3.6.2 scheme .doc/.xls share — is specified directly in terms of SHA-1, so a reader of an RC4-CryptoAPI-encrypted OLE document cannot avoid implementing it. `node:crypto` would break this package's `platform: 'neutral'` browser build, and WebCrypto's `crypto.subtle` is asynchronous where this package's read path is synchronous end to end, for the same reasons md5.ts already documents.
//
// SHA-1 is cryptographically broken and must never be used for anything security-bearing in new code. It exists here solely to read files that already exist, whose format mandates it.
//
// Every byte/word read below goes through a DataView rather than plain indexed access, for the same noUncheckedIndexedAccess reason md5.ts documents. The five 32-bit state words are named locals, never a fifth array, for the same reason md5.ts's own four are: there are only ever five of them, always referenced by their own fixed name, never a variable index. Unlike MD5, SHA-1 is big-endian throughout — both its input word parsing and its final digest layout — so every DataView call below omits the `littleEndian` argument (DataView defaults to big-endian) rather than passing `true`.

const BLOCK_BYTES = 64;
const DIGEST_BYTES = 20;
const ROUNDS = 80;
const WORDS_PER_BLOCK = 16;
const SCHEDULE_WORDS = 80;

// FIPS 180-1 6.1's own initial hash value.
const H0_INIT = 0x67452301;
const H1_INIT = 0xefcdab89;
const H2_INIT = 0x98badcfe;

// Widths, byte places, and the padding shape: a 32-bit word is 4 bytes, padding's own 0x80 terminator plus the 8-byte length field cost 9 bytes, and FIPS 180-1 5.1's own constants follow: the schedule reads 3, 8, 14 and 16 words back, rounds are 20 steps each with their own published k, and the compression rotations are 5, 30 and the schedule's own 1.
const WORD_BITS = 32;
const WORD_BYTES = 4;
const BITS_PER_BYTE = 8;
const TERMINATOR_AND_LENGTH_BYTES = 9;
const LENGTH_FIELD_BYTES = 8;
const PADDING_TERMINATOR = 0x80;
const W3_LAG = 3;
const W8_LAG = 8;
const W14_LAG = 14;
const W16_LAG = 16;
const SCHEDULE_ROTATE = 1;
const ROUND_1_STEPS = 20;
const ROUND_2_STEPS = 40;
const ROUND_3_STEPS = 60;
const ROUND_1_K = 0x5a827999;
const ROUND_2_K = 0x6ed9eba1;
const ROUND_3_K = 0x8f1bbcdc;
const ROUND_4_K = 0xca62c1d6;
const TEMP_ROTATE = 5;
const C_ROTATE = 30;
const H3_WORD = 3;
const H4_WORD = 4;
const H3_INIT = 0x10325476;
const H4_INIT = 0xc3d2e1f0;

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (WORD_BITS - bits))) >>> 0;
}

// The padded message: the original bytes, an 0x80 terminator bit, zero bytes up to a 56-mod-64 boundary, then the original bit length as a big-endian 64-bit integer (FIPS 180-1 5.1). This package's own inputs (a UTF-16LE password plus a 16-byte salt, or a base hash plus a 4-byte block number) never approach 2^32 bits, so only the low 32 bits of that length are ever non-zero; the high word is still written explicitly rather than assumed zero, since padding a length wrong silently produces a wrong digest rather than an error.
function pad(message: Uint8Array<ArrayBuffer>): DataView {
  const bitLength = message.length * BITS_PER_BYTE;
  const paddedLength =
    Math.ceil((message.length + TERMINATOR_AND_LENGTH_BYTES) / BLOCK_BYTES) *
    BLOCK_BYTES;
  const buffer = new ArrayBuffer(paddedLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(message, 0);
  view.setUint8(message.length, PADDING_TERMINATOR);
  view.setUint32(paddedLength - LENGTH_FIELD_BYTES, 0);
  view.setUint32(
    paddedLength - LENGTH_FIELD_BYTES + WORD_BYTES,
    bitLength >>> 0,
  );
  return view;
}

export function sha1(
  message: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const padded = pad(message);
  const blockCount = padded.byteLength / BLOCK_BYTES;

  let h0 = H0_INIT;
  let h1 = H1_INIT;
  let h2 = H2_INIT;
  let h3 = H3_INIT;
  let h4 = H4_INIT;

  const schedule = new DataView(new ArrayBuffer(SCHEDULE_WORDS * WORD_BYTES));

  for (let block = 0; block < blockCount; block += 1) {
    const blockStart = block * BLOCK_BYTES;
    for (let i = 0; i < WORDS_PER_BLOCK; i += 1) {
      schedule.setUint32(
        i * WORD_BYTES,
        padded.getUint32(blockStart + i * WORD_BYTES),
      );
    }
    // FIPS 180-1 7's message schedule extension.
    for (let i = WORDS_PER_BLOCK; i < ROUNDS; i += 1) {
      const w3 = schedule.getUint32((i - W3_LAG) * WORD_BYTES);
      const w8 = schedule.getUint32((i - W8_LAG) * WORD_BYTES);
      const w14 = schedule.getUint32((i - W14_LAG) * WORD_BYTES);
      const w16 = schedule.getUint32((i - W16_LAG) * WORD_BYTES);
      schedule.setUint32(
        i * WORD_BYTES,
        rotateLeft(w3 ^ w8 ^ w14 ^ w16, SCHEDULE_ROTATE),
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < ROUNDS; i += 1) {
      let f: number;
      let k: number;
      if (i < ROUND_1_STEPS) {
        f = (b & c) | (~b & d);
        k = ROUND_1_K;
      } else if (i < ROUND_2_STEPS) {
        f = b ^ c ^ d;
        k = ROUND_2_K;
      } else if (i < ROUND_3_STEPS) {
        f = (b & c) | (b & d) | (c & d);
        k = ROUND_3_K;
      } else {
        f = b ^ c ^ d;
        k = ROUND_4_K;
      }
      const w = schedule.getUint32(i * WORD_BYTES);
      const temp = (rotateLeft(a, TEMP_ROTATE) + f + e + k + w) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, C_ROTATE);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new DataView(new ArrayBuffer(DIGEST_BYTES));
  digest.setUint32(0, h0);
  digest.setUint32(WORD_BYTES, h1);
  digest.setUint32(2 * WORD_BYTES, h2);
  digest.setUint32(H3_WORD * WORD_BYTES, h3);
  digest.setUint32(H4_WORD * WORD_BYTES, h4);
  return new Uint8Array(digest.buffer);
}
