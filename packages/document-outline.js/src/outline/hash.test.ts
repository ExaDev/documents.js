import { describe, expect, it } from 'vitest';
import { documentTreeWithSchema } from 'document-schema.js';
import { paragraph, sectionGroup, wordprocessingPackage } from '../test-support/fixtures';
import { canonicalise, contentHashV1, sha256, stableContentHash } from './hash';

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
    // documentTreeWithSchema is the schema's own serialisation helper: it stamps the release-pinned $schema URI onto a package. The same package, serialised against two different schema releases, must hash equal -- the exact reserialisation case the strip exists for.
    const pkg = wordprocessingPackage([sectionGroup([paragraph('body')])]);
    expect(stableContentHash(documentTreeWithSchema(pkg))).toBe(stableContentHash(pkg));
  });

  it('never mutates its input, $schema keys included', () => {
    const value = { $schema: 'https://example.test/package-4.0.0.json', a: { $schema: 'x', b: 1 } };
    stableContentHash(value);
    expect(value).toEqual({ $schema: 'https://example.test/package-4.0.0.json', a: { $schema: 'x', b: 1 } });
  });
});

// ExaDev/documents.js#660's refinement 2: an explicitly versioned name for the same recipe, so a future change to the recipe ships as contentHashV2 rather than a silent change to what this name produces.
describe('contentHashV1', () => {
  it('is exactly stableContentHash, not a second implementation', () => {
    expect(contentHashV1({ a: 1, b: [2, 3] })).toBe(stableContentHash({ a: 1, b: [2, 3] }));
    expect(contentHashV1).toBe(stableContentHash);
  });

  it('regression: hashes semantically identical content the same across additively-compatible shapes, simulating two document-schema.js releases that agree on meaning but differ at the margins', () => {
    // An optional field explicitly set to undefined and the same field omitted entirely both mean "absent" to every content schema in this family (JSON.stringify drops undefined-valued properties either way) -- exactly the kind of additive, non-breaking difference a minor document-schema.js release could introduce (a new optional field older data simply never set) without the hash changing for pre-existing content.
    const withExplicitUndefined = { kind: 'paragraph', runs: [{ text: 'Hello.' }], styleId: undefined };
    const withOmittedField = { kind: 'paragraph', runs: [{ text: 'Hello.' }] };
    expect(contentHashV1(withExplicitUndefined)).toBe(contentHashV1(withOmittedField));

    // The same equivalence nested inside a tree-shaped value, matching how a real DocumentTree carries these fields several levels deep.
    const nestedA = { section: { pageSize: { widthPt: 595, heightPt: 842 }, style: undefined }, children: [] };
    const nestedB = { section: { pageSize: { widthPt: 595, heightPt: 842 } }, children: [] };
    expect(contentHashV1(nestedA)).toBe(contentHashV1(nestedB));
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
