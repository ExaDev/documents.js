import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng } from "./png-decode";

// Every fixture here is built with Node's own built-in zlib module — deliberately NOT this package's own deflate/crc32 — so decodePng is exercised against a genuinely independent implementation of PNG's container format, not merely its own inverse.

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const crc = zlib.crc32(Buffer.concat([typeBuf, data]));
  return Buffer.concat([u32be(data.length), typeBuf, data, u32be(crc >>> 0)]);
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

interface IhdrFields {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace?: number;
}

function buildPng(
  fields: IhdrFields,
  rawScanlines: Buffer,
  extraChunks: Buffer[] = [],
): Uint8Array<ArrayBuffer> {
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
    pngChunk("IHDR", ihdr),
    ...extraChunks,
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

describe("decodePng against hand-built (Node zlib) fixtures", () => {
  it("decodes a 2x1 truecolor (RGB) image, filter type None", () => {
    const scanline = Buffer.from([0, 255, 0, 0, 0, 255, 0]); // filter byte, then (255,0,0), (0,255,0)
    const png = buildPng(
      { width: 2, height: 1, bitDepth: 8, colorType: 2 },
      scanline,
    );
    const image = decodePng(png);
    expect(image.width).toBe(2);
    expect(image.height).toBe(1);
    expect(image.channels).toBe(3);
    expect(image.alpha).toBeUndefined();
    expect(Array.from(image.data)).toEqual([255, 0, 0, 0, 255, 0]);
  });

  it("decodes a 2x1 grayscale image, filter type None", () => {
    const scanline = Buffer.from([0, 0, 255]); // filter byte, then two gray samples
    const png = buildPng(
      { width: 2, height: 1, bitDepth: 8, colorType: 0 },
      scanline,
    );
    const image = decodePng(png);
    expect(image.channels).toBe(1);
    expect(Array.from(image.data)).toEqual([0, 255]);
  });

  it("decodes a 1-bit grayscale image, expanding samples to a full 0..255 range", () => {
    // width=8, one byte holds all 8 1-bit samples: 10110010
    const scanline = Buffer.from([0, 0b10110010]);
    const png = buildPng(
      { width: 8, height: 1, bitDepth: 1, colorType: 0 },
      scanline,
    );
    const image = decodePng(png);
    expect(Array.from(image.data)).toEqual([255, 0, 255, 255, 0, 0, 255, 0]);
  });

  it("decodes an indexed-colour image via its PLTE chunk", () => {
    const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]); // 3 palette entries: red, green, blue
    const scanline = Buffer.from([0, 0, 1, 2]); // filter byte, then indices 0,1,2
    const png = buildPng(
      { width: 3, height: 1, bitDepth: 8, colorType: 3 },
      scanline,
      [pngChunk("PLTE", plte)],
    );
    const image = decodePng(png);
    expect(image.channels).toBe(3);
    expect(Array.from(image.data)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  });

  it("applies per-index alpha from a tRNS chunk on an indexed-colour image", () => {
    const plte = Buffer.from([255, 0, 0, 0, 255, 0]);
    const trns = Buffer.from([0, 255]); // index 0 fully transparent, index 1 fully opaque
    const scanline = Buffer.from([0, 0, 1]);
    const png = buildPng(
      { width: 2, height: 1, bitDepth: 8, colorType: 3 },
      scanline,
      [pngChunk("PLTE", plte), pngChunk("tRNS", trns)],
    );
    const image = decodePng(png);
    expect(image.alpha).toBeDefined();
    expect(Array.from(image.alpha!)).toEqual([0, 255]);
  });

  it("decodes a truecolor+alpha (RGBA) image", () => {
    const scanline = Buffer.from([0, 10, 20, 30, 40, 50, 60, 70, 80]); // filter byte, then one RGBA pixel
    const png = buildPng(
      { width: 1, height: 1, bitDepth: 8, colorType: 6 },
      scanline,
    );
    const image = decodePng(png);
    expect(image.channels).toBe(3);
    expect(Array.from(image.data)).toEqual([10, 20, 30]);
    expect(Array.from(image.alpha!)).toEqual([40]);
  });

  it("concatenates multiple IDAT chunks before inflating", () => {
    const scanline = Buffer.from([0, 1, 2, 3]);
    const compressed = zlib.deflateSync(scanline);
    const mid = Math.floor(compressed.length / 2);
    const png = Buffer.concat([
      PNG_SIGNATURE,
      pngChunk(
        "IHDR",
        (() => {
          const ihdr = Buffer.alloc(13);
          ihdr.writeUInt32BE(3, 0);
          ihdr.writeUInt32BE(1, 4);
          ihdr[8] = 8;
          ihdr[9] = 0;
          return ihdr;
        })(),
      ),
      pngChunk("IDAT", compressed.subarray(0, mid)),
      pngChunk("IDAT", compressed.subarray(mid)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    const image = decodePng(
      new Uint8Array(png.buffer, png.byteOffset, png.byteLength),
    );
    expect(Array.from(image.data)).toEqual([1, 2, 3]);
  });

  it("rejects an Adam7-interlaced image explicitly rather than decoding it wrong", () => {
    const scanline = Buffer.from([0, 1]);
    const png = buildPng(
      { width: 1, height: 1, bitDepth: 8, colorType: 0, interlace: 1 },
      scanline,
    );
    expect(() => decodePng(png)).toThrow(/interlace/i);
  });

  it("reports a CRC mismatch as a warning, not a thrown error, and still decodes", () => {
    const scanline = Buffer.from([0, 42]);
    const png = buildPng(
      { width: 1, height: 1, bitDepth: 8, colorType: 0 },
      scanline,
    );
    // Corrupt the IHDR chunk's stored CRC (last 4 bytes of the IHDR chunk, which starts right after the signature) without touching the data it describes, so decoding still succeeds.
    const corrupted = png.slice();
    const ihdrCrcOffset = PNG_SIGNATURE.length + 4 + 4 + 13; // length + type + IHDR data, then CRC
    corrupted[ihdrCrcOffset] = (corrupted[ihdrCrcOffset]! + 1) & 0xff;
    const warnings: string[] = [];
    const image = decodePng(corrupted, { onWarning: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes("CRC32"))).toBe(true);
    expect(Array.from(image.data)).toEqual([42]);
  });

  it("throws on a file that does not start with the PNG signature", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });

  it("throws when a chunk header sits exactly at the end of the file with no room for its data or CRC", () => {
    const scanline = Buffer.from([0, 42]);
    const png = buildPng(
      { width: 1, height: 1, bitDepth: 8, colorType: 0 },
      scanline,
    );
    const iendChunkLength = pngChunk("IEND", Buffer.alloc(0)).length;
    const withoutIend = png.subarray(0, png.length - iendChunkLength);
    // A chunk header (length + type, 8 bytes) with nothing after it — exactly the boundary offset + 8 === bytes.length that distinguishes "enter the loop and discover there's no room for the data/CRC" from "stop the loop before reading a header at all".
    const truncatedHeader = Buffer.concat([
      u32be(0),
      Buffer.from("tEXt", "ascii"),
    ]);
    const truncated = new Uint8Array(
      withoutIend.length + truncatedHeader.length,
    );
    truncated.set(withoutIend, 0);
    truncated.set(truncatedHeader, withoutIend.length);
    expect(() => decodePng(truncated)).toThrow(/runs past the end/);
  });
});

describe("decodePng: bit depths and colour types the base fixtures skip", () => {
  function rawRow(filter: number, bytes: number[]): Buffer {
    return Buffer.from([filter, ...bytes]);
  }

  it("decodes a 16-bit grayscale image, keeping each sample's high byte", () => {
    const png = buildPng(
      { width: 2, height: 1, bitDepth: 16, colorType: 0 },
      rawRow(0, [0x12, 0x34, 0xab, 0xcd]),
    );
    const image = decodePng(png);
    expect(image.channels).toBe(1);
    expect(Array.from(image.data)).toEqual([0x12, 0xab]);
  });

  it("decodes a 16-bit grayscale+alpha image, scaling neither plane", () => {
    const png = buildPng(
      { width: 2, height: 1, bitDepth: 16, colorType: 4 },
      rawRow(0, [0x12, 0x34, 0xff, 0x00, 0x00, 0x00, 0x80, 0x00]),
    );
    const image = decodePng(png);
    expect(Array.from(image.data)).toEqual([0x12, 0x00]);
    expect(Array.from(image.alpha ?? [])).toEqual([0xff, 0x80]);
  });

  it("decodes a 4-bit grayscale image, scaling samples to the full byte range", () => {
    // Both 4-bit samples in one byte: 0xf then 0x8 scale to 255 and 136.
    const png = buildPng(
      { width: 2, height: 1, bitDepth: 4, colorType: 0 },
      rawRow(0, [0xf8]),
    );
    const image = decodePng(png);
    expect(Array.from(image.data)).toEqual([255, 136]);
  });

  it("decodes a 2-bit grayscale image, packing four samples per byte", () => {
    // Samples 0b00, 0b01, 0b10, 0b11 in one byte: 0, 85, 170, 255 after scaling.
    const png = buildPng(
      { width: 4, height: 1, bitDepth: 2, colorType: 0 },
      rawRow(0, [0b00011011]),
    );
    const image = decodePng(png);
    expect(Array.from(image.data)).toEqual([0, 85, 170, 255]);
  });

  it("decodes a filtered truecolor image whose unfiltering depends on the pixel size", () => {
    // Filter Up over two distinct rows: wrong bpp unfiltering smears row 2 into row 1's values.
    const png = buildPng(
      { width: 2, height: 2, bitDepth: 8, colorType: 2 },
      Buffer.concat([
        rawRow(0, [10, 20, 30, 40, 50, 60]),
        rawRow(2, [1, 1, 1, 1, 1, 1]),
      ]),
    );
    const image = decodePng(png);
    expect(Array.from(image.data)).toEqual([
      10, 20, 30, 40, 50, 60, 11, 21, 31, 41, 51, 61,
    ]);
  });

  it("decodes every pixel of a two-row grayscale image", () => {
    // Row 2's first sample is non-zero, which an x loop running one step too far would overwrite.
    const png = buildPng(
      { width: 2, height: 2, bitDepth: 8, colorType: 0 },
      Buffer.concat([rawRow(0, [7, 9]), rawRow(0, [200, 240])]),
    );
    const image = decodePng(png);
    expect(Array.from(image.data)).toEqual([7, 9, 200, 240]);
  });

  it("decodes a grayscale image with a tRNS key, keying only the matching sample", () => {
    const png = buildPng(
      { width: 2, height: 1, bitDepth: 8, colorType: 0 },
      rawRow(0, [200, 240]),
      [pngChunk("tRNS", Buffer.from([0x00, 200]))],
    );
    const image = decodePng(png);
    expect(Array.from(image.alpha ?? [])).toEqual([0, 255]);
  });

  it("decodes a truecolor image with a tRNS key, keying only an exact RGB match", () => {
    const png = buildPng(
      { width: 2, height: 1, bitDepth: 8, colorType: 2 },
      rawRow(0, [10, 20, 30, 10, 20, 99]),
      [pngChunk("tRNS", Buffer.from([0x00, 10, 0x00, 20, 0x00, 30]))],
    );
    const image = decodePng(png);
    expect(Array.from(image.alpha ?? [])).toEqual([0, 255]);
  });

  it("keys a truecolor tRNS match only when every channel matches, through each partial mismatch", () => {
    // Pixel 1 differs only in b, pixel 2 matches r only, pixel 3 matches g only, pixel 4
    // matches b only: none may key.
    const png = buildPng(
      { width: 4, height: 1, bitDepth: 8, colorType: 2 },
      rawRow(0, [10, 20, 31, 10, 99, 30, 99, 20, 30, 10, 20, 99]),
      [pngChunk("tRNS", Buffer.from([0x00, 10, 0x00, 20, 0x00, 30]))],
    );
    const image = decodePng(png);
    expect(Array.from(image.alpha ?? [])).toEqual([255, 255, 255, 255]);
  });

  it("decodes a grayscale image carrying no tRNS chunk at all", () => {
    const png = buildPng(
      { width: 1, height: 1, bitDepth: 8, colorType: 0 },
      rawRow(0, [128]),
    );
    const image = decodePng(png);
    expect(Array.from(image.data)).toEqual([128]);
    expect(image.alpha).toBeUndefined();
  });

  it("treats an indexed tRNS entry past the end of the chunk as fully opaque", () => {
    // Two palette entries but a one-entry tRNS: index 1 has no entry and must read as 255.
    const png = buildPng(
      { width: 2, height: 1, bitDepth: 8, colorType: 3 },
      rawRow(0, [0, 1]),
      [
        pngChunk("PLTE", Buffer.from([255, 0, 0, 0, 0, 255])),
        pngChunk("tRNS", Buffer.from([0x40])),
      ],
    );
    const image = decodePng(png);
    expect(Array.from(image.data)).toEqual([255, 0, 0, 0, 0, 255]);
    expect(Array.from(image.alpha ?? [])).toEqual([0x40, 255]);
  });

  it("maps each palette index to its own three-byte entry", () => {
    const png = buildPng(
      { width: 3, height: 1, bitDepth: 8, colorType: 3 },
      rawRow(0, [2, 0, 1]),
      [pngChunk("PLTE", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))],
    );
    const image = decodePng(png);
    expect(Array.from(image.data)).toEqual([7, 8, 9, 1, 2, 3, 4, 5, 6]);
  });
});

describe("decodePng: container-level failures and warnings", () => {
  it("throws on an unsupported colour type, naming it", () => {
    const png = buildPng(
      { width: 1, height: 1, bitDepth: 8, colorType: 5 },
      rawRowOfOnes(),
    );
    expect(() => decodePng(png)).toThrow(/unsupported PNG colour type: 5/);
  });

  it("throws when the first chunk is not an IHDR, naming the requirement", () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 0;
    const png = new Uint8Array(
      Buffer.concat([
        PNG_SIGNATURE,
        pngChunk("gAMA", Buffer.from([0x00, 0x01, 0x86, 0xa0])),
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", zlib.deflateSync(Buffer.from([0, 128]))),
        pngChunk("IEND", Buffer.alloc(0)),
      ]),
    );
    expect(() => decodePng(png)).toThrow(
      /PNG file does not begin with an IHDR chunk/,
    );
  });

  it("throws when the file carries no IDAT chunk at all, naming the requirement", () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 0;
    const png = new Uint8Array(
      Buffer.concat([
        PNG_SIGNATURE,
        pngChunk("IHDR", ihdr),
        pngChunk("IEND", Buffer.alloc(0)),
      ]),
    );
    expect(() => decodePng(png)).toThrow(/PNG file has no IDAT chunks/);
  });

  it("throws when an indexed image carries no PLTE chunk, naming the requirement", () => {
    const png = buildPng(
      { width: 1, height: 1, bitDepth: 8, colorType: 3 },
      Buffer.from([0, 0]),
    );
    expect(() => decodePng(png)).toThrow(
      /indexed-colour PNG has no PLTE chunk/,
    );
  });

  it("throws on a bad signature with a message naming the signature, whatever the byte", () => {
    const png = buildPng(
      { width: 1, height: 1, bitDepth: 8, colorType: 0 },
      Buffer.from([0, 0]),
    );
    for (const position of [0, 3, 7]) {
      const broken = new Uint8Array(png);
      broken[position] = (broken[position] ?? 0) ^ 0xff;
      expect(() => decodePng(broken)).toThrow(
        /not a valid PNG file: bad signature/,
      );
    }
  });

  it("decodes a file whose IEND is missing, stopping cleanly at the end of the data", () => {
    // The chunk loop ends by running out of bytes rather than by seeing IEND.
    const whole = buildPng(
      { width: 1, height: 1, bitDepth: 8, colorType: 0 },
      Buffer.from([0, 128]),
    );
    const cut = new Uint8Array(
      whole.subarray(0, whole.length - 12), // drop the IEND chunk entirely
    );
    expect(Array.from(decodePng(cut).data)).toEqual([128]);
  });

  it("ignores trailing garbage after IEND rather than parsing it as a chunk", () => {
    const whole = buildPng(
      { width: 1, height: 1, bitDepth: 8, colorType: 0 },
      Buffer.from([0, 128]),
    );
    const trailing = new Uint8Array(
      Buffer.concat([
        Buffer.from(whole),
        Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54, 0x52, 0x41, 0x50]),
      ]),
    );
    expect(Array.from(decodePng(trailing).data)).toEqual([128]);
  });

  it("reports no warning at all for a fully valid file", () => {
    const warnings: string[] = [];
    const png = buildPng(
      { width: 1, height: 1, bitDepth: 8, colorType: 0 },
      Buffer.from([0, 128]),
    );
    decodePng(png, { onWarning: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
  });

  it("reports the tolerant-recovery warning for a truncated IDAT stream, still decoding what arrived", () => {
    const scanlines = Buffer.concat([
      Buffer.from([0, 128]),
      Buffer.from([0, 200]),
    ]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(2, 4);
    ihdr[8] = 8;
    ihdr[9] = 0;
    const compressed = zlib.deflateSync(scanlines).subarray(0, 8);
    const png = new Uint8Array(
      Buffer.concat([
        PNG_SIGNATURE,
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", Buffer.from(compressed)),
        pngChunk("IEND", Buffer.alloc(0)),
      ]),
    );
    const warnings: string[] = [];
    const image = decodePng(png, { onWarning: (m) => warnings.push(m) });
    expect(warnings.join(" ")).toMatch(/tolerant recovery/);
    expect(image.width).toBe(1);
    expect(image.height).toBe(2);
  });
});

function rawRowOfOnes(): Buffer {
  return Buffer.from([0, 1]);
}
