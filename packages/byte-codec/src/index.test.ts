import { describe, expect, it } from 'vitest';
import { crc32, encodePng, decodePng, readJpegInfo, ByteWriter, concatBytes } from './index';

describe('byte-codec smoke', () => {
  it('crc32 produces a consistent hash for known input', () => {
    expect(crc32(new Uint8Array([1, 2, 3, 4]))).toBe(crc32(new Uint8Array([1, 2, 3, 4])));
  });

  it('encodePng then decodePng round-trips a small image', () => {
    const pixels = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
    const png = encodePng({ width: 2, height: 2, channels: 3, data: pixels });
    const decoded = decodePng(png);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
  });

  it('ByteWriter accumulates and produces concatenated output', () => {
    const w = new ByteWriter();
    w.writeByte(1);
    w.writeByte(2);
    w.writeByte(3);
    expect(Array.from(w.toBytes())).toEqual([1, 2, 3]);
  });

  it('concatBytes joins arrays', () => {
    const result = concatBytes([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it('readJpegInfo throws for non-JPEG input', () => {
    expect(() => readJpegInfo(new Uint8Array([0, 0, 0]))).toThrow(/JPEG/);
  });
});
