import { describe, expect, it, vi } from "vitest";
import { crc32 } from "../bytes/crc32";
import { deflate } from "../bytes/flate";
import { decodePng } from "./png-decode";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32(value: number): readonly number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

// Builds one real, correctly-CRC'd PNG chunk (length + type + data + CRC32), so hand-assembled test fixtures exercise the same chunk framing decodePng's own CRC check validates.
function realChunk(type: string, data: readonly number[]): readonly number[] {
  const typeBytes = Array.from(new TextEncoder().encode(type));
  const crc = crc32(Uint8Array.from([...typeBytes, ...data]));
  return [...u32(data.length), ...typeBytes, ...data, ...u32(crc)];
}

function pngBytes(
  chunks: readonly (readonly number[])[],
): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...PNG_SIGNATURE, ...chunks.flat()]);
}

function ihdrData(
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace = 0,
): readonly number[] {
  return [...u32(width), ...u32(height), bitDepth, colorType, 0, 0, interlace];
}

// Deflates `scanlines` (already filter-byte-prefixed rows) into a single real IDAT chunk.
function idatChunk(scanlines: readonly number[]): readonly number[] {
  return realChunk("IDAT", Array.from(deflate(new Uint8Array(scanlines))));
}

describe("decodePng: signature and structural validation", () => {
  it("throws for a buffer that does not start with the PNG signature", () => {
    expect(() => decodePng(new Uint8Array(8))).toThrow(
      "not a valid PNG file: bad signature",
    );
  });

  it("throws when only a prefix of the signature matches", () => {
    const bytes = new Uint8Array([...PNG_SIGNATURE.slice(0, 4), 0, 0, 0, 0]);
    expect(() => decodePng(bytes)).toThrow(
      "not a valid PNG file: bad signature",
    );
  });

  it("throws when the first chunk after the signature is not IHDR", () => {
    const bytes = pngBytes([realChunk("IDAT", [])]);
    expect(() => decodePng(bytes)).toThrow(
      "PNG file does not begin with an IHDR chunk",
    );
  });

  it("throws for an Adam7-interlaced image", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(1, 1, 8, 0, 1)), // interlace = 1
      idatChunk([0, 0]),
    ]);
    expect(() => decodePng(bytes)).toThrow(
      "Adam7-interlaced PNG images are not supported",
    );
  });

  it("throws for an unsupported colour type", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(1, 1, 8, 5)), // 5 is not a defined PNG colour type
      idatChunk([0, 0]),
    ]);
    expect(() => decodePng(bytes)).toThrow("unsupported PNG colour type: 5");
  });

  it("throws when there are no IDAT chunks at all", () => {
    const bytes = pngBytes([realChunk("IHDR", ihdrData(1, 1, 8, 0))]);
    expect(() => decodePng(bytes)).toThrow("PNG file has no IDAT chunks");
  });

  it("throws for an indexed-colour image with no PLTE chunk", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(1, 1, 8, 3)),
      idatChunk([0, 0]),
    ]);
    expect(() => decodePng(bytes)).toThrow(
      "indexed-colour PNG has no PLTE chunk",
    );
  });
});

describe("decodePng: chunk-stream parsing edge cases", () => {
  it("throws when a chunk declares a length that leaves no room for its trailing CRC", () => {
    const ihdr = realChunk("IHDR", ihdrData(1, 1, 8, 0));
    const idat = idatChunk([0, 0]);
    // A trailing 8-byte chunk header (4-byte length=0, 4-byte type) with nothing after it: the declared data (zero bytes) plus the mandatory 4-byte CRC would run 4 bytes past the end of the file. This exercises both the outer chunk-loop's own boundary (offset + 8 === the file's exact remaining length, so the loop must still attempt this chunk) and the inner length-overrun guard together.
    const trailingHeaderOnly = [...u32(0), 0x61, 0x62, 0x63, 0x64]; // length=0, type="abcd"
    const bytes = new Uint8Array([
      ...PNG_SIGNATURE,
      ...ihdr,
      ...idat,
      ...trailingHeaderOnly,
    ]);
    expect(() => decodePng(bytes)).toThrow(
      "PNG chunk 'abcd' declares a length that runs past the end of the file",
    );
  });

  it("stops scanning cleanly at the exact end of the buffer with no trailing bytes at all", () => {
    // No IEND chunk: the chunk loop must terminate purely via its own offset+8<=length bound rather than the IEND early-exit, and there is nothing at all after the last real chunk.
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(1, 1, 8, 0)),
      idatChunk([0, 42]),
    ]);
    expect(() => decodePng(bytes)).not.toThrow();
  });

  it("stops scanning at IEND and ignores anything after it, even data that would otherwise fail to parse", () => {
    const bytes = new Uint8Array([
      ...PNG_SIGNATURE,
      ...realChunk("IHDR", ihdrData(1, 1, 8, 0)),
      ...idatChunk([0, 7]),
      ...realChunk("IEND", []),
      // Garbage that declares an impossible length -- if the loop failed to stop at IEND, this would throw a length-overrun error instead of the whole call succeeding.
      ...u32(0xffff),
      0x62,
      0x61,
      0x64,
      0x21,
    ]);
    const decoded = decodePng(bytes);
    expect(decoded.data[0]).toBe(7);
  });

  it("concatenates multiple IDAT chunks before inflating, rather than decoding only the first", () => {
    const compressed = deflate(new Uint8Array([0, 1, 2, 3, 0, 4, 5, 6]));
    const half = Math.ceil(compressed.length / 2);
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(3, 2, 8, 0)),
      realChunk("IDAT", Array.from(compressed.subarray(0, half))),
      realChunk("IDAT", Array.from(compressed.subarray(half))),
    ]);
    const decoded = decodePng(bytes);
    expect(Array.from(decoded.data)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("calls onWarning with a descriptive message when a chunk's CRC does not match its bytes", () => {
    const ihdr = realChunk("IHDR", ihdrData(1, 1, 8, 0));
    const idat = idatChunk([0, 9]);
    // Corrupt the IDAT's stored CRC (its last 4 bytes) without touching its declared length or data.
    const corrupted = Uint8Array.from(idat);
    corrupted[corrupted.length - 1] =
      (corrupted[corrupted.length - 1]! ^ 0xff) & 0xff;
    const bytes = new Uint8Array([...PNG_SIGNATURE, ...ihdr, ...corrupted]);

    const onWarning = vi.fn();
    decodePng(bytes, { onWarning });
    expect(onWarning).toHaveBeenCalledWith(
      "PNG chunk 'IDAT' failed its CRC32 check",
    );
  });

  it("does not call onWarning at all when every chunk's CRC is genuinely correct", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(1, 1, 8, 0)),
      idatChunk([0, 9]),
    ]);
    const onWarning = vi.fn();
    decodePng(bytes, { onWarning });
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("does not attempt any CRC verification when no onWarning callback is given", () => {
    const ihdr = realChunk("IHDR", ihdrData(1, 1, 8, 0));
    const idat = idatChunk([0, 9]);
    const corrupted = Uint8Array.from(idat);
    corrupted[corrupted.length - 1] =
      (corrupted[corrupted.length - 1]! ^ 0xff) & 0xff;
    const bytes = new Uint8Array([...PNG_SIGNATURE, ...ihdr, ...corrupted]);
    expect(() => decodePng(bytes)).not.toThrow();
  });

  it("reports a tolerant-recovery warning when the IDAT stream needed the recovery ladder", () => {
    const scanlines = [0, 1, 2, 3, 0, 4, 5, 6];
    const zlibStream = deflate(new Uint8Array(scanlines), 0); // level 0: predictable stored-block framing
    const truncated = zlibStream.subarray(0, zlibStream.length - 4);
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(3, 2, 8, 0)),
      realChunk("IDAT", Array.from(truncated)),
    ]);

    const onWarning = vi.fn();
    decodePng(bytes, { onWarning });
    expect(onWarning).toHaveBeenCalledWith(
      "PNG IDAT stream required tolerant recovery (truncated or malformed)",
    );
  });
});

describe("decodePng: colour type 0 (grayscale) at every supported bit depth", () => {
  it("bit depth 1: unpacks 8 one-bit samples from a single byte, MSB first, scaled to 0/255", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(8, 1, 1, 0)),
      idatChunk([0, 0b10101010]),
    ]);
    const decoded = decodePng(bytes);
    expect(Array.from(decoded.data)).toEqual([255, 0, 255, 0, 255, 0, 255, 0]);
  });

  it("bit depth 2: unpacks four two-bit samples per byte, scaled across the full 0..255 range", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(4, 1, 2, 0)),
      idatChunk([0, 0b00_01_10_11]),
    ]);
    const decoded = decodePng(bytes);
    expect(Array.from(decoded.data)).toEqual([0, 85, 170, 255]);
  });

  it("bit depth 4: unpacks two four-bit samples per byte", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(2, 1, 4, 0)),
      idatChunk([0, 0b0011_1101]),
    ]);
    const decoded = decodePng(bytes);
    expect(Array.from(decoded.data)).toEqual([51, 221]); // 3*17, 13*17
  });

  it("bit depth 8: uses each byte as a sample directly, unscaled", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(2, 1, 8, 0)),
      idatChunk([0, 12, 240]),
    ]);
    const decoded = decodePng(bytes);
    expect(Array.from(decoded.data)).toEqual([12, 240]);
  });

  it("bit depth 16: reads only the high byte of each 16-bit sample, with no rescaling", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(2, 1, 16, 0)),
      idatChunk([0, 0xab, 0x12, 0x34, 0x56]),
    ]);
    const decoded = decodePng(bytes);
    expect(Array.from(decoded.data)).toEqual([0xab, 0x34]);
  });

  it("applies a tRNS gray key: the matching sample becomes transparent, others stay opaque", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(2, 1, 8, 0)),
      realChunk("tRNS", [0x00, 200]), // 16-bit gray key = 200
      idatChunk([0, 200, 50]),
    ]);
    const decoded = decodePng(bytes);
    expect(Array.from(decoded.data)).toEqual([200, 50]);
    expect(Array.from(decoded.alpha!)).toEqual([0, 255]);
  });
});

describe("decodePng: colour type 2 (truecolour)", () => {
  it("decodes RGB samples directly with no alpha plane by default", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(2, 1, 8, 2)),
      idatChunk([0, 10, 20, 30, 40, 50, 60]),
    ]);
    const decoded = decodePng(bytes);
    expect(decoded.channels).toBe(3);
    expect(decoded.alpha).toBeUndefined();
    expect(Array.from(decoded.data)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("applies a tRNS RGB key: only the exact matching triple becomes transparent, checking every channel independently", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(4, 1, 8, 2)),
      realChunk("tRNS", [0, 10, 0, 20, 0, 30]), // 16-bit RGB key = (10, 20, 30)
      idatChunk([
        0,
        10,
        20,
        30, // exact match -> transparent
        11,
        20,
        30, // differs only in R -> opaque
        10,
        21,
        30, // differs only in G -> opaque
        10,
        20,
        31, // differs only in B -> opaque
      ]),
    ]);
    const decoded = decodePng(bytes);
    expect(Array.from(decoded.alpha!)).toEqual([0, 255, 255, 255]);
  });
});

describe("decodePng: colour type 3 (indexed)", () => {
  it("looks up each index in PLTE and applies tRNS per-index alpha, defaulting later indices to opaque", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(3, 1, 8, 3)),
      realChunk("PLTE", [255, 0, 0, 0, 255, 0, 0, 0, 255]), // red, green, blue
      realChunk("tRNS", [0, 128]), // index 0 -> alpha 0, index 1 -> alpha 128, index 2 -> default 255
      idatChunk([0, 0, 1, 2]),
    ]);
    const decoded = decodePng(bytes);
    expect(Array.from(decoded.data)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    expect(Array.from(decoded.alpha!)).toEqual([0, 128, 255]);
  });
});

describe("decodePng: colour type 4 (grayscale + alpha)", () => {
  it("decodes an interleaved gray+alpha sample pair per pixel", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(2, 1, 8, 4)),
      idatChunk([0, 10, 255, 20, 128]),
    ]);
    const decoded = decodePng(bytes);
    expect(decoded.channels).toBe(1);
    expect(Array.from(decoded.data)).toEqual([10, 20]);
    expect(Array.from(decoded.alpha!)).toEqual([255, 128]);
  });
});

describe("decodePng: colour type 6 (truecolour + alpha)", () => {
  it("decodes an interleaved RGBA sample per pixel", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(2, 1, 8, 6)),
      idatChunk([0, 10, 20, 30, 255, 40, 50, 60, 0]),
    ]);
    const decoded = decodePng(bytes);
    expect(decoded.channels).toBe(3);
    expect(Array.from(decoded.data)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(Array.from(decoded.alpha!)).toEqual([255, 0]);
  });
});

describe("decodePng: RawImage shape", () => {
  it("omits the alpha property entirely (not merely undefined) when the image has no transparency", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(1, 1, 8, 2)),
      idatChunk([0, 1, 2, 3]),
    ]);
    const decoded = decodePng(bytes);
    expect("alpha" in decoded).toBe(false);
  });

  it("includes a real alpha property when the image carries transparency", () => {
    const bytes = pngBytes([
      realChunk("IHDR", ihdrData(1, 1, 8, 6)),
      idatChunk([0, 1, 2, 3, 4]),
    ]);
    const decoded = decodePng(bytes);
    expect("alpha" in decoded).toBe(true);
  });
});
