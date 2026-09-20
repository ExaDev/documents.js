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

// Differential test over every colour type and bit depth the decoder supports, on seeded random samples, against a reference conversion written from the PNG specification and this decoder's documented conventions: samples below 16 bits are scaled to 0..255 for grayscale (and used raw for truecolour and palette indices), a 16-bit sample keeps only its high byte, tRNS keys compare a pixel's (already reduced) samples with the key, and an alpha plane exists whenever the colour type carries alpha or a tRNS chunk is present. The fixtures are hand-assembled scanlines with filter type 0, so nothing here depends on the filters or on encodePng.
function seededSamples(
  count: number,
  maxValue: number,
  seed: number,
): number[] {
  const out: number[] = [];
  let state = seed >>> 0;
  for (let index = 0; index < count; index += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    out.push(((mixed ^ (mixed >>> 14)) >>> 0) % (maxValue + 1));
  }
  return out;
}

// Packs one row of samples, most significant bit first, into bytes at the given bit depth.
function packRow(samples: readonly number[], bitDepth: number): number[] {
  if (bitDepth === 16)
    return samples.flatMap((sample) => [sample >> 8, sample & 0xff]);
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const sample of samples) {
    accumulator = (accumulator << bitDepth) | sample;
    bits += bitDepth;
    if (bits === 8) {
      bytes.push(accumulator);
      accumulator = 0;
      bits = 0;
    }
  }
  if (bits > 0) bytes.push(accumulator << (8 - bits));
  return bytes;
}

const SUPPORTED_MODES: readonly (readonly [number, readonly number[]])[] = [
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]],
];
const CHANNELS_FOR: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DIFFERENTIAL_WIDTHS = [1, 2, 3, 5, 7, 8, 9, 13];
const DIFFERENTIAL_HEIGHT = 3;

function scaleGray(sample: number, bitDepth: number): number {
  return bitDepth === 16
    ? sample
    : Math.round((sample * 255) / ((1 << bitDepth) - 1));
}

interface ExpectedImage {
  readonly data: number[];
  readonly alpha: number[] | undefined;
}

function referenceDecode(
  colorType: number,
  bitDepth: number,
  width: number,
  height: number,
  samples: readonly number[],
  palette: readonly number[] | undefined,
  trns: readonly number[] | undefined,
): ExpectedImage {
  const channels = CHANNELS_FOR[colorType]!;
  // A 16-bit sample is reduced to its high byte before anything else looks at it, exactly as the decoder documents.
  const reduced = samples.map((sample) =>
    bitDepth === 16 ? sample >> 8 : sample,
  );
  const hasAlpha = colorType === 4 || colorType === 6 || trns !== undefined;
  const data: number[] = [];
  const alpha: number[] = [];
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const at = (channel: number): number =>
      reduced[pixel * channels + channel]!;
    let opacity = 255;
    if (colorType === 0) {
      data.push(scaleGray(at(0), bitDepth));
      if (trns !== undefined)
        opacity = at(0) === ((trns[0]! << 8) | trns[1]!) ? 0 : 255;
    } else if (colorType === 2) {
      data.push(at(0), at(1), at(2));
      if (trns !== undefined) {
        const keyMatches = [0, 1, 2].every(
          (c) => at(c) === ((trns[c * 2]! << 8) | trns[c * 2 + 1]!),
        );
        opacity = keyMatches ? 0 : 255;
      }
    } else if (colorType === 3) {
      data.push(
        palette![at(0) * 3]!,
        palette![at(0) * 3 + 1]!,
        palette![at(0) * 3 + 2]!,
      );
      if (trns !== undefined)
        opacity = at(0) < trns.length ? trns[at(0)]! : 255;
    } else if (colorType === 4) {
      data.push(scaleGray(at(0), bitDepth));
      opacity = scaleGray(at(1), bitDepth);
    } else {
      data.push(at(0), at(1), at(2));
      opacity = at(3);
    }
    alpha.push(opacity);
  }
  return { data, alpha: hasAlpha ? alpha : undefined };
}

describe("decodePng against a reference conversion, for every supported colour type and bit depth", () => {
  const cases = SUPPORTED_MODES.flatMap(([colorType, depths]) =>
    depths.flatMap((bitDepth) =>
      DIFFERENTIAL_WIDTHS.map((width) => [colorType, bitDepth, width] as const),
    ),
  );

  it.each(cases)(
    "colour type %i at bit depth %i, %i pixels wide, with and without transparency",
    (colorType, bitDepth, width) => {
      const channels = CHANNELS_FOR[colorType]!;
      const maxSample = (1 << bitDepth) - 1;
      const paletteEntries = 1 << Math.min(bitDepth, 8);
      const palette =
        colorType === 3
          ? seededSamples(paletteEntries * 3, 255, 41)
          : undefined;
      const trnsOptions: (readonly number[] | undefined)[] =
        colorType === 3
          ? [undefined, seededSamples(Math.max(1, paletteEntries - 1), 255, 43)]
          : colorType === 0
            ? [undefined, [0, 1]]
            : colorType === 2
              ? [undefined, [0, 1, 0, 2, 0, 3]]
              : [undefined];
      for (const trns of trnsOptions) {
        const samples = seededSamples(
          width * DIFFERENTIAL_HEIGHT * channels,
          maxSample,
          width * 1000 + bitDepth * 10 + colorType,
        );
        // Make the transparency key actually occur in the data, so a wrong comparison cannot pass by never matching.
        if (trns !== undefined && colorType === 0) samples[0] = 1;
        if (trns !== undefined && colorType === 2)
          samples.splice(0, 3, 1, 2, 3);
        const rows = Array.from(
          { length: DIFFERENTIAL_HEIGHT },
          (_unused, y) => [
            0,
            ...packRow(
              samples.slice(y * width * channels, (y + 1) * width * channels),
              bitDepth,
            ),
          ],
        );
        const chunks = [
          realChunk(
            "IHDR",
            ihdrData(width, DIFFERENTIAL_HEIGHT, bitDepth, colorType),
          ),
          ...(palette === undefined ? [] : [realChunk("PLTE", palette)]),
          ...(trns === undefined ? [] : [realChunk("tRNS", trns)]),
          idatChunk(rows.flat()),
          realChunk("IEND", []),
        ];
        const decoded = decodePng(pngBytes(chunks));
        const expected = referenceDecode(
          colorType,
          bitDepth,
          width,
          DIFFERENTIAL_HEIGHT,
          samples,
          palette,
          trns,
        );
        expect(Array.from(decoded.data)).toEqual(expected.data);
        expect(
          decoded.alpha === undefined ? undefined : Array.from(decoded.alpha),
        ).toEqual(expected.alpha);
        expect(decoded.channels).toBe(
          colorType === 0 || colorType === 4 ? 1 : 3,
        );
        expect(decoded.width).toBe(width);
        expect(decoded.height).toBe(DIFFERENTIAL_HEIGHT);
      }
    },
  );
});
