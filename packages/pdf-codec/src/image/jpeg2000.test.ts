import { describe, expect, it } from 'vitest';
import { JPEG2000_FIXTURES, jpeg2000FixtureBytes, jpeg2000FixtureSamples } from '../test-support/jpeg2000';
import { Jpeg2000ParseError, Jpeg2000UnsupportedError } from './jpeg2000-errors';
import { decodeJpeg2000, readJpeg2000Metadata } from './jpeg2000';

// The lossy fixtures have no exact answer to reproduce (see src/test-support/jpeg2000.ts), so they are held to the tightest bound that is meaningful at all: every sample within one of what OpenJPEG's own decoder produced, and all but a small fraction of them identical. A wrong context label, a wrong subband gain or a wrong lifting constant does not land inside a bound like this -- it lands orders of magnitude outside it.
const IRREVERSIBLE_MAX_SAMPLE_DIFFERENCE = 1;
const IRREVERSIBLE_MAX_DIFFERING_FRACTION = 0.01;

describe('decodeJpeg2000: real OpenJPEG-produced codestreams', () => {
  for (const fixture of JPEG2000_FIXTURES.filter((candidate) => !candidate.undecodable)) {
    it(`decodes "${fixture.name}" (${fixture.description})`, () => {
      const warnings: string[] = [];
      const image = decodeJpeg2000(jpeg2000FixtureBytes(fixture.codestream), { onWarning: (message) => warnings.push(message) });
      expect(warnings).toEqual([]);
      expect({ width: image.width, height: image.height, components: image.components.length, bitDepth: image.bitDepth }).toEqual({
        width: fixture.width,
        height: fixture.height,
        components: fixture.componentCount,
        bitDepth: fixture.bitDepth,
      });

      const expected = jpeg2000FixtureSamples(fixture);
      if (fixture.lossless) {
        for (let c = 0; c < fixture.componentCount; c++) {
          expect(Array.from(image.components[c] ?? [])).toEqual(expected[c]);
        }
        return;
      }

      let differing = 0;
      let worst = 0;
      let total = 0;
      for (let c = 0; c < fixture.componentCount; c++) {
        const decoded = image.components[c] ?? new Int32Array(0);
        const reference = expected[c] ?? [];
        for (let i = 0; i < reference.length; i++) {
          const difference = Math.abs((decoded[i] ?? 0) - (reference[i] ?? 0));
          total++;
          if (difference !== 0) {
            differing++;
            worst = Math.max(worst, difference);
          }
        }
      }
      expect(worst).toBeLessThanOrEqual(IRREVERSIBLE_MAX_SAMPLE_DIFFERENCE);
      expect(differing / total).toBeLessThan(IRREVERSIBLE_MAX_DIFFERING_FRACTION);
    });
  }

  it('covers every coding feature the fixture set is meant to exercise', () => {
    // A guard against a regeneration quietly dropping a whole feature: each of these names a fixture the battery above would otherwise stop exercising without any test failing.
    const required = [
      'ramp-no-wavelet',
      'ramp-one-decomposition',
      'odd-dimensions',
      'tiny',
      'single-sample',
      'deep-12-bit',
      'colour-rct',
      'colour-no-mct',
      'multi-tile',
      'origin-offset',
      'origin-offset-tiles',
      'multi-layer',
      'small-code-blocks',
      'precincts',
      'progression-rlcp',
      'progression-rpcl',
      'progression-cprl',
      'progression-rpcl-subdivided',
      'sop-eph',
      'vertically-causal',
      'segmentation-symbols',
      'reset-contexts',
      'jp2-container',
      'irreversible-photo',
      'irreversible-lossy',
      'irreversible-colour',
      'irreversible-tiles',
    ];
    for (const name of required) {
      expect(JPEG2000_FIXTURES.map((fixture) => fixture.name)).toContain(name);
    }
  });

  it('recovers genuinely varied content, not a flat plane a trivially wrong decoder could also produce', () => {
    const fixture = JPEG2000_FIXTURES.find((candidate) => candidate.name === 'photo-many-levels');
    expect(fixture).toBeDefined();
    const image = decodeJpeg2000(jpeg2000FixtureBytes(fixture?.codestream ?? ''));
    const distinct = new Set(image.components[0] ?? []);
    expect(distinct.size).toBeGreaterThan(20);
  });
});

describe('readJpeg2000Metadata', () => {
  it('reads the coding parameters of a bare codestream', () => {
    const fixture = JPEG2000_FIXTURES.find((candidate) => candidate.name === 'photo-many-levels');
    const metadata = readJpeg2000Metadata(jpeg2000FixtureBytes(fixture?.codestream ?? ''));
    expect(metadata).toMatchObject({
      width: fixture?.width,
      height: fixture?.height,
      decompositionLevels: 4,
      transform: 'reversible-5-3',
      progressionOrder: 'LRCP',
      layers: 1,
      codeBlockWidth: 64,
      codeBlockHeight: 64,
      quantizationStyle: 'none',
      tilesWide: 1,
      tilesHigh: 1,
      truncated: false,
      decodable: true,
    });
    expect(metadata.components).toEqual([{ bitDepth: 8, signed: false, dx: 1, dy: 1 }]);
    expect(metadata.comments.join(' ')).toContain('OpenJPEG');
  });

  it('reads a JP2 container box structure alongside the codestream it wraps', () => {
    const fixture = JPEG2000_FIXTURES.find((candidate) => candidate.name === 'jp2-container');
    const metadata = readJpeg2000Metadata(jpeg2000FixtureBytes(fixture?.codestream ?? ''));
    expect(metadata.colourSpace).toBe('srgb');
    expect(metadata.components).toHaveLength(3);
    expect(metadata.multipleComponentTransform).toBe(true);
  });

  it('reports the tile grid of a multi-tile codestream', () => {
    const fixture = JPEG2000_FIXTURES.find((candidate) => candidate.name === 'multi-tile');
    const metadata = readJpeg2000Metadata(jpeg2000FixtureBytes(fixture?.codestream ?? ''));
    expect({ tileWidth: metadata.tileWidth, tileHeight: metadata.tileHeight }).toEqual({ tileWidth: 16, tileHeight: 16 });
    expect(metadata.tilesWide * metadata.tilesHigh).toBe(metadata.tilePartCount);
    expect(metadata.tilePartCount).toBeGreaterThan(1);
  });

  it('reports the quality layer count and the markers a packet is framed by', () => {
    const layered = readJpeg2000Metadata(jpeg2000FixtureBytes(JPEG2000_FIXTURES.find((candidate) => candidate.name === 'multi-layer')?.codestream ?? ''));
    expect(layered.layers).toBe(3);
    const framed = readJpeg2000Metadata(jpeg2000FixtureBytes(JPEG2000_FIXTURES.find((candidate) => candidate.name === 'sop-eph')?.codestream ?? ''));
    expect({ sop: framed.usesSopMarkers, eph: framed.usesEphMarkers }).toEqual({ sop: true, eph: true });
  });

  it('reports the irreversible transform and still calls it decodable', () => {
    const metadata = readJpeg2000Metadata(jpeg2000FixtureBytes(JPEG2000_FIXTURES.find((candidate) => candidate.name === 'irreversible-photo')?.codestream ?? ''));
    expect(metadata.transform).toBe('irreversible-9-7');
    expect(metadata.quantizationStyle).toBe('expounded');
    expect(metadata.decodable).toBe(true);
  });
});

// Every refusal below patches a real, valid codestream so that exactly one thing differs, which is what makes it evidence about that one thing rather than about a broken file.
describe('decodeJpeg2000: scope refusals', () => {
  const fixture = JPEG2000_FIXTURES.find((candidate) => candidate.name === 'ramp-basic');
  const original = jpeg2000FixtureBytes(fixture?.codestream ?? '');

  // The SIZ marker segment starts at offset 4 (SOC is two bytes, the SIZ marker two more); its own length field is two bytes, then Rsiz, then the eight 32-bit geometry fields, then Csiz. The first component's Ssiz/XRsiz/YRsiz triple follows.
  const SIZ_COMPONENT_ZERO = 4 + 2 + 2 + 8 * 4 + 2;

  function patched(offset: number, value: number): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(original);
    copy[offset] = value;
    return copy;
  }

  it('refuses a sub-sampled component rather than resampling it', () => {
    // XRsiz of component 0, one byte past its Ssiz.
    const subsampled = patched(SIZ_COMPONENT_ZERO + 1, 2);
    expect(() => decodeJpeg2000(subsampled)).toThrow(Jpeg2000UnsupportedError);
    expect(() => decodeJpeg2000(subsampled)).toThrow(/sub-sampled/);
    expect(readJpeg2000Metadata(subsampled).decodable).toBe(false);
  });

  it('refuses the code-block styles whose segment structure it does not read, and accepts the ones it does', () => {
    // The COD marker's own code-block style byte, found by scanning for the marker rather than by a fixed offset, since a COM segment's length varies with the encoder's version string.
    const codOffset = findMarkerSegment(original, 0xff52);
    const styleOffset = codOffset + 2 + 2 + 1 + 1 + 2 + 1 + 1 + 1 + 1;
    for (const [flag, description] of [
      [0x01, /bypass/],
      [0x04, /terminates the arithmetic coder/],
    ] satisfies readonly (readonly [number, RegExp])[]) {
      const styled = patched(styleOffset, flag);
      expect(() => decodeJpeg2000(styled)).toThrow(description);
      expect(readJpeg2000Metadata(styled).decodable).toBe(false);
    }
    // Predictable termination changes nothing about how correct data decodes, so it is accepted rather than refused.
    expect(readJpeg2000Metadata(patched(styleOffset, 0x10)).decodable).toBe(true);
  });

  it('refuses a position-driven progression order whose precincts genuinely subdivide a resolution level, and says so before decoding', () => {
    // The one refusal that depends on two marker segments agreeing rather than on a single field, which is why it is tested against a real encoder's output rather than a patched codestream: readJpeg2000Metadata has to reach the same verdict decodeJpeg2000 does, or `decodable` would be a promise the decoder breaks.
    const entry = JPEG2000_FIXTURES.find((candidate) => candidate.name === 'progression-rpcl-subdivided');
    const bytes = jpeg2000FixtureBytes(entry?.codestream ?? '');
    const metadata = readJpeg2000Metadata(bytes);
    expect(metadata.progressionOrder).toBe('RPCL');
    expect(metadata.decodable).toBe(false);
    expect(metadata.undecodableReason).toMatch(/single precinct/);
    expect(() => decodeJpeg2000(bytes)).toThrow(Jpeg2000UnsupportedError);
    // The same progression order without subdivided precincts is decoded, so the refusal is about the combination and not about RPCL itself.
    expect(readJpeg2000Metadata(jpeg2000FixtureBytes(JPEG2000_FIXTURES.find((candidate) => candidate.name === 'progression-rpcl')?.codestream ?? '')).decodable).toBe(true);
  });

  it('rejects data that is neither a codestream nor a JP2 file', () => {
    expect(() => readJpeg2000Metadata(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(Jpeg2000ParseError);
  });

  it('reports a truncated codestream and still decodes the packets that did arrive', () => {
    const truncated = original.subarray(0, original.length - 40);
    const metadata = readJpeg2000Metadata(truncated);
    expect(metadata.truncated).toBe(true);
    const warnings: string[] = [];
    const image = decodeJpeg2000(truncated, { onWarning: (message) => warnings.push(message) });
    expect(warnings.join(' ')).toContain('truncated');
    expect({ width: image.width, height: image.height }).toEqual({ width: fixture?.width, height: fixture?.height });
  });
});

// Walks the main header's marker segments to the first occurrence of `marker`, returning the offset of the marker itself.
function findMarkerSegment(data: Uint8Array<ArrayBuffer>, marker: number): number {
  let position = 4 + ((data[4] ?? 0) << 8) + (data[5] ?? 0); // Past SOC and the whole SIZ segment.
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
