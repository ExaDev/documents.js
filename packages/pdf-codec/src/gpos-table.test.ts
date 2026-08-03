import { describe, expect, it } from 'vitest';
import { buildCmapLookup } from './cmap-table';
import { buildGposKernLookup } from './gpos-table';
import type { SfntFont } from './sfnt';
import { parseSfnt } from './sfnt';
import { caladeaItalicBytes, caladeaRegularBytes, carlitoBoldBytes, carlitoItalicBytes, carlitoRegularBytes } from './test-support/fonts';

// Every kerning value asserted below is the real value the real vendored font declares, cross-checked against two independent implementations of the same format before being written down here: fontTools 4.61.1 (Python) walking the same GPOS tables through its own object model, and HarfBuzz's own `hb-shape` (C), whose shaped advance for the first glyph of each pair was confirmed to equal that glyph's 'hmtx' advance plus the adjustment asserted here. The full ASCII cross-check behind these spot values covered 3161 non-zero kern pairs across all five faces with no disagreement; the handful reproduced here are the well-known pairs a reader can sanity-check by eye.
//
// The two families exercise deliberately different corners of the format, which is why both are driven rather than one standing in for the other. Carlito reaches its kerning only through LookupType 9 (Extension Positioning) wrapping PairPos format 2, so a parser that ignored Extension would find no Carlito kerning at all. Caladea uses LookupType 2 directly and mixes PairPos format 1 and format 2 subtables inside one lookup, so it is what proves the format 1 path and the subtable precedence order.

function parse(bytes: Uint8Array<ArrayBuffer>): SfntFont {
  const font = parseSfnt(bytes);
  if (font === undefined) {
    throw new Error('font failed to parse as an sfnt container');
  }
  return font;
}

// Kerning by character rather than glyph ID, so the assertions below read as the pairs they actually are. The glyph IDs themselves are exercised directly in the identity tests further down.
function kernerFor(bytes: Uint8Array<ArrayBuffer>): (pair: string) => number | undefined {
  const font = parse(bytes);
  const cmap = buildCmapLookup(font);
  const kern = buildGposKernLookup(font);
  if (cmap === undefined || kern === undefined) {
    throw new Error('font has no readable cmap/GPOS kerning');
  }
  return (pair: string): number | undefined => {
    const left = cmap(pair.codePointAt(0)!);
    const right = cmap(pair.codePointAt(1)!);
    if (left === undefined || right === undefined) {
      throw new Error(`font does not cover ${pair}`);
    }
    return kern(left, right);
  };
}

describe('buildGposKernLookup against the real vendored Carlito', () => {
  it('recovers the real adjustments Carlito Regular declares for well-known pairs', () => {
    const kern = kernerFor(carlitoRegularBytes());
    // Design units on Carlito's own 2048-unit em.
    expect(kern('AV')).toBe(-89);
    expect(kern('AW')).toBe(-80);
    expect(kern('AT')).toBe(-160);
    expect(kern('To')).toBe(-182);
    expect(kern('Ta')).toBe(-160);
    expect(kern('Wa')).toBe(-71);
    expect(kern('Wo')).toBe(-86);
    expect(kern('Ya')).toBe(-134);
    expect(kern('VA')).toBe(-96);
    expect(kern('LT')).toBe(-150);
    expect(kern('av')).toBe(-34);
    expect(kern('yo')).toBe(-24);
  });

  it('kerns a letter against following punctuation, the largest adjustments the font carries', () => {
    const kern = kernerFor(carlitoRegularBytes());
    expect(kern('P.')).toBe(-261);
    expect(kern('r.')).toBe(-206);
    expect(kern('F,')).toBe(-204);
    expect(kern('v.')).toBe(-168);
  });

  it('reads the bold and italic faces, which declare their own different values', () => {
    // Each face kerns independently -- asserting the same numbers across faces would prove only that the parser is consistent, not that it read each face.
    const bold = kernerFor(carlitoBoldBytes());
    expect(bold('AV')).toBe(-105);
    expect(bold('To')).toBe(-177);
    expect(bold('P.')).toBe(-226);
    const italic = kernerFor(carlitoItalicBytes());
    expect(italic('AV')).toBe(-146);
    expect(italic('To')).toBe(-173);
    expect(italic('P.')).toBe(-250);
  });

  it("resolves through Carlito's Extension lookups, which nothing else in the font offers a way around", () => {
    // Carlito's kern feature points at exactly one lookup, of LookupType 9, whose every subtable is an ExtensionPos wrapping a PairPos. A parser that skipped LookupType 9 would return undefined here rather than a real adjustment.
    const font = parse(carlitoRegularBytes());
    expect(font.tables.has('GPOS')).toBe(true);
    expect(font.tables.has('kern')).toBe(false); // no legacy kern table exists to fall back on
    expect(buildGposKernLookup(font)).toBeDefined();
    expect(kernerFor(carlitoRegularBytes())('AV')).toBe(-89);
  });
});

describe('buildGposKernLookup against the real vendored Caladea', () => {
  it('recovers the real adjustments Caladea Regular declares for well-known pairs', () => {
    const kern = kernerFor(caladeaRegularBytes());
    // Design units on Caladea's own 1000-unit em, so these are not comparable in magnitude to Carlito's above.
    expect(kern('AV')).toBe(-117);
    expect(kern('AW')).toBe(-106);
    expect(kern('AT')).toBe(-79);
    expect(kern('To')).toBe(-70);
    expect(kern('Ta')).toBe(-78);
    expect(kern('Wa')).toBe(-58);
    expect(kern('Wo')).toBe(-60);
    expect(kern('Ya')).toBe(-76);
    expect(kern('VA')).toBe(-119);
    expect(kern('LT')).toBe(-65);
    expect(kern('P.')).toBe(-100);
    expect(kern('r.')).toBe(-98);
  });

  it('reads the italic face, which declares its own different values', () => {
    const italic = kernerFor(caladeaItalicBytes());
    expect(italic('AV')).toBe(-71);
    expect(italic('To')).toBe(-68);
    expect(italic('P.')).toBe(-127);
  });

  it('resolves pairs that only its PairPos format 1 subtable describes', () => {
    // Each of these is listed explicitly in a format 1 subtable, and the class-based format 2 subtables later in the same lookup give a genuinely different answer for every one of them -- 0 for the first four, and a larger adjustment for the last three. That makes these values a real discriminator: a parser that failed to read format 1, or that reached the format 2 subtables first, would return the other number rather than these.
    const kern = kernerFor(caladeaRegularBytes());
    expect(kern('av')).toBe(-20); // format 2 alone would say 0
    expect(kern('FC')).toBe(-7); // format 2 alone would say 0
    expect(kern('my')).toBe(-20); // format 2 alone would say 0
    expect(kern('aw')).toBe(-13); // format 2 alone would say 0
    expect(kern('RC')).toBe(-20); // format 2 alone would say -30
    expect(kern('Wp')).toBe(-20); // format 2 alone would say -24
    expect(kern('Yp')).toBe(-54); // format 2 alone would say -59
  });
});

describe('buildGposKernLookup reports what a font does not kern', () => {
  it('returns undefined for a pair no kerning subtable covers', () => {
    // 'l' is not a first glyph of any Carlito kerning subtable's coverage, so nothing describes 'll' at all.
    expect(kernerFor(carlitoRegularBytes())('ll')).toBeUndefined();
  });

  it('distinguishes a pair a subtable covers but leaves alone from one nothing covers', () => {
    // 'r' is covered as a first glyph and 'rn' really does resolve, to an adjustment of zero -- a different fact from 'll' above, and worth reporting as such rather than collapsing both into undefined.
    const kern = kernerFor(carlitoRegularBytes());
    expect(kern('rn')).toBe(0);
    expect(kern('ll')).toBeUndefined();
  });

  it('returns undefined for a font with no GPOS table at all', () => {
    const bytes = carlitoRegularBytes();
    const font = parse(bytes);
    const stripped: SfntFont = { bytes: font.bytes, tables: new Map([...font.tables].filter(([tag]) => tag !== 'GPOS')) };
    expect(buildGposKernLookup(stripped)).toBeUndefined();
  });
});

describe('buildGposKernLookup takes glyph IDs, not characters', () => {
  it('kerns by the glyph IDs the font itself assigns', () => {
    // Carlito's own glyph IDs for 'A' and 'V', independently asserted in cmap-table.test.ts.
    const font = parse(carlitoRegularBytes());
    const kern = buildGposKernLookup(font);
    expect(kern!(3, 40)).toBe(-89);
    // The pair is directional: 'VA' is a different pair from 'AV' and the font kerns it differently.
    expect(kern!(40, 3)).toBe(-96);
  });

  it('returns undefined for a glyph ID the font does not have', () => {
    const kern = buildGposKernLookup(parse(carlitoRegularBytes()));
    expect(kern!(0xfffe, 0xffff)).toBeUndefined();
  });
});

// A minimal, spec-shaped GPOS carrying exactly one kern feature and one lookup, for the cases no vendored font contains. Every face here declares valueFormat1 = XAdvance alone with valueFormat2 = 0, so the ValueRecord field-ordering and record-stride arithmetic below -- what happens when XAdvance is preceded by other fields, or when a second ValueRecord widens every record -- has no real font to exercise it and needs building by hand.
const GPOS_PROLOGUE_SIZE = 56;

function buildGpos(lookupType: number, subtable: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(GPOS_PROLOGUE_SIZE + subtable.length);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string): void => {
    for (let i = 0; i < 4; i++) {
      bytes[offset + i] = value.charCodeAt(i);
    }
  };
  view.setUint16(0, 1); // majorVersion
  view.setUint16(2, 0); // minorVersion
  view.setUint16(4, 10); // scriptListOffset
  view.setUint16(6, 30); // featureListOffset
  view.setUint16(8, 44); // lookupListOffset

  view.setUint16(10, 1); // ScriptList: scriptCount
  tag(12, 'DFLT');
  view.setUint16(16, 8); // scriptOffset, from the ScriptList

  view.setUint16(18, 4); // Script: defaultLangSysOffset, from the Script table
  view.setUint16(20, 0); // langSysCount

  view.setUint16(22, 0); // LangSys: lookupOrderOffset (reserved)
  view.setUint16(24, 0xffff); // requiredFeatureIndex: none
  view.setUint16(26, 1); // featureIndexCount
  view.setUint16(28, 0); // featureIndices[0]

  view.setUint16(30, 1); // FeatureList: featureCount
  tag(32, 'kern');
  view.setUint16(36, 8); // featureOffset, from the FeatureList

  view.setUint16(38, 0); // Feature: featureParamsOffset
  view.setUint16(40, 1); // lookupIndexCount
  view.setUint16(42, 0); // lookupListIndices[0]

  view.setUint16(44, 1); // LookupList: lookupCount
  view.setUint16(46, 4); // lookupOffsets[0], from the LookupList

  view.setUint16(48, lookupType); // Lookup: lookupType
  view.setUint16(50, 0); // lookupFlag
  view.setUint16(52, 1); // subTableCount
  view.setUint16(54, 8); // subtableOffsets[0], from the Lookup

  bytes.set(subtable, GPOS_PROLOGUE_SIZE);
  return bytes;
}

function fontWithGpos(gpos: Uint8Array<ArrayBuffer>): SfntFont {
  const TABLE_OFFSET = 28;
  const bytes = new Uint8Array(TABLE_OFFSET + gpos.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000); // sfntVersion
  view.setUint16(4, 1); // numTables
  for (let i = 0; i < 4; i++) {
    bytes[12 + i] = 'GPOS'.charCodeAt(i);
  }
  view.setUint32(20, TABLE_OFFSET);
  view.setUint32(24, gpos.length);
  bytes.set(gpos, TABLE_OFFSET);
  return parse(bytes);
}

// A PairPos format 1 subtable covering one first glyph, with one second glyph carrying `value1` then `value2` -- each an int16 per set bit of its own valueFormat, in the spec's fixed field order.
function pairPosFormat1(options: { firstGlyphId: number; secondGlyphId: number; valueFormat1: number; valueFormat2: number; value1: readonly number[]; value2: readonly number[] }): Uint8Array<ArrayBuffer> {
  const HEADER_SIZE = 12; // through pairSetOffsets[0]
  const recordSize = 2 + options.value1.length * 2 + options.value2.length * 2;
  const pairSetSize = 2 + recordSize;
  const coverageOffset = HEADER_SIZE + pairSetSize;
  const bytes = new Uint8Array(coverageOffset + 6);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1); // posFormat
  view.setUint16(2, coverageOffset);
  view.setUint16(4, options.valueFormat1);
  view.setUint16(6, options.valueFormat2);
  view.setUint16(8, 1); // pairSetCount
  view.setUint16(10, HEADER_SIZE); // pairSetOffsets[0]

  view.setUint16(HEADER_SIZE, 1); // PairSet: pairValueCount
  view.setUint16(HEADER_SIZE + 2, options.secondGlyphId);
  [...options.value1, ...options.value2].forEach((value, index) => {
    view.setInt16(HEADER_SIZE + 4 + index * 2, value);
  });

  view.setUint16(coverageOffset, 1); // Coverage format 1
  view.setUint16(coverageOffset + 2, 1); // glyphCount
  view.setUint16(coverageOffset + 4, options.firstGlyphId);
  return bytes;
}

const VALUE_FORMAT_X_PLACEMENT = 0x0001;
const VALUE_FORMAT_Y_PLACEMENT = 0x0002;
const VALUE_FORMAT_X_ADVANCE = 0x0004;
const VALUE_FORMAT_Y_ADVANCE = 0x0008;

describe('buildGposKernLookup reads XAdvance out of a ValueRecord of any shape', () => {
  it('reads it when it is the only field, as every vendored font writes it', () => {
    const font = fontWithGpos(buildGpos(2, pairPosFormat1({ firstGlyphId: 10, secondGlyphId: 20, valueFormat1: VALUE_FORMAT_X_ADVANCE, valueFormat2: 0, value1: [-75], value2: [] })));
    expect(buildGposKernLookup(font)!(10, 20)).toBe(-75);
  });

  it('skips past the placement fields that precede it', () => {
    // XPlacement and YPlacement sort before XAdvance in the spec's field order, so a parser that read the first int16 of the record would return 11 here instead of -75.
    const valueFormat1 = VALUE_FORMAT_X_PLACEMENT | VALUE_FORMAT_Y_PLACEMENT | VALUE_FORMAT_X_ADVANCE;
    const font = fontWithGpos(buildGpos(2, pairPosFormat1({ firstGlyphId: 10, secondGlyphId: 20, valueFormat1, valueFormat2: 0, value1: [11, 22, -75], value2: [] })));
    expect(buildGposKernLookup(font)!(10, 20)).toBe(-75);
  });

  it('ignores the trailing fields and the whole second ValueRecord', () => {
    // YAdvance follows XAdvance, and valueFormat2's own record follows both -- neither may be mistaken for the first glyph's horizontal adjustment, and both widen the record the parser must stride over.
    const valueFormat1 = VALUE_FORMAT_X_ADVANCE | VALUE_FORMAT_Y_ADVANCE;
    const valueFormat2 = VALUE_FORMAT_X_PLACEMENT | VALUE_FORMAT_X_ADVANCE;
    const font = fontWithGpos(buildGpos(2, pairPosFormat1({ firstGlyphId: 10, secondGlyphId: 20, valueFormat1, valueFormat2, value1: [-75, 99], value2: [33, 44] })));
    expect(buildGposKernLookup(font)!(10, 20)).toBe(-75);
  });

  it('reports a covered pair whose record carries no XAdvance at all as zero, not as absent', () => {
    const font = fontWithGpos(buildGpos(2, pairPosFormat1({ firstGlyphId: 10, secondGlyphId: 20, valueFormat1: VALUE_FORMAT_Y_ADVANCE, valueFormat2: 0, value1: [99], value2: [] })));
    const kern = buildGposKernLookup(font)!;
    expect(kern(10, 20)).toBe(0);
    expect(kern(10, 21)).toBeUndefined();
  });
});

describe('buildGposKernLookup resolves Extension lookups', () => {
  function extensionWrapping(subtable: Uint8Array<ArrayBuffer>, extensionLookupType: number): Uint8Array<ArrayBuffer> {
    const EXTENSION_SIZE = 8;
    const bytes = new Uint8Array(EXTENSION_SIZE + subtable.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1); // posFormat
    view.setUint16(2, extensionLookupType);
    view.setUint32(4, EXTENSION_SIZE); // extensionOffset, from this subtable's own start
    bytes.set(subtable, EXTENSION_SIZE);
    return bytes;
  }

  const pairPos = pairPosFormat1({ firstGlyphId: 10, secondGlyphId: 20, valueFormat1: VALUE_FORMAT_X_ADVANCE, valueFormat2: 0, value1: [-75], value2: [] });

  it('follows the 32-bit offset through to the wrapped PairPos', () => {
    const font = fontWithGpos(buildGpos(9, extensionWrapping(pairPos, 2)));
    expect(buildGposKernLookup(font)!(10, 20)).toBe(-75);
  });

  it('refuses an Extension that wraps another Extension', () => {
    // The spec forbids it; declining rather than recursing is what keeps a malformed font from looping here.
    const font = fontWithGpos(buildGpos(9, extensionWrapping(extensionWrapping(pairPos, 2), 9)));
    expect(buildGposKernLookup(font)).toBeUndefined();
  });

  it('ignores a lookup whose type positions something other than glyph pairs', () => {
    // A kern feature may legitimately reference a single-adjustment lookup; nothing here can use one, and it must not be misread as a PairPos.
    expect(buildGposKernLookup(fontWithGpos(buildGpos(1, pairPos)))).toBeUndefined();
    expect(buildGposKernLookup(fontWithGpos(buildGpos(9, extensionWrapping(pairPos, 1))))).toBeUndefined();
  });
});

describe('buildGposKernLookup degrades rather than throwing on a malformed GPOS', () => {
  const pairPos = pairPosFormat1({ firstGlyphId: 10, secondGlyphId: 20, valueFormat1: VALUE_FORMAT_X_ADVANCE, valueFormat2: 0, value1: [-75], value2: [] });

  it('returns undefined for a GPOS truncated to less than its own header', () => {
    expect(buildGposKernLookup(fontWithGpos(buildGpos(2, pairPos).subarray(0, 6)))).toBeUndefined();
  });

  it('returns undefined for a major version it does not know', () => {
    const gpos = buildGpos(2, pairPos);
    new DataView(gpos.buffer).setUint16(0, 2);
    expect(buildGposKernLookup(fontWithGpos(gpos))).toBeUndefined();
  });

  it('returns undefined when the feature is not a kern feature', () => {
    const gpos = buildGpos(2, pairPos);
    for (let i = 0; i < 4; i++) {
      gpos[32 + i] = 'liga'.charCodeAt(i);
    }
    expect(buildGposKernLookup(fontWithGpos(gpos))).toBeUndefined();
  });

  it('returns undefined when a table offset points outside the GPOS', () => {
    const gpos = buildGpos(2, pairPos);
    new DataView(gpos.buffer).setUint16(8, 0xfff0); // lookupListOffset, past the end
    expect(buildGposKernLookup(fontWithGpos(gpos))).toBeUndefined();
  });

  it('returns undefined when the subtable is truncated mid-PairSet', () => {
    const truncated = buildGpos(2, pairPos);
    expect(buildGposKernLookup(fontWithGpos(truncated.subarray(0, truncated.length - 8)))).toBeUndefined();
  });
});
