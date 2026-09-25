// MD5 (RFC 1321), hand-written for the same reason every other layer of this package is hand-written: [MS-OFFCRYPTO] 2.3.6.2's own RC4 key-derivation algorithm for legacy Office binary documents (.doc/.xls/.ppt) is specified *directly* in terms of MD5, so a reader of an RC4-encrypted OLE document cannot avoid implementing it. Reaching for `node:crypto` here would put a Node builtin inside a `src/` tree that deliberately has none — this package builds with `platform: 'neutral'` and is consumed by a fully client-side Vite shell as well as a Node one, so a `node:crypto` import would break the browser build outright. WebCrypto is not an alternative either: `crypto.subtle` is asynchronous (this package's read path is synchronous end to end) and offers neither MD5 nor RC4 at all.
//
// MD5 is cryptographically broken and must never be used for anything security-bearing in new code. It exists here solely to read files that already exist, whose format mandates it.
//
// Every byte/word read below goes through a DataView rather than plain indexed access: with noUncheckedIndexedAccess on, `arr[i]` types as possibly-undefined even where a loop bound already guarantees it is not, and DataView's own get/set sidestep that without a non-null assertion at every step. The four 32-bit state words are named locals rather than a fourth array for the same reason — there are only ever four of them, always referenced by their own fixed name, never a variable index.

const BLOCK_BYTES = 64;
const DIGEST_BYTES = 16;
const ROUNDS = 64;
const WORDS_PER_BLOCK = 16;
const WORD_BYTES = 4;
const WORD_BITS = 32;
const BITS_PER_BYTE = 8;
const BITS_PER_HIGH_WORD = 0x100000000;
// The 8-byte little-endian bit length that closes MD5's padding.
const LENGTH_FIELD_BYTES = 8;
// The four rounds each run 16 steps; rounds 2-4 index the block through RFC 1321 3.4's own g formulas (round 1 uses g = i directly, with no multiplier or offset).
const ROUND_1_STEPS = 16;
const ROUND_2_STEPS = 32;
const ROUND_3_STEPS = 48;
const ROUND_2_G_MULTIPLIER = 5;
const ROUND_2_G_OFFSET = 1;
const ROUND_3_G_MULTIPLIER = 3;
const ROUND_3_G_OFFSET = 5;
const ROUND_4_G_MULTIPLIER = 7;
const STATE_D_WORD = 3;

// RFC 1321 3.4's own 64-element table, defined there as T[i] = floor(2^32 x abs(sin(i))) for i in 1..64 with i in radians. Written out rather than computed from Math.sin at load time deliberately: ECMAScript does not require Math.sin to be correctly rounded, so deriving the table would make this hash's output depend on the host engine's transcendental accuracy. These are published specification constants, not magic numbers. Stored via explicit little-endian DataView writes (rather than a Uint32Array) so reading them back never depends on the host's own native byte order.
interface Md5SineConstant {
  readonly i: number;
  readonly value: number;
}
const T_VALUES: readonly Md5SineConstant[] = [
  { i: 1, value: 0xd76aa478 },
  { i: 2, value: 0xe8c7b756 },
  { i: 3, value: 0x242070db },
  { i: 4, value: 0xc1bdceee },
  { i: 5, value: 0xf57c0faf },
  { i: 6, value: 0x4787c62a },
  { i: 7, value: 0xa8304613 },
  { i: 8, value: 0xfd469501 },
  { i: 9, value: 0x698098d8 },
  { i: 10, value: 0x8b44f7af },
  { i: 11, value: 0xffff5bb1 },
  { i: 12, value: 0x895cd7be },
  { i: 13, value: 0x6b901122 },
  { i: 14, value: 0xfd987193 },
  { i: 15, value: 0xa679438e },
  { i: 16, value: 0x49b40821 },
  { i: 17, value: 0xf61e2562 },
  { i: 18, value: 0xc040b340 },
  { i: 19, value: 0x265e5a51 },
  { i: 20, value: 0xe9b6c7aa },
  { i: 21, value: 0xd62f105d },
  { i: 22, value: 0x02441453 },
  { i: 23, value: 0xd8a1e681 },
  { i: 24, value: 0xe7d3fbc8 },
  { i: 25, value: 0x21e1cde6 },
  { i: 26, value: 0xc33707d6 },
  { i: 27, value: 0xf4d50d87 },
  { i: 28, value: 0x455a14ed },
  { i: 29, value: 0xa9e3e905 },
  { i: 30, value: 0xfcefa3f8 },
  { i: 31, value: 0x676f02d9 },
  { i: 32, value: 0x8d2a4c8a },
  { i: 33, value: 0xfffa3942 },
  { i: 34, value: 0x8771f681 },
  { i: 35, value: 0x6d9d6122 },
  { i: 36, value: 0xfde5380c },
  { i: 37, value: 0xa4beea44 },
  { i: 38, value: 0x4bdecfa9 },
  { i: 39, value: 0xf6bb4b60 },
  { i: 40, value: 0xbebfbc70 },
  { i: 41, value: 0x289b7ec6 },
  { i: 42, value: 0xeaa127fa },
  { i: 43, value: 0xd4ef3085 },
  { i: 44, value: 0x04881d05 },
  { i: 45, value: 0xd9d4d039 },
  { i: 46, value: 0xe6db99e5 },
  { i: 47, value: 0x1fa27cf8 },
  { i: 48, value: 0xc4ac5665 },
  { i: 49, value: 0xf4292244 },
  { i: 50, value: 0x432aff97 },
  { i: 51, value: 0xab9423a7 },
  { i: 52, value: 0xfc93a039 },
  { i: 53, value: 0x655b59c3 },
  { i: 54, value: 0x8f0ccc92 },
  { i: 55, value: 0xffeff47d },
  { i: 56, value: 0x85845dd1 },
  { i: 57, value: 0x6fa87e4f },
  { i: 58, value: 0xfe2ce6e0 },
  { i: 59, value: 0xa3014314 },
  { i: 60, value: 0x4e0811a1 },
  { i: 61, value: 0xf7537e82 },
  { i: 62, value: 0xbd3af235 },
  { i: 63, value: 0x2ad7d2bb },
  { i: 64, value: 0xeb86d391 },
];
const T = new DataView(new ArrayBuffer(T_VALUES.length * WORD_BYTES));
T_VALUES.forEach(({ value }, index) => {
  T.setUint32(index * WORD_BYTES, value, true);
});

// RFC 1321's own per-round rotation amounts, each named by its value so the round arrays below read as the table they transcribe.
const SHIFT_4 = 4;
const SHIFT_5 = 5;
const SHIFT_6 = 6;
const SHIFT_7 = 7;
const SHIFT_9 = 9;
const SHIFT_10 = 10;
const SHIFT_11 = 11;
const SHIFT_12 = 12;
const SHIFT_14 = 14;
const SHIFT_15 = 15;
const SHIFT_16 = 16;
const SHIFT_17 = 17;
const SHIFT_20 = 20;
const SHIFT_21 = 21;
const SHIFT_22 = 22;
const SHIFT_23 = 23;

// RFC 1321 3.4's per-round left-rotation amounts: four distinct values per round, each repeating across the round's own four 4-step groups.
const ROUND_1_SHIFTS: readonly number[] = [
  SHIFT_7,
  SHIFT_12,
  SHIFT_17,
  SHIFT_22,
];
const ROUND_2_SHIFTS: readonly number[] = [
  SHIFT_5,
  SHIFT_9,
  SHIFT_14,
  SHIFT_20,
];
const ROUND_3_SHIFTS: readonly number[] = [
  SHIFT_4,
  SHIFT_11,
  SHIFT_16,
  SHIFT_23,
];
const ROUND_4_SHIFTS: readonly number[] = [
  SHIFT_6,
  SHIFT_10,
  SHIFT_15,
  SHIFT_21,
];
const SHIFT_VALUES: readonly number[] = [
  ...ROUND_1_SHIFTS,
  ...ROUND_1_SHIFTS,
  ...ROUND_1_SHIFTS,
  ...ROUND_1_SHIFTS,
  ...ROUND_2_SHIFTS,
  ...ROUND_2_SHIFTS,
  ...ROUND_2_SHIFTS,
  ...ROUND_2_SHIFTS,
  ...ROUND_3_SHIFTS,
  ...ROUND_3_SHIFTS,
  ...ROUND_3_SHIFTS,
  ...ROUND_3_SHIFTS,
  ...ROUND_4_SHIFTS,
  ...ROUND_4_SHIFTS,
  ...ROUND_4_SHIFTS,
  ...ROUND_4_SHIFTS,
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
  return ((value << bits) | (value >>> (WORD_BITS - bits))) >>> 0;
}

// RFC 1321 3.1: the original *bit* length as a 64-bit quantity, split into two 32-bit halves by ordinary arithmetic rather than shifts, since a message longer than 512 MiB overflows a 32-bit bit-count while staying exactly representable as a JS number. Exported (rather than kept as padMessage's own local arithmetic) so the >2^32 boundary — reached only by a message past 512 MiB — is directly testable: hashing an actual 512 MiB buffer through this hand-written implementation to exercise it indirectly would make the test suite itself pathologically slow.
export function splitBitLength64(bitLength: number): {
  readonly low: number;
  readonly high: number;
} {
  return {
    low: bitLength % BITS_PER_HIGH_WORD,
    high: Math.floor(bitLength / BITS_PER_HIGH_WORD),
  };
}

// RFC 1321 3.1/3.2's own 64-bit little-endian bit-length field, as its two 32-bit halves. A dedicated function (rather than padMessage's own inline pair of writes) so the high half's own byte order is directly testable: high is non-zero only for a message past 512 MiB, and hashing an actual buffer that large just to reach it through padMessage would make the test suite itself pathologically slow.
export function writeBitLength64(
  view: DataView,
  offset: number,
  bitLength: number,
): void {
  const { low, high } = splitBitLength64(bitLength);
  view.setUint32(offset, low, true);
  view.setUint32(offset + WORD_BYTES, high, true);
}

// RFC 1321 3.1/3.2: append 0x80, then zero bytes until the length is 56 mod 64, then the original bit length as a 64-bit little-endian integer (DataView's own setUint32 handles the byte order, rather than a hand-rolled per-byte shift-and-mask loop).
function padMessage(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const paddedLength =
    (Math.floor((bytes.length + LENGTH_FIELD_BYTES) / BLOCK_BYTES) + 1) *
    BLOCK_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  writeBitLength64(
    view,
    paddedLength - LENGTH_FIELD_BYTES,
    bytes.length * BITS_PER_BYTE,
  );
  return padded;
}

export function md5(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const padded = padMessage(bytes);
  const paddedView = new DataView(padded.buffer);
  let stateA = INITIAL_A;
  let stateB = INITIAL_B;
  let stateC = INITIAL_C;
  let stateD = INITIAL_D;
  const block = new DataView(new ArrayBuffer(WORDS_PER_BLOCK * WORD_BYTES));
  for (let offset = 0; offset < padded.length; offset += BLOCK_BYTES) {
    for (let i = 0; i < WORDS_PER_BLOCK; i++) {
      block.setUint32(
        i * WORD_BYTES,
        paddedView.getUint32(offset + i * WORD_BYTES, true),
        true,
      );
    }
    let a = stateA;
    let b = stateB;
    let c = stateC;
    let d = stateD;
    for (let i = 0; i < ROUNDS; i++) {
      let f: number;
      let g: number;
      if (i < ROUND_1_STEPS) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < ROUND_2_STEPS) {
        f = (d & b) | (~d & c);
        g = (ROUND_2_G_MULTIPLIER * i + ROUND_2_G_OFFSET) % WORDS_PER_BLOCK;
      } else if (i < ROUND_3_STEPS) {
        f = b ^ c ^ d;
        g = (ROUND_3_G_MULTIPLIER * i + ROUND_3_G_OFFSET) % WORDS_PER_BLOCK;
      } else {
        f = c ^ (b | ~d);
        g = (ROUND_4_G_MULTIPLIER * i) % WORDS_PER_BLOCK;
      }
      const sum =
        (a +
          (f >>> 0) +
          T.getUint32(i * WORD_BYTES, true) +
          block.getUint32(g * WORD_BYTES, true)) >>>
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
  digestView.setInt32(0 * WORD_BYTES, stateA, true);
  digestView.setInt32(1 * WORD_BYTES, stateB, true);
  digestView.setInt32(2 * WORD_BYTES, stateC, true);
  digestView.setInt32(STATE_D_WORD * WORD_BYTES, stateD, true);
  return digest;
}
