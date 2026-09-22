// AES (FIPS 197) in CBC mode, hand-written for the same portability reason as md5.ts/sha2.ts/rc4.ts: the PDF standard security handler needs it for /CFM /AESV2 (128-bit) and /AESV3 (256-bit) content, for decrypting /UE to recover a revision-6 file key, and — as a raw *encryption* primitive — inside the revision-6 hardened hash of ISO 32000-2 Algorithm 2.B. `node:crypto` would break this package's `platform: 'neutral'` build and its fully client-side downstream consumer; WebCrypto offers AES-CBC but only asynchronously, and this codec's read path is synchronous end to end.
//
// The state is four 32-bit column words, each holding s[0][c] to s[3][c] most significant byte first, which is FIPS 197 3.4's layout (s[r][c] at byte index r + 4c) read a word at a time, so the input bytes map straight in with no transposition step. Rounds are table-driven (see the tables below); the S-boxes, the field arithmetic and the key schedule are FIPS 197's own definitions.

export const AES_BLOCK_BYTES = 16;
const WORDS_PER_BLOCK = 4;
const GF_MODULUS = 0x11b; // x^8 + x^4 + x^3 + x + 1, FIPS 197 4.2
const AFFINE_CONSTANT = 0x63; // FIPS 197 5.1.1

function xtime(a: number): number {
  const doubled = a << 1;
  return (doubled & 0x100) !== 0 ? (doubled ^ GF_MODULUS) & 0xff : doubled;
}

// Multiplication in GF(2^8), FIPS 197 4.2 — Russian-peasant style, adding shifted copies of `a` for each set bit of `b`.
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
    const s =
      (b ^
        rotl8(b, 1) ^
        rotl8(b, 2) ^
        rotl8(b, 3) ^
        rotl8(b, 4) ^
        AFFINE_CONSTANT) &
      0xff;
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
  return (
    ((SBOX[(word >>> 24) & 0xff]! << 24) |
      (SBOX[(word >>> 16) & 0xff]! << 16) |
      (SBOX[(word >>> 8) & 0xff]! << 8) |
      SBOX[word & 0xff]!) >>>
    0
  );
}

function rotWord(word: number): number {
  return ((word << 8) | (word >>> 24)) >>> 0;
}

// FIPS 197 5.2's KeyExpansion, valid for all three standard key sizes — Nk = key words, Nr = Nk + 6 rounds, and the extra SubWord at i % Nk === 4 that only AES-256 (Nk = 8) ever reaches.
function expandKey(key: Uint8Array<ArrayBuffer>): ExpandedKey {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new Error(
      `AES key must be 16, 24, or 32 bytes; got ${String(key.length)}`,
    );
  }
  const nk = key.length / 4;
  const rounds = nk + 6;
  const words = new Uint32Array(WORDS_PER_BLOCK * (rounds + 1));
  // The key's own words are read in through Uint32Array.set and the schedule then walks the array with forEach, so neither loop has a bound of its own to get wrong: a comparison off by one here would write one entry past the end of a fixed-size typed array, which JavaScript silently ignores, leaving nothing a test could observe.
  words.set(Array.from({ length: nk }, (_unused, i) => readWord(key, 4 * i)));
  let rcon = 1;
  words.forEach((_word, i) => {
    if (i < nk) {
      return; // already the key's own word
    }
    let temp = words[i - 1]!;
    if (i % nk === 0) {
      temp = (subWord(rotWord(temp)) ^ (rcon << 24)) >>> 0;
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      temp = subWord(temp);
    }
    words[i] = (words[i - nk]! ^ temp) >>> 0;
  });
  return { words, rounds };
}

// One 32-bit word holds one four-byte column of the state, row 0 in the most significant byte (FIPS 197 3.4 lays the state out column by column, so a block's sixteen bytes read straight in as four big-endian words).
function packWord(
  row0: number,
  row1: number,
  row2: number,
  row3: number,
): number {
  return ((row0 << 24) | (row1 << 16) | (row2 << 8) | row3) >>> 0;
}

function rotateRight8(word: number): number {
  return ((word >>> 8) | (word << 24)) >>> 0;
}

// Table-driven rounds, FIPS 197's own transformations folded together. For a byte x at row 0 of a column, SubBytes then MixColumns contribute the column (02.s, s, s, 03.s) where s = SBOX[x] (5.1.3's matrix read down its first column), and the same byte one row lower contributes that column rotated down by a row, which is a rotation of the word by eight bits. So four 256-entry tables, each the previous one rotated, turn a round's SubBytes, ShiftRows and MixColumns into sixteen lookups and XORs, with ShiftRows being nothing more than which column each byte is fetched from. Inverse rounds are the same with INV_SBOX and the matrix {0e,09,0d,0b}'s first column (5.3.3). Built once at load from the S-boxes and gmul above, so the tables are FIPS 197's definitions evaluated, not constants typed in.
const { TE0, TE1, TE2, TE3, TD0, TD1, TD2, TD3 } = (() => {
  const te0 = new Uint32Array(256);
  const te1 = new Uint32Array(256);
  const te2 = new Uint32Array(256);
  const te3 = new Uint32Array(256);
  const td0 = new Uint32Array(256);
  const td1 = new Uint32Array(256);
  const td2 = new Uint32Array(256);
  const td3 = new Uint32Array(256);
  for (let x = 0; x < 256; x++) {
    const s = SBOX[x]!;
    te0[x] = packWord(gmul(s, 0x02), s, s, gmul(s, 0x03));
    te1[x] = rotateRight8(te0[x]!);
    te2[x] = rotateRight8(te1[x]!);
    te3[x] = rotateRight8(te2[x]!);
    const i = INV_SBOX[x]!;
    td0[x] = packWord(
      gmul(i, 0x0e),
      gmul(i, 0x09),
      gmul(i, 0x0d),
      gmul(i, 0x0b),
    );
    td1[x] = rotateRight8(td0[x]!);
    td2[x] = rotateRight8(td1[x]!);
    td3[x] = rotateRight8(td2[x]!);
  }
  return {
    TE0: te0,
    TE1: te1,
    TE2: te2,
    TE3: te3,
    TD0: td0,
    TD1: td1,
    TD2: td2,
    TD3: td3,
  };
})();

// FIPS 197 5.3.5's equivalent inverse cipher: decrypting with the same round structure as encryption needs the round keys taken in reverse order, with InvMixColumns applied to every one but the first and last. InvMixColumns of a key word is the inverse table set applied to its bytes after undoing SubBytes, since the tables above bake a SubBytes in.
function inverseKeyWords(expanded: ExpandedKey): Uint32Array {
  const { words, rounds } = expanded;
  // Uint32Array.from's own length is the source's, so there is no loop bound to be off by one: an extra iteration would only write past the end of a fixed-size typed array, which is silently ignored and so unobservable.
  return Uint32Array.from(words, (_word, index) => {
    const round = Math.floor(index / WORDS_PER_BLOCK);
    const column = index % WORDS_PER_BLOCK;
    const word = words[(rounds - round) * WORDS_PER_BLOCK + column]!;
    return round === 0 || round === rounds
      ? word
      : TD0[SBOX[word >>> 24]!]! ^
          TD1[SBOX[(word >>> 16) & 0xff]!]! ^
          TD2[SBOX[(word >>> 8) & 0xff]!]! ^
          TD3[SBOX[word & 0xff]!]!;
  });
}

function readWord(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return packWord(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

function writeWord(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
  word: number,
): void {
  bytes[offset] = word >>> 24;
  bytes[offset + 1] = (word >>> 16) & 0xff;
  bytes[offset + 2] = (word >>> 8) & 0xff;
  bytes[offset + 3] = word & 0xff;
}

// FIPS 197 5.1's Cipher on one block held as four column words, the result left in `out`. Round 0 is AddRoundKey alone; each middle round is the table lookups above followed by AddRoundKey; the last round has no MixColumns, so it substitutes and shifts by direct S-box lookups.
function encryptWords(
  key: ExpandedKey,
  a0: number,
  a1: number,
  a2: number,
  a3: number,
  out: Uint32Array,
): void {
  const rk = key.words;
  let s0 = a0 ^ rk[0]!;
  let s1 = a1 ^ rk[1]!;
  let s2 = a2 ^ rk[2]!;
  let s3 = a3 ^ rk[3]!;
  for (let round = 1; round < key.rounds; round++) {
    const at = round * WORDS_PER_BLOCK;
    const t0 =
      TE0[s0 >>> 24]! ^
      TE1[(s1 >>> 16) & 0xff]! ^
      TE2[(s2 >>> 8) & 0xff]! ^
      TE3[s3 & 0xff]! ^
      rk[at]!;
    const t1 =
      TE0[s1 >>> 24]! ^
      TE1[(s2 >>> 16) & 0xff]! ^
      TE2[(s3 >>> 8) & 0xff]! ^
      TE3[s0 & 0xff]! ^
      rk[at + 1]!;
    const t2 =
      TE0[s2 >>> 24]! ^
      TE1[(s3 >>> 16) & 0xff]! ^
      TE2[(s0 >>> 8) & 0xff]! ^
      TE3[s1 & 0xff]! ^
      rk[at + 2]!;
    const t3 =
      TE0[s3 >>> 24]! ^
      TE1[(s0 >>> 16) & 0xff]! ^
      TE2[(s1 >>> 8) & 0xff]! ^
      TE3[s2 & 0xff]! ^
      rk[at + 3]!;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    s3 = t3;
  }
  const at = key.rounds * WORDS_PER_BLOCK;
  out[0] =
    packWord(
      SBOX[s0 >>> 24]!,
      SBOX[(s1 >>> 16) & 0xff]!,
      SBOX[(s2 >>> 8) & 0xff]!,
      SBOX[s3 & 0xff]!,
    ) ^ rk[at]!;
  out[1] =
    packWord(
      SBOX[s1 >>> 24]!,
      SBOX[(s2 >>> 16) & 0xff]!,
      SBOX[(s3 >>> 8) & 0xff]!,
      SBOX[s0 & 0xff]!,
    ) ^ rk[at + 1]!;
  out[2] =
    packWord(
      SBOX[s2 >>> 24]!,
      SBOX[(s3 >>> 16) & 0xff]!,
      SBOX[(s0 >>> 8) & 0xff]!,
      SBOX[s1 & 0xff]!,
    ) ^ rk[at + 2]!;
  out[3] =
    packWord(
      SBOX[s3 >>> 24]!,
      SBOX[(s0 >>> 16) & 0xff]!,
      SBOX[(s1 >>> 8) & 0xff]!,
      SBOX[s2 & 0xff]!,
    ) ^ rk[at + 3]!;
}

// FIPS 197 5.3.5's equivalent inverse cipher on one block, given as `rk` the key words from inverseKeyWords. The mirror image of encryptWords: ShiftRows runs the other way, so each column takes its bytes from the columns to its left instead of its right.
function decryptWords(
  rk: Uint32Array,
  rounds: number,
  a0: number,
  a1: number,
  a2: number,
  a3: number,
  out: Uint32Array,
): void {
  let s0 = a0 ^ rk[0]!;
  let s1 = a1 ^ rk[1]!;
  let s2 = a2 ^ rk[2]!;
  let s3 = a3 ^ rk[3]!;
  for (let round = 1; round < rounds; round++) {
    const at = round * WORDS_PER_BLOCK;
    const t0 =
      TD0[s0 >>> 24]! ^
      TD1[(s3 >>> 16) & 0xff]! ^
      TD2[(s2 >>> 8) & 0xff]! ^
      TD3[s1 & 0xff]! ^
      rk[at]!;
    const t1 =
      TD0[s1 >>> 24]! ^
      TD1[(s0 >>> 16) & 0xff]! ^
      TD2[(s3 >>> 8) & 0xff]! ^
      TD3[s2 & 0xff]! ^
      rk[at + 1]!;
    const t2 =
      TD0[s2 >>> 24]! ^
      TD1[(s1 >>> 16) & 0xff]! ^
      TD2[(s0 >>> 8) & 0xff]! ^
      TD3[s3 & 0xff]! ^
      rk[at + 2]!;
    const t3 =
      TD0[s3 >>> 24]! ^
      TD1[(s2 >>> 16) & 0xff]! ^
      TD2[(s1 >>> 8) & 0xff]! ^
      TD3[s0 & 0xff]! ^
      rk[at + 3]!;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    s3 = t3;
  }
  const at = rounds * WORDS_PER_BLOCK;
  out[0] =
    packWord(
      INV_SBOX[s0 >>> 24]!,
      INV_SBOX[(s3 >>> 16) & 0xff]!,
      INV_SBOX[(s2 >>> 8) & 0xff]!,
      INV_SBOX[s1 & 0xff]!,
    ) ^ rk[at]!;
  out[1] =
    packWord(
      INV_SBOX[s1 >>> 24]!,
      INV_SBOX[(s0 >>> 16) & 0xff]!,
      INV_SBOX[(s3 >>> 8) & 0xff]!,
      INV_SBOX[s2 & 0xff]!,
    ) ^ rk[at + 1]!;
  out[2] =
    packWord(
      INV_SBOX[s2 >>> 24]!,
      INV_SBOX[(s1 >>> 16) & 0xff]!,
      INV_SBOX[(s0 >>> 8) & 0xff]!,
      INV_SBOX[s3 & 0xff]!,
    ) ^ rk[at + 2]!;
  out[3] =
    packWord(
      INV_SBOX[s3 >>> 24]!,
      INV_SBOX[(s2 >>> 16) & 0xff]!,
      INV_SBOX[(s1 >>> 8) & 0xff]!,
      INV_SBOX[s0 & 0xff]!,
    ) ^ rk[at + 3]!;
}

// A trailing partial block is dropped rather than zero-extended: a CBC ciphertext whose length is not a whole number of blocks is malformed, and inventing the missing bytes would silently manufacture plaintext
function wholeBlockCount(byteLength: number): number {
  return Math.floor(byteLength / AES_BLOCK_BYTES);
}

export function aesCbcDecrypt(
  key: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const expanded = expandKey(key);
  const inverseKey = inverseKeyWords(expanded);
  const blocks = wholeBlockCount(data.length);
  const out = new Uint8Array(blocks * AES_BLOCK_BYTES);
  const plain = new Uint32Array(WORDS_PER_BLOCK);
  let c0 = readWord(iv, 0);
  let c1 = readWord(iv, 4);
  let c2 = readWord(iv, 8);
  let c3 = readWord(iv, 12);
  // One callback per whole block through Array.from's own length, in block order (each block's chaining value is the previous ciphertext block), so there is no loop bound to be off by one: an extra pass would read past the input and write past the end of a fixed-size typed array, which is silently ignored and so unobservable.
  Array.from({ length: blocks }).forEach((_unused, b) => {
    const at = b * AES_BLOCK_BYTES;
    const x0 = readWord(data, at);
    const x1 = readWord(data, at + 4);
    const x2 = readWord(data, at + 8);
    const x3 = readWord(data, at + 12);
    decryptWords(inverseKey, expanded.rounds, x0, x1, x2, x3, plain);
    writeWord(out, at, plain[0]! ^ c0);
    writeWord(out, at + 4, plain[1]! ^ c1);
    writeWord(out, at + 8, plain[2]! ^ c2);
    writeWord(out, at + 12, plain[3]! ^ c3);
    c0 = x0;
    c1 = x1;
    c2 = x2;
    c3 = x3;
  });
  return out;
}

export function aesCbcEncrypt(
  key: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const expanded = expandKey(key);
  const blocks = wholeBlockCount(data.length);
  const out = new Uint8Array(blocks * AES_BLOCK_BYTES);
  const cipher = new Uint32Array(WORDS_PER_BLOCK);
  let c0 = readWord(iv, 0);
  let c1 = readWord(iv, 4);
  let c2 = readWord(iv, 8);
  let c3 = readWord(iv, 12);
  // As in aesCbcDecrypt: Array.from's own length drives the blocks, in order, because each block is chained to the previous ciphertext block.
  Array.from({ length: blocks }).forEach((_unused, b) => {
    const at = b * AES_BLOCK_BYTES;
    encryptWords(
      expanded,
      readWord(data, at) ^ c0,
      readWord(data, at + 4) ^ c1,
      readWord(data, at + 8) ^ c2,
      readWord(data, at + 12) ^ c3,
      cipher,
    );
    c0 = cipher[0]!;
    c1 = cipher[1]!;
    c2 = cipher[2]!;
    c3 = cipher[3]!;
    writeWord(out, at, c0);
    writeWord(out, at + 4, c1);
    writeWord(out, at + 8, c2);
    writeWord(out, at + 12, c3);
  });
  return out;
}
