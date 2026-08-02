import { describe, expect, it } from 'vitest';
import { buildCmapLookup } from './cmap-table';
import type { SfntFont } from './sfnt';
import { parseSfnt } from './sfnt';
import { caladeaRegularBytes, carlitoRegularBytes } from './test-support/fonts';

// The glyph IDs asserted below were read out of the real vendored .ttf files by a standalone Node script walking the 'cmap' subtables with a bare DataView, independently of this module.
function parse(bytes: Uint8Array<ArrayBuffer>): SfntFont {
  const font = parseSfnt(bytes);
  if (font === undefined) {
    throw new Error('font failed to parse as an sfnt container');
  }
  return font;
}

describe('buildCmapLookup against the real vendored fonts', () => {
  it('resolves Carlito Regular code points to their real glyph IDs', () => {
    const lookup = buildCmapLookup(parse(carlitoRegularBytes()));
    expect(lookup).toBeDefined();
    expect(lookup!(0x20)).toBe(2); // space
    expect(lookup!(0x41)).toBe(3); // 'A'
    expect(lookup!(0x65)).toBe(59); // 'e'
    expect(lookup!(0xe9)).toBe(2007); // 'e-acute'
  });

  it("picks Carlito's Windows/BMP format 4 subtable over the Macintosh format 6 one it also ships", () => {
    // Carlito carries three subtables: (0, 3) and (3, 1) format 4, plus a (1, 0) format 6 covering only code points 0..254. U+2019 lies outside that trimmed range, so resolving it at all proves the format 4 subtable is what drives the lookup.
    const lookup = buildCmapLookup(parse(carlitoRegularBytes()));
    expect(lookup!(0x2019)).toBe(317); // RIGHT SINGLE QUOTATION MARK
  });

  it('resolves Caladea Regular code points to their real glyph IDs', () => {
    const lookup = buildCmapLookup(parse(caladeaRegularBytes()));
    expect(lookup).toBeDefined();
    expect(lookup!(0x41)).toBe(5);
    expect(lookup!(0x65)).toBe(35);
    expect(lookup!(0xe9)).toBe(178);
    expect(lookup!(0x2019)).toBe(331);
  });

  it('returns undefined for a code point the font does not cover', () => {
    const lookup = buildCmapLookup(parse(carlitoRegularBytes()));
    expect(lookup!(0x1_0000)).toBeUndefined(); // an unassigned supplementary-plane code point, which no BMP-only format 4 subtable can reach
    expect(lookup!(0x4e00)).toBeUndefined(); // a CJK ideograph, outside a Latin text font's coverage
  });
});

// A minimal sfnt carrying exactly one 'cmap' subtable, built to the spec's own layout (ISO/IEC 14496-22 clause 5.1). No vendored font here ships a format 6 subtable as its only mapping, so the fallback that reads one has no real font to exercise it.
function buildFontWithCmapSubtable(platformId: number, encodingId: number, subtable: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const CMAP_HEADER_SIZE = 4;
  const SUBTABLE_RECORD_SIZE = 8;
  const subtableOffset = CMAP_HEADER_SIZE + SUBTABLE_RECORD_SIZE;
  const cmap = new Uint8Array(subtableOffset + subtable.length);
  const cmapView = new DataView(cmap.buffer);
  cmapView.setUint16(2, 1); // numTables
  cmapView.setUint16(CMAP_HEADER_SIZE, platformId);
  cmapView.setUint16(CMAP_HEADER_SIZE + 2, encodingId);
  cmapView.setUint32(CMAP_HEADER_SIZE + 4, subtableOffset);
  cmap.set(subtable, subtableOffset);

  const DIRECTORY_SIZE = 12 + 16;
  const font = new Uint8Array(DIRECTORY_SIZE + cmap.length);
  const fontView = new DataView(font.buffer);
  fontView.setUint32(0, 0x00010000);
  fontView.setUint16(4, 1); // numTables
  font.set(Uint8Array.from([0x63, 0x6d, 0x61, 0x70]), 12); // 'cmap'
  fontView.setUint32(12 + 8, DIRECTORY_SIZE);
  fontView.setUint32(12 + 12, cmap.length);
  font.set(cmap, DIRECTORY_SIZE);
  return font;
}

function buildFormat6Subtable(firstCode: number, glyphIds: readonly number[]): Uint8Array<ArrayBuffer> {
  const HEADER_SIZE = 10;
  const subtable = new Uint8Array(HEADER_SIZE + glyphIds.length * 2);
  const view = new DataView(subtable.buffer);
  view.setUint16(0, 6); // format
  view.setUint16(2, subtable.length); // length
  view.setUint16(6, firstCode);
  view.setUint16(8, glyphIds.length); // entryCount
  glyphIds.forEach((glyphId, index) => {
    view.setUint16(HEADER_SIZE + index * 2, glyphId);
  });
  return subtable;
}

describe('format 6 (trimmed table mapping)', () => {
  it('drives a font whose only subtable is a format 6 one', () => {
    const font = parse(buildFontWithCmapSubtable(1, 0, buildFormat6Subtable(0x41, [11, 12, 13])));
    const lookup = buildCmapLookup(font);
    expect(lookup).toBeDefined();
    expect(lookup!(0x41)).toBe(11);
    expect(lookup!(0x42)).toBe(12);
    expect(lookup!(0x43)).toBe(13);
  });

  it('maps nothing outside its own trimmed range, and treats an explicit glyph 0 as unmapped', () => {
    const font = parse(buildFontWithCmapSubtable(1, 0, buildFormat6Subtable(0x41, [11, 0, 13])));
    const lookup = buildCmapLookup(font);
    expect(lookup!(0x40)).toBeUndefined(); // below firstCode
    expect(lookup!(0x44)).toBeUndefined(); // past the last entry
    expect(lookup!(0x42)).toBeUndefined(); // present, but mapped to .notdef
  });

  it('reports a truncated format 6 subtable as unreadable rather than reading past it', () => {
    const complete = buildFontWithCmapSubtable(1, 0, buildFormat6Subtable(0x41, [11, 12, 13]));
    const truncated = complete.subarray(0, complete.length - 2);
    const clipped = new Uint8Array(truncated.length);
    clipped.set(truncated);
    const font = parseSfnt(clipped);
    // The table directory still claims the full-length 'cmap', which no longer fits: the record is dropped, so the font parses with no 'cmap' at all.
    expect(font).toBeDefined();
    expect(buildCmapLookup(font!)).toBeUndefined();
  });
});

describe('degrading on an unusable cmap', () => {
  it('returns undefined for a font with no cmap table at all', () => {
    const bytes = carlitoRegularBytes();
    const font = parse(bytes);
    const withoutCmap: SfntFont = { bytes: font.bytes, tables: new Map([...font.tables].filter(([tag]) => tag !== 'cmap')) };
    expect(buildCmapLookup(withoutCmap)).toBeUndefined();
  });

  it('returns undefined for a font whose only subtable is in a format this module does not read', () => {
    // Format 0 (byte encoding table): the original 1-byte Macintosh mapping, deliberately unread.
    const format0 = new Uint8Array(262);
    new DataView(format0.buffer).setUint16(2, format0.length);
    expect(buildCmapLookup(parse(buildFontWithCmapSubtable(1, 0, format0)))).toBeUndefined();
  });
});
