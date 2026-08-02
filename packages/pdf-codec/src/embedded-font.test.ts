import { describe, expect, it } from 'vitest';
import { collectEmbeddedGlyphs, encodeForShowEmbedded, loadEmbeddedFace } from './embedded-font';
import type { EmbeddedFace } from './embedded-font';
import type { SfntFont } from './sfnt';
import { parseSfnt } from './sfnt';
import { caladeaItalicBytes, caladeaRegularBytes, carlitoItalicBytes, carlitoRegularBytes } from './test-support/fonts';

// Every design-unit value asserted below was read straight out of the real vendored .ttf files by a standalone Node script walking the sfnt table directory with a bare DataView -- not by this package's own parsers -- and the glyph-space value beside it is that number times 1000/unitsPerEm, computed by hand. So these are external cross-checks of the scaling, not this module's output asserted against itself.
//
// The two vendored families are chosen deliberately as a matched pair for exactly this: Carlito is drawn on a 2048-unit em, so every conversion is a real 0.48828125 scaling, while Caladea is drawn on a 1000-unit em, so every conversion is the identity. A bug that skipped the scale entirely would pass every Caladea assertion here and fail every Carlito one.
const CARLITO_UNITS_PER_EM = 2048;
const CALADEA_UNITS_PER_EM = 1000;

function load(bytes: Uint8Array<ArrayBuffer>): { readonly sfnt: SfntFont; readonly face: EmbeddedFace } {
  const sfnt = parseSfnt(bytes);
  if (sfnt === undefined) {
    throw new Error('vendored font failed to parse as an sfnt container');
  }
  const face = loadEmbeddedFace(sfnt);
  if (face === undefined) {
    throw new Error('vendored font failed to load as an embeddable face');
  }
  return { sfnt, face };
}

function scaled(designUnits: number, unitsPerEm: number): number {
  return (designUnits * 1000) / unitsPerEm;
}

describe('loadEmbeddedFace metrics on Carlito Regular, a 2048-unit-per-em face', () => {
  it('converts every geometry field into 1000-unit glyph space, and none of them is the raw design value', () => {
    const { face } = load(carlitoRegularBytes());
    const m = face.metrics;
    expect(m.unitsPerEm).toBe(CARLITO_UNITS_PER_EM);
    expect(m.ascentGlyphSpace).toBe(scaled(1950, CARLITO_UNITS_PER_EM)); // 952.148...
    expect(m.descentGlyphSpace).toBe(scaled(-550, CARLITO_UNITS_PER_EM)); // -268.554...
    expect(m.capHeightGlyphSpace).toBe(scaled(1314, CARLITO_UNITS_PER_EM)); // OS/2 sCapHeight
    expect(m.xHeightGlyphSpace).toBe(scaled(978, CARLITO_UNITS_PER_EM));
    expect(m.bboxGlyphSpace).toEqual([-1002, -529, 2351, 2078].map((n) => scaled(n, CARLITO_UNITS_PER_EM)));
    expect(m.underlinePositionGlyphSpace).toBe(scaled(-103, CARLITO_UNITS_PER_EM));
    expect(m.underlineThicknessGlyphSpace).toBe(scaled(194, CARLITO_UNITS_PER_EM));

    // The scale really is non-identity here: every field above would be roughly twice its correct value if the design units had been passed through unconverted. Stated as its own assertion so a regression that dropped the conversion cannot pass by coincidence.
    expect(m.ascentGlyphSpace).not.toBe(1950);
    expect(m.ascentGlyphSpace).toBeCloseTo(952.148, 3);
    expect(m.capHeightGlyphSpace).toBeCloseTo(641.602, 3);
  });

  it('leaves the italic angle in degrees, the one field that is an angle rather than a length', () => {
    expect(load(carlitoRegularBytes()).face.metrics.italicAngleDegrees).toBe(0);
    // -7 degrees exactly, not -7 * 1000/2048.
    expect(load(carlitoItalicBytes()).face.metrics.italicAngleDegrees).toBe(-7);
  });

  it('reports advance widths in glyph space too', () => {
    const { face } = load(carlitoRegularBytes());
    expect(face.glyphSpaceWidth(15)).toBe(scaled(1276, CARLITO_UNITS_PER_EM)); // 'H', 1276 design units -> 623.046875
    expect(face.glyphSpaceWidth(1140)).toBe(scaled(470, CARLITO_UNITS_PER_EM)); // 'l'
    expect(face.glyphSpaceWidth(2)).toBe(scaled(463, CARLITO_UNITS_PER_EM)); // space
    expect(face.glyphSpaceWidth(0)).toBe(scaled(1038, CARLITO_UNITS_PER_EM)); // .notdef
    expect(face.glyphSpaceWidth(15)).not.toBe(1276);
  });

  it('resolves characters through the face own cmap and names itself by its PostScript name', () => {
    const { face } = load(carlitoRegularBytes());
    expect(face.postScriptName).toBe('Carlito-Regular');
    expect(face.numGlyphs).toBe(2783);
    expect(face.glyphId(0x48)).toBe(15); // 'H'
    expect(face.glyphId(0xf6)).toBe(2142); // 'o' with a diaeresis
    expect(face.glyphId(0x4e2d)).toBeUndefined(); // a CJK ideograph Carlito has no glyph for
  });
});

describe('loadEmbeddedFace metrics on Caladea, a 1000-unit-per-em face', () => {
  it('passes design units through unchanged when the design grid already is glyph space', () => {
    const { face } = load(caladeaRegularBytes());
    const m = face.metrics;
    expect(m.unitsPerEm).toBe(CALADEA_UNITS_PER_EM);
    expect(m.ascentGlyphSpace).toBe(900);
    expect(m.descentGlyphSpace).toBe(-250);
    expect(m.capHeightGlyphSpace).toBe(667);
    expect(m.xHeightGlyphSpace).toBe(467);
    expect(m.bboxGlyphSpace).toEqual([-313, -222, 1199, 936]);
    expect(m.underlinePositionGlyphSpace).toBe(-75);
    expect(m.underlineThicknessGlyphSpace).toBe(50);
    expect(m.italicAngleDegrees).toBe(0);
    expect(load(caladeaItalicBytes()).face.metrics.italicAngleDegrees).toBe(-9);
  });
});

describe('serif classification from the face own PANOSE declaration', () => {
  it('calls Caladea a serif design and Carlito a sans one, from what each font declares rather than its name', () => {
    // Caladea declares PANOSE 2,4 (Latin text, square cove) and Carlito 2,15 (Latin text, rounded sans) -- both read out of the real files with a bare DataView. Deriving the flag from these means a source-embedded face this package has never heard of is classified by the same rule.
    expect(load(caladeaRegularBytes()).face.metrics.serif).toBe(true);
    expect(load(caladeaItalicBytes()).face.metrics.serif).toBe(true);
    expect(load(carlitoRegularBytes()).face.metrics.serif).toBe(false);
    expect(load(carlitoItalicBytes()).face.metrics.serif).toBe(false);
  });
});

describe('loadEmbeddedFace caching and refusal', () => {
  it('parses one font once, returning the identical face for the same bytes', () => {
    const bytes = carlitoRegularBytes();
    const first = parseSfnt(bytes);
    const second = parseSfnt(bytes);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Two independently parsed sfnt containers over the same byte array: the cache is keyed on the bytes, so both yield the same face object rather than two parses of the same font.
    expect(loadEmbeddedFace(first!)).toBe(loadEmbeddedFace(second!));
  });

  it('refuses a font with no cmap, which offers no way to resolve a character to a glyph', () => {
    const patched = new Uint8Array(carlitoRegularBytes());
    dropTable(patched, 'cmap');
    const font = parseSfnt(patched);
    expect(font?.tables.has('cmap')).toBe(false);
    expect(loadEmbeddedFace(font!)).toBeUndefined();
  });

  it('refuses a font with no name table, which offers nothing legal to write as /BaseFont', () => {
    const patched = new Uint8Array(carlitoRegularBytes());
    dropTable(patched, 'name');
    const font = parseSfnt(patched);
    expect(loadEmbeddedFace(font!)).toBeUndefined();
  });

  it('refuses a font whose hmtx is too short for the metric count its hhea declares', () => {
    const patched = new Uint8Array(carlitoRegularBytes());
    truncateTable(patched, 'hmtx', 8);
    const font = parseSfnt(patched);
    expect(font?.tables.get('hmtx')?.length).toBe(8);
    expect(loadEmbeddedFace(font!)).toBeUndefined();
  });

  it('measures a cap height off the H glyph when OS/2 does not declare one', () => {
    // Carlito's own 'OS/2' is version 3 and does declare sCapHeight; dropping the table entirely leaves the outline of 'H' as the only thing in the font that still states its cap height, which is exactly what that FontDescriptor field means.
    const patched = new Uint8Array(carlitoRegularBytes());
    dropTable(patched, 'OS/2');
    const font = parseSfnt(patched);
    const face = loadEmbeddedFace(font!);
    expect(face).toBeDefined();
    expect(face!.metrics.xHeightGlyphSpace).toBeUndefined(); // nothing left in the font declares it, so nothing is written for it
    expect(face!.metrics.serif).toBe(false); // no PANOSE to classify by, so no serif claim is made
    // Carlito's 'H' (glyph 15) has yMax 1314 design units, read from the real file's own glyf entry with a bare DataView -- the same number its 'OS/2' sCapHeight declares. That agreement is the point: the measurement recovers the cap height the font itself states, rather than merely producing some plausible value.
    expect(face!.metrics.capHeightGlyphSpace).toBe(scaled(1314, CARLITO_UNITS_PER_EM));
    expect(face!.metrics.capHeightGlyphSpace).toBe(load(carlitoRegularBytes()).face.metrics.capHeightGlyphSpace);
  });
});

describe('encodeForShowEmbedded', () => {
  it('emits one big-endian 2-byte CID per character and measures exactly those glyphs', () => {
    const { face } = load(carlitoRegularBytes());
    const shown = encodeForShowEmbedded('Hi', face);
    const hGlyph = 15;
    const iGlyph = face.glyphId(0x69)!;
    expect([...shown.codes]).toEqual([(hGlyph >> 8) & 0xff, hGlyph & 0xff, (iGlyph >> 8) & 0xff, iGlyph & 0xff]);
    expect(shown.width1000).toBe(face.glyphSpaceWidth(hGlyph) + face.glyphSpaceWidth(iGlyph));
    expect(shown.substitutions).toEqual([]);
  });

  it('handles a supplementary-plane character as one code point, not two surrogate halves', () => {
    const { face } = load(carlitoRegularBytes());
    // U+1D400 (mathematical bold capital A) is a single code point Carlito has no glyph for -- two UTF-16 code units in a JS string, but one character, one CID, and one substitution.
    const shown = encodeForShowEmbedded('\u{1D400}', face);
    expect(shown.codes.length).toBe(2);
    expect(shown.substitutions).toEqual([{ from: '\u{1D400}' }]);
  });

  it('shows .notdef for a character the face cannot map, and measures .notdef own advance for it', () => {
    const { face } = load(carlitoRegularBytes());
    const shown = encodeForShowEmbedded('A中A', face);
    const aGlyph = face.glyphId(0x41)!;
    expect([...shown.codes]).toEqual([0, aGlyph, 0, 0, 0, aGlyph]);
    expect(shown.substitutions).toEqual([{ from: '中' }]);
    // The measurement follows what will actually be drawn, not what was asked for: the middle character advances by .notdef's own width. Measuring it as zero (or throwing) would desync a computed line-wrap point from the drawn line.
    expect(shown.width1000).toBe(face.glyphSpaceWidth(aGlyph) * 2 + face.glyphSpaceWidth(0));
  });

  it('is the single path measurement and showing share, so the two can never disagree', () => {
    const { face } = load(carlitoRegularBytes());
    const text = 'Hello, wörld!';
    const shown = encodeForShowEmbedded(text, face);
    // Re-deriving the width from the emitted CIDs -- i.e. from exactly the bytes a Tj operand would carry -- reproduces the reported width. Nothing measures a string by a route the drawing path does not take.
    let widthFromCodes = 0;
    for (let i = 0; i + 1 < shown.codes.length; i += 2) {
      widthFromCodes += face.glyphSpaceWidth((shown.codes[i]! << 8) | shown.codes[i + 1]!);
    }
    expect(widthFromCodes).toBe(shown.width1000);
    expect(shown.codes.length).toBe([...text].length * 2);
  });
});

describe('collectEmbeddedGlyphs', () => {
  it('maps each used glyph back to the character it represents, across every run in a document', () => {
    const { face } = load(carlitoRegularBytes());
    const used = collectEmbeddedGlyphs(['Hi', 'oö'], face);
    const expected: [number, number][] = [
      [15, 0x48], // 'H'
      [face.glyphId(0x69)!, 0x69], // 'i'
      [111, 0x6f], // 'o'
      [2142, 0xf6], // 'o' with a diaeresis, a composite glyph
    ];
    expect([...used].sort((a, b) => a[0] - b[0])).toEqual(expected.sort((a, b) => a[0] - b[0]));
  });

  it('contributes nothing for a character the face cannot map', () => {
    // .notdef stands for no Unicode text at all; putting it in a ToUnicode CMap would make a copy/paste recover a character the page never showed.
    const { face } = load(carlitoRegularBytes());
    expect([...collectEmbeddedGlyphs(['中'], face)]).toEqual([]);
  });
});

// Repointing a table record past the end of the file makes parseSfnt drop that one table, exactly as it would for a genuinely truncated font -- the same technique sfnt-subset.test.ts uses to build its own missing-table cases.
function tableRecordOffset(bytes: Uint8Array<ArrayBuffer>, tag: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const recordOffset = 12 + i * 16;
    let found = '';
    for (let c = 0; c < 4; c++) {
      found += String.fromCharCode(view.getUint8(recordOffset + c));
    }
    if (found === tag) {
      return recordOffset;
    }
  }
  throw new Error(`the vendored font has no "${tag}" table to patch`);
}

function dropTable(bytes: Uint8Array<ArrayBuffer>, tag: string): void {
  new DataView(bytes.buffer).setUint32(tableRecordOffset(bytes, tag) + 8, bytes.length + 4);
}

function truncateTable(bytes: Uint8Array<ArrayBuffer>, tag: string, length: number): void {
  new DataView(bytes.buffer).setUint32(tableRecordOffset(bytes, tag) + 12, length);
}
