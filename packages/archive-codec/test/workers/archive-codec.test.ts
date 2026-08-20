import { describe, expect, it } from 'vitest';
import {
  ArchiveWalkLimitError,
  detectArchiveFormat,
  isZipArchive,
  unzipPackage,
  zipPackage,
  walkArchive,
} from '../../src';

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
});
