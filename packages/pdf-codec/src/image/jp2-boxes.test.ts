import { describe, expect, it } from 'vitest';
import { JPEG2000_FIXTURES, jpeg2000FixtureBytes } from '../test-support/jpeg2000';
import { Jpeg2000ParseError, Jpeg2000UnsupportedError } from './jpeg2000-errors';
import { looksLikeBareCodestream, parseJp2Container } from './jp2-boxes';

function fixture(name: string): Uint8Array<ArrayBuffer> {
  const found = JPEG2000_FIXTURES.find((candidate) => candidate.name === name);
  expect(found).toBeDefined();
  return jpeg2000FixtureBytes(found?.codestream ?? '');
}

// Builds a JP2 box: a 32-bit length, the four-character type, then the payload.
function box(type: string, payload: readonly number[]): number[] {
  const length = 8 + payload.length;
  return [(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff, ...Array.from(type, (character) => character.charCodeAt(0)), ...payload];
}

const SIGNATURE_BOX = box('jP  ', [0x0d, 0x0a, 0x87, 0x0a]);
const MINIMAL_CODESTREAM = [0xff, 0x4f, 0xff, 0x51];

function imageHeaderPayload(height: number, width: number, components: number, bpc: number): number[] {
  return [
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (components >>> 8) & 0xff,
    components & 0xff,
    bpc,
    7, // Compression type: 7 is the only value ISO/IEC 15444-1 I.5.3.1 defines.
    0,
    0,
  ];
}

describe('looksLikeBareCodestream', () => {
  it('recognises SOC immediately followed by SIZ, and nothing else', () => {
    expect(looksLikeBareCodestream(Uint8Array.from([0xff, 0x4f, 0xff, 0x51, 0x00]))).toBe(true);
    // A JP2 file always starts with the signature box's own length, 0x0000000C.
    expect(looksLikeBareCodestream(Uint8Array.from([0x00, 0x00, 0x00, 0x0c]))).toBe(false);
    expect(looksLikeBareCodestream(Uint8Array.from([0xff, 0x4f]))).toBe(false);
  });
});

describe('parseJp2Container', () => {
  it('hands a bare codestream straight back with no box information', () => {
    const bare = fixture('ramp-basic');
    const container = parseJp2Container(bare);
    expect(container.hasBoxes).toBe(false);
    expect(container.codestream).toBe(bare);
    expect(container.imageHeader).toBeUndefined();
    expect(container.colourSpace).toBeUndefined();
  });

  it('reads a real JP2 file produced by OpenJPEG', () => {
    const container = parseJp2Container(fixture('jp2-container'));
    expect(container.hasBoxes).toBe(true);
    expect(container.imageHeader).toEqual({ width: 32, height: 24, componentCount: 3, bitDepth: 8, signed: false });
    expect(container.colourSpace).toBe('srgb');
    expect(container.iccProfile).toBeUndefined();
    // The extracted codestream is the jp2c payload, which begins with its own SOC marker.
    expect(Array.from(container.codestream.subarray(0, 2))).toEqual([0xff, 0x4f]);
  });

  it('reads an image header whose per-component depths differ', () => {
    // A BPC of 255 means the components differ and a bpcc box carries the real depths; the codestream's own SIZ marker is authoritative either way, so no depth is reported here.
    const data = Uint8Array.from([...SIGNATURE_BOX, ...box('jp2h', box('ihdr', imageHeaderPayload(4, 5, 3, 0xff))), ...box('jp2c', MINIMAL_CODESTREAM)]);
    expect(parseJp2Container(data).imageHeader).toEqual({ width: 5, height: 4, componentCount: 3 });
  });

  it('keeps a restricted ICC profile without interpreting it', () => {
    const colr = box('colr', [2, 0, 0, 0xde, 0xad, 0xbe, 0xef]);
    const data = Uint8Array.from([...SIGNATURE_BOX, ...box('jp2h', [...box('ihdr', imageHeaderPayload(4, 5, 1, 7)), ...colr]), ...box('jp2c', MINIMAL_CODESTREAM)]);
    const container = parseJp2Container(data);
    expect(Array.from(container.iccProfile ?? [])).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(container.colourSpace).toBeUndefined();
  });

  it('reads channel definitions so an alpha channel is distinguishable from a colour one', () => {
    const cdef = box('cdef', [0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0]);
    const data = Uint8Array.from([...SIGNATURE_BOX, ...box('jp2h', [...box('ihdr', imageHeaderPayload(4, 5, 2, 7)), ...cdef]), ...box('jp2c', MINIMAL_CODESTREAM)]);
    expect(parseJp2Container(data).channelDefinitions).toEqual([
      { channel: 0, type: 0, association: 0 },
      { channel: 1, type: 1, association: 0 },
    ]);
  });

  it('treats a box declaring length zero as running to the end of the file', () => {
    const trailing = [0, 0, 0, 0, ...Array.from('jp2c', (character) => character.charCodeAt(0)), ...MINIMAL_CODESTREAM];
    const container = parseJp2Container(Uint8Array.from([...SIGNATURE_BOX, ...trailing]));
    expect(Array.from(container.codestream)).toEqual(MINIMAL_CODESTREAM);
  });

  it('follows a 64-bit extended length', () => {
    // Length 1 escapes to an eight-byte XLBox that sits between the type and the payload, so the box header is sixteen bytes rather than eight.
    const length = 16 + MINIMAL_CODESTREAM.length;
    const extended = [0, 0, 0, 1, ...Array.from('jp2c', (character) => character.charCodeAt(0)), 0, 0, 0, 0, 0, 0, 0, length, ...MINIMAL_CODESTREAM];
    const container = parseJp2Container(Uint8Array.from([...SIGNATURE_BOX, ...extended]));
    expect(Array.from(container.codestream)).toEqual(MINIMAL_CODESTREAM);
  });

  it('refuses a palette rather than handing back raw indices as if they were colour', () => {
    const data = Uint8Array.from([...SIGNATURE_BOX, ...box('jp2h', [...box('ihdr', imageHeaderPayload(4, 5, 1, 7)), ...box('pclr', [0, 2, 1, 7])]), ...box('jp2c', MINIMAL_CODESTREAM)]);
    expect(() => parseJp2Container(data)).toThrow(Jpeg2000UnsupportedError);
    expect(() => parseJp2Container(data)).toThrow(/palette/);
  });

  it('rejects a JP2 file with no contiguous codestream box', () => {
    const data = Uint8Array.from([...SIGNATURE_BOX, ...box('jp2h', box('ihdr', imageHeaderPayload(4, 5, 1, 7)))]);
    expect(() => parseJp2Container(data)).toThrow(Jpeg2000ParseError);
    expect(() => parseJp2Container(data)).toThrow(/jp2c/);
  });

  it('rejects data that is neither a codestream nor a box structure', () => {
    expect(() => parseJp2Container(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toThrow(Jpeg2000ParseError);
  });
});
