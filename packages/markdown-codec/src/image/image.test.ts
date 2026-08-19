import { describe, expect, it } from 'vitest';
import { readImageDimensions } from './image';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('readImageDimensions', () => {
  it('reads a PNG IHDR chunk width/height', () => {
    const png = bytes(
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // signature
      0x00,
      0x00,
      0x00,
      0x0d, // IHDR chunk length (13)
      0x49,
      0x48,
      0x44,
      0x52, // 'IHDR'
      0x00,
      0x00,
      0x01,
      0x2c, // width = 300
      0x00,
      0x00,
      0x00,
      0x64, // height = 100
      0x08,
      0x06,
      0x00,
      0x00,
      0x00, // bit depth, color type, compression, filter, interlace
    );
    expect(readImageDimensions(png)).toEqual({ widthPx: 300, heightPx: 100 });
  });

  it('returns undefined for a truncated PNG with no full IHDR', () => {
    const truncated = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);
    expect(readImageDimensions(truncated)).toBeUndefined();
  });

  it('reads a JPEG SOF0 frame header width/height, skipping a preceding APP0 segment by its own declared length', () => {
    const jpeg = bytes(
      0xff,
      0xd8, // SOI
      0xff,
      0xe0,
      0x00,
      0x04,
      0x41,
      0x42, // APP0, length 4 (2 payload bytes 'A' 'B')
      0xff,
      0xc0,
      0x00,
      0x0b, // SOF0, length 11
      0x08, // precision
      0x00,
      0x10, // height = 16
      0x00,
      0x20, // width = 32
      0x01, // Nf = 1
      0x01,
      0x11,
      0x00, // component 1
      0xff,
      0xd9, // EOI
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 32, heightPx: 16 });
  });

  it('does not mistake DHT (0xC4) for a frame header despite sharing the SOF numeric range', () => {
    const jpeg = bytes(
      0xff,
      0xd8, // SOI
      0xff,
      0xc4,
      0x00,
      0x05,
      0x00,
      0x01,
      0x02, // DHT, length 5 (3 payload bytes)
      0xff,
      0xc0,
      0x00,
      0x0b, // SOF0, length 11
      0x08,
      0x00,
      0x02,
      0x00,
      0x03,
      0x01,
      0x01,
      0x11,
      0x00,
      0xff,
      0xd9,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 3, heightPx: 2 });
  });

  it('returns undefined for neither a PNG signature nor a JPEG SOI marker', () => {
    expect(readImageDimensions(bytes(0x00, 0x01, 0x02, 0x03))).toBeUndefined();
  });

  it('returns undefined for a JPEG with no frame header before the end of input', () => {
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02);
    expect(readImageDimensions(jpeg)).toBeUndefined();
  });
});
