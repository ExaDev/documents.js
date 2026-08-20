import { describe, expect, it } from 'vitest';
import { OlePackageFormatError, readOlePackage } from './ole-package';

// Coverage for the OLE Package stream unwrapping (src/cfb/ole-package.ts): the [MS-OLEDS]-family packaging a Word/PowerPoint compound-file embed wraps the real file in before storing it as the 'Package' stream. Fixtures are built inline (the layout is a short run of length-prefixed fields) rather than through the compound-file writer, so the byte construction here is an independent spelling of the format the module must parse.

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

// The Package stream layout: a uint16 header word, the label and source path as null-terminated strings, 8 opaque bytes, the temp path as a null-terminated string, then the file's byte count and the file bytes themselves.
function packageStream(label: string, sourcePath: string, tempPath: string, fileBytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const zstring = (s: string): Uint8Array<ArrayBuffer> => enc(`${s}\0`);
  const parts = [new Uint8Array([0x02, 0x00]), zstring(label), zstring(sourcePath), new Uint8Array(8), zstring(tempPath), new Uint8Array(4), fileBytes];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  new DataView(out.buffer).setUint32(out.length - fileBytes.length - 4, fileBytes.length, true);
  return out;
}

describe('readOlePackage', () => {
  it('unwraps the packaged file bytes and the descriptive strings around them', () => {
    const fileBytes = enc('the real embedded file');
    const pkg = readOlePackage(packageStream('Book1.xlsx', 'C:\\data\\Book1.xlsx', 'C:\\users\\joe\\AppData\\Local\\Temp\\Book1.xlsx', fileBytes));
    expect(pkg.label).toBe('Book1.xlsx');
    expect(pkg.sourcePath).toBe('C:\\data\\Book1.xlsx');
    expect(pkg.tempPath).toBe('C:\\users\\joe\\AppData\\Local\\Temp\\Book1.xlsx');
    expect(pkg.fileBytes).toEqual(fileBytes);
  });

  it('ignores trailing bytes after the file data (the optional wide-string tail)', () => {
    // Real producers append wide-character repeats of the paths after the file bytes; the packaged file's extent is fixed by its declared size, so the tail is none of this reader's business.
    const wrapped = packageStream('a', 'b', 'c', enc('payload'));
    const withTail = new Uint8Array(wrapped.length + 6);
    withTail.set(wrapped);
    withTail.set(enc('tail!'), wrapped.length);
    expect(readOlePackage(withTail).fileBytes).toEqual(enc('payload'));
  });

  it('unwraps an empty packaged file', () => {
    const pkg = readOlePackage(packageStream('empty', '', '', new Uint8Array(0)));
    expect(pkg.fileBytes).toEqual(new Uint8Array(0));
  });

  it('throws OlePackageFormatError when a string never terminates', () => {
    const unterminated = enc('\x02\x00Book1.xlsx');
    try {
      readOlePackage(unterminated);
      throw new Error('expected readOlePackage to throw OlePackageFormatError');
    } catch (error) {
      expect(error).toBeInstanceOf(OlePackageFormatError);
    }
  });

  it('throws OlePackageFormatError when the declared file size exceeds the remaining bytes', () => {
    const wrapped = packageStream('a', 'b', 'c', enc('payload'));
    const view = new DataView(wrapped.buffer);
    view.setUint32(wrapped.length - 'payload'.length - 4, 0x00ffffff, true);
    expect(() => readOlePackage(wrapped)).toThrowError(OlePackageFormatError);
  });

  it('throws OlePackageFormatError for input too short to hold even the fixed fields', () => {
    expect(() => readOlePackage(new Uint8Array(3))).toThrowError(OlePackageFormatError);
  });
});
