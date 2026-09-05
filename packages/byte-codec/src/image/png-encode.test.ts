import { describe, expect, it } from "vitest";
import { decodePng } from "./png-decode";
import { encodePng } from "./png-encode";

// Walks a PNG's own chunk stream (ignoring CRC verification, unlike decodePng's own reader) so tests can assert directly on which chunks and IHDR fields encodePng actually wrote, independent of what decodePng chooses to expose in a RawImage.
function readChunks(png: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks = new Map<string, Uint8Array>();
  let offset = 8; // past the 8-byte PNG signature
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder("latin1").decode(
      png.subarray(offset + 4, offset + 8),
    );
    const dataStart = offset + 8;
    chunks.set(type, png.subarray(dataStart, dataStart + length));
    offset = dataStart + length + 4; // skip the trailing CRC
    if (type === "IEND") {
      break;
    }
  }
  return chunks;
}

function colorTypeOf(png: Uint8Array): number {
  const ihdr = readChunks(png).get("IHDR");
  if (ihdr === undefined) {
    throw new Error("PNG has no IHDR chunk");
  }
  return ihdr[9]!;
}

// Builds a channels=3 RawImage from a flat list of [r, g, b] pixels, row-major, `width` pixels per row.
function rgbImage(width: number, height: number, pixels: readonly number[]) {
  return {
    width,
    height,
    channels: 3 as const,
    data: new Uint8Array(pixels),
  };
}

describe("encodePng indexed-colour (colour type 3)", () => {
  it("emits colour type 3 with a real PLTE chunk for a small-palette image, and decodePng reads it back exactly", () => {
    const image = rgbImage(
      2,
      2,
      [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0],
    );
    const png = encodePng(image);

    expect(colorTypeOf(png)).toBe(3);
    const plte = readChunks(png).get("PLTE");
    expect(plte).toBeDefined();
    expect(plte!.length).toBe(4 * 3); // 4 distinct colours, one RGB triple each
    expect(readChunks(png).has("tRNS")).toBe(false); // no alpha plane on the source image

    const decoded = decodePng(png);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.channels).toBe(3);
    expect(decoded.alpha).toBeUndefined();
    expect(Array.from(decoded.data)).toEqual(Array.from(image.data));
  });

  it("round-trips a palette image with genuine per-pixel transparency via tRNS", () => {
    const image = {
      ...rgbImage(2, 1, [255, 0, 0, 0, 255, 0]),
      alpha: new Uint8Array([255, 0]), // opaque red, fully transparent green
    };
    const png = encodePng(image);

    expect(colorTypeOf(png)).toBe(3);
    const trns = readChunks(png).get("tRNS");
    expect(trns).toBeDefined();

    const decoded = decodePng(png);
    expect(Array.from(decoded.data)).toEqual(Array.from(image.data));
    expect(decoded.alpha).toBeDefined();
    expect(Array.from(decoded.alpha!)).toEqual(Array.from(image.alpha));
  });

  it("preserves a defined-but-fully-opaque alpha plane through the indexed path", () => {
    const image = {
      ...rgbImage(2, 1, [10, 20, 30, 40, 50, 60]),
      alpha: new Uint8Array([255, 255]),
    };
    const png = encodePng(image);

    expect(colorTypeOf(png)).toBe(3);
    expect(readChunks(png).has("tRNS")).toBe(true); // presence preserved even though every value is opaque

    const decoded = decodePng(png);
    expect(decoded.alpha).toBeDefined();
    expect(Array.from(decoded.alpha!)).toEqual([255, 255]);
  });

  it("chooses indexed colour at exactly 256 distinct colours", () => {
    const pixels: number[] = [];
    for (let i = 0; i < 256; i++) {
      pixels.push(i, 0, 0); // 256 distinct shades of red
    }
    const image = rgbImage(256, 1, pixels);
    const png = encodePng(image);

    expect(colorTypeOf(png)).toBe(3);
    expect(readChunks(png).get("PLTE")!.length).toBe(256 * 3);
    expect(Array.from(decodePng(png).data)).toEqual(Array.from(image.data));
  });

  it("falls back to truecolour at 257 distinct colours", () => {
    const pixels: number[] = [];
    for (let i = 0; i < 257; i++) {
      pixels.push(i % 256, Math.floor(i / 256), 0);
    }
    const image = rgbImage(257, 1, pixels);
    const png = encodePng(image);

    expect(colorTypeOf(png)).toBe(2); // truecolour, no alpha
    expect(readChunks(png).has("PLTE")).toBe(false);
    expect(Array.from(decodePng(png).data)).toEqual(Array.from(image.data));
  });

  it("never emits indexed colour for a grayscale (channels 1) image, since a palette would come back from decodePng as channels 3", () => {
    const image = {
      width: 2,
      height: 1,
      channels: 1 as const,
      data: new Uint8Array([10, 20]),
    };
    const png = encodePng(image);

    expect(colorTypeOf(png)).toBe(0); // plain grayscale, not indexed
    expect(readChunks(png).has("PLTE")).toBe(false);
    const decoded = decodePng(png);
    expect(decoded.channels).toBe(1);
    expect(Array.from(decoded.data)).toEqual(Array.from(image.data));
  });

  it("falls back to truecolour+alpha for a high-colour-count image with an alpha plane", () => {
    const pixels: number[] = [];
    const alpha: number[] = [];
    for (let i = 0; i < 300; i++) {
      pixels.push(i % 256, Math.floor(i / 256) * 10, i % 128);
      alpha.push(i % 256);
    }
    const image = {
      ...rgbImage(300, 1, pixels),
      alpha: new Uint8Array(alpha),
    };
    const png = encodePng(image);

    expect(colorTypeOf(png)).toBe(6); // truecolour + alpha
    const decoded = decodePng(png);
    expect(Array.from(decoded.data)).toEqual(Array.from(image.data));
    expect(Array.from(decoded.alpha!)).toEqual(Array.from(image.alpha));
  });

  it("respects the 'none' filter option on the indexed path", () => {
    const image = rgbImage(
      2,
      2,
      [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0],
    );
    const png = encodePng(image, { filter: "none" });

    expect(colorTypeOf(png)).toBe(3);
    expect(Array.from(decodePng(png).data)).toEqual(Array.from(image.data));
  });
});
