import { describe, expect, it } from 'vitest';
import { rc4 } from './rc4';

// The RC4 test vectors published alongside the algorithm itself (and reproduced in RFC 6229's own introduction of the cipher), plus the involution property PDF decryption depends on: encrypting and decrypting are the same operation, so a round trip must return the input exactly.

function hex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

describe('rc4: published test vectors', () => {
  const vectors: readonly (readonly [string, string, string])[] = [
    ['Key', 'Plaintext', 'bbf316e8d940af0ad3'],
    ['Wiki', 'pedia', '1021bf0420'],
    ['Secret', 'Attack at dawn', '45a01f645fc35b383552544b9bf5'],
  ];

  for (const [key, plaintext, expected] of vectors) {
    it(`encrypts "${plaintext}" under key "${key}"`, () => {
      expect(hex(rc4(ascii(key), ascii(plaintext)))).toBe(expected);
    });
  }
});

describe('rc4: properties', () => {
  it('is its own inverse', () => {
    const key = ascii('a pdf file encryption key');
    const data = Uint8Array.from({ length: 300 }, (_unused, i) => (i * 7) & 0xff);
    expect(Array.from(rc4(key, rc4(key, data)))).toEqual(Array.from(data));
  });

  it('leaves the input untouched under a zero-length key, which has no keystream at all', () => {
    const data = Uint8Array.from([1, 2, 3]);
    expect(Array.from(rc4(new Uint8Array(0), data))).toEqual([1, 2, 3]);
  });

  it('produces output the same length as its input, including for an empty input', () => {
    expect(rc4(ascii('k'), new Uint8Array(0))).toHaveLength(0);
    expect(rc4(ascii('k'), new Uint8Array(17))).toHaveLength(17);
  });
});
