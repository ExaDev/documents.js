import { describe, expect, it } from 'vitest';
import {
  ArchiveWalkLimitError,
  CompoundFileFormatError,
  CompoundFileWriteError,
  detectArchiveFormat,
  isCompoundFile,
  isZipArchive,
  readCompoundFile,
  readOlePackage,
  unzipPackage,
  writeCompoundFile,
  zipPackage,
  walkArchive,
} from '../../src';
import { compoundFile } from '../../src/test-support/cfb';

const encode = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

// Proves archive-codec's surface executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. Every path here -- ZIP container read/write, magic-byte detection, recursive walking with depth/size guards -- is deliberately Node-free (fflate is pure JS and the byte readers are plain integer folds); if any touched node:fs/Buffer/process the workerd isolate would throw rather than these passing. This is the runtime complement to attw's static module-resolution check.
describe('archive-codec under the Cloudflare Workers runtime', () => {
  it('round-trips a ZIP container (no Node Buffer, no fs)', () => {
    const enc = new TextEncoder();
    const bytes = zipPackage([
      ['mimetype', { bytes: enc.encode('application/x-test'), stored: true }],
      ['content.xml', { bytes: enc.encode('<doc>'.repeat(64)) }],
    ]);
    const unzipped = unzipPackage(bytes);
    expect(unzipped['content.xml']).toEqual(enc.encode('<doc>'.repeat(64)));
  });

  it('detects zip vs unknown from magic bytes', () => {
    const enc = new TextEncoder();
    expect(isZipArchive(zipPackage([]))).toBe(true);
    expect(detectArchiveFormat(enc.encode('not an archive'))).toBe('unknown');
  });

  it('walks a ZIP-in-ZIP with ancestor chains inside the isolate', () => {
    const enc = new TextEncoder();
    const embedded = zipPackage([['xl/workbook.xml', { bytes: enc.encode('<workbook/>') }]]);
    const outer = zipPackage([
      ['word/document.xml', { bytes: enc.encode('<doc/>') }],
      ['word/embeddings/oleObject1.xlsx', { bytes: embedded }],
    ]);
    const entries = walkArchive(outer);
    expect(entries).toHaveLength(3);
    const inner = entries.find((e) => e.path === 'xl/workbook.xml');
    expect(inner?.ancestors).toEqual(['word/embeddings/oleObject1.xlsx']);
  });

  it('enforces the walk guards inside the isolate', () => {
    const enc = new TextEncoder();
    const bomb = zipPackage([['zeros.txt', { bytes: enc.encode('0'.repeat(1024 * 1024)) }]]);
    try {
      walkArchive(bomb, { maxTotalBytes: 4096 });
      throw new Error('expected the workers walk to throw ArchiveWalkLimitError');
    } catch (error) {
      expect(error).toBeInstanceOf(ArchiveWalkLimitError);
      expect((error as ArchiveWalkLimitError).limit).toBe('total-bytes');
    }
  });

  it('reads a compound file and its OLE Package stream inside the isolate', () => {
    // The CFB path (magic detection, header/FAT/mini-FAT/directory parsing, Package-stream unwrapping) is pure integer-and-DataView work over the bytes -- the whole reason it belongs in this Worker-isomorphic package -- and this proves it executes under workerd with the test-support builder (itself TextEncoder-only) on the path. The Package stream is assembled here with its fixed field run: header word, label, source path, 8 opaque bytes, temp path, size, file bytes.
    const enc = new TextEncoder();
    const fileBytes = zipPackage([['xl/workbook.xml', { bytes: enc.encode('<workbook/>') }]]);
    const label = 'Book1.xlsx';
    const parts = [new Uint8Array([0x02, 0x00]), encode(`${label}\0`), encode('C:\\Book1.xlsx\0'), new Uint8Array(8), encode('C:\\temp\\Book1.xlsx\0'), new Uint8Array(4), fileBytes];
    const packageStream = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      packageStream.set(part, offset);
      offset += part.length;
    }
    new DataView(packageStream.buffer).setUint32(packageStream.length - fileBytes.length - 4, fileBytes.length, true);
    const cfb = compoundFile([{ path: 'Package', bytes: packageStream }]);
    expect(isCompoundFile(cfb)).toBe(true);
    expect(detectArchiveFormat(cfb)).toBe('cfb');
    const streams = readCompoundFile(cfb);
    expect(streams.map((s) => s.path)).toEqual(['Package']);
    const unwrapped = readOlePackage(streams[0]?.bytes ?? new Uint8Array(0));
    expect(unwrapped.label).toBe(label);
    expect(unwrapped.fileBytes).toEqual(fileBytes);
  });

  it('writes a compound file and reads it back inside the isolate', () => {
    // The writer is the same kind of pure integer-and-DataView work over one allocation the reader is -- one Uint8Array, one DataView, no Buffer and no fs -- so it belongs to this package's Worker-isomorphic half too. Both allocation paths run here: 'Current User' is under the 4096-byte cutoff so it lands in the mini stream, 'PowerPoint Document' above it so it takes FAT-chained sectors, and a nested storage covers the directory tree's second level.
    const currentUser = encode('a small stream, mini-FAT resident');
    const document = new Uint8Array(9000).fill(0x50);
    const built = writeCompoundFile([
      { path: 'PowerPoint Document', bytes: document },
      { path: 'Current User', bytes: currentUser },
      { path: 'ObjectPool/Package', bytes: encode('nested') },
    ]);
    expect(isCompoundFile(built)).toBe(true);
    expect(detectArchiveFormat(built)).toBe('cfb');
    const streams = readCompoundFile(built);
    expect(streams.map((s) => s.path).sort()).toEqual(['Current User', 'ObjectPool/Package', 'PowerPoint Document']);
    expect(streams.find((s) => s.path === 'Current User')?.bytes).toEqual(currentUser);
    expect(streams.find((s) => s.path === 'PowerPoint Document')?.bytes).toEqual(document);
  });

  it('throws the named write error inside the isolate for a request that cannot be written', () => {
    expect(() => writeCompoundFile([{ path: 'bad:name', bytes: encode('x') }])).toThrow(CompoundFileWriteError);
  });

  it('throws the named compound-file error inside the isolate for corrupt structure', () => {
    const bytes = compoundFile([{ path: 'A', bytes: encode('x'.repeat(4500)) }]);
    const view = new DataView(bytes.buffer);
    view.setUint32(512 + 2 * 4, 2, true); // the stream's first data sector points at itself: a cyclic FAT chain
    expect(() => readCompoundFile(bytes)).toThrow(CompoundFileFormatError);
  });
});
