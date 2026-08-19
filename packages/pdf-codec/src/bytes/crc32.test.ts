import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32';

describe('crc32', () => {
  it('matches the empty-input identity', () => {
    expect(crc32(new Uint8Array([]))).toBe(0x00000000);
  });

  it('matches the standard CRC-32/ISO-HDLC check value for "123456789"', () => {
    // The canonical check value published for this exact algorithm (poly 0xEDB88320, the same one ZIP and PNG use), reproduced in every CRC-32 reference table (e.g. reveng's catalogue).
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('matches a second well-known reference value', () => {
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('is sensitive to every byte -- a single-bit change changes the result', () => {
    const a = crc32(new TextEncoder().encode('abcdef'));
    const b = crc32(new TextEncoder().encode('abcdeg'));
    expect(a).not.toBe(b);
  });
});
