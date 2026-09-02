import { describe, expect, it } from "vitest";
import {
  detectImageFormat,
  POINTS_PER_PIXEL,
  readImageDimensions,
} from "./dimensions";

// A minimal PNG carrying only what this module reads: the 8-byte signature plus an IHDR chunk (length, type, width, height, and the five remaining bytes IHDR requires -- bit depth, colour type, compression, filter, interlace -- whose values don't matter to a dimensions-only reader). No IDAT/IEND: this module never walks past IHDR.
function fakePng(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // IHDR chunk data length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  view.setUint32(16, widthPx);
  view.setUint32(20, heightPx);
  bytes.set([8, 6, 0, 0, 0], 24); // bit depth, colour type, compression, filter, interlace
  return bytes;
}

// A minimal baseline JPEG: SOI, then an SOF0 segment carrying height/width/components, nothing past it.
function fakeJpeg(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(2 + 2 + 2 + 1 + 2 + 2 + 1);
  let offset = 0;
  bytes.set([0xff, 0xd8], offset); // SOI
  offset += 2;
  bytes.set([0xff, 0xc0], offset); // SOF0
  offset += 2;
  const view = new DataView(bytes.buffer);
  view.setUint16(offset, 8); // segment length (includes these 2 bytes)
  offset += 2;
  bytes[offset] = 8; // precision
  offset += 1;
  view.setUint16(offset, heightPx);
  offset += 2;
  view.setUint16(offset, widthPx);
  offset += 2;
  bytes[offset] = 1; // components
  return bytes;
}

describe("detectImageFormat", () => {
  it("recognises a PNG signature", () => {
    expect(detectImageFormat(fakePng(1, 1))).toBe("png");
  });

  it("recognises a JPEG SOI marker", () => {
    expect(detectImageFormat(fakeJpeg(1, 1))).toBe("jpeg");
  });

  it("returns undefined for neither", () => {
    expect(
      detectImageFormat(new Uint8Array([0x47, 0x49, 0x46])),
    ).toBeUndefined();
  });
});

describe("readImageDimensions", () => {
  it("reads PNG width/height from IHDR", () => {
    expect(readImageDimensions(fakePng(640, 480))).toEqual({
      widthPx: 640,
      heightPx: 480,
    });
  });

  it("reads JPEG width/height from SOF0", () => {
    expect(readImageDimensions(fakeJpeg(800, 600))).toEqual({
      widthPx: 800,
      heightPx: 600,
    });
  });

  it("returns undefined for a truncated PNG", () => {
    expect(readImageDimensions(fakePng(1, 1).subarray(0, 10))).toBeUndefined();
  });

  it("returns undefined for neither format", () => {
    expect(
      readImageDimensions(new Uint8Array([0x00, 0x01, 0x02])),
    ).toBeUndefined();
  });
});

describe("POINTS_PER_PIXEL", () => {
  it("is the CSS reference-pixel ratio (72/96)", () => {
    expect(POINTS_PER_PIXEL).toBeCloseTo(0.75);
  });
});
