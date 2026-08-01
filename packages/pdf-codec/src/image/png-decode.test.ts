import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng } from './png-decode';

// Every fixture here is built with Node's own built-in zlib module -- deliberately NOT this package's own deflate/crc32 -- so decodePng is exercised against a genuinely independent implementation of PNG's container format, not merely its own inverse.

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = zlib.crc32(Buffer.concat([typeBuf, data]));
  return Buffer.concat([u32be(data.length), typeBuf, data, u32be(crc >>> 0)]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface IhdrFields {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace?: number;
}

function buildPng(fields: IhdrFields, rawScanlines: Buffer, extraChunks: Buffer[] = []): Uint8Array<ArrayBuffer> {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(fields.width, 0);
  ihdr.writeUInt32BE(fields.height, 4);
  ihdr[8] = fields.bitDepth;
  ihdr[9] = fields.colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = fields.interlace ?? 0;
  const compressed = zlib.deflateSync(rawScanlines);
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...extraChunks,
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

describe('decodePng against hand-built (Node zlib) fixtures', () => {
  it('decodes a 2x1 truecolor (RGB) image, filter type None', () => {
    const scanline = Buffer.from([0, 255, 0, 0, 0, 255, 0]); // filter byte, then (255,0,0), (0,255,0)
    const png = buildPng({ width: 2, height: 1, bitDepth: 8, colorType: 2 }, scanline);
    const image = decodePng(png);
    expect(image.width).toBe(2);
    expect(image.height).toBe(1);
    expect(image.channels).toBe(3);
    expect(image.alpha).toBeUndefined();
    expect(Array.from(image.data)).toEqual([255, 0, 0, 0, 255, 0]);
  });

  it('decodes a 2x1 grayscale image, filter type None', () => {
    const scanline = Buffer.from([0, 0, 255]); // filter byte, then two gray samples
    const png = buildPng({ width: 2, height: 1, bitDepth: 8, colorType: 0 }, scanline);
    const image = decodePng(png);
    expect(image.channels).toBe(1);
    expect(Array.from(image.data)).toEqual([0, 255]);
  });

  it('decodes a 1-bit grayscale image, expanding samples to a full 0..255 range', () => {
    // width=8, one byte holds all 8 1-bit samples: 10110010
    const scanline = Buffer.from([0, 0b10110010]);
    const png = buildPng({ width: 8, height: 1, bitDepth: 1, colorType: 0 }, scanline);
    const image = decodePng(png);
    expect(Array.from(image.data)).toEqual([255, 0, 255, 255, 0, 0, 255, 0]);
  });

  it('decodes an indexed-colour image via its PLTE chunk', () => {
    const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]); // 3 palette entries: red, green, blue
    const scanline = Buffer.from([0, 0, 1, 2]); // filter byte, then indices 0,1,2
    const png = buildPng({ width: 3, height: 1, bitDepth: 8, colorType: 3 }, scanline, [pngChunk('PLTE', plte)]);
    const image = decodePng(png);
    expect(image.channels).toBe(3);
    expect(Array.from(image.data)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  });

  it('applies per-index alpha from a tRNS chunk on an indexed-colour image', () => {
    const plte = Buffer.from([255, 0, 0, 0, 255, 0]);
    const trns = Buffer.from([0, 255]); // index 0 fully transparent, index 1 fully opaque
    const scanline = Buffer.from([0, 0, 1]);
    const png = buildPng({ width: 2, height: 1, bitDepth: 8, colorType: 3 }, scanline, [
      pngChunk('PLTE', plte),
      pngChunk('tRNS', trns),
    ]);
    const image = decodePng(png);
    expect(image.alpha).toBeDefined();
    expect(Array.from(image.alpha!)).toEqual([0, 255]);
  });

  it('decodes a truecolor+alpha (RGBA) image', () => {
    const scanline = Buffer.from([0, 10, 20, 30, 40, 50, 60, 70, 80]); // filter byte, then one RGBA pixel
    const png = buildPng({ width: 1, height: 1, bitDepth: 8, colorType: 6 }, scanline);
    const image = decodePng(png);
    expect(image.channels).toBe(3);
    expect(Array.from(image.data)).toEqual([10, 20, 30]);
    expect(Array.from(image.alpha!)).toEqual([40]);
  });

  it('concatenates multiple IDAT chunks before inflating', () => {
    const scanline = Buffer.from([0, 1, 2, 3]);
    const compressed = zlib.deflateSync(scanline);
    const mid = Math.floor(compressed.length / 2);
    const png = Buffer.concat([
      PNG_SIGNATURE,
      pngChunk(
        'IHDR',
        (() => {
          const ihdr = Buffer.alloc(13);
          ihdr.writeUInt32BE(3, 0);
          ihdr.writeUInt32BE(1, 4);
          ihdr[8] = 8;
          ihdr[9] = 0;
          return ihdr;
        })(),
      ),
      pngChunk('IDAT', compressed.subarray(0, mid)),
      pngChunk('IDAT', compressed.subarray(mid)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
    const image = decodePng(new Uint8Array(png.buffer, png.byteOffset, png.byteLength));
    expect(Array.from(image.data)).toEqual([1, 2, 3]);
  });

  it('rejects an Adam7-interlaced image explicitly rather than decoding it wrong', () => {
    const scanline = Buffer.from([0, 1]);
    const png = buildPng({ width: 1, height: 1, bitDepth: 8, colorType: 0, interlace: 1 }, scanline);
    expect(() => decodePng(png)).toThrow(/interlace/i);
  });

  it('reports a CRC mismatch as a warning, not a thrown error, and still decodes', () => {
    const scanline = Buffer.from([0, 42]);
    const png = buildPng({ width: 1, height: 1, bitDepth: 8, colorType: 0 }, scanline);
    // Corrupt the IHDR chunk's stored CRC (last 4 bytes of the IHDR chunk, which starts right after the signature) without touching the data it describes, so decoding still succeeds.
    const corrupted = png.slice();
    const ihdrCrcOffset = PNG_SIGNATURE.length + 4 + 4 + 13; // length + type + IHDR data, then CRC
    corrupted[ihdrCrcOffset] = (corrupted[ihdrCrcOffset]! + 1) & 0xff;
    const warnings: string[] = [];
    const image = decodePng(corrupted, { onWarning: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('CRC32'))).toBe(true);
    expect(Array.from(image.data)).toEqual([42]);
  });

  it('throws on a file that does not start with the PNG signature', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
