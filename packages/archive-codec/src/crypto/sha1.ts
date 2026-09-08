// SHA-1 (RFC 3174 / FIPS 180-1), hand-written for the same reason every other layer of this package is hand-written: [MS-OFFCRYPTO] 2.3.5.2's own "RC4 CryptoAPI Encryption Key Generation" algorithm -- the scheme PowerPoint binary documents (.ppt) use for password-to-open encryption, genuinely distinct from the MD5-based 2.3.6.2 scheme .doc/.xls share -- is specified directly in terms of SHA-1, so a reader of an RC4-CryptoAPI-encrypted OLE document cannot avoid implementing it. `node:crypto` would break this package's `platform: 'neutral'` browser build, and WebCrypto's `crypto.subtle` is asynchronous where this package's read path is synchronous end to end, for the same reasons md5.ts already documents.
//
// SHA-1 is cryptographically broken and must never be used for anything security-bearing in new code. It exists here solely to read files that already exist, whose format mandates it.
//
// Every byte/word read below goes through a DataView rather than plain indexed access, for the same noUncheckedIndexedAccess reason md5.ts documents. The five 32-bit state words are named locals, never a fifth array, for the same reason md5.ts's own four are: there are only ever five of them, always referenced by their own fixed name, never a variable index. Unlike MD5, SHA-1 is big-endian throughout -- both its input word parsing and its final digest layout -- so every DataView call below omits the `littleEndian` argument (DataView defaults to big-endian) rather than passing `true`.

const BLOCK_BYTES = 64;
const DIGEST_BYTES = 20;
const ROUNDS = 80;
const WORDS_PER_BLOCK = 16;
const SCHEDULE_WORDS = 80;

// FIPS 180-1 6.1's own initial hash value.
const H0_INIT = 0x67452301;
const H1_INIT = 0xefcdab89;
const H2_INIT = 0x98badcfe;
const H3_INIT = 0x10325476;
const H4_INIT = 0xc3d2e1f0;

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

// The padded message: the original bytes, an 0x80 terminator bit, zero bytes up to a 56-mod-64 boundary, then the original bit length as a big-endian 64-bit integer (FIPS 180-1 5.1). This package's own inputs (a UTF-16LE password plus a 16-byte salt, or a base hash plus a 4-byte block number) never approach 2^32 bits, so only the low 32 bits of that length are ever non-zero; the high word is still written explicitly rather than assumed zero, since padding a length wrong silently produces a wrong digest rather than an error.
function pad(message: Uint8Array<ArrayBuffer>): DataView {
  const bitLength = message.length * 8;
  const paddedLength =
    Math.ceil((message.length + 9) / BLOCK_BYTES) * BLOCK_BYTES;
  const buffer = new ArrayBuffer(paddedLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(message, 0);
  view.setUint8(message.length, 0x80);
  view.setUint32(paddedLength - 8, 0);
  view.setUint32(paddedLength - 4, bitLength >>> 0);
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

  const schedule = new DataView(new ArrayBuffer(SCHEDULE_WORDS * 4));

  for (let block = 0; block < blockCount; block += 1) {
    const blockStart = block * BLOCK_BYTES;
    for (let i = 0; i < WORDS_PER_BLOCK; i += 1) {
      schedule.setUint32(i * 4, padded.getUint32(blockStart + i * 4));
    }
    // FIPS 180-1 7's message schedule extension.
    for (let i = WORDS_PER_BLOCK; i < ROUNDS; i += 1) {
      const w3 = schedule.getUint32((i - 3) * 4);
      const w8 = schedule.getUint32((i - 8) * 4);
      const w14 = schedule.getUint32((i - 14) * 4);
      const w16 = schedule.getUint32((i - 16) * 4);
      schedule.setUint32(i * 4, rotateLeft(w3 ^ w8 ^ w14 ^ w16, 1));
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < ROUNDS; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const w = schedule.getUint32(i * 4);
      const temp = (rotateLeft(a, 5) + f + e + k + w) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
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
  digest.setUint32(4, h1);
  digest.setUint32(8, h2);
  digest.setUint32(12, h3);
  digest.setUint32(16, h4);
  return new Uint8Array(digest.buffer);
}
