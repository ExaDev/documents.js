// SHA-256/384/512 (FIPS 180-4), hand-written for the same portability reason as md5.ts: ISO 32000-2's revision-6 password algorithms (2.A and the hardened hash 2.B) name all three by number, and a `node:crypto` import would break this package's `platform: 'neutral'` build and its fully client-side downstream consumer. WebCrypto's `crypto.subtle.digest` does offer SHA-2, but only asynchronously -- this codec's read path has no `await` point anywhere in it.
//
// SHA-384/512 work on 64-bit words held as a pair of 32-bit halves, because a 64-bit BigInt operation allocates and is slow in the one place these hashes are hot: Algorithm 2.B runs at least 64 rounds, and every round hashes an AES ciphertext of 64 repetitions of its input, so opening or writing one AES-256 file is thousands of kilobytes hashed. A BigInt version of the same construction is kept in sha2.test.ts as the reference this one is checked against, together with Node's own hashes. The round constants and initial states below stay BigInt literals, the form FIPS 180-4 prints them in, and are split into halves once at load.

const SHA256_BLOCK_BYTES = 64;
const SHA256_ROUNDS = 64;
const SHA512_BLOCK_BYTES = 128;
const SHA512_ROUNDS = 80;
const WORDS_PER_BLOCK = 16;

// FIPS 180-4 4.2.3: the first 64 bits of the fractional parts of the cube roots of the first 80 primes. Written out rather than derived at load time because deriving them needs exact integer cube roots to 64 bits of precision -- IEEE-754 doubles carry only 53, so a Math.cbrt-based derivation would be silently wrong in the low word. Published specification constants, not magic numbers; sha2.test.ts checks the resulting hashes against FIPS 180-4's own example vectors.
const K512 = [
  0x428a2f98d728ae22n,
  0x7137449123ef65cdn,
  0xb5c0fbcfec4d3b2fn,
  0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n,
  0x59f111f1b605d019n,
  0x923f82a4af194f9bn,
  0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n,
  0x12835b0145706fben,
  0x243185be4ee4b28cn,
  0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn,
  0x80deb1fe3b1696b1n,
  0x9bdc06a725c71235n,
  0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n,
  0xefbe4786384f25e3n,
  0x0fc19dc68b8cd5b5n,
  0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n,
  0x4a7484aa6ea6e483n,
  0x5cb0a9dcbd41fbd4n,
  0x76f988da831153b5n,
  0x983e5152ee66dfabn,
  0xa831c66d2db43210n,
  0xb00327c898fb213fn,
  0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n,
  0xd5a79147930aa725n,
  0x06ca6351e003826fn,
  0x142929670a0e6e70n,
  0x27b70a8546d22ffcn,
  0x2e1b21385c26c926n,
  0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn,
  0x650a73548baf63den,
  0x766a0abb3c77b2a8n,
  0x81c2c92e47edaee6n,
  0x92722c851482353bn,
  0xa2bfe8a14cf10364n,
  0xa81a664bbc423001n,
  0xc24b8b70d0f89791n,
  0xc76c51a30654be30n,
  0xd192e819d6ef5218n,
  0xd69906245565a910n,
  0xf40e35855771202an,
  0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n,
  0x1e376c085141ab53n,
  0x2748774cdf8eeb99n,
  0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n,
  0x4ed8aa4ae3418acbn,
  0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn,
  0x78a5636f43172f60n,
  0x84c87814a1f0ab72n,
  0x8cc702081a6439ecn,
  0x90befffa23631e28n,
  0xa4506cebde82bde9n,
  0xbef9a3f7b2c67915n,
  0xc67178f2e372532bn,
  0xca273eceea26619cn,
  0xd186b8c721c0c207n,
  0xeada7dd6cde0eb1en,
  0xf57d4f7fee6ed178n,
  0x06f067aa72176fban,
  0x0a637dc5a2c898a6n,
  0x113f9804bef90daen,
  0x1b710b35131c471bn,
  0x28db77f523047d84n,
  0x32caab7b40c72493n,
  0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n,
  0x597f299cfc657e2an,
  0x5fcb6fab3ad6faecn,
  0x6c44198c4a475817n,
];

// FIPS 180-4 5.3.3: the first 64 bits of the fractional parts of the square roots of the first 8 primes.
const H512 = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
];

// FIPS 180-4 5.3.4: the same quantity for the *ninth through sixteenth* primes -- SHA-384 differs from SHA-512 only in this initial state and in truncating the output.
const H384 = [
  0xcbbb9d5dc1059ed8n,
  0x629a292a367cd507n,
  0x9159015a3070dd17n,
  0x152fecd8f70e5939n,
  0x67332667ffc00b31n,
  0x8eb44a8768581511n,
  0xdb0c2e0d64f98fa7n,
  0x47b5481dbefa4fa4n,
];

// FIPS 180-4 4.2.2 and 5.3.3 define SHA-256's round constants and initial state as the first *32* bits of the very same fractional parts SHA-512 takes 64 bits of -- so both are the high word of the tables above rather than a second transcription that could drift out of step with them.
const K256 = Uint32Array.from(K512.slice(0, SHA256_ROUNDS), (k) =>
  Number(k >> 32n),
);
const H256 = Uint32Array.from(H512, (h) => Number(h >> 32n));

// The 64-bit constants split into their high and low 32-bit halves, the form the word-pair arithmetic below consumes.
const LOW_HALF = 0xffffffffn;
const K512_HIGH = Uint32Array.from(K512, (k) => Number(k >> 32n));
const K512_LOW = Uint32Array.from(K512, (k) => Number(k & LOW_HALF));
const TWO_POW_32 = 0x100000000;

// FIPS 180-4 5.1: append 0x80, pad with zeroes, and end with the message's *bit* length as a big-endian integer occupying the final `lengthBytes` of the last block. The length is written by repeated division rather than shifts so a message beyond 512 MB (which overflows a 32-bit bit count) still records its length exactly.
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
  let bitLength = bytes.length * 8;
  for (let i = 0; i < lengthBytes && bitLength > 0; i++) {
    padded[paddedLength - 1 - i] = bitLength % 256;
    bitLength = Math.floor(bitLength / 256);
  }
  return padded;
}

function rotr32(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

export function sha256(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const padded = padBigEndian(bytes, SHA256_BLOCK_BYTES, 8);
  const state = Uint32Array.from(H256);
  const w = new Uint32Array(SHA256_ROUNDS);
  for (let offset = 0; offset < padded.length; offset += SHA256_BLOCK_BYTES) {
    for (let t = 0; t < WORDS_PER_BLOCK; t++) {
      const at = offset + t * 4;
      w[t] =
        ((padded[at]! << 24) |
          (padded[at + 1]! << 16) |
          (padded[at + 2]! << 8) |
          padded[at + 3]!) >>>
        0;
    }
    for (let t = WORDS_PER_BLOCK; t < SHA256_ROUNDS; t++) {
      const x = w[t - 15]!;
      const y = w[t - 2]!;
      const s0 = rotr32(x, 7) ^ rotr32(x, 18) ^ (x >>> 3);
      const s1 = rotr32(y, 17) ^ rotr32(y, 19) ^ (y >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;
    for (let t = 0; t < SHA256_ROUNDS; t++) {
      const bigS1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + bigS1 + (ch >>> 0) + K256[t]! + w[t]!) >>> 0;
      const bigS0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
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
    for (let i = 0; i < state.length; i++) {
      state[i] = (state[i]! + next[i]!) >>> 0;
    }
  }
  const digest = new Uint8Array(state.length * 4);
  for (let i = 0; i < state.length; i++) {
    const word = state[i]!;
    digest[i * 4] = (word >>> 24) & 0xff;
    digest[i * 4 + 1] = (word >>> 16) & 0xff;
    digest[i * 4 + 2] = (word >>> 8) & 0xff;
    digest[i * 4 + 3] = word & 0xff;
  }
  return digest;
}

function readWord32(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

// The shared SHA-512 core: FIPS 180-4 6.4, parameterised only by its initial state and how many of the eight output words survive truncation (all eight for SHA-512, the first six for SHA-384). Each 64-bit word is a high and a low 32-bit half in separate typed arrays. A 64-bit rotation by n below 32 mixes the two halves through shifts of n and 32 - n; by n above 32 it is the rotation by n - 32 of the swapped halves (FIPS 180-4 3.2). A sum of several words adds the low halves first as doubles, which are exact far beyond five 32-bit terms, and carries the overflow into the high halves.
function sha512Core(
  bytes: Uint8Array<ArrayBuffer>,
  initialState: readonly bigint[],
  outputWords: number,
): Uint8Array<ArrayBuffer> {
  const padded = padBigEndian(bytes, SHA512_BLOCK_BYTES, 16);
  const stateHigh = Uint32Array.from(initialState, (word) =>
    Number(word >> 32n),
  );
  const stateLow = Uint32Array.from(initialState, (word) =>
    Number(word & LOW_HALF),
  );
  const wHigh = new Uint32Array(SHA512_ROUNDS);
  const wLow = new Uint32Array(SHA512_ROUNDS);
  for (let offset = 0; offset < padded.length; offset += SHA512_BLOCK_BYTES) {
    // One pass over the eighty schedule positions through the typed array's own length: the first sixteen are the block's words, the rest expand from them. There is no separate loop bound to be off by one; an extra pass would only write past the end of a fixed-size typed array, which is silently ignored and so unobservable.
    wHigh.forEach((_word, t) => {
      if (t < WORDS_PER_BLOCK) {
        const at = offset + t * 8;
        wHigh[t] = readWord32(padded, at);
        wLow[t] = readWord32(padded, at + 4);
        return;
      }
      const xh = wHigh[t - 15]!;
      const xl = wLow[t - 15]!;
      const yh = wHigh[t - 2]!;
      const yl = wLow[t - 2]!;
      // sigma0 = ROTR 1 ^ ROTR 8 ^ SHR 7, sigma1 = ROTR 19 ^ ROTR 61 ^ SHR 6 (FIPS 180-4 4.1.3).
      const s0h =
        ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      const s0l =
        ((xl >>> 1) | (xh << 31)) ^
        ((xl >>> 8) | (xh << 24)) ^
        ((xl >>> 7) | (xh << 25));
      const s1h =
        ((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6);
      const s1l =
        ((yl >>> 19) | (yh << 13)) ^
        ((yh >>> 29) | (yl << 3)) ^
        ((yl >>> 6) | (yh << 26));
      const low = wLow[t - 16]! + (s0l >>> 0) + wLow[t - 7]! + (s1l >>> 0);
      const carry = Math.floor(low / TWO_POW_32);
      wLow[t] = low;
      wHigh[t] =
        wHigh[t - 16]! + (s0h >>> 0) + wHigh[t - 7]! + (s1h >>> 0) + carry;
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
        ((eh >>> 14) | (el << 18)) ^
        ((eh >>> 18) | (el << 14)) ^
        ((el >>> 9) | (eh << 23));
      const bigS1l =
        ((el >>> 14) | (eh << 18)) ^
        ((el >>> 18) | (eh << 14)) ^
        ((eh >>> 9) | (el << 23));
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
        ((ah >>> 28) | (al << 4)) ^
        ((al >>> 2) | (ah << 30)) ^
        ((al >>> 7) | (ah << 25));
      const bigS0l =
        ((al >>> 28) | (ah << 4)) ^
        ((ah >>> 2) | (al << 30)) ^
        ((ah >>> 7) | (al << 25));
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
    { length: outputWords * 8 },
    (_unused, index) => {
      const word = (index % 8 < 4 ? stateHigh : stateLow)[
        Math.floor(index / 8)
      ]!;
      return (word >>> (24 - 8 * (index % 4))) & 0xff;
    },
  );
  return digest;
}

export function sha512(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  return sha512Core(bytes, H512, 8);
}

export function sha384(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  return sha512Core(bytes, H384, 6);
}
