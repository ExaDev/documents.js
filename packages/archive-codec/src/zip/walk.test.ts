import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { ArchiveWalkLimitError, MAX_WALK_DEPTH, MAX_WALK_TOTAL_BYTES, walkArchive } from './walk';
import { zipPackage } from './container';

const enc = new TextEncoder();

function entryByPath(entries: ReturnType<typeof walkArchive>, path: string, ancestors: readonly string[]) {
  return entries.find((e) => e.path === path && e.ancestors.join('/') === ancestors.join('/'));
}

// Invokes the walk, asserting it throws an ArchiveWalkLimitError and returning it for field-level checks.
function catchLimit(fn: () => unknown): ArchiveWalkLimitError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ArchiveWalkLimitError) return error;
    throw error;
  }
  throw new Error('expected walkArchive to throw ArchiveWalkLimitError');
}

// Wraps a text entry in `wrappers` nested one-entry archives. Walked from the returned archive, the innermost entry sits at depth wrappers + 1 behind ancestors level-0.zip .. level-(wrappers-1).zip.
function nestZip(wrappers: number): Uint8Array<ArrayBuffer> {
  let current: Uint8Array<ArrayBuffer> = zipSync({ 'innermost.txt': enc.encode('payload') });
  for (let i = 0; i < wrappers; i++) {
    current = zipSync({ [`level-${i}.zip`]: current });
  }
  return current;
}

describe('walkArchive', () => {
  it('lists every entry of a flat archive with no ancestors', () => {
    const bytes = zipSync({
      'a.txt': enc.encode('alpha'),
      'dir/b.txt': enc.encode('beta'),
    });
    const entries = walkArchive(bytes);
    expect(entries.map((e) => e.path).sort()).toEqual(['a.txt', 'dir/b.txt']);
    for (const entry of entries) {
      expect(entry.ancestors).toEqual([]);
    }
    expect(entryByPath(entries, 'a.txt', [])?.bytes).toEqual(enc.encode('alpha'));
  });

  it('descends into a ZIP-in-ZIP entry and reports the ancestor chain', () => {
    // The OOXML embedded-object shape this package exists for: an outer package carrying a genuinely separate ZIP blob at word/embeddings/oleObject1.xlsx.
    const embedded = zipSync({
      'xl/workbook.xml': enc.encode('<workbook/>'),
      '[Content_Types].xml': enc.encode('<types/>'),
    });
    const outer = zipSync({
      'word/document.xml': enc.encode('<doc/>'),
      'word/embeddings/oleObject1.xlsx': embedded,
    });
    const entries = walkArchive(outer);
    expect(entries).toHaveLength(4);
    expect(entryByPath(entries, 'word/document.xml', [])).toBeDefined();
    expect(entryByPath(entries, 'word/embeddings/oleObject1.xlsx', [])).toBeDefined();
    const inner1 = entryByPath(entries, 'xl/workbook.xml', ['word/embeddings/oleObject1.xlsx']);
    const inner2 = entryByPath(entries, '[Content_Types].xml', ['word/embeddings/oleObject1.xlsx']);
    expect(inner1?.bytes).toEqual(enc.encode('<workbook/>'));
    expect(inner2?.bytes).toEqual(enc.encode('<types/>'));
  });

  it('walks three levels of nesting, chaining ancestors outermost-first', () => {
    const innermost = zipSync({ 'META-INF/MANIFEST.MF': enc.encode('Manifest-Version: 1.0') });
    const middle = zipSync({ 'lib/nested.jar': innermost });
    const outer = zipSync({ 'app.war': middle, 'readme.txt': enc.encode('see also') });
    const entries = walkArchive(outer);
    const deep = entryByPath(entries, 'META-INF/MANIFEST.MF', ['app.war', 'lib/nested.jar']);
    expect(deep?.bytes).toEqual(enc.encode('Manifest-Version: 1.0'));
    expect(entryByPath(entries, 'lib/nested.jar', ['app.war'])).toBeDefined();
  });

  it('lists directory entries as zero-byte members of the listing', () => {
    const bytes = zipSync({ 'dir/': new Uint8Array(0), 'dir/file.txt': enc.encode('x') });
    const entries = walkArchive(bytes);
    const directory = entryByPath(entries, 'dir/', []);
    expect(directory?.bytes.length).toBe(0);
    expect(entryByPath(entries, 'dir/file.txt', [])).toBeDefined();
  });

  it('descends into an empty nested archive without listing anything from it', () => {
    const bytes = zipSync({ 'empty.zip': zipPackage([]) });
    const entries = walkArchive(bytes);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe('empty.zip');
  });

  it('throws for a root that is not a ZIP archive', () => {
    expect(() => walkArchive(enc.encode('plainly not an archive'))).toThrow(/not a ZIP archive/);
  });
});

describe('walkArchive depth guard', () => {
  it('accepts nesting exactly at MAX_WALK_DEPTH', () => {
    // The deepest entry sits at wrappers + 1, so one fewer wrapper than the cap puts it exactly at the cap.
    const bytes = nestZip(MAX_WALK_DEPTH - 1);
    const entries = walkArchive(bytes);
    expect(entries.filter((e) => e.path === 'innermost.txt')).toHaveLength(1);
  });

  it('throws ArchiveWalkLimitError(depth) one level past MAX_WALK_DEPTH', () => {
    const bytes = nestZip(MAX_WALK_DEPTH);
    const error = catchLimit(() => walkArchive(bytes));
    expect(error.limit).toBe('depth');
    expect(error.name).toBe('ArchiveWalkLimitError');
  });

  it('honours a tighter caller-supplied maxDepth', () => {
    const bytes = nestZip(2); // innermost at depth 3
    expect(walkArchive(bytes, { maxDepth: 3 })).toHaveLength(3);
    expect(catchLimit(() => walkArchive(bytes, { maxDepth: 2 })).limit).toBe('depth');
  });
});

describe('walkArchive cumulative-size guard', () => {
  it('throws ArchiveWalkLimitError(total-bytes) when a single archive overruns the budget', () => {
    const bytes = zipSync({
      'a.bin': new Uint8Array(600),
      'b.bin': new Uint8Array(600),
    });
    expect(catchLimit(() => walkArchive(bytes, { maxTotalBytes: 1000 })).limit).toBe('total-bytes');
  });

  it('counts decompressed bytes cumulatively across nesting levels, not per archive', () => {
    // Each level alone stays under the budget; only their sum crosses it -- this is the property byte-codec's per-stream cap cannot express.
    const inner = zipSync({ 'big-inner.txt': enc.encode('x'.repeat(600 * 1024)) });
    const outer = zipSync({
      'half.txt': enc.encode('x'.repeat(500 * 1024)),
      'nested.zip': inner,
    });
    expect(catchLimit(() => walkArchive(outer, { maxTotalBytes: 1024 * 1024 })).limit).toBe('total-bytes');
  });

  it('bounds a highly compressible entry by its decompressed size, not its compressed size', () => {
    // Four megabytes of one repeated character compress to a few kilobytes -- the zip-bomb shape. The budget counts what the walk actually decompresses.
    const bytes = zipSync({ 'zeros.txt': enc.encode('0'.repeat(4 * 1024 * 1024)) });
    expect(catchLimit(() => walkArchive(bytes, { maxTotalBytes: 1024 * 1024 })).limit).toBe('total-bytes');
  });

  it('accepts a walk landing exactly on the budget (the check is exclusive of the limit itself)', () => {
    const bytes = zipSync({ 'exact.txt': new Uint8Array(100) });
    const entries = walkArchive(bytes, { maxTotalBytes: 100 });
    expect(entries).toHaveLength(1);
  });
});

describe('walk guard defaults', () => {
  it('exposes derived default constants', () => {
    expect(MAX_WALK_DEPTH).toBe(8);
    expect(MAX_WALK_TOTAL_BYTES).toBe(512 * 1024 * 1024);
  });
});
