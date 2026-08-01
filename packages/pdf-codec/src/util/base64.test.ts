import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './base64';

describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips an empty byte array', () => {
    const bytes = new Uint8Array(0);
    expect(bytesToBase64(bytes)).toBe('');
    expect(base64ToBytes('')).toEqual(bytes);
  });

  it('round-trips a byte array not aligned to a multiple of three (two padding characters)', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const encoded = bytesToBase64(bytes);
    expect(encoded.endsWith('==')).toBe(true);
    expect(base64ToBytes(encoded)).toEqual(bytes);
  });

  it('round-trips a byte array not aligned to a multiple of three (one padding character)', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded = bytesToBase64(bytes);
    expect(encoded.endsWith('=')).toBe(true);
    expect(encoded.endsWith('==')).toBe(false);
    expect(base64ToBytes(encoded)).toEqual(bytes);
  });

  it('round-trips a byte array exactly aligned to a multiple of three (no padding)', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const encoded = bytesToBase64(bytes);
    expect(encoded.endsWith('=')).toBe(false);
    expect(base64ToBytes(encoded)).toEqual(bytes);
  });

  it('round-trips every byte value 0..255', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      bytes[i] = i;
    }
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('matches Node Buffer output for a known string', () => {
    const bytes = new TextEncoder().encode('the quick brown fox jumps over the lazy dog');
    const expected = Buffer.from(bytes).toString('base64');
    expect(bytesToBase64(bytes)).toBe(expected);
    expect(base64ToBytes(expected)).toEqual(bytes);
  });

  it('ignores whitespace and other non-alphabet characters when decoding', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const encoded = bytesToBase64(bytes);
    const withNoise = `${encoded.slice(0, 2)}\n ${encoded.slice(2)}`;
    expect(base64ToBytes(withNoise)).toEqual(bytes);
  });

  it('throws on a genuinely invalid character in the first two positions of a group', () => {
    expect(() => {
      base64ToBytes('!!==');
    }).toThrow('invalid base64 input');
  });
});
