import { describe, expect, it } from 'vitest';
import { readJpegInfo } from './jpeg-info';

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function marker(code: number, payload: number[]): number[] {
  return [0xff, code, ...u16be(payload.length + 2), ...payload];
}

function buildJpeg(options: {
  width: number;
  height: number;
  components?: number;
  precision?: number;
  progressive?: boolean;
  extraMarkers?: number[][];
}): Uint8Array<ArrayBuffer> {
  const { width, height, components = 3, precision = 8, progressive = false, extraMarkers = [] } = options;
  const sofCode = progressive ? 0xc2 : 0xc0;
  const componentBytes: number[] = [];
  for (let i = 0; i < components; i++) {
    componentBytes.push(i + 1, 0x11, 0);
  }
  const sofPayload = [precision, ...u16be(height), ...u16be(width), components, ...componentBytes];
  const bytes = [
    0xff,
    0xd8, // SOI
    ...extraMarkers.flat(),
    ...marker(sofCode, sofPayload),
    0xff,
    0xd9, // EOI
  ];
  return new Uint8Array(bytes);
}

describe('readJpegInfo', () => {
  it('reads width/height/components/precision from a baseline (SOF0) JPEG', () => {
    const jpeg = buildJpeg({ width: 640, height: 480, components: 3, precision: 8 });
    const info = readJpegInfo(jpeg);
    expect(info).toEqual({
      width: 640,
      height: 480,
      components: 3,
      precision: 8,
      progressive: false,
      adobeTransform: undefined,
    });
  });

  it('marks a progressive (SOF2) JPEG as progressive', () => {
    const jpeg = buildJpeg({ width: 100, height: 50, progressive: true });
    expect(readJpegInfo(jpeg).progressive).toBe(true);
  });

  it('recovers grayscale (1-component) and CMYK (4-component) frames', () => {
    expect(readJpegInfo(buildJpeg({ width: 10, height: 10, components: 1 })).components).toBe(1);
    expect(readJpegInfo(buildJpeg({ width: 10, height: 10, components: 4 })).components).toBe(4);
  });

  it('reads the Adobe APP14 transform byte when present', () => {
    const adobePayload = [
      0x41,
      0x64,
      0x6f,
      0x62,
      0x65, // "Adobe"
      0,
      100, // version
      0,
      0, // flags0
      0,
      0, // flags1
      2, // transform: YCCK
    ];
    const jpeg = buildJpeg({
      width: 4,
      height: 4,
      components: 4,
      extraMarkers: [marker(0xee, adobePayload)],
    });
    expect(readJpegInfo(jpeg).adobeTransform).toBe(2);
  });

  it('skips other marker segments (e.g. a DQT table) before reaching SOF', () => {
    const jpeg = buildJpeg({
      width: 20,
      height: 20,
      extraMarkers: [marker(0xdb, [0, 1, 2, 3, 4, 5])], // a fake DQT segment
    });
    expect(readJpegInfo(jpeg).width).toBe(20);
  });

  it('throws on bytes with no SOI marker', () => {
    expect(() => readJpegInfo(new Uint8Array([0, 1, 2, 3]))).toThrow(/SOI/);
  });

  it('throws when no SOF marker is found before EOI', () => {
    expect(() => readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow(/SOF/);
  });
});
