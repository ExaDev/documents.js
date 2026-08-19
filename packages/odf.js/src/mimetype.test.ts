import { describe, expect, it } from 'vitest';
import type { Package } from './model/package';
import { readMimetype, writeMimetype } from './mimetype';
import { MIMETYPE_PART } from './package-io/write';
import { encodePackage } from './codec';
import { assertMimetypeEntryLayout } from './test-support/zip';

function emptyPackage(): Package {
  return { parts: {} };
}

describe('readMimetype', () => {
  it('returns undefined when the package has no mimetype part', () => {
    expect(readMimetype(emptyPackage())).toBeUndefined();
  });

  it('returns undefined when the "mimetype" part exists but was parsed as XML rather than binary', () => {
    const pkg: Package = { parts: { [MIMETYPE_PART]: { kind: 'xml', nodes: [] } } };
    expect(readMimetype(pkg)).toBeUndefined();
  });

  it('reads back exactly what writeMimetype wrote', () => {
    const pkg = emptyPackage();
    writeMimetype(pkg, 'application/vnd.oasis.opendocument.text');
    expect(readMimetype(pkg)).toBe('application/vnd.oasis.opendocument.text');
  });
});

describe('writeMimetype', () => {
  it('replaces an existing mimetype part rather than appending a second one', () => {
    const pkg = emptyPackage();
    writeMimetype(pkg, 'application/vnd.oasis.opendocument.text');
    writeMimetype(pkg, 'application/vnd.oasis.opendocument.spreadsheet');
    expect(readMimetype(pkg)).toBe('application/vnd.oasis.opendocument.spreadsheet');
    expect(Object.keys(pkg.parts)).toEqual([MIMETYPE_PART]);
  });

  it('stores exactly the ASCII bytes of the media type -- no trailing newline, no BOM -- at the fixed offsets ODF pins for the first zip entry', () => {
    const pkg = emptyPackage();
    const mediaType = 'application/vnd.oasis.opendocument.presentation';
    writeMimetype(pkg, mediaType);
    const bytes = encodePackage(pkg);
    assertMimetypeEntryLayout(bytes, mediaType);
  });
});
