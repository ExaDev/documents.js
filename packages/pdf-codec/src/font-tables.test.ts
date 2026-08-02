import { describe, expect, it } from 'vitest';
import { parseHead, parseMaxp, parseName, parseOs2, parsePost } from './font-tables';
import type { SfntFont } from './sfnt';
import { parseSfnt } from './sfnt';
import { caladeaRegularBytes, carlitoBoldBytes, carlitoItalicBytes, carlitoRegularBytes } from './test-support/fonts';

// Every expected value below was read out of the real vendored .ttf files (assets/fonts/{carlito,caladea}/) by a standalone Node script walking the sfnt table directory with a bare DataView -- not by this package's own parsers -- so these are external cross-checks rather than this module's output asserted against itself.
function parse(bytes: Uint8Array<ArrayBuffer>): SfntFont {
  const font = parseSfnt(bytes);
  if (font === undefined) {
    throw new Error('vendored font failed to parse as an sfnt container');
  }
  return font;
}

const FS_SELECTION_ITALIC = 0x0001;
const FS_SELECTION_BOLD = 0x0020;
const FS_SELECTION_REGULAR = 0x0040;

describe('parseHead', () => {
  it('reads Carlito Regular: a 2048-unit design grid with a long loca index', () => {
    const head = parseHead(parse(carlitoRegularBytes()));
    expect(head).toBeDefined();
    expect(head!.unitsPerEm).toBe(2048);
    expect(head!.xMin).toBe(-1002);
    expect(head!.yMin).toBe(-529);
    expect(head!.xMax).toBe(2351);
    expect(head!.yMax).toBe(2078);
    expect(head!.indexToLocFormat).toBe(1);
    expect(head!.checkSumAdjustment).toBe(0xbadb455d);
  });

  it('reads Caladea Regular: a 1000-unit design grid with a short loca index', () => {
    const head = parseHead(parse(caladeaRegularBytes()));
    expect(head).toBeDefined();
    expect(head!.unitsPerEm).toBe(1000);
    expect(head!.xMin).toBe(-313);
    expect(head!.yMin).toBe(-222);
    expect(head!.xMax).toBe(1199);
    expect(head!.yMax).toBe(936);
    expect(head!.indexToLocFormat).toBe(0);
    expect(head!.checkSumAdjustment).toBe(0x08200720);
  });

  it('reports a bounding box that actually contains the origin-relative design space', () => {
    for (const bytes of [carlitoRegularBytes(), carlitoBoldBytes(), carlitoItalicBytes(), caladeaRegularBytes()]) {
      const head = parseHead(parse(bytes));
      expect(head).toBeDefined();
      expect(head!.xMin).toBeLessThan(head!.xMax);
      expect(head!.yMin).toBeLessThan(head!.yMax);
      expect(head!.yMax).toBeGreaterThan(head!.unitsPerEm / 2); // a text font's tallest glyph always rises well past half an em
    }
  });
});

describe('parseMaxp', () => {
  it('reads the real glyph counts', () => {
    expect(parseMaxp(parse(carlitoRegularBytes()))?.numGlyphs).toBe(2783);
    expect(parseMaxp(parse(carlitoItalicBytes()))?.numGlyphs).toBe(2783);
    expect(parseMaxp(parse(caladeaRegularBytes()))?.numGlyphs).toBe(464);
  });
});

describe('parseOs2', () => {
  it('reads Carlito Regular vertical metrics and its REGULAR selection bit', () => {
    const os2 = parseOs2(parse(carlitoRegularBytes()));
    expect(os2).toBeDefined();
    expect(os2!.version).toBe(3);
    expect(os2!.sTypoAscender).toBe(1536);
    expect(os2!.sTypoDescender).toBe(-512);
    expect(os2!.sTypoLineGap).toBe(452);
    expect(os2!.usWinAscent).toBe(1950);
    expect(os2!.usWinDescent).toBe(550);
    expect(os2!.sxHeight).toBe(978);
    expect(os2!.sCapHeight).toBe(1314);
    expect(os2!.fsSelection & FS_SELECTION_REGULAR).toBe(FS_SELECTION_REGULAR);
    expect(os2!.fsSelection & FS_SELECTION_BOLD).toBe(0);
    expect(os2!.fsSelection & FS_SELECTION_ITALIC).toBe(0);
  });

  it("distinguishes the family's bold and italic faces by their own fsSelection bits", () => {
    const bold = parseOs2(parse(carlitoBoldBytes()));
    expect(bold!.fsSelection & FS_SELECTION_BOLD).toBe(FS_SELECTION_BOLD);
    expect(bold!.fsSelection & FS_SELECTION_ITALIC).toBe(0);
    expect(bold!.sCapHeight).toBe(1328); // the bold face is drawn slightly taller than the regular's 1314

    const italic = parseOs2(parse(carlitoItalicBytes()));
    expect(italic!.fsSelection & FS_SELECTION_ITALIC).toBe(FS_SELECTION_ITALIC);
    expect(italic!.fsSelection & FS_SELECTION_BOLD).toBe(0);
    expect(italic!.sxHeight).toBe(983);
  });

  it('reads Caladea Regular, a version 4 OS/2 table', () => {
    const os2 = parseOs2(parse(caladeaRegularBytes()));
    expect(os2).toBeDefined();
    expect(os2!.version).toBe(4);
    expect(os2!.sTypoAscender).toBe(900);
    expect(os2!.sTypoDescender).toBe(-250);
    expect(os2!.sTypoLineGap).toBe(0);
    expect(os2!.usWinAscent).toBe(1050);
    expect(os2!.usWinDescent).toBe(250);
    expect(os2!.sxHeight).toBe(467);
    expect(os2!.sCapHeight).toBe(667);
  });
});

describe('parsePost', () => {
  it('reads Carlito Regular: an upright face, so a zero italic angle', () => {
    const post = parsePost(parse(carlitoRegularBytes()));
    expect(post).toBeDefined();
    expect(post!.version).toBe(0x00030000);
    expect(post!.italicAngle).toBe(0);
    expect(post!.underlinePosition).toBe(-103);
    expect(post!.underlineThickness).toBe(194);
  });

  it("reads Carlito Italic's real -7 degree slant out of its Fixed 16.16 italicAngle", () => {
    const post = parsePost(parse(carlitoItalicBytes()));
    expect(post!.italicAngle).toBeCloseTo(-7, 6);
    expect(post!.underlinePosition).toBe(-103);
    expect(post!.underlineThickness).toBe(194);
  });

  it('reads Caladea Regular, a version 2.0 post table', () => {
    const post = parsePost(parse(caladeaRegularBytes()));
    expect(post!.version).toBe(0x00020000);
    expect(post!.italicAngle).toBe(0);
    expect(post!.underlinePosition).toBe(-75);
    expect(post!.underlineThickness).toBe(50);
  });
});

describe('parseName', () => {
  it('reads the real PostScript and family names', () => {
    expect(parseName(parse(carlitoRegularBytes()))).toEqual({ postScriptName: 'Carlito-Regular', familyName: 'Carlito' });
    expect(parseName(parse(carlitoBoldBytes()))).toEqual({ postScriptName: 'Carlito-Bold', familyName: 'Carlito' });
    expect(parseName(parse(carlitoItalicBytes()))).toEqual({ postScriptName: 'Carlito-Italic', familyName: 'Carlito' });
    // Caladea carries both Macintosh/Roman (1, 0) and Windows/Unicode (3, 1) copies of every name; the two agree here, so what this proves is that a font with both is read once, not twice or as a concatenation of the two encodings.
    expect(parseName(parse(caladeaRegularBytes()))).toEqual({ postScriptName: 'Caladea-Regular', familyName: 'Caladea' });
  });
});

// A minimal, hand-built 'name' table wrapped in a real sfnt directory. Every vendored font here carries Windows/Unicode records, so the Macintosh/Roman fallback and the "the family name is missing entirely" branch have no real font to exercise them -- these bytes are built to the spec's own record layout (clause 5.2.7) to cover exactly those two paths.
function buildFontWithNameTable(records: readonly { platformId: number; encodingId: number; nameId: number; text: string; utf16: boolean }[]): Uint8Array<ArrayBuffer> {
  const NAME_HEADER_SIZE = 6;
  const NAME_RECORD_SIZE = 12;
  const storageOffset = NAME_HEADER_SIZE + records.length * NAME_RECORD_SIZE;
  const encoded = records.map((record) => {
    const chars = [...record.text].map((character) => character.charCodeAt(0));
    return record.utf16 ? Uint8Array.from(chars.flatMap((code) => [code >> 8, code & 0xff])) : Uint8Array.from(chars);
  });
  const storageLength = encoded.reduce((total, bytes) => total + bytes.length, 0);
  const nameTable = new Uint8Array(storageOffset + storageLength);
  const nameView = new DataView(nameTable.buffer);
  nameView.setUint16(2, records.length);
  nameView.setUint16(4, storageOffset);
  let stringOffset = 0;
  records.forEach((record, index) => {
    const recordOffset = NAME_HEADER_SIZE + index * NAME_RECORD_SIZE;
    const encodedRecord = encoded[index]!;
    nameView.setUint16(recordOffset, record.platformId);
    nameView.setUint16(recordOffset + 2, record.encodingId);
    nameView.setUint16(recordOffset + 6, record.nameId);
    nameView.setUint16(recordOffset + 8, encodedRecord.length);
    nameView.setUint16(recordOffset + 10, stringOffset);
    nameTable.set(encodedRecord, storageOffset + stringOffset);
    stringOffset += encodedRecord.length;
  });

  const DIRECTORY_SIZE = 12 + 16;
  const font = new Uint8Array(DIRECTORY_SIZE + nameTable.length);
  const fontView = new DataView(font.buffer);
  fontView.setUint32(0, 0x00010000);
  fontView.setUint16(4, 1);
  font.set(Uint8Array.from([0x6e, 0x61, 0x6d, 0x65]), 12); // 'name'
  fontView.setUint32(12 + 8, DIRECTORY_SIZE);
  fontView.setUint32(12 + 12, nameTable.length);
  font.set(nameTable, DIRECTORY_SIZE);
  return font;
}

describe('parseName record selection', () => {
  it('falls back to a Macintosh/Roman record when the font ships no Windows/Unicode one', () => {
    const font = parse(
      buildFontWithNameTable([
        { platformId: 1, encodingId: 0, nameId: 1, text: 'MacOnly', utf16: false },
        { platformId: 1, encodingId: 0, nameId: 6, text: 'MacOnly-Regular', utf16: false },
      ]),
    );
    expect(parseName(font)).toEqual({ postScriptName: 'MacOnly-Regular', familyName: 'MacOnly' });
  });

  it('prefers the Windows/Unicode record over the Macintosh/Roman one for the same nameID', () => {
    const font = parse(
      buildFontWithNameTable([
        { platformId: 1, encodingId: 0, nameId: 1, text: 'MacName', utf16: false },
        { platformId: 3, encodingId: 1, nameId: 1, text: 'WindowsName', utf16: true },
      ]),
    );
    expect(parseName(font)?.familyName).toBe('WindowsName');
  });

  it('prefers the typographic family (nameID 16) over the legacy family (nameID 1)', () => {
    const font = parse(
      buildFontWithNameTable([
        { platformId: 3, encodingId: 1, nameId: 1, text: 'Legacy Family Semibold', utf16: true },
        { platformId: 3, encodingId: 1, nameId: 16, text: 'Typographic Family', utf16: true },
      ]),
    );
    expect(parseName(font)?.familyName).toBe('Typographic Family');
  });

  it('reports an absent name as undefined rather than an empty string', () => {
    const font = parse(buildFontWithNameTable([{ platformId: 3, encodingId: 1, nameId: 1, text: 'OnlyAFamily', utf16: true }]));
    expect(parseName(font)).toEqual({ postScriptName: undefined, familyName: 'OnlyAFamily' });
  });
});

describe('missing and malformed tables', () => {
  it('returns undefined for every table a font does not carry', () => {
    const font = parse(buildFontWithNameTable([{ platformId: 3, encodingId: 1, nameId: 1, text: 'Nameless', utf16: true }]));
    expect(parseHead(font)).toBeUndefined();
    expect(parseMaxp(font)).toBeUndefined();
    expect(parseOs2(font)).toBeUndefined();
    expect(parsePost(font)).toBeUndefined();
  });

  it("rejects a 'head' table whose magic number is wrong rather than reporting nonsense metrics", () => {
    const bytes = carlitoRegularBytes();
    const font = parse(bytes);
    const head = font.tables.get('head');
    expect(head).toBeDefined();
    const corrupted = new Uint8Array(bytes.length);
    corrupted.set(bytes);
    corrupted[head!.offset + 12] = 0x00; // the first byte of the 0x5F0F3CF5 magic number
    expect(parseHead(parse(corrupted))).toBeUndefined();
  });
});
