import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256, sha384, sha512 } from "./sha2";

// FIPS 180-4's own published example vectors (and the NIST "Examples" appendix ones for the multi-block cases). These check the round-constant tables above all: SHA-256's constants are derived here from SHA-512's own table rather than transcribed separately, so a single wrong entry would break both hashes at once and show up in every vector below.

function hex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const ABC = "abc";
// FIPS 180-4's own two-block example message for the 512-bit family.
const TWO_BLOCK =
  "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu";
// FIPS 180-4's own two-block example message for the 256-bit family.
const TWO_BLOCK_256 =
  "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";

function digest(
  hash: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>,
  text: string,
): string {
  return hex(hash(new TextEncoder().encode(text)));
}

describe("sha256", () => {
  it('matches FIPS 180-4 for "abc"', () => {
    expect(digest(sha256, ABC)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches FIPS 180-4 for the empty message", () => {
    expect(digest(sha256, "")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches FIPS 180-4 for a message spanning two blocks", () => {
    expect(digest(sha256, TWO_BLOCK_256)).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  // 55/56/57 bytes bracket the point where the 8-byte length field stops fitting in the same block as the 0x80 terminator.
  it("pads correctly either side of the 56-byte block boundary", () => {
    expect(digest(sha256, "a".repeat(55))).toBe(
      "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
    );
    expect(digest(sha256, "a".repeat(56))).toBe(
      "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
    );
    expect(digest(sha256, "a".repeat(57))).toBe(
      "f13b2d724659eb3bf47f2dd6af1accc87b81f09f59f2b75e5c0bed6589dfe8c6",
    );
  });
});

describe("sha384", () => {
  it('matches FIPS 180-4 for "abc"', () => {
    expect(digest(sha384, ABC)).toBe(
      "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
    );
  });

  it("matches FIPS 180-4 for a message spanning two blocks", () => {
    expect(digest(sha384, TWO_BLOCK)).toBe(
      "09330c33f71147e83d192fc782cd1b4753111b173b3b05d22fa08086e3b0f712fcc7c71a557e2db966c3e9fa91746039",
    );
  });

  it("truncates to 48 bytes", () => {
    expect(sha384(new Uint8Array(0))).toHaveLength(48);
  });
});

describe("sha512", () => {
  it('matches FIPS 180-4 for "abc"', () => {
    expect(digest(sha512, ABC)).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
  });

  it("matches FIPS 180-4 for a message spanning two blocks", () => {
    expect(digest(sha512, TWO_BLOCK)).toBe(
      "8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909",
    );
  });

  // The 512-bit family uses 128-byte blocks and a 16-byte length field, so its own padding boundary sits at 112, not 56.
  it("pads correctly either side of the 112-byte block boundary", () => {
    expect(digest(sha512, "a".repeat(111))).toBe(
      "fa9121c7b32b9e01733d034cfc78cbf67f926c7ed83e82200ef86818196921760b4beff48404df811b953828274461673c68d04e297b0eb7b2b4d60fc6b566a2",
    );
    expect(digest(sha512, "a".repeat(112))).toBe(
      "c01d080efd492776a1c43bd23dd99d0a2e626d481e16782e75d54c2503b5dc32bd05f0f1ba33e568b88fd2d970929b719ecbb152f58f130a407c8830604b70ca",
    );
    expect(digest(sha512, "a".repeat(113))).toBe(
      "55ddd8ac210a6e18ba1ee055af84c966e0dbff091c43580ae1be703bdb85da31acf6948cf5bd90c55a20e5450f22fb89bd8d0085e39f85a86cc46abbca75e24d",
    );
  });
});

// The reference below is the SHA-384/512 construction the implementation under test is held to: FIPS 180-4 6.4 written with BigInt, one operation per line, as slow and as direct as it can be. Its round constants and initial states are derived here from their definitions (the first 64 bits of the fractional parts of the cube roots and square roots of the first primes) with exact integer roots, not copied from the implementation, so agreement is between two separately built constructions and with Node's own hashes.
const MASK64 = 0xffffffffffffffffn;

function integerRoot(value: bigint, degree: bigint): bigint {
  let low = 0n;
  let high =
    1n << ((BigInt(value.toString(2).length) + degree - 1n) / degree + 1n);
  while (low < high) {
    const middle = (low + high + 1n) >> 1n;
    if (middle ** degree <= value) low = middle;
    else high = middle - 1n;
  }
  return low;
}

const FIRST_PRIMES = (() => {
  const primes: number[] = [];
  for (let candidate = 2; primes.length < 80; candidate += 1) {
    if (primes.every((prime) => candidate % prime !== 0))
      primes.push(candidate);
  }
  return primes;
})();

// The fractional part's first 64 bits: floor(root * 2^64) modulo 2^64, taken by rooting the prime scaled by 2^(64 * degree).
const REFERENCE_K = FIRST_PRIMES.map(
  (prime) => integerRoot(BigInt(prime) << 192n, 3n) & MASK64,
);
const REFERENCE_H512 = FIRST_PRIMES.slice(0, 8).map(
  (prime) => integerRoot(BigInt(prime) << 128n, 2n) & MASK64,
);
const REFERENCE_H384 = FIRST_PRIMES.slice(8, 16).map(
  (prime) => integerRoot(BigInt(prime) << 128n, 2n) & MASK64,
);

function referenceRotr(value: bigint, bits: bigint): bigint {
  return ((value >> bits) | (value << (64n - bits))) & MASK64;
}

function referenceSha512Family(
  message: Uint8Array,
  initial: readonly bigint[],
  outputBytes: number,
): Uint8Array<ArrayBuffer> {
  const bitLength = BigInt(message.length) * 8n;
  const paddedLength = Math.ceil((message.length + 1 + 16) / 128) * 128;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  for (let i = 0; i < 16; i += 1) {
    padded[paddedLength - 1 - i] = Number((bitLength >> BigInt(8 * i)) & 0xffn);
  }
  let state = [...initial];
  for (let offset = 0; offset < paddedLength; offset += 128) {
    const w: bigint[] = [];
    for (let t = 0; t < 16; t += 1) {
      let word = 0n;
      for (let i = 0; i < 8; i += 1) {
        word = (word << 8n) | BigInt(padded[offset + t * 8 + i]!);
      }
      w.push(word);
    }
    for (let t = 16; t < 80; t += 1) {
      const x = w[t - 15]!;
      const y = w[t - 2]!;
      const s0 = referenceRotr(x, 1n) ^ referenceRotr(x, 8n) ^ (x >> 7n);
      const s1 = referenceRotr(y, 19n) ^ referenceRotr(y, 61n) ^ (y >> 6n);
      w.push((w[t - 16]! + s0 + w[t - 7]! + s1) & MASK64);
    }
    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;
    for (let t = 0; t < 80; t += 1) {
      const bigS1 =
        referenceRotr(e, 14n) ^ referenceRotr(e, 18n) ^ referenceRotr(e, 41n);
      const ch = (e & f) ^ (~e & MASK64 & g);
      const t1 = (h + bigS1 + ch + REFERENCE_K[t]! + w[t]!) & MASK64;
      const bigS0 =
        referenceRotr(a, 28n) ^ referenceRotr(a, 34n) ^ referenceRotr(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (bigS0 + maj) & MASK64;
      h = g;
      g = f;
      f = e;
      e = (d + t1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) & MASK64;
    }
    state = state.map(
      (word, i) => (word + [a, b, c, d, e, f, g, h][i]!) & MASK64,
    );
  }
  const digest = new Uint8Array(64);
  state.forEach((word, i) => {
    for (let j = 0; j < 8; j += 1) {
      digest[i * 8 + j] = Number((word >> BigInt(56 - 8 * j)) & 0xffn);
    }
  });
  return digest.subarray(0, outputBytes);
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

function nodeDigest(
  algorithm: "sha384" | "sha512",
  message: Uint8Array,
): Uint8Array {
  return Uint8Array.from(createHash(algorithm).update(message).digest());
}

describe("the reference construction itself", () => {
  it("reproduces the published SHA-512 and SHA-384 digest of 'abc', so the derived constants are right", () => {
    const abc = new TextEncoder().encode("abc");
    expect(hex(referenceSha512Family(abc, REFERENCE_H512, 64))).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
    expect(hex(referenceSha512Family(abc, REFERENCE_H384, 48))).toBe(
      "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
    );
  });
});

describe("sha384 and sha512 against independent implementations", () => {
  // Either side of every place the padding changes shape: the 0x80 terminator and 16-byte length field stop fitting in the last block at 112 bytes, and a whole extra block starts at 128.
  const lengths = [
    0, 1, 2, 3, 7, 8, 9, 63, 64, 65, 111, 112, 113, 119, 120, 121, 127, 128,
    129, 239, 240, 241, 255, 256, 257, 383, 384, 385, 1000, 1024,
  ];

  it.each(lengths)(
    "matches the reference and Node's hashes for a %i-byte seeded message",
    (length) => {
      const message = seededBytes(length, length + 1);
      expect(sha512(message)).toEqual(
        referenceSha512Family(message, REFERENCE_H512, 64),
      );
      expect(sha512(message)).toEqual(nodeDigest("sha512", message));
      expect(sha384(message)).toEqual(
        referenceSha512Family(message, REFERENCE_H384, 48),
      );
      expect(sha384(message)).toEqual(nodeDigest("sha384", message));
    },
  );

  it("matches Node's hashes on messages of all zero bytes and all 0xff bytes, which exercise every carry and every mask", () => {
    for (const fill of [0x00, 0xff]) {
      const message = new Uint8Array(300).fill(fill);
      expect(sha512(message)).toEqual(nodeDigest("sha512", message));
      expect(sha384(message)).toEqual(nodeDigest("sha384", message));
    }
  });

  it("matches Node's hashes on a large seeded message", () => {
    const message = seededBytes(256 * 1024 + 5, 0x5eed);
    expect(sha512(message)).toEqual(nodeDigest("sha512", message));
    expect(sha384(message)).toEqual(nodeDigest("sha384", message));
  });

  it("does not read outside the view it is given", () => {
    const backing = seededBytes(400, 11);
    const view = backing.subarray(37, 37 + 150);
    expect(sha512(view)).toEqual(nodeDigest("sha512", view));
  });
});
