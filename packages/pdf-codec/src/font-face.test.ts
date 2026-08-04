import { describe, expect, it } from 'vitest';
import { FontFaceParseError, readFontFace } from './font-face';
import { caladeaItalicBytes, caladeaRegularBytes, carlitoBoldBytes, carlitoItalicBytes, carlitoRegularBytes } from './test-support/fonts';

const OS2_FS_SELECTION_BOLD = 0x0020;
const HEAD_MAC_STYLE_BOLD = 0x0001;
const HEAD_MAC_STYLE_ITALIC = 0x0002;

// A minimal, hand-built 'name' table -- the same record layout font-tables.test.ts's own buildFontWithNameTable uses (clause 5.2.7), factored here to return the bare table bytes so it can be combined with other synthetic tables via buildSfnt below.
function buildNameTableBytes(records: readonly { platformId: number; encodingId: number; nameId: number; text: string }[]): Uint8Array<ArrayBuffer> {
  const NAME_HEADER_SIZE = 6;
  const NAME_RECORD_SIZE = 12;
  const storageOffset = NAME_HEADER_SIZE + records.length * NAME_RECORD_SIZE;
  const encoded = records.map((record) => Uint8Array.from([...record.text].flatMap((character) => [character.charCodeAt(0) >> 8, character.charCodeAt(0) & 0xff])));
  const storageLength = encoded.reduce((total, bytes) => total + bytes.length, 0);
  const table = new Uint8Array(storageOffset + storageLength);
  const view = new DataView(table.buffer);
  view.setUint16(2, records.length);
  view.setUint16(4, storageOffset);
  let stringOffset = 0;
  records.forEach((record, index) => {
    const recordOffset = NAME_HEADER_SIZE + index * NAME_RECORD_SIZE;
    const encodedRecord = encoded[index]!;
    view.setUint16(recordOffset, record.platformId);
    view.setUint16(recordOffset + 2, record.encodingId);
    view.setUint16(recordOffset + 6, record.nameId);
    view.setUint16(recordOffset + 8, encodedRecord.length);
    view.setUint16(recordOffset + 10, stringOffset);
    table.set(encodedRecord, storageOffset + stringOffset);
    stringOffset += encodedRecord.length;
  });
  return table;
}

// A Windows/Unicode nameID-1 family record, the one shape every test below needs -- built through buildNameTableBytes so a synthetic font's family always resolves the same way real vendored fonts do.
function buildFamilyNameTableBytes(family: string): Uint8Array<ArrayBuffer> {
  return buildNameTableBytes([{ platformId: 3, encodingId: 1, nameId: 1, text: family }]);
}

// A minimal 'head' table (clause 5.2.2, 54 bytes): the magic number and a valid indexToLocFormat are required for font-tables.ts's parseHead to accept it at all; every other field is left at zero except macStyle, the one this suite exercises.
function buildHeadTableBytes(macStyle: number): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(54);
  const view = new DataView(table.buffer);
  view.setUint32(12, 0x5f0f3cf5);
  view.setUint16(18, 1000); // unitsPerEm
  view.setInt16(50, 0); // indexToLocFormat
  view.setUint16(44, macStyle);
  return table;
}

// A minimal version-0 'OS/2' table (clause 5.2.8, 78 bytes): only fsSelection is meaningful here.
function buildOs2TableBytes(fsSelection: number): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(78);
  new DataView(table.buffer).setUint16(62, fsSelection);
  return table;
}

// A real sfnt table directory (clause 4) wrapping whichever synthetic tables a test needs, in insertion order -- the general-purpose counterpart to font-tables.test.ts's own single-table buildFontWithNameTable.
function buildSfnt(tables: ReadonlyMap<string, Uint8Array<ArrayBuffer>>): Uint8Array<ArrayBuffer> {
  const DIRECTORY_HEADER_SIZE = 12;
  const RECORD_SIZE = 16;
  const entries = [...tables.entries()];
  const directorySize = DIRECTORY_HEADER_SIZE + entries.length * RECORD_SIZE;
  const totalLength = entries.reduce((total, [, bytes]) => total + bytes.length, directorySize);
  const font = new Uint8Array(totalLength);
  const view = new DataView(font.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, entries.length);
  let offset = directorySize;
  entries.forEach(([tag, bytes], index) => {
    const recordOffset = DIRECTORY_HEADER_SIZE + index * RECORD_SIZE;
    for (let i = 0; i < 4; i++) {
      font[recordOffset + i] = tag.charCodeAt(i);
    }
    view.setUint32(recordOffset + 8, offset);
    view.setUint32(recordOffset + 12, bytes.length);
    font.set(bytes, offset);
    offset += bytes.length;
  });
  return font;
}

describe('readFontFace on real vendored fonts', () => {
  it('reads Carlito Regular as an upright, non-bold face', () => {
    expect(readFontFace(carlitoRegularBytes(), 'Carlito-Regular.ttf')).toEqual({ family: 'Carlito', bold: false, italic: false });
  });

  it('reads Carlito Bold', () => {
    expect(readFontFace(carlitoBoldBytes(), 'Carlito-Bold.ttf')).toEqual({ family: 'Carlito', bold: true, italic: false });
  });

  it('reads Carlito Italic', () => {
    expect(readFontFace(carlitoItalicBytes(), 'Carlito-Italic.ttf')).toEqual({ family: 'Carlito', bold: false, italic: true });
  });

  it('reads Caladea Regular, a different vendored family with its own name table', () => {
    expect(readFontFace(caladeaRegularBytes(), 'Caladea-Regular.ttf')).toEqual({ family: 'Caladea', bold: false, italic: false });
  });

  it('reads Caladea Italic', () => {
    expect(readFontFace(caladeaItalicBytes(), 'Caladea-Italic.ttf')).toEqual({ family: 'Caladea', bold: false, italic: true });
  });
});

describe('readFontFace style-bit precedence', () => {
  it("falls back to 'head' macStyle when the font declares no 'OS/2' table at all", () => {
    const font = buildSfnt(
      new Map([
        ['name', buildFamilyNameTableBytes('MacOnly')],
        ['head', buildHeadTableBytes(HEAD_MAC_STYLE_BOLD | HEAD_MAC_STYLE_ITALIC)],
      ]),
    );
    expect(readFontFace(font, 'mac-only.ttf')).toEqual({ family: 'MacOnly', bold: true, italic: true });
  });

  it("reads a regular face's macStyle as neither bold nor italic", () => {
    const font = buildSfnt(
      new Map([
        ['name', buildFamilyNameTableBytes('MacOnlyRegular')],
        ['head', buildHeadTableBytes(0)],
      ]),
    );
    expect(readFontFace(font, 'mac-only-regular.ttf')).toEqual({ family: 'MacOnlyRegular', bold: false, italic: false });
  });

  it("prefers 'OS/2' fsSelection over 'head' macStyle when both tables are present and disagree", () => {
    const font = buildSfnt(
      new Map([
        ['name', buildFamilyNameTableBytes('Disagreement')],
        ['head', buildHeadTableBytes(HEAD_MAC_STYLE_BOLD)], // head says bold
        ['OS/2', buildOs2TableBytes(0)], // OS/2 says regular -- this is the one that must win
      ]),
    );
    expect(readFontFace(font, 'disagreement.ttf')).toEqual({ family: 'Disagreement', bold: false, italic: false });
  });

  it("reads 'OS/2' fsSelection directly when the font also carries a 'head' table", () => {
    const font = buildSfnt(
      new Map([
        ['name', buildFamilyNameTableBytes('BoldFromOs2')],
        ['head', buildHeadTableBytes(0)],
        ['OS/2', buildOs2TableBytes(OS2_FS_SELECTION_BOLD)],
      ]),
    );
    expect(readFontFace(font, 'bold-from-os2.ttf')).toEqual({ family: 'BoldFromOs2', bold: true, italic: false });
  });
});

describe('readFontFace error handling', () => {
  it('throws FontFaceParseError, naming the source, for bytes that are not a recognised sfnt container at all', () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(() => readFontFace(garbage, 'not-a-font.bin')).toThrow(FontFaceParseError);
    expect(() => readFontFace(garbage, 'not-a-font.bin')).toThrow(/not-a-font\.bin/);
  });

  it('gives a TrueType Collection its own actionable message rather than a generic parse failure', () => {
    const ttc = new Uint8Array(12);
    new DataView(ttc.buffer).setUint32(0, 0x74746366); // 'ttcf'
    expect(() => readFontFace(ttc, 'bundle.ttc')).toThrow(FontFaceParseError);
    expect(() => readFontFace(ttc, 'bundle.ttc')).toThrow(/TrueType Collection/);
  });

  it('throws when the font declares no usable family name in its own name table', () => {
    const font = buildSfnt(new Map([['head', buildHeadTableBytes(0)]]));
    expect(() => readFontFace(font, 'nameless.ttf')).toThrow(FontFaceParseError);
    expect(() => readFontFace(font, 'nameless.ttf')).toThrow(/family name/);
  });

  it("throws when the font has a family name but neither a readable 'OS/2' nor a readable 'head' table", () => {
    const font = buildSfnt(new Map([['name', buildFamilyNameTableBytes('NoStyleTables')]]));
    expect(() => readFontFace(font, 'no-style-tables.ttf')).toThrow(FontFaceParseError);
    expect(() => readFontFace(font, 'no-style-tables.ttf')).toThrow(/weight and slope/);
  });
});
