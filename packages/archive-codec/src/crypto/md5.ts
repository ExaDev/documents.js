// MD5 (RFC 1321), hand-written for the same reason every other layer of this package is hand-written: [MS-OFFCRYPTO] 2.3.6.2's own RC4 key-derivation algorithm for legacy Office binary documents (.doc/.xls/.ppt) is specified *directly* in terms of MD5, so a reader of an RC4-encrypted OLE document cannot avoid implementing it. Reaching for `node:crypto` here would put a Node builtin inside a `src/` tree that deliberately has none -- this package builds with `platform: 'neutral'` and is consumed by a fully client-side Vite shell as well as a Node one, so a `node:crypto` import would break the browser build outright. WebCrypto is not an alternative either: `crypto.subtle` is asynchronous (this package's read path is synchronous end to end) and offers neither MD5 nor RC4 at all.
//
// MD5 is cryptographically broken and must never be used for anything security-bearing in new code. It exists here solely to read files that already exist, whose format mandates it.
//
// Every byte/word read below goes through a DataView rather than plain indexed access: with noUncheckedIndexedAccess on, `arr[i]` types as possibly-undefined even where a loop bound already guarantees it is not, and DataView's own get/set sidestep that without a non-null assertion at every step. The four 32-bit state words are named locals rather than a fourth array for the same reason -- there are only ever four of them, always referenced by their own fixed name, never a variable index.

const BLOCK_BYTES = 64;
const DIGEST_BYTES = 16;
const ROUNDS = 64;
const WORDS_PER_BLOCK = 16;

// RFC 1321 3.4's own 64-element table, defined there as T[i] = floor(2^32 x abs(sin(i))) for i in 1..64 with i in radians. Written out rather than computed from Math.sin at load time deliberately: ECMAScript does not require Math.sin to be correctly rounded, so deriving the table would make this hash's output depend on the host engine's transcendental accuracy. These are published specification constants, not magic numbers. Stored via explicit little-endian DataView writes (rather than a Uint32Array) so reading them back never depends on the host's own native byte order.
const T_VALUES = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
  0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
  0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
  0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
  0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
  0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];
const T = new DataView(new ArrayBuffer(T_VALUES.length * 4));
T_VALUES.forEach((value, index) => {
  T.setUint32(index * 4, value, true);
});

// RFC 1321 3.4's per-round left-rotation amounts, four distinct values cycling within each of the four 16-step rounds.
const SHIFT_VALUES = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
];
const SHIFT = new DataView(new ArrayBuffer(SHIFT_VALUES.length));
SHIFT_VALUES.forEach((value, index) => {
  SHIFT.setUint8(index, value);
});

// RFC 1321 3.3's initial state, little-endian words of the byte sequence 01 23 45 67 89 ab cd ef fe dc ba 98 76 54 32 10.
const INITIAL_A = 0x67452301;
const INITIAL_B = 0xefcdab89;
const INITIAL_C = 0x98badcfe;
const INITIAL_D = 0x10325476;

function rotl32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

// RFC 1321 3.1: the original *bit* length as a 64-bit quantity, split into two 32-bit halves by ordinary arithmetic rather than shifts, since a message longer than 512 MiB overflows a 32-bit bit-count while staying exactly representable as a JS number. Exported (rather than kept as padMessage's own local arithmetic) so the >2^32 boundary -- reached only by a message past 512 MiB -- is directly testable: hashing an actual 512 MiB buffer through this hand-written implementation to exercise it indirectly would make the test suite itself pathologically slow.
export function splitBitLength64(bitLength: number): {
  readonly low: number;
  readonly high: number;
} {
  return {
    low: bitLength % 0x100000000,
    high: Math.floor(bitLength / 0x100000000),
  };
}

// RFC 1321 3.1/3.2: append 0x80, then zero bytes until the length is 56 mod 64, then the original bit length as a 64-bit little-endian integer (DataView's own setUint32 handles the byte order, rather than a hand-rolled per-byte shift-and-mask loop).
function padMessage(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const paddedLength =
    (Math.floor((bytes.length + 8) / BLOCK_BYTES) + 1) * BLOCK_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const { low, high } = splitBitLength64(bytes.length * 8);
  view.setUint32(paddedLength - 8, low, true);
  view.setUint32(paddedLength - 4, high, true);
  return padded;
}

export function md5(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const padded = padMessage(bytes);
  const paddedView = new DataView(padded.buffer);
  let stateA = INITIAL_A;
  let stateB = INITIAL_B;
  let stateC = INITIAL_C;
  let stateD = INITIAL_D;
  const block = new DataView(new ArrayBuffer(WORDS_PER_BLOCK * 4));
  for (let offset = 0; offset < padded.length; offset += BLOCK_BYTES) {
    for (let i = 0; i < WORDS_PER_BLOCK; i++) {
      block.setUint32(i * 4, paddedView.getUint32(offset + i * 4, true), true);
    }
    let a = stateA;
    let b = stateB;
    let c = stateC;
    let d = stateD;
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
      const sum =
        (a +
          (f >>> 0) +
          T.getUint32(i * 4, true) +
          block.getUint32(g * 4, true)) >>>
        0;
      const rotated = rotl32(sum, SHIFT.getUint8(i));
      a = d;
      d = c;
      c = b;
      b = (b + rotated) >>> 0;
    }
    stateA = (stateA + a) | 0;
    stateB = (stateB + b) | 0;
    stateC = (stateC + c) | 0;
    stateD = (stateD + d) | 0;
  }
  const digest = new Uint8Array(DIGEST_BYTES);
  const digestView = new DataView(digest.buffer);
  digestView.setInt32(0, stateA, true);
  digestView.setInt32(4, stateB, true);
  digestView.setInt32(8, stateC, true);
  digestView.setInt32(12, stateD, true);
  return digest;
}
