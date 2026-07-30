import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng } from './png-decode';
import { encodePng } from './png-encode';

describe('encodePng / decodePng round-trip', () => {
  it('round-trips a grayscale image with no alpha', () => {
    const image = { width: 2, height: 1, channels: 1 as const, data: new Uint8Array([0, 255]) };
    expect(decodePng(encodePng(image))).toEqual(image);
  });

  it('round-trips an RGB image with no alpha', () => {
    const image = {
      width: 2,
      height: 1,
      channels: 3 as const,
      data: new Uint8Array([255, 0, 0, 0, 255, 0]),
    };
    expect(decodePng(encodePng(image))).toEqual(image);
  });

  it('round-trips a gray+alpha image', () => {
    const image = {
      width: 2,
      height: 1,
      channels: 1 as const,
      data: new Uint8Array([10, 200]),
      alpha: new Uint8Array([255, 0]),
    };
    expect(decodePng(encodePng(image))).toEqual(image);
  });

  it('round-trips an RGBA image', () => {
    const image = {
      width: 1,
      height: 2,
      channels: 3 as const,
      data: new Uint8Array([10, 20, 30, 40, 50, 60]),
      alpha: new Uint8Array([128, 200]),
    };
    expect(decodePng(encodePng(image))).toEqual(image);
  });

  it('round-trips a larger varied image under both filter strategies', () => {
    const width = 13;
    const height = 7;
    const data = new Uint8Array(width * height * 3);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 53 + 7) % 256;
    }
    const image = { width, height, channels: 3 as const, data };
    for (const filter of ['none', 'adaptive'] as const) {
      expect(decodePng(encodePng(image, { filter }))).toEqual(image);
    }
  });

  it('emits a real PNG signature and correct IHDR dimensions/colour type', () => {
    const image = { width: 4, height: 3, channels: 3 as const, data: new Uint8Array(4 * 3 * 3) };
    const bytes = encodePng(image);
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(8 + 8)).toBe(4); // IHDR data starts after signature + length/type
    expect(view.getUint32(8 + 8 + 4)).toBe(3);
    expect(bytes[8 + 8 + 9]).toBe(2); // colour type 2: truecolor
  });

  it("emits an IDAT chunk that Node's own zlib.inflateSync (not this package's inflate) accepts", () => {
    const image = {
      width: 3,
      height: 2,
      channels: 3 as const,
      data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]),
    };
    const bytes = encodePng(image, { filter: 'none' });
    // Walk chunks to find IDAT without relying on this package's own decoder internals.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    let idat: Uint8Array<ArrayBuffer> | undefined;
    while (offset + 8 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = new TextDecoder('latin1').decode(bytes.subarray(offset + 4, offset + 8));
      if (type === 'IDAT') {
        idat = bytes.subarray(offset + 8, offset + 8 + length);
        break;
      }
      offset += 8 + length + 4;
    }
    expect(idat).toBeDefined();
    const inflated = zlib.inflateSync(Buffer.from(idat!));
    // Each row is a leading filter-type byte (0, since 'none' was requested) followed by 9 raw bytes.
    expect(Array.from(inflated)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });
});
