import { describe, expect, it } from 'vitest';
import { compoundFile } from '../test-support/cfb';
import { CompoundFileFormatError, readCompoundFile } from './read';

// Coverage for the bounded [MS-CFB] reader (src/cfb/read.ts): header/sector-size parsing, DIFAT/FAT chain walking, the directory entry tree, stream extraction from both the FAT and the mini stream, and the guards. Fixtures come from src/test-support/cfb.ts -- a hand-built minimal compound-file writer whose construction is documented there -- because the reader under test consumes actual compound-file bytes (a hand-built in-memory model would skip the parse entirely).

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

describe('readCompoundFile', () => {
  it('extracts a FAT-resident stream larger than the mini-stream cutoff', () => {
    // 5000 bytes >= the 4096-byte cutoff, so the stream occupies whole sectors chained in the FAT -- the plain path every large stream takes.
    const payload = enc('X'.repeat(5000));
    const streams = readCompoundFile(compoundFile([{ path: 'BigStream', bytes: payload }]));
    expect(streams.map((s) => s.path)).toEqual(['BigStream']);
    expect(streams[0]?.bytes).toEqual(payload);
  });

  it('extracts a mini-stream-resident stream shorter than the cutoff, via the mini-FAT', () => {
    // 100 bytes < 4096, so the stream lives in the mini stream -- the root entry's own stream, carved into 64-byte mini sectors by the mini-FAT -- which is where a small real-world embed (an OLE-packaged file of a few kilobytes) genuinely lands.
    const payload = enc('mini stream payload');
    const streams = readCompoundFile(compoundFile([{ path: 'SmallStream', bytes: payload }]));
    expect(streams.map((s) => s.path)).toEqual(['SmallStream']);
    expect(streams[0]?.bytes).toEqual(payload);
  });

  it('mixes FAT-resident and mini-stream-resident streams in one file', () => {
    const small = enc('tiny');
    const large = enc('Y'.repeat(4096));
    const streams = readCompoundFile(compoundFile([
      { path: 'Large', bytes: large },
      { path: 'Small', bytes: small },
    ]));
    expect(streams.map((s) => s.path)).toEqual(['Large', 'Small']);
    expect(streams.find((s) => s.path === 'Small')?.bytes).toEqual(small);
    expect(streams.find((s) => s.path === 'Large')?.bytes).toEqual(large);
  });

  it('extracts both FAT- and mini-stream-resident streams from a version-4 file (4096-byte sectors)', () => {
    // Version 4 zero-pads the 512-byte header out to the full 4096-byte first sector ([MS-CFB] 2.2), so sector N starts at (N + 1) * 4096 -- an offset that only coincides with version 3's 512 + N * sectorSize because version 3's sector size is itself 512. Real-world .bin embeds written by 64-bit producers are version 4, so this is the layout the embedded-object recovery path genuinely meets.
    const small = enc('mini stream payload');
    const large = enc('V'.repeat(4096));
    const streams = readCompoundFile(compoundFile([
      { path: 'Large', bytes: large },
      { path: 'Small', bytes: small },
    ], { majorVersion: 4 }));
    expect(streams.map((s) => s.path)).toEqual(['Large', 'Small']);
    expect(streams.find((s) => s.path === 'Small')?.bytes).toEqual(small);
    expect(streams.find((s) => s.path === 'Large')?.bytes).toEqual(large);
  });

  it('derives slash-joined paths for streams nested inside storages', () => {
    const payload = enc('nested');
    const streams = readCompoundFile(compoundFile([
      { path: 'ObjectStorage/Package', bytes: payload },
      { path: 'Sibling', bytes: enc('root-level') },
    ]));
    expect(streams.map((s) => s.path)).toEqual(['ObjectStorage/Package', 'Sibling']);
    expect(streams[0]?.bytes).toEqual(payload);
  });

  it('extracts a FAT-resident stream whose size is not a whole multiple of the sector size, truncating to the declared size', () => {
    // 4500 bytes sits above the cutoff (FAT-resident) but needs 9 sectors = 4608 bytes of storage, so extraction must slice the chain's 4608 bytes back to 4500 -- trailing sector padding never becomes stream content. The mini-stream arm of the same truncation is covered by the small-stream tests (their payloads never fill their last 64-byte mini sector either).
    const payload = enc('Z'.repeat(4500));
    const streams = readCompoundFile(compoundFile([{ path: 'Partial', bytes: payload }]));
    expect(streams[0]?.bytes).toEqual(payload);
    expect(streams[0]?.bytes.length).toBe(4500);
  });

  it('returns an empty listing for a compound file with no streams', () => {
    expect(readCompoundFile(compoundFile([]))).toEqual([]);
  });
});

describe('readCompoundFile malformed-input handling', () => {
  // Every corrupt-structure case asserts the named error, never a partial listing: a compound file that fails any structural check fails whole, per the family's loud-failure policy (the same stance walkArchive takes with its guards).
  const expectFormatError = (bytes: Uint8Array<ArrayBuffer>): void => {
    try {
      readCompoundFile(bytes);
      throw new Error('expected readCompoundFile to throw CompoundFileFormatError');
    } catch (error) {
      expect(error).toBeInstanceOf(CompoundFileFormatError);
    }
  };

  it('throws for bytes without the compound-file signature', () => {
    expectFormatError(enc('not a compound file at all'));
  });

  it('throws for input shorter than the 512-byte header', () => {
    expectFormatError(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]));
  });

  it('throws for a header whose sector shift contradicts its major version', () => {
    const bytes = compoundFile([{ path: 'A', bytes: enc('x'.repeat(5000)) }]);
    bytes[0x1a] = 4; // major version 4 ...
    bytes[0x1e] = 9; // ... still declaring 512-byte sectors, which version 4 forbids
    expectFormatError(bytes);
  });

  it('throws for a big-endian byte-order field', () => {
    const bytes = compoundFile([{ path: 'A', bytes: enc('x'.repeat(5000)) }]);
    // The field holds FE FF (little-endian 0xFFFE); swapping to FF FE reads as 0xFEFF, the big-endian marker this reader refuses.
    bytes[0x1c] = 0xff;
    bytes[0x1d] = 0xfe;
    expectFormatError(bytes);
  });

  it('throws for a truncated file (sectors the header references are gone)', () => {
    const bytes = compoundFile([{ path: 'A', bytes: enc('x'.repeat(5000)) }]);
    expectFormatError(bytes.slice(0, 700));
  });

  it('throws for a DIFAT entry naming a sector outside the file', () => {
    const bytes = compoundFile([{ path: 'A', bytes: enc('x'.repeat(5000)) }]);
    const view = new DataView(bytes.buffer);
    view.setUint32(0x4c, 0x0000ff00, true); // header DIFAT[0] -> far beyond the file's sector count
    expectFormatError(bytes);
  });

  it('throws for a FAT chain that cycles', () => {
    const bytes = compoundFile([{ path: 'A', bytes: enc('x'.repeat(5000)) }]);
    // The stream's first data sector is sector 2 (FAT at 0, directory at 1); point its FAT entry back at itself so the chain never reaches ENDOFCHAIN.
    const view = new DataView(bytes.buffer);
    view.setUint32(512 + 2 * 4, 2, true);
    expectFormatError(bytes);
  });

  it('throws for a stream whose declared size exceeds its chain', () => {
    const bytes = compoundFile([{ path: 'A', bytes: enc('x'.repeat(5000)) }]);
    // Entry 1 is the stream; inflate its declared size to a figure no chain in this small file can fill.
    const view = new DataView(bytes.buffer);
    const entryOffset = 512 + 512 + 1 * 128; // header + FAT sector + directory sector, entry 1
    view.setUint32(entryOffset + 0x78, 0x00ffffff, true);
    expectFormatError(bytes);
  });

  it('throws for a directory tree whose sibling links cycle', () => {
    const bytes = compoundFile([
      { path: 'A', bytes: enc('x'.repeat(5000)) },
      { path: 'B', bytes: enc('y'.repeat(5000)) },
    ]);
    // Entries 1 (A) and 2 (B) are siblings chained 1 -> 2; point B's right sibling back at A.
    const view = new DataView(bytes.buffer);
    const entryOffset = (id: number) => 512 + 512 + id * 128;
    view.setUint32(entryOffset(2) + 0x48, 1, true);
    expectFormatError(bytes);
  });

  it('throws when the cumulative extracted size exceeds the configured budget', () => {
    // Two 5000-byte streams with a 6000-byte budget: the second extraction tips the cumulative total over, so the whole read fails rather than returning a partial listing -- the same stance archive-codec's ZIP walk takes on its guards, and for the same reason (a hostile FAT can alias one sector into many streams, multiplying extraction beyond the file's own size).
    const bytes = compoundFile([
      { path: 'A', bytes: enc('x'.repeat(5000)) },
      { path: 'B', bytes: enc('y'.repeat(5000)) },
    ]);
    expect(() => readCompoundFile(bytes, { maxTotalBytes: 6000 })).toThrowError(CompoundFileFormatError);
    // The same file under the default budget reads fine -- the guard fires on the budget, not on the structure.
    expect(readCompoundFile(bytes)).toHaveLength(2);
  });
});
