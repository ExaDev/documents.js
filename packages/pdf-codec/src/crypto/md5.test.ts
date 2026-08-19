import { describe, expect, it } from 'vitest';
import { md5 } from './md5';

// RFC 1321 Appendix A.5's own "MD5 test suite", verbatim -- the published conformance vectors for this algorithm, so a transcription error in the T table or a wrong rotation amount fails here rather than silently producing plausible-looking garbage a PDF key derivation would then build on.

function hex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function digestOf(text: string): string {
  return hex(md5(new TextEncoder().encode(text)));
}

describe('md5: RFC 1321 test suite', () => {
  const vectors: readonly (readonly [string, string])[] = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
  ];

  for (const [input, expected] of vectors) {
    it(`hashes ${input === '' ? 'the empty string' : `"${input.slice(0, 24)}${input.length > 24 ? '..."' : '"'}`}`, () => {
      expect(digestOf(input)).toBe(expected);
    });
  }
});

describe('md5: block boundaries', () => {
  // 55/56/57 bytes bracket the exact point where the 8-byte length field no longer fits alongside the 0x80 terminator and padding spills into a second block -- the single most common place a hand-written padding routine goes wrong.
  const boundaries: readonly (readonly [number, string])[] = [
    [55, 'ef1772b6dff9a122358552954ad0df65'],
    [56, '3b0c8ac703f828b04c6c197006d17218'],
    [57, '652b906d60af96844ebd21b674f35e93'],
    [64, '014842d480b571495a4a0363793f7367'],
  ];

  for (const [length, expected] of boundaries) {
    it(`hashes ${String(length)} bytes of 'a' across the padding boundary`, () => {
      expect(digestOf('a'.repeat(length))).toBe(expected);
    });
  }

  it('returns a 16-byte digest', () => {
    expect(md5(new Uint8Array(0))).toHaveLength(16);
  });
});
