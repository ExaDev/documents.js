// AES (FIPS 197) in CBC mode, hand-written for the same portability reason as md5.ts/sha2.ts/rc4.ts: the PDF standard security handler needs it for /CFM /AESV2 (128-bit) and /AESV3 (256-bit) content, for decrypting /UE to recover a revision-6 file key, and -- as a raw *encryption* primitive -- inside the revision-6 hardened hash of ISO 32000-2 Algorithm 2.B. `node:crypto` would break this package's `platform: 'neutral'` build and its fully client-side downstream consumer; WebCrypto offers AES-CBC but only asynchronously, and this codec's read path is synchronous end to end.
//
// The state is a flat 16-byte array indexed exactly as FIPS 197 3.4 defines it: s[r][c] lives at index r + 4c, so the input bytes map straight in with no transposition step.

export const AES_BLOCK_BYTES = 16;
const WORDS_PER_BLOCK = 4;
const GF_MODULUS = 0x11b; // x^8 + x^4 + x^3 + x + 1, FIPS 197 4.2
const AFFINE_CONSTANT = 0x63; // FIPS 197 5.1.1

function xtime(a: number): number {
  const doubled = a << 1;
  return (doubled & 0x100) !== 0 ? (doubled ^ GF_MODULUS) & 0xff : doubled;
}

// Multiplication in GF(2^8), FIPS 197 4.2 -- Russian-peasant style, adding shifted copies of `a` for each set bit of `b`.
function gmul(a: number, b: number): number {
  let product = 0;
  let left = a;
  let right = b;
  while (right !== 0) {
    if ((right & 1) !== 0) {
      product ^= left;
    }
    left = xtime(left);
    right >>= 1;
  }
  return product & 0xff;
}

function rotl8(value: number, bits: number): number {
  return ((value << bits) | (value >>> (8 - bits))) & 0xff;
}

// FIPS 197 5.1.1 defines the S-box constructively: the multiplicative inverse in GF(2^8) (with 0 mapping to itself), followed by a fixed affine transformation. Building it from that definition rather than transcribing 256 literal bytes keeps the derivation visible and removes any chance of a transcription typo; the inverse S-box is then just this table read backwards.
const { SBOX, INV_SBOX } = (() => {
  const inverse = new Uint8Array(256);
  for (let a = 1; a < 256; a++) {
    for (let b = 1; b < 256; b++) {
      if (gmul(a, b) === 1) {
        inverse[a] = b;
        break;
      }
    }
  }
  const sbox = new Uint8Array(256);
  const invSbox = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const b = inverse[i]!;
    const s = (b ^ rotl8(b, 1) ^ rotl8(b, 2) ^ rotl8(b, 3) ^ rotl8(b, 4) ^ AFFINE_CONSTANT) & 0xff;
    sbox[i] = s;
    invSbox[s] = i;
  }
  return { SBOX: sbox, INV_SBOX: invSbox };
})();

interface ExpandedKey {
  readonly words: Uint32Array;
  readonly rounds: number;
}

function subWord(word: number): number {
  return ((SBOX[(word >>> 24) & 0xff]! << 24) | (SBOX[(word >>> 16) & 0xff]! << 16) | (SBOX[(word >>> 8) & 0xff]! << 8) | SBOX[word & 0xff]!) >>> 0;
}

function rotWord(word: number): number {
  return ((word << 8) | (word >>> 24)) >>> 0;
}

// FIPS 197 5.2's KeyExpansion, valid for all three standard key sizes -- Nk = key words, Nr = Nk + 6 rounds, and the extra SubWord at i % Nk === 4 that only AES-256 (Nk = 8) ever reaches.
function expandKey(key: Uint8Array<ArrayBuffer>): ExpandedKey {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new Error(`AES key must be 16, 24, or 32 bytes; got ${String(key.length)}`);
  }
  const nk = key.length / 4;
  const rounds = nk + 6;
  const words = new Uint32Array(WORDS_PER_BLOCK * (rounds + 1));
  for (let i = 0; i < nk; i++) {
    words[i] = ((key[4 * i]! << 24) | (key[4 * i + 1]! << 16) | (key[4 * i + 2]! << 8) | key[4 * i + 3]!) >>> 0;
  }
  let rcon = 1;
  for (let i = nk; i < words.length; i++) {
    let temp = words[i - 1]!;
    if (i % nk === 0) {
      temp = (subWord(rotWord(temp)) ^ (rcon << 24)) >>> 0;
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      temp = subWord(temp);
    }
    words[i] = (words[i - nk]! ^ temp) >>> 0;
  }
  return { words, rounds };
}

function addRoundKey(state: Uint8Array<ArrayBuffer>, words: Uint32Array, round: number): void {
  for (let c = 0; c < WORDS_PER_BLOCK; c++) {
    const word = words[round * WORDS_PER_BLOCK + c]!;
    // The word's four bytes map onto rows 0..3 of the column, most significant byte first (FIPS 197 5.1.4).
    for (let r = 0; r < WORDS_PER_BLOCK; r++) {
      state[4 * c + r] = state[4 * c + r]! ^ ((word >>> (24 - r * 8)) & 0xff);
    }
  }
}

function substituteBytes(state: Uint8Array<ArrayBuffer>, table: Uint8Array): void {
  for (let i = 0; i < AES_BLOCK_BYTES; i++) {
    state[i] = table[state[i]!]!;
  }
}

// FIPS 197 5.1.2: row r rotates left by r columns. `direction` is +1 for ShiftRows and -1 for InvShiftRows (5.3.1), which rotates right by the same amount.
function shiftRows(state: Uint8Array<ArrayBuffer>, direction: 1 | -1): void {
  const source = Uint8Array.from(state);
  for (let r = 1; r < WORDS_PER_BLOCK; r++) {
    for (let c = 0; c < WORDS_PER_BLOCK; c++) {
      state[r + 4 * c] = source[r + 4 * (((c + direction * r) % WORDS_PER_BLOCK + WORDS_PER_BLOCK) % WORDS_PER_BLOCK)]!;
    }
  }
}

// FIPS 197 5.1.3 / 5.3.3: each column is multiplied by a fixed polynomial over GF(2^8) -- {02,03,01,01} forward, {0e,0b,0d,09} inverse.
function mixColumns(state: Uint8Array<ArrayBuffer>, coefficients: readonly [number, number, number, number]): void {
  const [k0, k1, k2, k3] = coefficients;
  for (let c = 0; c < WORDS_PER_BLOCK; c++) {
    const a0 = state[4 * c]!;
    const a1 = state[4 * c + 1]!;
    const a2 = state[4 * c + 2]!;
    const a3 = state[4 * c + 3]!;
    state[4 * c] = gmul(a0, k0) ^ gmul(a1, k1) ^ gmul(a2, k2) ^ gmul(a3, k3);
    state[4 * c + 1] = gmul(a0, k3) ^ gmul(a1, k0) ^ gmul(a2, k1) ^ gmul(a3, k2);
    state[4 * c + 2] = gmul(a0, k2) ^ gmul(a1, k3) ^ gmul(a2, k0) ^ gmul(a3, k1);
    state[4 * c + 3] = gmul(a0, k1) ^ gmul(a1, k2) ^ gmul(a2, k3) ^ gmul(a3, k0);
  }
}

const FORWARD_MIX: readonly [number, number, number, number] = [0x02, 0x03, 0x01, 0x01];
const INVERSE_MIX: readonly [number, number, number, number] = [0x0e, 0x0b, 0x0d, 0x09];

// FIPS 197 5.1's Cipher, in place on a 16-byte state.
function encryptBlock(state: Uint8Array<ArrayBuffer>, key: ExpandedKey): void {
  addRoundKey(state, key.words, 0);
  for (let round = 1; round < key.rounds; round++) {
    substituteBytes(state, SBOX);
    shiftRows(state, 1);
    mixColumns(state, FORWARD_MIX);
    addRoundKey(state, key.words, round);
  }
  substituteBytes(state, SBOX);
  shiftRows(state, 1);
  addRoundKey(state, key.words, key.rounds);
}

// FIPS 197 5.3's InvCipher (the straightforward, non-"equivalent" form: the round keys are consumed in reverse order without needing an inverse key schedule of their own).
function decryptBlock(state: Uint8Array<ArrayBuffer>, key: ExpandedKey): void {
  addRoundKey(state, key.words, key.rounds);
  for (let round = key.rounds - 1; round >= 1; round--) {
    shiftRows(state, -1);
    substituteBytes(state, INV_SBOX);
    addRoundKey(state, key.words, round);
    mixColumns(state, INVERSE_MIX);
  }
  shiftRows(state, -1);
  substituteBytes(state, INV_SBOX);
  addRoundKey(state, key.words, 0);
}

// A trailing partial block is dropped rather than zero-extended: a CBC ciphertext whose length is not a whole number of blocks is malformed, and inventing the missing bytes would silently manufacture plaintext. The caller (encrypt.ts) checks the same length itself and reports a diagnostic.
function wholeBlockCount(byteLength: number): number {
  return Math.floor(byteLength / AES_BLOCK_BYTES);
}

export function aesCbcDecrypt(key: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const expanded = expandKey(key);
  const blocks = wholeBlockCount(data.length);
  const out = new Uint8Array(blocks * AES_BLOCK_BYTES);
  const chain = Uint8Array.from(iv.subarray(0, AES_BLOCK_BYTES));
  for (let b = 0; b < blocks; b++) {
    const cipherBlock = data.subarray(b * AES_BLOCK_BYTES, (b + 1) * AES_BLOCK_BYTES);
    const state = Uint8Array.from(cipherBlock);
    decryptBlock(state, expanded);
    for (let i = 0; i < AES_BLOCK_BYTES; i++) {
      out[b * AES_BLOCK_BYTES + i] = state[i]! ^ chain[i]!;
    }
    chain.set(cipherBlock);
  }
  return out;
}

export function aesCbcEncrypt(key: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const expanded = expandKey(key);
  const blocks = wholeBlockCount(data.length);
  const out = new Uint8Array(blocks * AES_BLOCK_BYTES);
  const chain = Uint8Array.from(iv.subarray(0, AES_BLOCK_BYTES));
  for (let b = 0; b < blocks; b++) {
    const state = new Uint8Array(AES_BLOCK_BYTES);
    for (let i = 0; i < AES_BLOCK_BYTES; i++) {
      state[i] = data[b * AES_BLOCK_BYTES + i]! ^ chain[i]!;
    }
    encryptBlock(state, expanded);
    out.set(state, b * AES_BLOCK_BYTES);
    chain.set(state);
  }
  return out;
}

