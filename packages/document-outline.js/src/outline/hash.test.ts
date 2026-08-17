import { describe, expect, it } from 'vitest';
import { sha256 } from './hash';

// The SHA-256 implementation is pinned against the specification's own published digests (FIPS 180-4 example vectors): the empty string exercises the single-block padding, 'abc' a short message, and the 55-character string forces exactly two padded blocks with the length word in the second -- the padding edge a hand-rolled implementation most easily gets wrong.
describe('sha256', () => {
  const digest = (text: string): string => {
    const bytes = new TextEncoder().encode(text);
    return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  };

  it('matches the FIPS 180-4 vectors', () => {
    expect(digest('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(digest('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(digest('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
});
