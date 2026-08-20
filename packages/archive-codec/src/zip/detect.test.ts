import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { detectArchiveFormat, isZipArchive } from './detect';
import { zipPackage } from './container';

describe('isZipArchive', () => {
  it('recognises a real archive produced by fflate', () => {
    const enc = new TextEncoder();
    expect(isZipArchive(zipSync({ 'a.txt': enc.encode('a') }))).toBe(true);
  });

  it('recognises an empty archive (end-of-central-directory magic only)', () => {
    expect(isZipArchive(zipPackage([]))).toBe(true);
  });

  it('rejects plain text', () => {
    expect(isZipArchive(new TextEncoder().encode('PK is mentioned here but this is not an archive'))).toBe(false);
  });

  it('rejects gzip and tar leading bytes as unknown, not as zip', () => {
    // gzip members start 0x1f 0x8b; a tar archive starts with a 512-byte header block whose typical tail bytes are "ustar". Both are out of scope for v1 and must never report 'zip'.
    const gzip = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const tar = new Uint8Array(512);
    tar.set(new TextEncoder().encode('ustar'), 257);
    expect(isZipArchive(gzip)).toBe(false);
    expect(isZipArchive(tar)).toBe(false);
  });

  it('rejects truncated magic without throwing', () => {
    expect(isZipArchive(new Uint8Array([]))).toBe(false);
    expect(isZipArchive(new Uint8Array([0x50]))).toBe(false);
    expect(isZipArchive(new Uint8Array([0x50, 0x4b, 0x03]))).toBe(false);
  });
});

describe('detectArchiveFormat', () => {
  it('reports zip for a real archive', () => {
    expect(detectArchiveFormat(zipSync({}))).toBe('zip');
  });

  it('reports unknown for non-archive bytes', () => {
    expect(detectArchiveFormat(new Uint8Array([0, 1, 2, 3]))).toBe('unknown');
  });
});
