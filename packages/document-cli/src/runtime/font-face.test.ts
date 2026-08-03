import { describe, expect, it } from 'vitest';
import { FIXTURE_FONT_FAMILY, fixtureCalibriFontBytes, vendoredCaladeaFaceBytes } from '../test-support/font-fixture';
import { FontFaceError, describeFontFace } from './font-face';

// Asserted against genuine font files throughout, never against hand-built table bytes alone: the four vendored Caladea faces are real font-tool output (documents.js ships them to substitute for Cambria), so the family/bold/italic this reader recovers from them is checkable against what that font is actually known to be. The one synthesised input is the Calibri-named fixture, and only its 'name' table is synthesised -- which is the half this reader is being asked about.

const TABLE_DIRECTORY_HEADER_SIZE = 12;
const SFNT_VERSION_TRUETYPE = 0x00010000;

describe('describeFontFace', () => {
  it("reads the family from a real font's own 'name' table", () => {
    expect(describeFontFace(vendoredCaladeaFaceBytes({ bold: false, italic: false }), 'caladea.ttf')).toStrictEqual({ family: 'Caladea', bold: false, italic: false });
  });

  it("reads weight and slope from a real font's own 'OS/2' fsSelection, independently of its file name", () => {
    // Every one of the four faces is passed the identical `source` label, so nothing about the name a caller happened to give the file can be feeding these results.
    expect(describeFontFace(vendoredCaladeaFaceBytes({ bold: true, italic: false }), 'face.ttf')).toStrictEqual({ family: 'Caladea', bold: true, italic: false });
    expect(describeFontFace(vendoredCaladeaFaceBytes({ bold: false, italic: true }), 'face.ttf')).toStrictEqual({ family: 'Caladea', bold: false, italic: true });
    expect(describeFontFace(vendoredCaladeaFaceBytes({ bold: true, italic: true }), 'face.ttf')).toStrictEqual({ family: 'Caladea', bold: true, italic: true });
  });

  it("reads the replacement family from a font whose 'name' table was rewritten, proving the family is genuinely read rather than inferred from the outlines", () => {
    // Identical outline/metric bytes to the Caladea regular face above; only the 'name' table differs, so a reader that recovered "Caladea" here would be reading something other than the table it claims to.
    expect(describeFontFace(fixtureCalibriFontBytes(), 'calibri-fixture.ttf')).toStrictEqual({ family: FIXTURE_FONT_FAMILY, bold: false, italic: false });
  });

  it('names the offending file when the bytes are not a font at all', () => {
    const notAFont = new Uint8Array(new TextEncoder().encode('This is a plain text file, not a font.'));
    expect(() => describeFontFace(notAFont, '/tmp/notes.txt')).toThrow(FontFaceError);
    expect(() => describeFontFace(notAFont, '/tmp/notes.txt')).toThrow('/tmp/notes.txt is not a TrueType/OpenType font file');
  });

  it('rejects a TrueType Collection by name rather than reading its header as a table directory', () => {
    // 'ttcf' followed by a plausible version and face count -- a real .ttc's first bytes. Read as a single font's directory this would claim 0x0002_0000 tables; diagnosing the container instead is the whole point.
    const collection = new Uint8Array([0x74, 0x74, 0x63, 0x66, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02]);
    expect(() => describeFontFace(collection, 'Helvetica.ttc')).toThrow('Helvetica.ttc is a TrueType Collection');
  });

  it('reports a truncated file rather than reading past its end', () => {
    expect(() => describeFontFace(new Uint8Array([0x00, 0x01, 0x00]), 'truncated.ttf')).toThrow('truncated.ttf is too short to be a font file (3 bytes)');
  });

  it("reports a font whose directory declares more tables than the file can hold", () => {
    // A valid 0x00010000 sfnt version claiming 4096 tables in a 12-byte file: the directory header parses, the records cannot.
    const header = new Uint8Array(TABLE_DIRECTORY_HEADER_SIZE);
    const view = new DataView(header.buffer);
    view.setUint32(0, SFNT_VERSION_TRUETYPE);
    view.setUint16(4, 4096);
    expect(() => describeFontFace(header, 'lying.ttf')).toThrow('lying.ttf declares 4096 tables but is too short');
  });
});
