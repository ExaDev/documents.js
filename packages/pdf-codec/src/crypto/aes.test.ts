import { describe, expect, it } from 'vitest';
import { AES_BLOCK_BYTES, aesCbcDecrypt, aesCbcEncrypt } from './aes';

// FIPS 197 Appendix C's own single-block known-answer vectors (reached here through CBC with an all-zero IV, which for one block is exactly ECB), and NIST SP 800-38A Appendix F.2's multi-block CBC vectors. Between them these pin the S-box construction, the key schedule for both key sizes this codec needs, MixColumns in both directions, and the CBC chaining itself.

function bytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function hex(data: Uint8Array<ArrayBuffer>): string {
  return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');
}

const ZERO_IV = new Uint8Array(AES_BLOCK_BYTES);

describe('aes: FIPS 197 Appendix C single-block vectors', () => {
  const PLAINTEXT = '00112233445566778899aabbccddeeff';

  it('encrypts and decrypts C.1 (AES-128)', () => {
    const key = bytes('000102030405060708090a0b0c0d0e0f');
    const cipher = aesCbcEncrypt(key, ZERO_IV, bytes(PLAINTEXT));
    expect(hex(cipher)).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
    expect(hex(aesCbcDecrypt(key, ZERO_IV, cipher))).toBe(PLAINTEXT);
  });

  it('encrypts and decrypts C.3 (AES-256)', () => {
    const key = bytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const cipher = aesCbcEncrypt(key, ZERO_IV, bytes(PLAINTEXT));
    expect(hex(cipher)).toBe('8ea2b7ca516745bfeafc49904b496089');
    expect(hex(aesCbcDecrypt(key, ZERO_IV, cipher))).toBe(PLAINTEXT);
  });
});

describe('aes: NIST SP 800-38A CBC vectors', () => {
  const PLAINTEXT = '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710';
  const IV = bytes('000102030405060708090a0b0c0d0e0f');

  it('matches F.2.1/F.2.2 (AES-128-CBC)', () => {
    const key = bytes('2b7e151628aed2a6abf7158809cf4f3c');
    const cipher = aesCbcEncrypt(key, IV, bytes(PLAINTEXT));
    expect(hex(cipher)).toBe('7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b273bed6b8e3c1743b7116e69e222295163ff1caa1681fac09120eca307586e1a7');
    expect(hex(aesCbcDecrypt(key, IV, cipher))).toBe(PLAINTEXT);
  });

  it('matches F.2.5/F.2.6 (AES-256-CBC)', () => {
    const key = bytes('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4');
    const cipher = aesCbcEncrypt(key, IV, bytes(PLAINTEXT));
    expect(hex(cipher)).toBe('f58c4c04d6e5f1ba779eabfb5f7bfbd69cfc4e967edb808d679f777bc6702c7d39f23369a9d9bacfa530e26304231461b2eb05e2c39be9fcda6c19078c6a9d1b');
    expect(hex(aesCbcDecrypt(key, IV, cipher))).toBe(PLAINTEXT);
  });
});

describe('aes: input handling', () => {
  it('rejects a key that is not one of the three standard sizes', () => {
    expect(() => aesCbcEncrypt(new Uint8Array(20), ZERO_IV, new Uint8Array(AES_BLOCK_BYTES))).toThrow(/16, 24, or 32 bytes/);
  });

  // A ciphertext that is not a whole number of blocks is malformed. Dropping the partial block is a deliberate choice over zero-extending it, which would invent plaintext that was never encrypted.
  it('drops a trailing partial block rather than inventing bytes for it', () => {
    const key = bytes('000102030405060708090a0b0c0d0e0f');
    expect(aesCbcDecrypt(key, ZERO_IV, new Uint8Array(AES_BLOCK_BYTES + 5))).toHaveLength(AES_BLOCK_BYTES);
    expect(aesCbcDecrypt(key, ZERO_IV, new Uint8Array(5))).toHaveLength(0);
  });
});
