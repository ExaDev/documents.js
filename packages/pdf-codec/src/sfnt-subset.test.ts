import { describe, expect, it } from 'vitest';
import { STIX_TWO_MATH_FONT_BASE64 } from './assets/stix-two-math-font';
import { buildCmapLookup } from './cmap-table';
import { parseHead, parseMaxp, parseName, parseOs2, parsePost } from './font-tables';
import type { GlyfTable } from './glyf';
import { parseGlyf, parseLoca } from './glyf';
import { parseHmtx } from './hmtx-table';
import type { SfntFont } from './sfnt';
import { parseSfnt } from './sfnt';
import { subsetSfnt } from './sfnt-subset';
import { caladeaRegularBytes, carlitoRegularBytes } from './test-support/fonts';
import { base64ToBytes } from './util/base64';

// A real round trip: subset a genuine vendored face down to the glyphs one short string needs, then read the output back through this package's own sfnt/font-tables/glyf/hmtx parsers and check it against the font it was cut from. The container itself is checked by a second, independent reader written here with a bare DataView -- deliberately not this package's own parseSfnt -- so a directory this subsetter writes wrongly cannot be validated by the same assumptions that wrote it.
//
// The test string is chosen for what it forces the subsetter to do rather than for being pretty: 'o' with a diaeresis and 'C' with a cedilla are composite glyphs in these faces, and the digits are composites in Carlito too, so a subset that copied only the glyphs the 'cmap' resolves would emit visibly broken characters. Every component those composites reference has to come along transitively.
const TEXT = 'Hello, wörld! Ça va? 42';

function codePointsOf(text: string): number[] {
  return [...new Set([...text].map((character) => character.codePointAt(0)!))];
}

interface LoadedFont {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly sfnt: SfntFont;
  readonly numGlyphs: number;
  readonly glyf: GlyfTable;
}

function load(bytes: Uint8Array<ArrayBuffer>): LoadedFont {
  const sfnt = parseSfnt(bytes);
  if (sfnt === undefined) {
    throw new Error('font failed to parse as an sfnt container');
  }
  const head = parseHead(sfnt);
  const maxp = parseMaxp(sfnt);
  if (head === undefined || maxp === undefined) {
    throw new Error('font is missing head/maxp');
  }
  const glyf = parseGlyf(sfnt, { numGlyphs: maxp.numGlyphs, indexToLocFormat: head.indexToLocFormat });
  if (glyf === undefined) {
    throw new Error('font has no readable glyf/loca');
  }
  return { bytes, sfnt, numGlyphs: maxp.numGlyphs, glyf };
}

// An independent sfnt table-directory reader, over a bare DataView, for checking the container this subsetter emits without going through the reader that shares its assumptions.
interface DirectoryRecord {
  readonly tag: string;
  readonly checkSum: number;
  readonly offset: number;
  readonly length: number;
}

interface Directory {
  readonly sfntVersion: number;
  readonly numTables: number;
  readonly searchRange: number;
  readonly entrySelector: number;
  readonly rangeShift: number;
  readonly records: readonly DirectoryRecord[];
}

function readDirectory(bytes: Uint8Array<ArrayBuffer>): Directory {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = view.getUint16(4);
  const records: DirectoryRecord[] = [];
  for (let i = 0; i < numTables; i++) {
    const recordOffset = 12 + i * 16;
    let tag = '';
    for (let c = 0; c < 4; c++) {
      tag += String.fromCharCode(view.getUint8(recordOffset + c));
    }
    records.push({ tag, checkSum: view.getUint32(recordOffset + 4), offset: view.getUint32(recordOffset + 8), length: view.getUint32(recordOffset + 12) });
  }
  return { sfntVersion: view.getUint32(0), numTables, searchRange: view.getUint16(6), entrySelector: view.getUint16(8), rangeShift: view.getUint16(10), records };
}

function sumRegion(view: DataView, offset: number, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i += 4) {
    sum = (sum + view.getUint32(offset + i)) >>> 0;
  }
  return sum;
}

const CHECKSUM_ADJUSTMENT_MAGIC = 0xb1b0afba;

// A copy of the font with 'head's own checkSumAdjustment zeroed -- the form every checksum in the file is defined against, both the head record's own and the whole-file sum the adjustment is then derived from (clause 4.1).
function withZeroedCheckSumAdjustment(bytes: Uint8Array<ArrayBuffer>, headOffset: number): DataView {
  const zeroed = new Uint8Array(bytes);
  zeroed.fill(0, headOffset + 8, headOffset + 12);
  return new DataView(zeroed.buffer);
}

function expectEveryRecordChecksumToVerify(bytes: Uint8Array<ArrayBuffer>): void {
  const directory = readDirectory(bytes);
  const headRecord = directory.records.find((record) => record.tag === 'head');
  expect(headRecord).toBeDefined();
  const view = withZeroedCheckSumAdjustment(bytes, headRecord!.offset);
  for (const record of directory.records) {
    expect({ tag: record.tag, checkSum: record.checkSum }).toEqual({ tag: record.tag, checkSum: sumRegion(view, record.offset, Math.ceil(record.length / 4) * 4) });
  }
}

// A used glyph's own bytes survive verbatim, followed only by the zero bytes that pad it onto the next four-byte boundary. The padding lands inside this glyph's own 'loca' range by construction (the next entry points past it), which is exactly how the format expresses alignment -- a consumer reads the header and contour data and never reaches the padding.
function expectGlyphOutlinePreserved(source: GlyfTable, subset: GlyfTable, glyphId: number): void {
  const original = source.glyphBytes(glyphId);
  const copied = subset.glyphBytes(glyphId);
  expect(original).toBeDefined();
  expect(copied).toBeDefined();
  expect([...copied!.subarray(0, original!.length)]).toEqual([...original!]);
  expect(copied!.length).toBe(Math.ceil(original!.length / 4) * 4);
  expect([...copied!.subarray(original!.length)]).toEqual(Array<number>(copied!.length - original!.length).fill(0));
}

function subsetCarlito(text: string = TEXT): { source: LoadedFont; subset: LoadedFont; glyphIds: readonly number[]; unmappedCodePoints: readonly number[] } {
  const source = load(carlitoRegularBytes());
  const result = subsetSfnt(source.sfnt, codePointsOf(text));
  if (result === undefined) {
    throw new Error('subsetting the vendored Carlito Regular failed');
  }
  return { source, subset: load(result.bytes), glyphIds: result.glyphIds, unmappedCodePoints: result.unmappedCodePoints };
}

// Every glyph ID below is the real one Carlito Regular's own 'cmap' resolves these characters to (cross-checked in src/cmap-table.test.ts and src/glyf.test.ts against the .ttf read with a bare DataView). Glyph 2781 is the interesting one: no character in the test string maps to it, but Carlito's 'ö', '2', and '4' are all composites that reference it, so it is in the subset only because the component walk put it there.
const CARLITO_GLYPH_IDS = [0, 2, 8, 15, 45, 55, 59, 111, 117, 136, 137, 308, 309, 311, 393, 395, 401, 403, 485, 1140, 2142, 2781];
const CARLITO_HIGHEST_USED_GLYPH_ID = 2781;
const CARLITO_SOURCE_NUM_GLYPHS = 2783;

describe('subsetSfnt against real Carlito Regular', () => {
  it('carries exactly the glyphs the text needs, plus .notdef and every composite component', () => {
    const { glyphIds, unmappedCodePoints } = subsetCarlito();
    expect(glyphIds).toEqual(CARLITO_GLYPH_IDS);
    expect(unmappedCodePoints).toEqual([]);
    expect(glyphIds).toContain(0); // .notdef, whether or not any character mapped to it
  });

  it('follows composite components transitively, keeping a glyph no code point maps to', () => {
    const { source, glyphIds } = subsetCarlito();
    const cmap = buildCmapLookup(source.sfnt);
    expect(cmap).toBeDefined();
    const directlyMapped = new Set(codePointsOf(TEXT).map((codePoint) => cmap!(codePoint)));
    expect(directlyMapped.has(CARLITO_HIGHEST_USED_GLYPH_ID)).toBe(false);
    expect(glyphIds).toContain(CARLITO_HIGHEST_USED_GLYPH_ID);
    // Every component of every composite the subset carries is itself in the subset -- the property that makes a GID-preserving byte-verbatim copy safe.
    const used = new Set(glyphIds);
    let compositesChecked = 0;
    for (const glyphId of glyphIds) {
      const components = source.glyf.compositeComponents(glyphId);
      if (components === undefined) {
        continue;
      }
      compositesChecked++;
      for (const component of components) {
        expect(used.has(component.glyphIndex)).toBe(true);
      }
    }
    expect(compositesChecked).toBe(3); // 'ö', '2', and '4'
  });

  it("reproduces every used glyph's outline bytes byte-identically", () => {
    const { source, subset, glyphIds } = subsetCarlito();
    for (const glyphId of glyphIds) {
      expectGlyphOutlinePreserved(source.glyf, subset.glyf, glyphId);
    }
    // Not vacuous: the glyphs really do carry outline data, and a composite's own component records survived the copy unrenumbered.
    expect(source.glyf.glyphBytes(2142)!.length).toBeGreaterThan(0);
    expect(subset.glyf.compositeComponents(2142)?.map((component) => component.glyphIndex)).toEqual(source.glyf.compositeComponents(2142)?.map((component) => component.glyphIndex));
  });

  it('preserves glyph IDs: every unused slot below the highest used one is present but empty', () => {
    const { subset, glyphIds } = subsetCarlito();
    expect(subset.numGlyphs).toBe(CARLITO_HIGHEST_USED_GLYPH_ID + 1);
    const used = new Set(glyphIds);
    let emptySlots = 0;
    for (let glyphId = 0; glyphId < subset.numGlyphs; glyphId++) {
      if (used.has(glyphId)) {
        continue;
      }
      expect(subset.glyf.glyphBytes(glyphId)).toEqual(new Uint8Array(0));
      emptySlots++;
    }
    expect(emptySlots).toBe(subset.numGlyphs - glyphIds.length);
  });

  it('keeps every glyph advance width the source font declares', () => {
    const { source, subset, glyphIds } = subsetCarlito();
    const sourceHmtx = parseHmtx(source.sfnt);
    const subsetHmtx = parseHmtx(subset.sfnt);
    for (const glyphId of glyphIds) {
      expect(subsetHmtx.advanceWidth(glyphId)).toBe(sourceHmtx.advanceWidth(glyphId));
    }
    // Concrete values, so a subset that returned a constant for every glyph would not pass: 'H', 'l', and the space.
    expect(subsetHmtx.advanceWidth(15)).toBe(1276);
    expect(subsetHmtx.advanceWidth(1140)).toBe(470);
    expect(subsetHmtx.advanceWidth(2)).toBe(463);
    // Every slot, used or not, has a real record: the subset's own hhea declares one metric per glyph.
    for (let glyphId = 0; glyphId < subset.numGlyphs; glyphId++) {
      expect(subsetHmtx.advanceWidth(glyphId)).toBe(sourceHmtx.advanceWidth(glyphId));
    }
  });

  it('rebuilds head, hhea, and maxp consistently with the subset it actually wrote', () => {
    const { subset } = subsetCarlito();
    const head = parseHead(subset.sfnt);
    const maxp = parseMaxp(subset.sfnt);
    expect(head?.indexToLocFormat).toBe(1); // long, always -- one code path, legal whatever the source font used
    expect(maxp?.numGlyphs).toBe(subset.numGlyphs);
    const hhea = subset.sfnt.tables.get('hhea');
    expect(hhea?.length).toBe(36);
    const view = new DataView(subset.bytes.buffer, subset.bytes.byteOffset, subset.bytes.byteLength);
    expect(view.getUint16(hhea!.offset + 34)).toBe(subset.numGlyphs); // numberOfHMetrics
    // The design grid and bounding box are the source's own, unchanged: a subset renders on the same grid as the font it came from.
    const sourceHead = parseHead(load(carlitoRegularBytes()).sfnt);
    expect(head?.unitsPerEm).toBe(sourceHead?.unitsPerEm);
    expect([head?.xMin, head?.yMin, head?.xMax, head?.yMax]).toEqual([sourceHead?.xMin, sourceHead?.yMin, sourceHead?.xMax, sourceHead?.yMax]);
    // 'loca' is one long entry per glyph plus the terminator, and its terminator is the whole length of the 'glyf' table it indexes.
    const loca = parseLoca(subset.sfnt, { numGlyphs: subset.numGlyphs, indexToLocFormat: 1 });
    expect(loca?.length).toBe(subset.numGlyphs + 1);
    expect(loca?.[subset.numGlyphs]).toBe(subset.sfnt.tables.get('glyf')?.length);
    expect(subset.sfnt.tables.get('loca')?.length).toBe((subset.numGlyphs + 1) * 4);
  });

  it('keeps the hinting programs and drops the tables an embedded CIDFontType2 program never needs', () => {
    const { source, subset } = subsetCarlito();
    for (const tag of ['cvt ', 'fpgm', 'prep']) {
      const original = source.sfnt.tables.get(tag);
      const copied = subset.sfnt.tables.get(tag);
      expect(original).toBeDefined();
      expect(copied?.length).toBe(original?.length);
      expect([...subset.bytes.subarray(copied!.offset, copied!.offset + copied!.length)]).toEqual([...source.bytes.subarray(original!.offset, original!.offset + original!.length)]);
    }
    for (const tag of ['cmap', 'name', 'OS/2', 'GSUB', 'GPOS', 'GDEF', 'kern']) {
      expect(source.sfnt.tables.has(tag) || tag === 'kern').toBe(true); // the source really does ship these, so their absence below is a removal rather than a coincidence
      expect(subset.sfnt.tables.has(tag)).toBe(false);
    }
    expect(buildCmapLookup(subset.sfnt)).toBeUndefined();
    expect(parseName(subset.sfnt)).toBeUndefined();
    expect(parseOs2(subset.sfnt)).toBeUndefined();
    // 'post' survives only as a version 3.0 header: no glyph names, but the source's own italic angle and underline geometry carried over.
    const post = parsePost(subset.sfnt);
    const sourcePost = parsePost(source.sfnt);
    expect(subset.sfnt.tables.get('post')?.length).toBe(32);
    expect(post?.version).toBe(0x00030000);
    expect(post?.italicAngle).toBe(sourcePost?.italicAngle);
    expect(post?.underlinePosition).toBe(sourcePost?.underlinePosition);
    expect(post?.underlineThickness).toBe(sourcePost?.underlineThickness);
  });

  it('emits a well-formed sfnt container: sorted, aligned table records whose checksums all verify', () => {
    const { subset } = subsetCarlito();
    const directory = readDirectory(subset.bytes);
    const view = new DataView(subset.bytes.buffer, subset.bytes.byteOffset, subset.bytes.byteLength);

    expect(directory.sfntVersion).toBe(0x00010000);
    expect(directory.numTables).toBe(10); // glyf, head, hhea, hmtx, loca, maxp, post + cvt , fpgm, prep
    expect(directory.records.map((record) => record.tag)).toEqual(['cvt ', 'fpgm', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'post', 'prep']);
    // Binary-search hints, as clause 4.2 defines them: the largest power of two at or below numTables, times the record size.
    expect(directory.entrySelector).toBe(3); // 2^3 = 8 <= 10 < 16
    expect(directory.searchRange).toBe(8 * 16);
    expect(directory.rangeShift).toBe(10 * 16 - 8 * 16);

    expect(subset.bytes.length % 4).toBe(0);
    let expectedOffset = Math.ceil((12 + directory.numTables * 16) / 4) * 4;
    for (const record of directory.records) {
      expect(record.offset % 4).toBe(0);
      expect(record.offset).toBe(expectedOffset);
      expect(record.offset + record.length).toBeLessThanOrEqual(subset.bytes.length);
      // The inter-table padding really is zero, rather than whatever happened to follow.
      const paddedLength = Math.ceil(record.length / 4) * 4;
      for (let i = record.length; i < paddedLength; i++) {
        expect(view.getUint8(record.offset + i)).toBe(0);
      }
      expectedOffset += paddedLength;
    }
    expect(expectedOffset).toBe(subset.bytes.length);

    // Each record's checksum is the sum of its table's own zero-padded uint32s -- for 'head', of the table as it stands with checkSumAdjustment zeroed, which is what the spec defines that one record's checksum against.
    expectEveryRecordChecksumToVerify(subset.bytes);

    // head.checkSumAdjustment itself: the whole file, with that one field zeroed, must sum to the magic constant once the stored adjustment is added back.
    const headRecord = directory.records.find((record) => record.tag === 'head');
    expect(headRecord).toBeDefined();
    const storedAdjustment = view.getUint32(headRecord!.offset + 8);
    const zeroedSum = sumRegion(withZeroedCheckSumAdjustment(subset.bytes, headRecord!.offset), 0, subset.bytes.length);
    expect(storedAdjustment).toBe((CHECKSUM_ADJUSTMENT_MAGIC - zeroedSum) >>> 0);
    expect((zeroedSum + storedAdjustment) >>> 0).toBe(CHECKSUM_ADJUSTMENT_MAGIC);
    expect(storedAdjustment).not.toBe(0);
  });

  it('cuts a 613 KiB face down to under a twentieth of its size for a short string', () => {
    const { source, subset, glyphIds } = subsetCarlito();
    expect(source.numGlyphs).toBe(CARLITO_SOURCE_NUM_GLYPHS);
    expect(glyphIds.length).toBeLessThan(source.numGlyphs / 100);
    expect(subset.bytes.length).toBeLessThan(source.bytes.length / 20);
    // The outlines are what collapses: the source's own 'glyf' is ~500 KB, the subset's a few KB. What remains is dominated by the GID-preserving 'loca'/'hmtx' pair, which stays proportional to the HIGHEST used glyph ID rather than to the number of glyphs kept -- the deliberate, documented cost of never renumbering.
    expect(subset.sfnt.tables.get('glyf')!.length).toBeLessThan(source.sfnt.tables.get('glyf')!.length / 100);
    expect(subset.sfnt.tables.get('loca')!.length).toBe((CARLITO_HIGHEST_USED_GLYPH_ID + 2) * 4);
  });

  it('reports a code point the face has no glyph for rather than dropping it silently', () => {
    const source = load(carlitoRegularBytes());
    const result = subsetSfnt(source.sfnt, [0x41, 0x4e2d, 0x1d400]); // 'A', a CJK ideograph, and a mathematical bold capital A -- neither of the last two is in Carlito
    expect(result).toBeDefined();
    expect(result!.unmappedCodePoints).toEqual([0x4e2d, 0x1d400]);
    expect(result!.glyphIds).toEqual([0, 3]); // .notdef and 'A'
  });

  it('subsets down to nothing but .notdef when asked for no code points at all', () => {
    const source = load(carlitoRegularBytes());
    const result = subsetSfnt(source.sfnt, []);
    expect(result).toBeDefined();
    expect(result!.glyphIds).toEqual([0]);
    expect(result!.numGlyphs).toBe(1);
    const subset = load(result!.bytes);
    expectGlyphOutlinePreserved(source.glyf, subset.glyf, 0);
  });
});

describe('subsetSfnt against real Caladea Regular, a short-loca source', () => {
  it('rewrites a short loca index as a long one without disturbing a single outline byte', () => {
    const source = load(caladeaRegularBytes());
    expect(parseHead(source.sfnt)?.indexToLocFormat).toBe(0); // the source really is short-format, so the conversion below is exercised
    const result = subsetSfnt(source.sfnt, codePointsOf(TEXT));
    expect(result).toBeDefined();
    const subset = load(result!.bytes);
    expect(parseHead(subset.sfnt)?.indexToLocFormat).toBe(1);
    for (const glyphId of result!.glyphIds) {
      expectGlyphOutlinePreserved(source.glyf, subset.glyf, glyphId);
    }
    const sourceHmtx = parseHmtx(source.sfnt);
    const subsetHmtx = parseHmtx(subset.sfnt);
    for (const glyphId of result!.glyphIds) {
      expect(subsetHmtx.advanceWidth(glyphId)).toBe(sourceHmtx.advanceWidth(glyphId));
    }
    // Caladea nests composites one level deeper than Carlito does, which is what makes the closure genuinely transitive rather than one-level: 'Ç' (222) is assembled from 'C' (45) and a cedilla (295), and that cedilla is itself a composite referring to glyph 280. Nothing in the test string maps to either 295 or 280.
    expect(source.glyf.compositeComponents(222)?.map((component) => component.glyphIndex)).toEqual([45, 295]);
    expect(source.glyf.compositeComponents(295)?.map((component) => component.glyphIndex)).toEqual([280]);
    expect(result!.glyphIds).toContain(295);
    expect(result!.glyphIds).toContain(280);
    // That cedilla carries a zero advance width -- a real value a subsetter must copy rather than treat as a missing metric.
    expect(subsetHmtx.advanceWidth(295)).toBe(0);
    // Every record's checksum still verifies for a font whose tables are laid out at completely different lengths from Carlito's.
    expectEveryRecordChecksumToVerify(result!.bytes);
  });
});

describe('fonts subsetSfnt declines to subset', () => {
  it('returns undefined for a CFF-flavoured font, which has no glyf outlines to copy', () => {
    const bytes = base64ToBytes(STIX_TWO_MATH_FONT_BASE64);
    const font = parseSfnt(bytes);
    expect(font).toBeDefined();
    expect(font!.tables.has('CFF ')).toBe(true);
    expect(font!.tables.has('glyf')).toBe(false);
    expect(subsetSfnt(font!, [0x41])).toBeUndefined();
  });

  it('returns undefined rather than inventing an advance width for a truncated hmtx', () => {
    const bytes = carlitoRegularBytes();
    const truncated = new Uint8Array(bytes);
    const directory = readDirectory(truncated);
    const hmtxIndex = directory.records.findIndex((record) => record.tag === 'hmtx');
    expect(hmtxIndex).toBeGreaterThanOrEqual(0);
    // Only the record's declared length is cut, so the container still parses and every other table is untouched -- the failure has to come from the subsetter refusing to guess at a metric it cannot read.
    new DataView(truncated.buffer).setUint32(12 + hmtxIndex * 16 + 12, 8);
    const font = parseSfnt(truncated);
    expect(font).toBeDefined();
    expect(subsetSfnt(font!, codePointsOf(TEXT))).toBeUndefined();
  });

  it('returns undefined for a font whose glyf table is missing entirely', () => {
    const bytes = carlitoRegularBytes();
    const patched = new Uint8Array(bytes);
    const directory = readDirectory(patched);
    const glyfIndex = directory.records.findIndex((record) => record.tag === 'glyf');
    // Repointing the record past the end of the file makes parseSfnt drop that one table, exactly as it would for a genuinely truncated font.
    new DataView(patched.buffer).setUint32(12 + glyfIndex * 16 + 8, patched.length + 4);
    const font = parseSfnt(patched);
    expect(font?.tables.has('glyf')).toBe(false);
    expect(subsetSfnt(font!, codePointsOf(TEXT))).toBeUndefined();
  });
});
