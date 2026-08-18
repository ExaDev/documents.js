import { describe, expect, it } from 'vitest';
import { documentPackageWithSchema } from 'document-schema.js';
import { paragraph, sectionGroup, wordprocessingPackage } from '../test-support/fixtures';
import { canonicalise, sha256, stableContentHash } from './hash';

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

describe('stableContentHash', () => {
  it('is order-insensitive over object keys at any depth', () => {
    expect(stableContentHash({ a: 1, b: { c: 2, d: 3 } })).toBe(stableContentHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('excludes $schema keys at any depth: a hash names the content, not the release label', () => {
    expect(stableContentHash({ $schema: 'https://example.test/package-4.0.0.json', a: 1 })).toBe(stableContentHash({ a: 1 }));
    expect(stableContentHash({ a: { $schema: 'https://example.test/package-4.0.0.json', b: 1 } })).toBe(
      stableContentHash({ a: { b: 1 } }),
    );
    // Only the label key is excluded -- a field merely named similarly still counts as content.
    expect(stableContentHash({ schema: 'x' })).not.toBe(stableContentHash({}));
  });

  it('hashes a serialised package identically with and without its $schema envelope label', () => {
    // documentPackageWithSchema is the schema's own serialisation helper: it stamps the release-pinned $schema URI onto a package. The same package, serialised against two different schema releases, must hash equal -- the exact reserialisation case the strip exists for.
    const pkg = wordprocessingPackage([sectionGroup([paragraph('body')])]);
    expect(stableContentHash(documentPackageWithSchema(pkg))).toBe(stableContentHash(pkg));
  });

  it('never mutates its input, $schema keys included', () => {
    const value = { $schema: 'https://example.test/package-4.0.0.json', a: { $schema: 'x', b: 1 } };
    stableContentHash(value);
    expect(value).toEqual({ $schema: 'https://example.test/package-4.0.0.json', a: { $schema: 'x', b: 1 } });
  });
});

describe('canonicalise', () => {
  it('sorts keys ascending by UTF-16 code unit and preserves array order', () => {
    expect(canonicalise({ b: 2, a: 1 })).toEqual({ a: 1, b: 2 });
    const nested = { z: [{ y: 1, x: 2 }] };
    expect(canonicalise(nested)).toEqual({ z: [{ x: 2, y: 1 }] });
    expect(canonicalise([3, 1, 2])).toEqual([3, 1, 2]);
  });
});
