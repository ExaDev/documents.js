// MD5 (RFC 1321), hand-written for exactly the reason every other layer of this codec is hand-written: ISO 32000-1 7.6.3.3's own key-derivation algorithms (Algorithm 2, and the /U verification Algorithms 4/5) are specified *directly* in terms of MD5, so a PDF reader cannot avoid implementing it. Reaching for `node:crypto` here would put a Node builtin inside a `src/` tree that deliberately has none -- tsdown builds this package with `platform: 'neutral'`, and its downstream consumer (documents.js) binds into a fully client-side Vite shell as well as a Node one, so a `node:crypto` import would break the browser build outright. WebCrypto is not an alternative either: `crypto.subtle` is asynchronous (this codec's read path is synchronous end to end) and offers neither MD5 nor RC4 at all.
//
// MD5 is cryptographically broken and must never be used for anything security-bearing in new code. It exists here solely to read files that already exist, whose format mandates it.

const BLOCK_BYTES = 64;
const DIGEST_BYTES = 16;
const ROUNDS = 64;
const WORDS_PER_BLOCK = 16;

// RFC 1321 3.4's own 64-element table, defined there as T[i] = floor(2^32 x abs(sin(i))) for i in 1..64 with i in radians. Written out rather than computed from Math.sin at load time deliberately: ECMAScript does not require Math.sin to be correctly rounded, so deriving the table would make this hash's output depend on the host engine's transcendental accuracy. These are published specification constants, not magic numbers.
const T = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

// RFC 1321 3.4's per-round left-rotation amounts, four distinct values cycling within each of the four 16-step rounds.
const SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10,
  15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// RFC 1321 3.3's initial state, little-endian words of the byte sequence 01 23 45 67 89 ab cd ef fe dc ba 98 76 54 32 10.
const INITIAL_STATE = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

function rotl32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

// RFC 1321 3.1/3.2: append 0x80, then zero bytes until the length is 56 mod 64, then the original *bit* length as a 64-bit little-endian integer. The length is split into two 32-bit halves by ordinary arithmetic rather than shifts, since a message longer than 512 MB overflows a 32-bit bit-count while staying exactly representable as a JS number.
function padMessage(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const paddedLength = (Math.floor((bytes.length + 8) / BLOCK_BYTES) + 1) * BLOCK_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  let low = bitLength % 0x100000000;
  let high = Math.floor(bitLength / 0x100000000);
  for (let i = 0; i < 4; i++) {
    padded[paddedLength - 8 + i] = low & 0xff;
    low = Math.floor(low / 256);
    padded[paddedLength - 4 + i] = high & 0xff;
    high = Math.floor(high / 256);
  }
  return padded;
}

export function md5(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const padded = padMessage(bytes);
  const state = Int32Array.from(INITIAL_STATE);
  const block = new Uint32Array(WORDS_PER_BLOCK);
  for (let offset = 0; offset < padded.length; offset += BLOCK_BYTES) {
    for (let i = 0; i < WORDS_PER_BLOCK; i++) {
      const at = offset + i * 4;
      block[i] = (padded[at]! | (padded[at + 1]! << 8) | (padded[at + 2]! << 16) | (padded[at + 3]! << 24)) >>> 0;
    }
    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    for (let i = 0; i < ROUNDS; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % WORDS_PER_BLOCK;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % WORDS_PER_BLOCK;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % WORDS_PER_BLOCK;
      }
      const sum = (a + (f >>> 0) + T[i]! + block[g]!) >>> 0;
      const rotated = rotl32(sum, SHIFT[i]!);
      a = d;
      d = c;
      c = b;
      b = (b + rotated) >>> 0;
    }
    state[0] = (state[0]! + a) | 0;
    state[1] = (state[1]! + b) | 0;
    state[2] = (state[2]! + c) | 0;
    state[3] = (state[3]! + d) | 0;
  }
  const digest = new Uint8Array(DIGEST_BYTES);
  for (let i = 0; i < state.length; i++) {
    const word = state[i]!;
    digest[i * 4] = word & 0xff;
    digest[i * 4 + 1] = (word >>> 8) & 0xff;
    digest[i * 4 + 2] = (word >>> 16) & 0xff;
    digest[i * 4 + 3] = (word >>> 24) & 0xff;
  }
  return digest;
}
