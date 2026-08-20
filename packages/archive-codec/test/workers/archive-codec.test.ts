import { describe, expect, it } from 'vitest';
import {
  ArchiveWalkLimitError,
  CompoundFileFormatError,
  detectArchiveFormat,
  isCompoundFile,
  isZipArchive,
  readCompoundFile,
  readOlePackage,
  unzipPackage,
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

  it('throws the named compound-file error inside the isolate for corrupt structure', () => {
    const bytes = compoundFile([{ path: 'A', bytes: encode('x'.repeat(4500)) }]);
    const view = new DataView(bytes.buffer);
    view.setUint32(512 + 2 * 4, 2, true); // the stream's first data sector points at itself: a cyclic FAT chain
    expect(() => readCompoundFile(bytes)).toThrowError(CompoundFileFormatError);
  });
});
