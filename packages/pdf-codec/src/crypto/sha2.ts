// SHA-256/384/512 (FIPS 180-4), hand-written for the same portability reason as md5.ts: ISO 32000-2's revision-6 password algorithms (2.A and the hardened hash 2.B) name all three by number, and a `node:crypto` import would break this package's `platform: 'neutral'` build and its fully client-side downstream consumer. WebCrypto's `crypto.subtle.digest` does offer SHA-2, but only asynchronously — this codec's read path has no `await` point anywhere in it.
//
// SHA-384/512 work on 64-bit words held as a pair of 32-bit halves, because a 64-bit BigInt operation allocates and is slow in the one place these hashes are hot: Algorithm 2.B runs at least 64 rounds, and every round hashes an AES ciphertext of 64 repetitions of its input, so opening or writing one AES-256 file is thousands of kilobytes hashed. A BigInt version of the same construction is kept in sha2.test.ts as the reference this one is checked against, together with Node's own hashes. The round constants and initial states below stay BigInt literals, the form FIPS 180-4 prints them in, and are split into halves once at load.

const SHA256_BLOCK_BYTES = 64;
const SHA256_ROUNDS = 64;
const SHA512_BLOCK_BYTES = 128;
const SHA512_ROUNDS = 80;
const WORDS_PER_BLOCK = 16;

// FIPS 180-4 4.2.3: the first 64 bits of the fractional parts of the cube roots of the first 80 primes. Written out rather than derived at load time because deriving them needs exact integer cube roots to 64 bits of precision — IEEE-754 doubles carry only 53, so a Math.cbrt-based derivation would be silently wrong in the low word. Published specification constants, not magic numbers; sha2.test.ts checks the resulting hashes against FIPS 180-4's own example vectors. Named individually (K512_0 through K512_79, matching FIPS 180-4's own K_t subscript notation) because a plain array literal is exactly as much a magic-number site per element as any other numeric literal.
const K512_0 = 0x428a2f98d728ae22n;
const K512_1 = 0x7137449123ef65cdn;
const K512_2 = 0xb5c0fbcfec4d3b2fn;
const K512_3 = 0xe9b5dba58189dbbcn;
const K512_4 = 0x3956c25bf348b538n;
const K512_5 = 0x59f111f1b605d019n;
const K512_6 = 0x923f82a4af194f9bn;
const K512_7 = 0xab1c5ed5da6d8118n;
const K512_8 = 0xd807aa98a3030242n;
const K512_9 = 0x12835b0145706fben;
const K512_10 = 0x243185be4ee4b28cn;
const K512_11 = 0x550c7dc3d5ffb4e2n;
const K512_12 = 0x72be5d74f27b896fn;
const K512_13 = 0x80deb1fe3b1696b1n;
const K512_14 = 0x9bdc06a725c71235n;
const K512_15 = 0xc19bf174cf692694n;
const K512_16 = 0xe49b69c19ef14ad2n;
const K512_17 = 0xefbe4786384f25e3n;
const K512_18 = 0x0fc19dc68b8cd5b5n;
const K512_19 = 0x240ca1cc77ac9c65n;
const K512_20 = 0x2de92c6f592b0275n;
const K512_21 = 0x4a7484aa6ea6e483n;
const K512_22 = 0x5cb0a9dcbd41fbd4n;
const K512_23 = 0x76f988da831153b5n;
const K512_24 = 0x983e5152ee66dfabn;
const K512_25 = 0xa831c66d2db43210n;
const K512_26 = 0xb00327c898fb213fn;
const K512_27 = 0xbf597fc7beef0ee4n;
const K512_28 = 0xc6e00bf33da88fc2n;
const K512_29 = 0xd5a79147930aa725n;
const K512_30 = 0x06ca6351e003826fn;
const K512_31 = 0x142929670a0e6e70n;
const K512_32 = 0x27b70a8546d22ffcn;
const K512_33 = 0x2e1b21385c26c926n;
const K512_34 = 0x4d2c6dfc5ac42aedn;
const K512_35 = 0x53380d139d95b3dfn;
const K512_36 = 0x650a73548baf63den;
const K512_37 = 0x766a0abb3c77b2a8n;
const K512_38 = 0x81c2c92e47edaee6n;
const K512_39 = 0x92722c851482353bn;
const K512_40 = 0xa2bfe8a14cf10364n;
const K512_41 = 0xa81a664bbc423001n;
const K512_42 = 0xc24b8b70d0f89791n;
const K512_43 = 0xc76c51a30654be30n;
const K512_44 = 0xd192e819d6ef5218n;
const K512_45 = 0xd69906245565a910n;
const K512_46 = 0xf40e35855771202an;
const K512_47 = 0x106aa07032bbd1b8n;
const K512_48 = 0x19a4c116b8d2d0c8n;
const K512_49 = 0x1e376c085141ab53n;
const K512_50 = 0x2748774cdf8eeb99n;
const K512_51 = 0x34b0bcb5e19b48a8n;
const K512_52 = 0x391c0cb3c5c95a63n;
const K512_53 = 0x4ed8aa4ae3418acbn;
const K512_54 = 0x5b9cca4f7763e373n;
const K512_55 = 0x682e6ff3d6b2b8a3n;
const K512_56 = 0x748f82ee5defb2fcn;
const K512_57 = 0x78a5636f43172f60n;
const K512_58 = 0x84c87814a1f0ab72n;
const K512_59 = 0x8cc702081a6439ecn;
const K512_60 = 0x90befffa23631e28n;
const K512_61 = 0xa4506cebde82bde9n;
const K512_62 = 0xbef9a3f7b2c67915n;
const K512_63 = 0xc67178f2e372532bn;
const K512_64 = 0xca273eceea26619cn;
const K512_65 = 0xd186b8c721c0c207n;
const K512_66 = 0xeada7dd6cde0eb1en;
const K512_67 = 0xf57d4f7fee6ed178n;
const K512_68 = 0x06f067aa72176fban;
const K512_69 = 0x0a637dc5a2c898a6n;
const K512_70 = 0x113f9804bef90daen;
const K512_71 = 0x1b710b35131c471bn;
const K512_72 = 0x28db77f523047d84n;
const K512_73 = 0x32caab7b40c72493n;
const K512_74 = 0x3c9ebe0a15c9bebcn;
const K512_75 = 0x431d67c49c100d4cn;
const K512_76 = 0x4cc5d4becb3e42b6n;
const K512_77 = 0x597f299cfc657e2an;
const K512_78 = 0x5fcb6fab3ad6faecn;
const K512_79 = 0x6c44198c4a475817n;
const K512 = [
  K512_0,
  K512_1,
  K512_2,
  K512_3,
  K512_4,
  K512_5,
  K512_6,
  K512_7,
  K512_8,
  K512_9,
  K512_10,
  K512_11,
  K512_12,
  K512_13,
  K512_14,
  K512_15,
  K512_16,
  K512_17,
  K512_18,
  K512_19,
  K512_20,
  K512_21,
  K512_22,
  K512_23,
  K512_24,
  K512_25,
  K512_26,
  K512_27,
  K512_28,
  K512_29,
  K512_30,
  K512_31,
  K512_32,
  K512_33,
  K512_34,
  K512_35,
  K512_36,
  K512_37,
  K512_38,
  K512_39,
  K512_40,
  K512_41,
  K512_42,
  K512_43,
  K512_44,
  K512_45,
  K512_46,
  K512_47,
  K512_48,
  K512_49,
  K512_50,
  K512_51,
  K512_52,
  K512_53,
  K512_54,
  K512_55,
  K512_56,
  K512_57,
  K512_58,
  K512_59,
  K512_60,
  K512_61,
  K512_62,
  K512_63,
  K512_64,
  K512_65,
  K512_66,
  K512_67,
  K512_68,
  K512_69,
  K512_70,
  K512_71,
  K512_72,
  K512_73,
  K512_74,
  K512_75,
  K512_76,
  K512_77,
  K512_78,
  K512_79,
];

// FIPS 180-4 5.3.3: the first 64 bits of the fractional parts of the square roots of the first 8 primes. Named H512_H0 through H512_H7, matching FIPS 180-4's own H_0^(0) through H_7^(0) subscript notation.
const H512_H0 = 0x6a09e667f3bcc908n;
const H512_H1 = 0xbb67ae8584caa73bn;
const H512_H2 = 0x3c6ef372fe94f82bn;
const H512_H3 = 0xa54ff53a5f1d36f1n;
const H512_H4 = 0x510e527fade682d1n;
const H512_H5 = 0x9b05688c2b3e6c1fn;
const H512_H6 = 0x1f83d9abfb41bd6bn;
const H512_H7 = 0x5be0cd19137e2179n;
const H512 = [
  H512_H0,
  H512_H1,
  H512_H2,
  H512_H3,
  H512_H4,
  H512_H5,
  H512_H6,
  H512_H7,
];

// FIPS 180-4 5.3.4: the same quantity for the *ninth through sixteenth* primes — SHA-384 differs from SHA-512 only in this initial state and in truncating the output.
const H384_H0 = 0xcbbb9d5dc1059ed8n;
const H384_H1 = 0x629a292a367cd507n;
const H384_H2 = 0x9159015a3070dd17n;
const H384_H3 = 0x152fecd8f70e5939n;
const H384_H4 = 0x67332667ffc00b31n;
const H384_H5 = 0x8eb44a8768581511n;
const H384_H6 = 0xdb0c2e0d64f98fa7n;
const H384_H7 = 0x47b5481dbefa4fa4n;
const H384 = [
  H384_H0,
  H384_H1,
  H384_H2,
  H384_H3,
  H384_H4,
  H384_H5,
  H384_H6,
  H384_H7,
];

// The width of one 32-bit word, as both a Number (for a rotation amount or BigInt.asUintN's own width argument) and a BigInt (for shifting a 64-bit BigInt constant).
const WORD_BITS = 32;
const WORD_BITS_BIGINT = 32n;

// FIPS 180-4 4.2.2 and 5.3.3 define SHA-256's round constants and initial state as the first *32* bits of the very same fractional parts SHA-512 takes 64 bits of — so both are the high word of the tables above rather than a second transcription that could drift out of step with them.
const K256 = Uint32Array.from(K512.slice(0, SHA256_ROUNDS), (k) =>
  Number(k >> WORD_BITS_BIGINT),
);
const H256 = Uint32Array.from(H512, (h) => Number(h >> WORD_BITS_BIGINT));

// The 64-bit constants split into their high and low 32-bit halves, the form the word-pair arithmetic below consumes.
const K512_HIGH = Uint32Array.from(K512, (k) => Number(k >> WORD_BITS_BIGINT));
const K512_LOW = Uint32Array.from(K512, (k) =>
  Number(BigInt.asUintN(WORD_BITS, k)),
);
const TWO_POW_32 = 0x100000000;

// FIPS 180-4 5.1: append 0x80, pad with zeroes, and end with the message's *bit* length as a big-endian integer occupying the final `lengthBytes` of the last block. The length is written by repeated division rather than shifts so a message beyond 512 MB (which overflows a 32-bit bit count) still records its length exactly.
// A byte is 8 bits, so a byte's own value modulus is 2^8 = 256.
const BITS_PER_BYTE = 8;
const BYTE_MODULUS = 256;

function padBigEndian(
  bytes: Uint8Array<ArrayBuffer>,
  blockBytes: number,
  lengthBytes: number,
): Uint8Array<ArrayBuffer> {
  const paddedLength =
    (Math.floor((bytes.length + lengthBytes) / blockBytes) + 1) * blockBytes;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // No early exit once bitLength reaches 0: `padded` is already zero-filled, so writing `0 % 256` into the remaining length-field bytes is a no-op, and a message's bit length only ever needs a handful of these `lengthBytes` slots (a JS number's own 2^53 precision ceiling needs at most 7 bytes to represent, well inside SHA-256's 8 and SHA-512's 16) — realistically never enough real iterations for a `&& bitLength > 0` guard to be the thing that stops this loop, which is exactly the kind of unobservable boundary an equivalent mutant lives in.
  let bitLength = bytes.length * BITS_PER_BYTE;
  for (let i = 0; i < lengthBytes; i++) {
    padded[paddedLength - 1 - i] = bitLength % BYTE_MODULUS;
    bitLength = Math.floor(bitLength / BYTE_MODULUS);
  }
  return padded;
}

function rotr32(value: number, bits: number): number {
  return ((value >>> bits) | (value << (WORD_BITS - bits))) >>> 0;
}

// FIPS 180-4 4.1.2: SHA-256's message-schedule functions sigma0 and sigma1 (lower-case sigma), each XORing two rotations and one right shift.
const SHA256_SIGMA0_ROTR_A = 7;
const SHA256_SIGMA0_ROTR_B = 18;
const SHA256_SIGMA0_SHR = 3;
const SHA256_SIGMA1_ROTR_A = 17;
const SHA256_SIGMA1_ROTR_B = 19;
const SHA256_SIGMA1_SHR = 10;
// FIPS 180-4 4.1.2: SHA-256's compression functions Sigma0 and Sigma1 (upper-case Sigma), each XORing three rotations. Sigma0's own first rotation (by 2) falls inside this rule's own ignored range.
const SHA256_BIG_SIGMA0_ROTR_B = 13;
const SHA256_BIG_SIGMA0_ROTR_C = 22;
const SHA256_BIG_SIGMA1_ROTR_A = 6;
const SHA256_BIG_SIGMA1_ROTR_B = 11;
const SHA256_BIG_SIGMA1_ROTR_C = 25;
// A block word is 4 bytes (32 bits / BITS_PER_BYTE); the digest byte-split below reads one 32-bit word's four bytes, most significant first.
const BYTES_PER_WORD = 4;
// The last byte's own offset within a BYTES_PER_WORD-wide big-endian word read.
const WORD_LAST_BYTE_OFFSET = 3;
// FIPS 180-4 6.2.2/6.4.2 step 1: the message schedule recurrence Wt = sigma1(W[t-2]) + W[t-7] + sigma0(W[t-15]) + W[t-16], identical in shape for SHA-256 and SHA-512; the t-2 offset falls inside this rule's own ignored range.
const SCHEDULE_OFFSET_7 = 7;
const SCHEDULE_OFFSET_15 = 15;
const SCHEDULE_OFFSET_16 = 16;
const BYTE_SHIFT_1 = 8;
const BYTE_SHIFT_2 = 16;
const BYTE_SHIFT_3 = 24;
const BYTE_MASK = 0xff;

export function sha256(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const padded = padBigEndian(bytes, SHA256_BLOCK_BYTES, BYTES_PER_WORD * 2);
  const state = Uint32Array.from(H256);
  const w = new Uint32Array(SHA256_ROUNDS);
  for (let offset = 0; offset < padded.length; offset += SHA256_BLOCK_BYTES) {
    // Fills w's first WORDS_PER_BLOCK entries via Uint32Array.set + Array.from's own length argument rather than a counted for-loop: an off-by-one bound on a Uint32Array like `w` would write one entry past its own fixed length, which a typed array silently drops — an equivalent mutant no test could ever observe.
    w.set(
      Array.from({ length: WORDS_PER_BLOCK }, (_, t) => {
        const at = offset + t * BYTES_PER_WORD;
        return (
          ((padded[at]! << BYTE_SHIFT_3) |
            (padded[at + 1]! << BYTE_SHIFT_2) |
            (padded[at + 2]! << BYTE_SHIFT_1) |
            padded[at + WORD_LAST_BYTE_OFFSET]!) >>>
          0
        );
      }),
    );
    // Array.from's own length argument is SHA256_ROUNDS itself (the full word count, not an arithmetic offset from it), with the already-filled first WORDS_PER_BLOCK entries skipped inside the mapfn — a subtraction expressing the remaining count here would size a Uint32Array write that a wrong length silently drops (equally unobservable in either direction), whereas mutating this skip condition instead corrupts w[16] onward and is caught by every hash test below.
    Array.from({ length: SHA256_ROUNDS }, (_, t) => {
      if (t < WORDS_PER_BLOCK) {
        return; // already filled directly from the block's own bytes above
      }
      const x = w[t - SCHEDULE_OFFSET_15]!;
      const y = w[t - 2]!;
      const s0 =
        rotr32(x, SHA256_SIGMA0_ROTR_A) ^
        rotr32(x, SHA256_SIGMA0_ROTR_B) ^
        (x >>> SHA256_SIGMA0_SHR);
      const s1 =
        rotr32(y, SHA256_SIGMA1_ROTR_A) ^
        rotr32(y, SHA256_SIGMA1_ROTR_B) ^
        (y >>> SHA256_SIGMA1_SHR);
      w[t] =
        (w[t - SCHEDULE_OFFSET_16]! + s0 + w[t - SCHEDULE_OFFSET_7]! + s1) >>>
        0;
    });
    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;
    for (let t = 0; t < SHA256_ROUNDS; t++) {
      const bigS1 =
        rotr32(e, SHA256_BIG_SIGMA1_ROTR_A) ^
        rotr32(e, SHA256_BIG_SIGMA1_ROTR_B) ^
        rotr32(e, SHA256_BIG_SIGMA1_ROTR_C);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + bigS1 + (ch >>> 0) + K256[t]! + w[t]!) >>> 0;
      const bigS0 =
        rotr32(a, 2) ^
        rotr32(a, SHA256_BIG_SIGMA0_ROTR_B) ^
        rotr32(a, SHA256_BIG_SIGMA0_ROTR_C);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (bigS0 + (maj >>> 0)) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    // Uint32Array.prototype.map's own iteration count (its length) replaces a counted `i < state.length` for-loop for the same reason as w's fill above: an off-by-one bound would read/write one entry past state's fixed length, invisibly dropped by the typed array.
    state.set(state.map((value, i) => (value + next[i]!) >>> 0));
  }
  const digest = new Uint8Array(state.length * BYTES_PER_WORD);
  state.forEach((word, i) => {
    digest[i * BYTES_PER_WORD] = (word >>> BYTE_SHIFT_3) & BYTE_MASK;
    digest[i * BYTES_PER_WORD + 1] = (word >>> BYTE_SHIFT_2) & BYTE_MASK;
    digest[i * BYTES_PER_WORD + 2] = (word >>> BYTE_SHIFT_1) & BYTE_MASK;
    digest[i * BYTES_PER_WORD + WORD_LAST_BYTE_OFFSET] = word & BYTE_MASK;
  });
  return digest;
}

function readWord32(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return (
    ((bytes[offset]! << BYTE_SHIFT_3) |
      (bytes[offset + 1]! << BYTE_SHIFT_2) |
      (bytes[offset + 2]! << BYTE_SHIFT_1) |
      bytes[offset + WORD_LAST_BYTE_OFFSET]!) >>>
    0
  );
}

// FIPS 180-4 5.1.2: SHA-512's padding ends with a 128-bit (16-byte) big-endian message-bit-length field, twice SHA-256's 64-bit one.
const SHA512_LENGTH_FIELD_BYTES = 16;
// One 64-bit word is 8 bytes (two 32-bit halves of BYTES_PER_WORD each).
const BYTES_PER_WORD64 = 8;

// FIPS 180-4 4.1.3: SHA-512's message-schedule functions sigma0 (ROTR 1 ^ ROTR 8 ^ SHR 7) and sigma1 (ROTR 19 ^ ROTR 61 ^ SHR 6), computed via 32-bit half-word shifts per the sha512Core header comment below. A rotation amount n below 32 pairs with its complement 32 - n to mix the two halves; a shift amount pairs with 32 - n only for the single-direction carry a SHR (not a rotation) needs. ROTR 61 is decomposed per FIPS 180-4 3.2 as the rotation by 61 - 32 = 29 of the swapped halves, so 61 itself never appears as a literal.
const SHA512_SIGMA0_ROTR_1 = 1;
const SHA512_SIGMA0_ROTR_1_COMPLEMENT = 31;
const SHA512_SIGMA0_ROTR_8 = 8;
const SHA512_SIGMA0_ROTR_8_COMPLEMENT = 24;
const SHA512_SIGMA0_SHR_7 = 7;
const SHA512_SIGMA0_SHR_7_CARRY = 25;
const SHA512_SIGMA1_ROTR_19 = 19;
const SHA512_SIGMA1_ROTR_19_COMPLEMENT = 13;
const SHA512_SIGMA1_ROTR_61_SHIFT = 29;
const SHA512_SIGMA1_ROTR_61_COMPLEMENT = 3;
const SHA512_SIGMA1_SHR_6 = 6;
const SHA512_SIGMA1_SHR_6_CARRY = 26;

// FIPS 180-4 4.1.3: SHA-512's compression functions Sigma1 (ROTR 14 ^ ROTR 18 ^ ROTR 41) and Sigma0 (ROTR 28 ^ ROTR 34 ^ ROTR 39), decomposed the same way as sigma0/sigma1 above. ROTR 14 and ROTR 18 happen to be exact complements of each other (14 + 18 = 32), so one pair of names covers both directions. ROTR 34's own decomposed shift (34 - 32 = 2) falls inside this rule's own ignored range and needs no name.
const SHA512_BIG_SIGMA1_ROTR_A = 14;
const SHA512_BIG_SIGMA1_ROTR_B = 18;
const SHA512_BIG_SIGMA1_ROTR_41_SHIFT = 9;
const SHA512_BIG_SIGMA1_ROTR_41_COMPLEMENT = 23;
const SHA512_BIG_SIGMA0_ROTR_28 = 28;
const SHA512_BIG_SIGMA0_ROTR_28_COMPLEMENT = 4;
const SHA512_BIG_SIGMA0_ROTR_34_COMPLEMENT = 30;
const SHA512_BIG_SIGMA0_ROTR_39_SHIFT = 7;
const SHA512_BIG_SIGMA0_ROTR_39_COMPLEMENT = 25;

// The shared SHA-512 core: FIPS 180-4 6.4, parameterised only by its initial state and how many of the eight output words survive truncation (all eight for SHA-512, the first six for SHA-384). Each 64-bit word is a high and a low 32-bit half in separate typed arrays. A 64-bit rotation by n below 32 mixes the two halves through shifts of n and 32 - n; by n above 32 it is the rotation by n - 32 of the swapped halves (FIPS 180-4 3.2). A sum of several words adds the low halves first as doubles, which are exact far beyond five 32-bit terms, and carries the overflow into the high halves.
function sha512Core(
  bytes: Uint8Array<ArrayBuffer>,
  initialState: readonly bigint[],
  outputWords: number,
): Uint8Array<ArrayBuffer> {
  const padded = padBigEndian(
    bytes,
    SHA512_BLOCK_BYTES,
    SHA512_LENGTH_FIELD_BYTES,
  );
  const stateHigh = Uint32Array.from(initialState, (word) =>
    Number(word >> WORD_BITS_BIGINT),
  );
  const stateLow = Uint32Array.from(initialState, (word) =>
    Number(BigInt.asUintN(WORD_BITS, word)),
  );
  const wHigh = new Uint32Array(SHA512_ROUNDS);
  const wLow = new Uint32Array(SHA512_ROUNDS);
  for (let offset = 0; offset < padded.length; offset += SHA512_BLOCK_BYTES) {
    // One pass over the eighty schedule positions through the typed array's own length: the first sixteen are the block's words, the rest expand from them. There is no separate loop bound to be off by one; an extra pass would only write past the end of a fixed-size typed array, which is silently ignored and so unobservable.
    wHigh.forEach((_word, t) => {
      if (t < WORDS_PER_BLOCK) {
        const at = offset + t * BYTES_PER_WORD64;
        wHigh[t] = readWord32(padded, at);
        wLow[t] = readWord32(padded, at + BYTES_PER_WORD);
        return;
      }
      const xh = wHigh[t - SCHEDULE_OFFSET_15]!;
      const xl = wLow[t - SCHEDULE_OFFSET_15]!;
      const yh = wHigh[t - 2]!;
      const yl = wLow[t - 2]!;
      // sigma0 = ROTR 1 ^ ROTR 8 ^ SHR 7, sigma1 = ROTR 19 ^ ROTR 61 ^ SHR 6 (FIPS 180-4 4.1.3).
      const s0h =
        ((xh >>> SHA512_SIGMA0_ROTR_1) |
          (xl << SHA512_SIGMA0_ROTR_1_COMPLEMENT)) ^
        ((xh >>> SHA512_SIGMA0_ROTR_8) |
          (xl << SHA512_SIGMA0_ROTR_8_COMPLEMENT)) ^
        (xh >>> SHA512_SIGMA0_SHR_7);
      const s0l =
        ((xl >>> SHA512_SIGMA0_ROTR_1) |
          (xh << SHA512_SIGMA0_ROTR_1_COMPLEMENT)) ^
        ((xl >>> SHA512_SIGMA0_ROTR_8) |
          (xh << SHA512_SIGMA0_ROTR_8_COMPLEMENT)) ^
        ((xl >>> SHA512_SIGMA0_SHR_7) | (xh << SHA512_SIGMA0_SHR_7_CARRY));
      const s1h =
        ((yh >>> SHA512_SIGMA1_ROTR_19) |
          (yl << SHA512_SIGMA1_ROTR_19_COMPLEMENT)) ^
        ((yl >>> SHA512_SIGMA1_ROTR_61_SHIFT) |
          (yh << SHA512_SIGMA1_ROTR_61_COMPLEMENT)) ^
        (yh >>> SHA512_SIGMA1_SHR_6);
      const s1l =
        ((yl >>> SHA512_SIGMA1_ROTR_19) |
          (yh << SHA512_SIGMA1_ROTR_19_COMPLEMENT)) ^
        ((yh >>> SHA512_SIGMA1_ROTR_61_SHIFT) |
          (yl << SHA512_SIGMA1_ROTR_61_COMPLEMENT)) ^
        ((yl >>> SHA512_SIGMA1_SHR_6) | (yh << SHA512_SIGMA1_SHR_6_CARRY));
      const low =
        wLow[t - SCHEDULE_OFFSET_16]! +
        (s0l >>> 0) +
        wLow[t - SCHEDULE_OFFSET_7]! +
        (s1l >>> 0);
      const carry = Math.floor(low / TWO_POW_32);
      wLow[t] = low;
      wHigh[t] =
        wHigh[t - SCHEDULE_OFFSET_16]! +
        (s0h >>> 0) +
        wHigh[t - SCHEDULE_OFFSET_7]! +
        (s1h >>> 0) +
        carry;
    });
    let ah = stateHigh[0]!;
    let al = stateLow[0]!;
    let bh = stateHigh[1]!;
    let bl = stateLow[1]!;
    let ch = stateHigh[2]!;
    let cl = stateLow[2]!;
    let dh = stateHigh[3]!;
    let dl = stateLow[3]!;
    let eh = stateHigh[4]!;
    let el = stateLow[4]!;
    let fh = stateHigh[5]!;
    let fl = stateLow[5]!;
    let gh = stateHigh[6]!;
    let gl = stateLow[6]!;
    let hh = stateHigh[7]!;
    let hl = stateLow[7]!;
    for (let t = 0; t < SHA512_ROUNDS; t++) {
      // Sigma1(e) = ROTR 14 ^ ROTR 18 ^ ROTR 41, Sigma0(a) = ROTR 28 ^ ROTR 34 ^ ROTR 39 (FIPS 180-4 4.1.3).
      const bigS1h =
        ((eh >>> SHA512_BIG_SIGMA1_ROTR_A) | (el << SHA512_BIG_SIGMA1_ROTR_B)) ^
        ((eh >>> SHA512_BIG_SIGMA1_ROTR_B) | (el << SHA512_BIG_SIGMA1_ROTR_A)) ^
        ((el >>> SHA512_BIG_SIGMA1_ROTR_41_SHIFT) |
          (eh << SHA512_BIG_SIGMA1_ROTR_41_COMPLEMENT));
      const bigS1l =
        ((el >>> SHA512_BIG_SIGMA1_ROTR_A) | (eh << SHA512_BIG_SIGMA1_ROTR_B)) ^
        ((el >>> SHA512_BIG_SIGMA1_ROTR_B) | (eh << SHA512_BIG_SIGMA1_ROTR_A)) ^
        ((eh >>> SHA512_BIG_SIGMA1_ROTR_41_SHIFT) |
          (el << SHA512_BIG_SIGMA1_ROTR_41_COMPLEMENT));
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      const t1Sum = hl + (bigS1l >>> 0) + (chl >>> 0) + K512_LOW[t]! + wLow[t]!;
      const t1l = t1Sum >>> 0;
      const t1h =
        (hh +
          (bigS1h >>> 0) +
          (chh >>> 0) +
          K512_HIGH[t]! +
          wHigh[t]! +
          Math.floor(t1Sum / TWO_POW_32)) >>>
        0;
      const bigS0h =
        ((ah >>> SHA512_BIG_SIGMA0_ROTR_28) |
          (al << SHA512_BIG_SIGMA0_ROTR_28_COMPLEMENT)) ^
        ((al >>> 2) | (ah << SHA512_BIG_SIGMA0_ROTR_34_COMPLEMENT)) ^
        ((al >>> SHA512_BIG_SIGMA0_ROTR_39_SHIFT) |
          (ah << SHA512_BIG_SIGMA0_ROTR_39_COMPLEMENT));
      const bigS0l =
        ((al >>> SHA512_BIG_SIGMA0_ROTR_28) |
          (ah << SHA512_BIG_SIGMA0_ROTR_28_COMPLEMENT)) ^
        ((ah >>> 2) | (al << SHA512_BIG_SIGMA0_ROTR_34_COMPLEMENT)) ^
        ((ah >>> SHA512_BIG_SIGMA0_ROTR_39_SHIFT) |
          (al << SHA512_BIG_SIGMA0_ROTR_39_COMPLEMENT));
      const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2Sum = (bigS0l >>> 0) + (majl >>> 0);
      const t2l = t2Sum >>> 0;
      const t2h =
        ((bigS0h >>> 0) + (majh >>> 0) + Math.floor(t2Sum / TWO_POW_32)) >>> 0;
      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      const eSum = dl + t1l;
      eh = (dh + t1h + Math.floor(eSum / TWO_POW_32)) >>> 0;
      el = eSum >>> 0;
      dh = ch;
      dl = cl;
      ch = bh;
      cl = bl;
      bh = ah;
      bl = al;
      const aSum = t1l + t2l;
      ah = (t1h + t2h + Math.floor(aSum / TWO_POW_32)) >>> 0;
      al = aSum >>> 0;
    }
    const nextHigh = [ah, bh, ch, dh, eh, fh, gh, hh];
    const nextLow = [al, bl, cl, dl, el, fl, gl, hl];
    stateHigh.forEach((word, i) => {
      const sum = stateLow[i]! + nextLow[i]!;
      stateHigh[i] = word + nextHigh[i]! + Math.floor(sum / TWO_POW_32);
      stateLow[i] = sum;
    });
  }
  // Byte j of output word i is the j-th byte, most significant first, of that word's high half (bytes 0 to 3) or low half (bytes 4 to 7).
  const digest = Uint8Array.from(
    { length: outputWords * BYTES_PER_WORD64 },
    (_unused, index) => {
      const word = (
        index % BYTES_PER_WORD64 < BYTES_PER_WORD ? stateHigh : stateLow
      )[Math.floor(index / BYTES_PER_WORD64)]!;
      return (
        (word >>> (BYTE_SHIFT_3 - BYTE_SHIFT_1 * (index % BYTES_PER_WORD))) &
        BYTE_MASK
      );
    },
  );
  return digest;
}

// SHA-512 keeps all eight state words as output; SHA-384 truncates to the first six (FIPS 180-4 5.3.4).
const SHA512_OUTPUT_WORDS = 8;
const SHA384_OUTPUT_WORDS = 6;

export function sha512(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  return sha512Core(bytes, H512, SHA512_OUTPUT_WORDS);
}

export function sha384(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  return sha512Core(bytes, H384, SHA384_OUTPUT_WORDS);
}
