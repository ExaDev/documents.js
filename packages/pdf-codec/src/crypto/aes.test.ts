import { createCipheriv, createDecipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AES_BLOCK_BYTES, aesCbcDecrypt, aesCbcEncrypt } from "./aes";

// FIPS 197 Appendix C's own single-block known-answer vectors (reached here through CBC with an all-zero IV, which for one block is exactly ECB), and NIST SP 800-38A Appendix F.2's multi-block CBC vectors. Between them these pin the S-box construction, the key schedule for both key sizes this codec needs, MixColumns in both directions, and the CBC chaining itself.

function bytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function hex(data: Uint8Array<ArrayBuffer>): string {
  return Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
}

const ZERO_IV = new Uint8Array(AES_BLOCK_BYTES);

describe("aes: FIPS 197 Appendix C single-block vectors", () => {
  const PLAINTEXT = "00112233445566778899aabbccddeeff";

  it("encrypts and decrypts C.1 (AES-128)", () => {
    const key = bytes("000102030405060708090a0b0c0d0e0f");
    const cipher = aesCbcEncrypt(key, ZERO_IV, bytes(PLAINTEXT));
    expect(hex(cipher)).toBe("69c4e0d86a7b0430d8cdb78070b4c55a");
    expect(hex(aesCbcDecrypt(key, ZERO_IV, cipher))).toBe(PLAINTEXT);
  });

  it("encrypts and decrypts C.3 (AES-256)", () => {
    const key = bytes(
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    );
    const cipher = aesCbcEncrypt(key, ZERO_IV, bytes(PLAINTEXT));
    expect(hex(cipher)).toBe("8ea2b7ca516745bfeafc49904b496089");
    expect(hex(aesCbcDecrypt(key, ZERO_IV, cipher))).toBe(PLAINTEXT);
  });
});

describe("aes: NIST SP 800-38A CBC vectors", () => {
  const PLAINTEXT =
    "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710";
  const IV = bytes("000102030405060708090a0b0c0d0e0f");

  it("matches F.2.1/F.2.2 (AES-128-CBC)", () => {
    const key = bytes("2b7e151628aed2a6abf7158809cf4f3c");
    const cipher = aesCbcEncrypt(key, IV, bytes(PLAINTEXT));
    expect(hex(cipher)).toBe(
      "7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b273bed6b8e3c1743b7116e69e222295163ff1caa1681fac09120eca307586e1a7",
    );
    expect(hex(aesCbcDecrypt(key, IV, cipher))).toBe(PLAINTEXT);
  });

  it("matches F.2.5/F.2.6 (AES-256-CBC)", () => {
    const key = bytes(
      "603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4",
    );
    const cipher = aesCbcEncrypt(key, IV, bytes(PLAINTEXT));
    expect(hex(cipher)).toBe(
      "f58c4c04d6e5f1ba779eabfb5f7bfbd69cfc4e967edb808d679f777bc6702c7d39f23369a9d9bacfa530e26304231461b2eb05e2c39be9fcda6c19078c6a9d1b",
    );
    expect(hex(aesCbcDecrypt(key, IV, cipher))).toBe(PLAINTEXT);
  });
});

describe("aes: input handling", () => {
  it("rejects a key that is not one of the three standard sizes", () => {
    expect(() =>
      aesCbcEncrypt(
        new Uint8Array(20),
        ZERO_IV,
        new Uint8Array(AES_BLOCK_BYTES),
      ),
    ).toThrow(/16, 24, or 32 bytes/);
  });

  // A ciphertext that is not a whole number of blocks is malformed. Dropping the partial block is a deliberate choice over zero-extending it, which would invent plaintext that was never encrypted.
  it("drops a trailing partial block rather than inventing bytes for it", () => {
    const key = bytes("000102030405060708090a0b0c0d0e0f");
    expect(
      aesCbcDecrypt(key, ZERO_IV, new Uint8Array(AES_BLOCK_BYTES + 5)),
    ).toHaveLength(AES_BLOCK_BYTES);
    expect(aesCbcDecrypt(key, ZERO_IV, new Uint8Array(5))).toHaveLength(0);
  });
});

// The reference below is the straightforward FIPS 197 construction the implementation under test is held to: a flat 16-byte state, one function per transformation, and an S-box derived from its own definition (multiplicative inverse in GF(2^8) followed by the affine map) rather than shared with the implementation. It is slow on purpose. Nothing here imports from ./aes, so agreement is between two separately written constructions and with Node's own AES.
function referenceXtime(a: number): number {
  const doubled = a << 1;
  return (doubled & 0x100) !== 0 ? (doubled ^ 0x11b) & 0xff : doubled;
}

function referenceGmul(a: number, b: number): number {
  let product = 0;
  let left = a;
  let right = b;
  while (right !== 0) {
    if ((right & 1) !== 0) product ^= left;
    left = referenceXtime(left);
    right >>= 1;
  }
  return product & 0xff;
}

const REFERENCE_SBOXES = (() => {
  const sbox = new Uint8Array(256);
  const invSbox = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    let inverse = 0;
    for (let candidate = 1; candidate < 256 && value !== 0; candidate += 1) {
      if (referenceGmul(value, candidate) === 1) inverse = candidate;
    }
    const rotate = (bits: number): number =>
      ((inverse << bits) | (inverse >>> (8 - bits))) & 0xff;
    const substituted =
      (inverse ^ rotate(1) ^ rotate(2) ^ rotate(3) ^ rotate(4) ^ 0x63) & 0xff;
    sbox[value] = substituted;
    invSbox[substituted] = value;
  }
  return { sbox, invSbox };
})();

function referenceRoundKeys(key: Uint8Array): Uint8Array[] {
  const nk = key.length / 4;
  const rounds = nk + 6;
  const words: number[][] = [];
  for (let i = 0; i < nk; i += 1) {
    words.push([
      key[4 * i]!,
      key[4 * i + 1]!,
      key[4 * i + 2]!,
      key[4 * i + 3]!,
    ]);
  }
  let rcon = 1;
  for (let i = nk; i < 4 * (rounds + 1); i += 1) {
    let temp = [...words[i - 1]!];
    if (i % nk === 0) {
      temp = [temp[1]!, temp[2]!, temp[3]!, temp[0]!].map(
        (byte) => REFERENCE_SBOXES.sbox[byte]!,
      );
      temp[0] = temp[0]! ^ rcon;
      rcon = referenceXtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      temp = temp.map((byte) => REFERENCE_SBOXES.sbox[byte]!);
    }
    words.push(words[i - nk]!.map((byte, index) => byte ^ temp[index]!));
  }
  return Array.from({ length: rounds + 1 }, (_unused, round) =>
    Uint8Array.from(words.slice(4 * round, 4 * round + 4).flat()),
  );
}

function referenceMix(
  state: Uint8Array,
  matrix: readonly number[],
): Uint8Array {
  const out = new Uint8Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) {
        value ^= referenceGmul(
          state[4 * column + k]!,
          matrix[(k - row + 4) % 4]!,
        );
      }
      out[4 * column + row] = value;
    }
  }
  return out;
}

function referenceShift(state: Uint8Array, direction: 1 | -1): Uint8Array {
  const out = new Uint8Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      out[row + 4 * column] =
        state[row + 4 * ((column + direction * row + 16) % 4)]!;
    }
  }
  return out;
}

function referenceXor(a: Uint8Array, b: Uint8Array): Uint8Array {
  return a.map((byte, index) => byte ^ b[index]!);
}

function referenceEncryptBlock(
  block: Uint8Array,
  keys: Uint8Array[],
): Uint8Array {
  let state = referenceXor(block, keys[0]!);
  for (let round = 1; round < keys.length - 1; round += 1) {
    state = state.map((byte) => REFERENCE_SBOXES.sbox[byte]!);
    state = referenceMix(referenceShift(state, 1), [2, 3, 1, 1]);
    state = referenceXor(state, keys[round]!);
  }
  state = referenceShift(
    state.map((byte) => REFERENCE_SBOXES.sbox[byte]!),
    1,
  );
  return referenceXor(state, keys[keys.length - 1]!);
}

function referenceDecryptBlock(
  block: Uint8Array,
  keys: Uint8Array[],
): Uint8Array {
  let state = referenceXor(block, keys[keys.length - 1]!);
  for (let round = keys.length - 2; round >= 1; round -= 1) {
    state = referenceShift(state, -1).map(
      (byte) => REFERENCE_SBOXES.invSbox[byte]!,
    );
    state = referenceXor(state, keys[round]!);
    state = referenceMix(state, [14, 11, 13, 9]);
  }
  state = referenceShift(state, -1).map(
    (byte) => REFERENCE_SBOXES.invSbox[byte]!,
  );
  return referenceXor(state, keys[0]!);
}

function referenceCbc(
  direction: "encrypt" | "decrypt",
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const keys = referenceRoundKeys(key);
  const out = new Uint8Array(data.length);
  let chain: Uint8Array = Uint8Array.from(iv);
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = data.subarray(offset, offset + 16);
    if (direction === "encrypt") {
      chain = referenceEncryptBlock(referenceXor(block, chain), keys);
      out.set(chain, offset);
    } else {
      out.set(referenceXor(referenceDecryptBlock(block, keys), chain), offset);
      chain = Uint8Array.from(block);
    }
  }
  return out;
}

/** Deterministic pseudo-random bytes from Mulberry32, so a failing input reproduces exactly and no test depends on Math.random. */
function seededBytes(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    out[index] = (mixed ^ (mixed >>> 14)) & 0xff;
  }
  return out;
}

function nodeCbc(
  direction: "encrypt" | "decrypt",
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const algorithm = `aes-${String(key.length * 8)}-cbc`;
  const cipher =
    direction === "encrypt"
      ? createCipheriv(algorithm, key, iv)
      : createDecipheriv(algorithm, key, iv);
  cipher.setAutoPadding(false);
  return Uint8Array.from(Buffer.concat([cipher.update(data), cipher.final()]));
}

/** Byte-for-byte equality through hex strings: vitest's deep equality walks a typed array element by element, which costs milliseconds per kilobyte under coverage instrumentation, and this comparison runs many times over kilobyte-sized buffers. */
function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(Buffer.from(actual).toString("hex")).toBe(
    Buffer.from(expected).toString("hex"),
  );
}

describe("aes against independent implementations", () => {
  // Block counts chosen to include zero, one, an odd count, and enough blocks that a chaining mistake past the first few blocks shows.
  const blockCounts = [0, 1, 2, 3, 17, 64];

  it.each([16, 24, 32])(
    "matches Node's AES-CBC and the reference in both directions for a %i-byte key at every tested length",
    (keyLength) => {
      for (const blocks of blockCounts) {
        const key = seededBytes(keyLength, keyLength);
        const iv = seededBytes(16, blocks + 100);
        const data = seededBytes(blocks * 16, blocks + keyLength);
        const encrypted = aesCbcEncrypt(key, iv, data);
        expect(encrypted).toEqual(nodeCbc("encrypt", key, iv, data));
        expect(encrypted).toEqual(referenceCbc("encrypt", key, iv, data));
        const decrypted = aesCbcDecrypt(key, iv, data);
        expect(decrypted).toEqual(nodeCbc("decrypt", key, iv, data));
        expect(decrypted).toEqual(referenceCbc("decrypt", key, iv, data));
        expect(aesCbcDecrypt(key, iv, encrypted)).toEqual(data);
      }
    },
  );

  it("matches Node's AES-CBC on a 16 KiB buffer of random data", () => {
    const key = seededBytes(32, 7);
    const iv = seededBytes(16, 8);
    const data = seededBytes(16 * 1024, 9);
    const encrypted = aesCbcEncrypt(key, iv, data);
    expect(encrypted).toEqual(nodeCbc("encrypt", key, iv, data));
    expect(aesCbcDecrypt(key, iv, encrypted)).toEqual(data);
  });

  const SPREAD_VALUES = [0x00, 0x55, 0xaa, 0xff];
  const SPREAD_POSITIONS = [0, 7, 15];

  // Node's AES sees every byte value in every position (fast and native). The deliberately slow reference sees four values (both extremes and the two alternating-bit patterns) at the first, a middle and the last position, so the test stays well inside the default timeout on a slow, instrumented runner instead of needing one raised.
  it("matches Node's AES on every byte value in every position of a block, and the reference on a spread of them", () => {
    const key = seededBytes(16, 21);
    const iv = new Uint8Array(16);
    for (let position = 0; position < 16; position += 1) {
      const data = new Uint8Array(256 * 16);
      for (let value = 0; value < 256; value += 1) {
        data[value * 16 + position] = value;
      }
      expectSameBytes(
        aesCbcEncrypt(key, iv, data),
        nodeCbc("encrypt", key, iv, data),
      );
      expectSameBytes(
        aesCbcDecrypt(key, iv, data),
        nodeCbc("decrypt", key, iv, data),
      );
      if (SPREAD_POSITIONS.includes(position)) {
        const spread = new Uint8Array(SPREAD_VALUES.length * 16);
        SPREAD_VALUES.forEach((value, index) => {
          spread[index * 16 + position] = value;
        });
        expectSameBytes(
          aesCbcEncrypt(key, iv, spread),
          referenceCbc("encrypt", key, iv, spread),
        );
        expectSameBytes(
          aesCbcDecrypt(key, iv, spread),
          referenceCbc("decrypt", key, iv, spread),
        );
      }
    }
  });
});
