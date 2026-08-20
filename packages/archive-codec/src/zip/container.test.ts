import { describe, expect, it } from 'vitest';
import { zipPackage, unzipPackage } from './container';
import { localFileHeaderNames, localHeaderCompressionMethod } from '../test-support/zip';

describe('zipPackage', () => {
  it('emits entries in the caller-supplied order, not sorted or hashed order', () => {
    const enc = new TextEncoder();
    const bytes = zipPackage([
      ['c/second.txt', { bytes: enc.encode('c') }],
      ['a/first.txt', { bytes: enc.encode('a') }],
      ['b/third.txt', { bytes: enc.encode('b') }],
    ]);
    expect(localFileHeaderNames(bytes)).toEqual(['c/second.txt', 'a/first.txt', 'b/third.txt']);
  });

  it('writes a stored entry with compression method 0 and a deflated entry with method 8', () => {
    const enc = new TextEncoder();
    const payload = enc.encode('mimetype: this part must be readable at a fixed offset');
    const bytes = zipPackage([
      ['mimetype', { bytes: payload, stored: true }],
      ['content.xml', { bytes: enc.encode('<doc/>') }],
    ]);
    expect(localHeaderCompressionMethod(bytes, 0)).toBe(0);
    expect(localHeaderCompressionMethod(bytes, 1)).toBe(8);
  });

  it('round-trips mixed stored and deflated entries through unzipPackage', () => {
    const enc = new TextEncoder();
    const stored = enc.encode('application/vnd.test');
    const deflated = enc.encode('compressible '.repeat(64));
    const bytes = zipPackage([
      ['mimetype', { bytes: stored, stored: true }],
      ['data.bin', { bytes: deflated }],
    ]);
    const unzipped = unzipPackage(bytes);
    expect(Object.keys(unzipped).sort()).toEqual(['data.bin', 'mimetype']);
    expect(unzipped['mimetype']).toEqual(stored);
    expect(unzipped['data.bin']).toEqual(deflated);
  });

  it('preserves byte-exact content for arbitrary binary payloads', () => {
    const binary = new Uint8Array(256);
    for (let i = 0; i < binary.length; i++) binary[i] = i;
    const bytes = zipPackage([['bin', { bytes: binary }]]);
    expect(unzipPackage(bytes)['bin']).toEqual(binary);
  });
});

describe('unzipPackage', () => {
  it('returns an empty record for an empty archive', () => {
    const bytes = zipPackage([]);
    expect(unzipPackage(bytes)).toEqual({});
  });
});
