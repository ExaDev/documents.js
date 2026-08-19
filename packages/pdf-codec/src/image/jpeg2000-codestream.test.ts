import { describe, expect, it } from 'vitest';
import { JPEG2000_FIXTURES, jpeg2000FixtureBytes } from '../test-support/jpeg2000';
import { parseJpeg2000Codestream } from './jpeg2000-codestream';
import { Jpeg2000ParseError, Jpeg2000UnsupportedError } from './jpeg2000-errors';

function fixture(name: string): Uint8Array<ArrayBuffer> {
  const found = JPEG2000_FIXTURES.find((candidate) => candidate.name === name);
  expect(found).toBeDefined();
  return jpeg2000FixtureBytes(found?.codestream ?? '');
}

describe('parseJpeg2000Codestream', () => {
  it('reads the geometry, coding style and quantization of a real main header', () => {
    const codestream = parseJpeg2000Codestream(fixture('ramp-basic'));
    expect(codestream.siz).toMatchObject({ xsiz: 32, ysiz: 24, xosiz: 0, yosiz: 0, xtsiz: 32, ytsiz: 24, xtosiz: 0, ytosiz: 0 });
    expect(codestream.siz.components).toEqual([{ signed: false, bitDepth: 8, dx: 1, dy: 1 }]);
    expect(codestream.main.cod).toMatchObject({
      decompositionLevels: 2,
      codeBlockWidthExp: 6,
      codeBlockHeightExp: 6,
      codeBlockStyle: 0,
      transform: 'reversible-5-3',
      progressionOrder: 'LRCP',
      layers: 1,
      multipleComponentTransform: false,
      useSop: false,
      useEph: false,
    });
    // No explicit precinct sizes were transmitted, so every resolution level takes the maximal partition -- one precinct covering the whole level.
    expect(codestream.main.cod?.precinctSizes).toEqual([
      { ppx: 15, ppy: 15 },
      { ppx: 15, ppy: 15 },
      { ppx: 15, ppy: 15 },
    ]);
    expect(codestream.main.qcd).toMatchObject({ style: 'none', guardBits: 2 });
    // One step size per subband: the lowest level's LL, then three per decomposition level.
    expect(codestream.main.qcd?.stepSizes).toHaveLength(3 * 2 + 1);
    expect(codestream.truncated).toBe(false);
  });

  it('reads explicit precinct sizes when the coding style declares them', () => {
    const codestream = parseJpeg2000Codestream(fixture('precincts'));
    // SPcod lists one packed exponent pair per resolution level starting at level 0. Every level is partitioned at 2^4, which for this fixture's own dimensions splits the higher levels into several precincts each rather than leaving one covering the whole level.
    expect(codestream.main.cod?.precinctSizes).toEqual([
      { ppx: 4, ppy: 4 },
      { ppx: 4, ppy: 4 },
      { ppx: 4, ppy: 4 },
    ]);
    // The guard that makes this fixture worth having: a partition wider than the level it applies to leaves one precinct covering everything and exercises nothing, which is exactly what an earlier version of this fixture did.
    expect(2 ** 4).toBeLessThan(codestream.siz.xsiz - codestream.siz.xosiz);
    expect(2 ** 4).toBeLessThan(codestream.siz.ysiz - codestream.siz.yosiz);
  });

  it('reads the mantissa and exponent of an irreversible quantization', () => {
    const codestream = parseJpeg2000Codestream(fixture('irreversible-photo'));
    expect(codestream.main.qcd?.style).toBe('expounded');
    expect(codestream.main.cod?.transform).toBe('irreversible-9-7');
    // An expounded quantization transmits a two-byte exponent/mantissa pair per subband, and a real encoder's mantissas are not all zero.
    expect(codestream.main.qcd?.stepSizes.some((step) => step.mantissa !== 0)).toBe(true);
  });

  it('splits a multi-tile codestream into one tile-part per tile, each with its own data extent', () => {
    const codestream = parseJpeg2000Codestream(fixture('multi-tile'));
    expect(codestream.numTilesWide * codestream.numTilesHigh).toBe(codestream.tileParts.length);
    expect(codestream.tileParts.map((part) => part.tileIndex)).toEqual(codestream.tileParts.map((_, index) => index));
    for (const part of codestream.tileParts) {
      expect(part.dataEnd).toBeGreaterThan(part.dataStart);
      expect(part.dataEnd).toBeLessThanOrEqual(codestream.bytes.length);
    }
  });

  it('records the encoder comment a COM marker carries', () => {
    expect(parseJpeg2000Codestream(fixture('ramp-basic')).comments.join(' ')).toContain('OpenJPEG');
  });

  it('reports a codestream that ends without an EOC marker as truncated', () => {
    const full = fixture('ramp-basic');
    expect(parseJpeg2000Codestream(full).truncated).toBe(false);
    expect(parseJpeg2000Codestream(full.subarray(0, full.length - 30)).truncated).toBe(true);
  });

  it('rejects a codestream that does not begin with SOC followed by SIZ', () => {
    const original = fixture('ramp-basic');
    const noSoc = new Uint8Array(original);
    noSoc[1] = 0x4e;
    expect(() => parseJpeg2000Codestream(noSoc)).toThrow(/SOC/);

    const noSiz = new Uint8Array(original);
    noSiz[3] = 0x52;
    expect(() => parseJpeg2000Codestream(noSiz)).toThrow(/SIZ/);
  });

  it('rejects an SOT whose declared length is not the fixed ten bytes', () => {
    const original = fixture('ramp-basic');
    const sotOffset = findMarker(original, 0xff90);
    const broken = new Uint8Array(original);
    broken[sotOffset + 3] = 12;
    expect(() => parseJpeg2000Codestream(broken)).toThrow(Jpeg2000ParseError);
  });

  it('refuses a codestream whose packet headers live in a PPM marker rather than inline', () => {
    const original = fixture('ramp-basic');
    // Turn the main header's COM segment into a PPM one; its length field stays valid, so the refusal is about the marker and nothing else.
    const comOffset = findMarker(original, 0xff64);
    const asPpm = new Uint8Array(original);
    asPpm[comOffset + 1] = 0x60;
    expect(() => parseJpeg2000Codestream(asPpm)).toThrow(Jpeg2000UnsupportedError);
    expect(() => parseJpeg2000Codestream(asPpm)).toThrow(/PPM/);
  });

  it('rejects a marker segment declaring more data than the codestream carries', () => {
    const original = fixture('ramp-basic');
    const comOffset = findMarker(original, 0xff64);
    const broken = new Uint8Array(original);
    broken[comOffset + 2] = 0x7f;
    expect(() => parseJpeg2000Codestream(broken)).toThrow(Jpeg2000ParseError);
  });
});

// Walks the main header's marker segments to the first occurrence of `marker`, returning the offset of the marker itself. Used instead of a fixed offset because a COM segment's length varies with the encoder's own version string.
function findMarker(data: Uint8Array<ArrayBuffer>, marker: number): number {
  let position = 4 + ((data[4] ?? 0) << 8) + (data[5] ?? 0);
  for (;;) {
    const current = ((data[position] ?? 0) << 8) | (data[position + 1] ?? 0);
    if (current === marker) {
      return position;
    }
    if (position >= data.length - 4) {
      throw new Error(`marker 0x${marker.toString(16)} not found in the fixture's main header`);
    }
    position += 2 + (((data[position + 2] ?? 0) << 8) | (data[position + 3] ?? 0));
  }
}
