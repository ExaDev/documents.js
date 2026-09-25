// MD5 (RFC 1321), hand-written for exactly the reason every other layer of this codec is hand-written: ISO 32000-1 7.6.3.3's own key-derivation algorithms (Algorithm 2, and the /U verification Algorithms 4/5) are specified *directly* in terms of MD5, so a PDF reader cannot avoid implementing it. Reaching for `node:crypto` here would put a Node builtin inside a `src/` tree that deliberately has none — tsdown builds this package with `platform: 'neutral'`, and its downstream consumer (documents.js) binds into a fully client-side Vite shell as well as a Node one, so a `node:crypto` import would break the browser build outright. WebCrypto is not an alternative either: `crypto.subtle` is asynchronous (this codec's read path is synchronous end to end) and offers neither MD5 nor RC4 at all.
//
// MD5 is cryptographically broken and must never be used for anything security-bearing in new code. It exists here solely to read files that already exist, whose format mandates it.

const BLOCK_BYTES = 64;
const DIGEST_BYTES = 16;
const ROUNDS = 64;
const WORDS_PER_BLOCK = 16;
const STEPS_PER_ROUND = 16; // Each of MD5's four rounds runs this many steps; ROUNDS above is STEPS_PER_ROUND times the round count.
const BITS_PER_BYTE = 8;
const BYTES_PER_WORD = 4; // A little-endian 32-bit MD5 word, in bytes.
const BYTE_MASK = 0xff;
const WORD_BITS = 32; // The width of the left-rotate rotl32 performs.
const UINT32_MODULUS = 0x100000000; // 2^32: splits a 64-bit bit-length into its low/high 32-bit halves in padMessage below.
const LENGTH_FIELD_BYTES = 8; // RFC 1321 3.1: the trailing 64-bit little-endian original-bit-length field every padded message ends with.

// RFC 1321 3.4's own auxiliary-function index formula for rounds 2-4 (round 1 uses g = i directly, with no multiplier or offset).
const ROUND_2_G_MULTIPLIER = 5; // Round 2: g = (5i + 1) mod 16.
const ROUND_3_G_MULTIPLIER = 3; // Round 3: g = (3i + 5) mod 16.
const ROUND_3_G_OFFSET = 5;
const ROUND_4_G_MULTIPLIER = 7; // Round 4: g = 7i mod 16.
const ROUND_4_START = 48; // 3 * STEPS_PER_ROUND: the step index where MD5's fourth and final round begins.

// RFC 1321 3.4's own 64-element table, defined there as T[i] = floor(2^32 x abs(sin(i))) for i in 1..64 with i in radians. Written out rather than computed from Math.sin at load time deliberately: ECMAScript does not require Math.sin to be correctly rounded, so deriving the table would make this hash's output depend on the host engine's transcendental accuracy. These are published specification constants, not magic numbers. Each entry carries RFC 1321's own 1-based T[i] index alongside its value, so a reader can cross-check any one entry directly against the published table by that index.
interface Md5SineConstant {
  readonly i: number;
  readonly value: number;
}
const T_TABLE: readonly Md5SineConstant[] = [
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
const T = Uint32Array.from(T_TABLE, (entry) => entry.value);

// RFC 1321 3.4's per-round left-rotation amounts, using the exact S11-S44 names RFC 1321 Appendix A.3's own reference implementation gives them: SRc where R is the round (1-4) and c is the step-within-round (1-4), each group of four cycling four times across that round's sixteen steps.
const S11 = 7;
const S12 = 12;
const S13 = 17;
const S14 = 22;
const S21 = 5;
const S22 = 9;
const S23 = 14;
const S24 = 20;
const S31 = 4;
const S32 = 11;
const S33 = 16;
const S34 = 23;
const S41 = 6;
const S42 = 10;
const S43 = 15;
const S44 = 21;
const ROUND_1_SHIFTS: readonly number[] = [S11, S12, S13, S14];
const ROUND_2_SHIFTS: readonly number[] = [S21, S22, S23, S24];
const ROUND_3_SHIFTS: readonly number[] = [S31, S32, S33, S34];
const ROUND_4_SHIFTS: readonly number[] = [S41, S42, S43, S44];
const SHIFT: readonly number[] = [
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

// RFC 1321 3.3's initial state, using the same A/B/C/D word-buffer names RFC 1321 itself uses: little-endian words of the byte sequence 01 23 45 67 89 ab cd ef fe dc ba 98 76 54 32 10.
const MD5_INITIAL_A = 0x67452301;
const MD5_INITIAL_B = 0xefcdab89;
const MD5_INITIAL_C = 0x98badcfe;
const MD5_INITIAL_D = 0x10325476;
const INITIAL_STATE = [
  MD5_INITIAL_A,
  MD5_INITIAL_B,
  MD5_INITIAL_C,
  MD5_INITIAL_D,
];

function rotl32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (WORD_BITS - bits))) >>> 0;
}

// RFC 1321 3.1/3.2: append 0x80, then zero bytes until the length is 56 mod 64, then the original *bit* length as a 64-bit little-endian integer. The length is split into two 32-bit halves by ordinary arithmetic rather than shifts, since a message longer than 512 MB overflows a 32-bit bit-count while staying exactly representable as a JS number.
function padMessage(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const paddedLength =
    (Math.floor((bytes.length + LENGTH_FIELD_BYTES) / BLOCK_BYTES) + 1) *
    BLOCK_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * BITS_PER_BYTE;
  let low = bitLength % UINT32_MODULUS;
  let high = Math.floor(bitLength / UINT32_MODULUS);
  for (let i = 0; i < BYTES_PER_WORD; i++) {
    padded[paddedLength - LENGTH_FIELD_BYTES + i] = low & BYTE_MASK;
    low = Math.floor(low / (1 << BITS_PER_BYTE));
    padded[paddedLength - BYTES_PER_WORD + i] = high & BYTE_MASK;
    high = Math.floor(high / (1 << BITS_PER_BYTE));
  }
  return padded;
}

export function md5(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const padded = padMessage(bytes);
  const state = Int32Array.from(INITIAL_STATE);
  const block = new Uint32Array(WORDS_PER_BLOCK);
  for (let offset = 0; offset < padded.length; offset += BLOCK_BYTES) {
    for (let i = 0; i < WORDS_PER_BLOCK; i++) {
      const at = offset + i * BYTES_PER_WORD;
      block[i] =
        (padded[at]! |
          (padded[at + 1]! << BITS_PER_BYTE) |
          (padded[at + 2]! << (2 * BITS_PER_BYTE)) |
          (padded[at + (BYTES_PER_WORD - 1)]! <<
            ((BYTES_PER_WORD - 1) * BITS_PER_BYTE))) >>>
        0;
    }
    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    for (let i = 0; i < ROUNDS; i++) {
      let f: number;
      let g: number;
      if (i < STEPS_PER_ROUND) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 2 * STEPS_PER_ROUND) {
        f = (d & b) | (~d & c);
        g = (ROUND_2_G_MULTIPLIER * i + 1) % WORDS_PER_BLOCK;
      } else if (i < ROUND_4_START) {
        f = b ^ c ^ d;
        g = (ROUND_3_G_MULTIPLIER * i + ROUND_3_G_OFFSET) % WORDS_PER_BLOCK;
      } else {
        f = c ^ (b | ~d);
        g = (ROUND_4_G_MULTIPLIER * i) % WORDS_PER_BLOCK;
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
    digest[i * BYTES_PER_WORD] = word & BYTE_MASK;
    digest[i * BYTES_PER_WORD + 1] = (word >>> BITS_PER_BYTE) & BYTE_MASK;
    digest[i * BYTES_PER_WORD + 2] = (word >>> (2 * BITS_PER_BYTE)) & BYTE_MASK;
    digest[i * BYTES_PER_WORD + (BYTES_PER_WORD - 1)] =
      (word >>> ((BYTES_PER_WORD - 1) * BITS_PER_BYTE)) & BYTE_MASK;
  }
  return digest;
}
