import type { RawImage } from "byte-codec";
import { deflate, encodePng } from "byte-codec";
import { describe, expect, it } from "vitest";
import type { PdfDiagnosticSink } from "./diagnostics";
import { decodeStream } from "./filters";
import type { ResolvedColorSpace } from "./images-read";
import {
  decodeImageSamples,
  readImageXObject,
  SampleDecodeWork,
} from "./images-read";
import type { PdfObjectResolver } from "./interpret-types";
import type { PdfDict, PdfObject } from "./objects";
import {
  asDict,
  pdfArray,
  pdfDict,
  pdfName,
  pdfNum,
  pdfRef,
  pdfHexString,
  pdfStream,
} from "./objects";
import {
  CCITT_FAX_FIXTURES,
  ccittFixtureBytes,
} from "./test-support/ccitt-fax";
import { JBIG2_FIXTURES, jbig2FixtureBytes } from "./test-support/jbig2";
import { referenceDecodeImageSamples } from "./test-support/reference-image-decode";
import { randomBytes, seededRandom } from "./test-support/seeded-random";

// The current sample decode against the per-sample-array decode it replaced (test-support/reference-image-decode.ts): every colour space, bit depth and /Decode setting the package decodes, over row widths that do and do not fill their last byte, and over streams that are exactly as long as the image, shorter (mid-row and mid-pixel included) and longer. Both must produce the same raster and so the same PNG bytes, since an image's id is the crc32 of those bytes.

type DecodableColorSpace = Exclude<
  ResolvedColorSpace,
  { readonly kind: "unsupported" }
>;

const NOOP_SINK: PdfDiagnosticSink = () => undefined;
const BIT_DEPTHS = [1, 2, 4, 8] as const;
// Widths chosen so a row of 1-, 2- and 4-bit samples ends mid-byte for at least one depth and one component count, which is where row padding shows.
const DIMENSIONS = [
  [1, 1],
  [3, 2],
  [7, 5],
  [13, 4],
  [16, 3],
] as const;

function bytesPerRow(
  width: number,
  components: number,
  bitsPerComponent: number,
): number {
  return Math.ceil((width * components * bitsPerComponent) / 8);
}

function colorSpaces(
  random: () => number,
): readonly (readonly [string, DecodableColorSpace])[] {
  const lookup = (entries: number, components: number) =>
    randomBytes(random, entries * components);
  return [
    ["gray", { kind: "gray" }],
    ["rgb", { kind: "rgb" }],
    ["cmyk", { kind: "cmyk" }],
    [
      "indexed over gray",
      { kind: "indexed", base: { kind: "gray" }, lookup: lookup(256, 1) },
    ],
    [
      "indexed over rgb",
      { kind: "indexed", base: { kind: "rgb" }, lookup: lookup(256, 3) },
    ],
    [
      "indexed over cmyk",
      { kind: "indexed", base: { kind: "cmyk" }, lookup: lookup(256, 4) },
    ],
    // A palette shorter than the indices reach, whose missing entries read as 0.
    [
      "indexed over rgb with a short palette",
      { kind: "indexed", base: { kind: "rgb" }, lookup: lookup(3, 3) },
    ],
    [
      "indexed over an unsupported base",
      {
        kind: "indexed",
        base: { kind: "unsupported", name: "Pattern" },
        lookup: lookup(16, 3),
      },
    ],
  ];
}

function componentsPerPixel(colorSpace: DecodableColorSpace): number {
  if (colorSpace.kind === "indexed" || colorSpace.kind === "gray") {
    return 1;
  }
  return colorSpace.kind === "cmyk" ? 4 : 3;
}

// Stream lengths around the image's own: empty, one byte, mid-row, one byte short, exact, and with trailing bytes.
function streamLengths(exact: number, rowBytes: number): readonly number[] {
  return [
    ...new Set([
      0,
      1,
      Math.floor(rowBytes / 2),
      rowBytes + 1,
      exact - 1,
      exact,
      exact + rowBytes + 3,
    ]),
  ].filter((length) => length >= 0);
}

function plain(image: RawImage): Record<string, unknown> {
  return { ...image, data: Array.from(image.data) };
}

describe("decodeImageSamples against the per-sample-array decode it replaced", () => {
  const random = seededRandom(1721);
  for (const [name, colorSpace] of colorSpaces(random)) {
    for (const bitsPerComponent of BIT_DEPTHS) {
      it(`decodes ${name} at ${String(bitsPerComponent)} bits per component to the same raster and PNG bytes`, () => {
        let compared = 0;
        for (const [width, height] of DIMENSIONS) {
          const rowBytes = bytesPerRow(
            width,
            componentsPerPixel(colorSpace),
            bitsPerComponent,
          );
          const exact = rowBytes * height;
          for (const length of streamLengths(exact, rowBytes)) {
            const data = randomBytes(random, length);
            for (const inverted of [false, true]) {
              const expected = referenceDecodeImageSamples(
                data,
                width,
                height,
                bitsPerComponent,
                colorSpace,
                inverted,
              );
              const actual = decodeImageSamples(
                data,
                width,
                height,
                bitsPerComponent,
                colorSpace,
                inverted,
              );
              expect(plain(actual)).toEqual(plain(expected));
              expect(encodePng(actual)).toEqual(encodePng(expected));
              compared++;
            }
          }
        }
        // Every dimension, stream length and /Decode setting reached the comparison.
        expect(compared).toBeGreaterThanOrEqual(DIMENSIONS.length * 2 * 5);
      });
    }
  }

  it("agrees on 300 seeded images of random size, depth, colour space and stream length", () => {
    const generate = seededRandom(0x1721);
    const spaces = colorSpaces(generate);
    for (let run = 0; run < 300; run++) {
      const [, colorSpace] = spaces[Math.floor(generate() * spaces.length)]!;
      const bitsPerComponent =
        BIT_DEPTHS[Math.floor(generate() * BIT_DEPTHS.length)]!;
      const width = 1 + Math.floor(generate() * 40);
      const height = 1 + Math.floor(generate() * 12);
      const exact =
        bytesPerRow(width, componentsPerPixel(colorSpace), bitsPerComponent) *
        height;
      const data = randomBytes(
        generate,
        Math.floor(generate() * (exact + exact / 4 + 2)),
      );
      const inverted = generate() < 0.5;
      const expected = referenceDecodeImageSamples(
        data,
        width,
        height,
        bitsPerComponent,
        colorSpace,
        inverted,
      );
      const actual = decodeImageSamples(
        data,
        width,
        height,
        bitsPerComponent,
        colorSpace,
        inverted,
      );
      expect(plain(actual), `run ${String(run)}`).toEqual(plain(expected));
      expect(encodePng(actual), `run ${String(run)}`).toEqual(
        encodePng(expected),
      );
    }
  });
});

describe("decodeImageSamples: the bytes it allocates", () => {
  function work(): SampleDecodeWork {
    return new SampleDecodeWork();
  }

  it("allocates nothing for an 8-bit gray or RGB image without inversion, whose stream already is the raster", () => {
    // The size of the large raster that issue #1721 describes, as a stream of zeros: the decode reads no sample, so its size costs nothing to test.
    const width = 3969;
    const height = 2480;
    const data = new Uint8Array(width * height * 3);
    for (const [colorSpace, channels] of [
      [{ kind: "rgb" }, 3],
      [{ kind: "gray" }, 1],
    ] as const) {
      const counted = work();
      const image = decodeImageSamples(
        data,
        width,
        height,
        8,
        colorSpace,
        false,
        counted,
      );
      expect(counted.bytesAllocated).toBe(0);
      expect(image.data.buffer).toBe(data.buffer);
      expect(image.data.length).toBe(width * height * channels);
    }
  });

  it("allocates the raster, one row of samples and one table entry per sample value, and nothing per sample", () => {
    const random = seededRandom(17210);
    const width = 37;
    const height = 9;
    for (const [, colorSpace] of colorSpaces(random)) {
      const components = componentsPerPixel(colorSpace);
      for (const bitsPerComponent of BIT_DEPTHS) {
        for (const inverted of [false, true]) {
          if (
            bitsPerComponent === 8 &&
            !inverted &&
            (colorSpace.kind === "gray" || colorSpace.kind === "rgb")
          ) {
            continue; // the view case above
          }
          const data = randomBytes(
            random,
            bytesPerRow(width, components, bitsPerComponent) * height,
          );
          const counted = work();
          const image = decodeImageSamples(
            data,
            width,
            height,
            bitsPerComponent,
            colorSpace,
            inverted,
            counted,
          );
          const values = 2 ** bitsPerComponent;
          const table =
            colorSpace.kind === "indexed" ? values * image.channels : values;
          expect(counted.bytesAllocated).toBe(
            image.data.length + width * components + table,
          );
          expect(image.data.length).toBe(width * height * image.channels);
        }
      }
    }
  });

  it("allocates about one byte per output sample for a large one-bit scan, against eight or more per sample for a number array", () => {
    // A one-bit page scan, the second shape issue #1721 reports, at a size that keeps the walk cheap: what is bounded is the allocation, which does not depend on the content.
    const width = 2480;
    const height = 64;
    const data = randomBytes(seededRandom(7), (width / 8) * height);
    const counted = work();
    const image = decodeImageSamples(
      data,
      width,
      height,
      1,
      { kind: "gray" },
      false,
      counted,
    );
    expect(counted.bytesAllocated).toBe(width * height + width + 2);
    expect(counted.bytesAllocated).toBeLessThan(width * (height + 2));
    expect(image.data.length).toBe(width * height);
  });
});

// --- readImageXObject over every filter: the stream a filter decodes is what the sample decode reads, so each filter's output is compared through the whole read, against encodePng of the reference decode over decodeStream's own output. ---

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined =>
    obj?.kind === "ref" ? objects.get(obj.num) : obj;
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined =>
    asDict(resolve(obj));
  return { resolve, resolveDict };
}

function asciiHexEncode(bytes: Uint8Array<ArrayBuffer>): Uint8Array {
  const text = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(" ");
  return new TextEncoder().encode(`${text}>`);
}

function ascii85Encode(bytes: Uint8Array<ArrayBuffer>): Uint8Array {
  let text = "";
  for (let i = 0; i < bytes.length; i += 4) {
    const group = bytes.subarray(i, i + 4);
    const padded = [...group, 0, 0, 0].slice(0, 4);
    let value =
      ((padded[0]! << 24) |
        (padded[1]! << 16) |
        (padded[2]! << 8) |
        padded[3]!) >>>
      0;
    if (value === 0 && group.length === 4) {
      text += "z";
      continue;
    }
    const digits: string[] = [];
    for (let d = 0; d < 5; d++) {
      digits.unshift(String.fromCharCode(33 + (value % 85)));
      value = Math.floor(value / 85);
    }
    text += digits.slice(0, group.length + 1).join("");
  }
  return new TextEncoder().encode(`${text}~>`);
}

// Literal runs of up to 128 bytes, with a repeat run wherever a byte repeats, then the end-of-data marker.
function runLengthEncode(bytes: Uint8Array<ArrayBuffer>): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    let repeat = 1;
    while (
      i + repeat < bytes.length &&
      repeat < 128 &&
      bytes[i + repeat] === bytes[i]
    ) {
      repeat++;
    }
    if (repeat > 1) {
      out.push(257 - repeat, bytes[i]!);
      i += repeat;
      continue;
    }
    const literal = bytes.subarray(i, Math.min(i + 128, bytes.length));
    out.push(literal.length - 1, ...literal);
    i += literal.length;
  }
  out.push(128);
  return Uint8Array.from(out);
}

// Every byte as its own 9-bit literal code, with a clear-table code often enough that the code width never grows: a valid LZW stream (ISO 32000-1 7.4.4) that needs no dictionary on the encoding side.
function lzwEncode(bytes: Uint8Array<ArrayBuffer>): Uint8Array {
  const codes = [256];
  bytes.forEach((byte, index) => {
    if (index > 0 && index % 200 === 0) {
      codes.push(256);
    }
    codes.push(byte);
  });
  codes.push(257);
  const out = new Uint8Array(Math.ceil((codes.length * 9) / 8));
  codes.forEach((code, index) => {
    for (let bit = 0; bit < 9; bit++) {
      if ((code >> (8 - bit)) & 1) {
        const position = index * 9 + bit;
        out[position >> 3]! |= 0x80 >> (position & 7);
      }
    }
  });
  return out;
}

// PNG predictor rows (ISO 32000-1 7.4.4.4), alternating the None and Sub filter types so both are exercised.
function pngPredict(
  bytes: Uint8Array<ArrayBuffer>,
  rowBytes: number,
  pixelBytes: number,
): Uint8Array<ArrayBuffer> {
  const rows = Math.ceil(bytes.length / rowBytes);
  const out = new Uint8Array(rows * (rowBytes + 1));
  for (let row = 0; row < rows; row++) {
    const sub = row % 2 === 1;
    out[row * (rowBytes + 1)] = sub ? 1 : 0;
    for (let i = 0; i < rowBytes; i++) {
      const value = bytes[row * rowBytes + i] ?? 0;
      const left =
        i >= pixelBytes ? (bytes[row * rowBytes + i - pixelBytes] ?? 0) : 0;
      out[row * (rowBytes + 1) + 1 + i] = sub ? (value - left) & 0xff : value;
    }
  }
  return out;
}

// TIFF predictor 2 over 8-bit samples: each sample less the same component of the pixel to its left.
function tiffPredict(
  bytes: Uint8Array<ArrayBuffer>,
  rowBytes: number,
  colors: number,
): Uint8Array<ArrayBuffer> {
  return bytes.map((value, index) =>
    index % rowBytes >= colors
      ? (value - bytes[index - colors]!) & 0xff
      : value,
  );
}

interface FilterCase {
  readonly name: string;
  readonly entries: Record<string, PdfObject>;
  readonly encode: (
    samples: Uint8Array<ArrayBuffer>,
    rowBytes: number,
    colors: number,
  ) => Uint8Array;
}

const FILTERS: readonly FilterCase[] = [
  { name: "no filter", entries: {}, encode: (samples) => samples },
  {
    name: "FlateDecode",
    entries: { Filter: pdfName("FlateDecode") },
    encode: (samples) => deflate(samples),
  },
  {
    name: "LZWDecode",
    entries: { Filter: pdfName("LZWDecode") },
    encode: (samples) => lzwEncode(samples),
  },
  {
    name: "ASCIIHexDecode",
    entries: { Filter: pdfName("ASCIIHexDecode") },
    encode: (samples) => asciiHexEncode(samples),
  },
  {
    name: "ASCII85Decode",
    entries: { Filter: pdfName("ASCII85Decode") },
    encode: (samples) => ascii85Encode(samples),
  },
  {
    name: "RunLengthDecode",
    entries: { Filter: pdfName("RunLengthDecode") },
    encode: (samples) => runLengthEncode(samples),
  },
  {
    name: "a FlateDecode then ASCIIHexDecode chain",
    entries: {
      Filter: pdfArray([pdfName("ASCIIHexDecode"), pdfName("FlateDecode")]),
    },
    encode: (samples) => asciiHexEncode(deflate(samples)),
  },
];

function predictorCases(
  width: number,
  colors: number,
  bitsPerComponent: number,
): readonly FilterCase[] {
  const parms = (predictor: number) =>
    pdfDict({
      Predictor: pdfNum(predictor),
      Colors: pdfNum(colors),
      BitsPerComponent: pdfNum(bitsPerComponent),
      Columns: pdfNum(width),
    });
  const pixelBytes = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const cases: FilterCase[] = [
    {
      name: "FlateDecode with a PNG predictor",
      entries: { Filter: pdfName("FlateDecode"), DecodeParms: parms(15) },
      encode: (samples, rowBytes) =>
        deflate(pngPredict(samples, rowBytes, pixelBytes)),
    },
  ];
  if (bitsPerComponent === 8) {
    cases.push({
      name: "FlateDecode with the TIFF predictor",
      entries: { Filter: pdfName("FlateDecode"), DecodeParms: parms(2) },
      encode: (samples, rowBytes) =>
        deflate(tiffPredict(samples, rowBytes, colors)),
    });
  }
  return cases;
}

// The reference read: decodeStream (unchanged) for the filters, the reference sample decode, and the soft mask's own decoded bytes as alpha when it is the image's size at 8 bits, as readSoftMaskAlpha takes it.
function referenceRead(
  dict: PdfDict,
  raw: Uint8Array<ArrayBuffer>,
  resolver: Readonly<PdfObjectResolver>,
  width: number,
  height: number,
  bitsPerComponent: number,
  colorSpace: DecodableColorSpace,
  inverted: boolean,
  alpha: Uint8Array<ArrayBuffer> | undefined,
): Uint8Array<ArrayBuffer> {
  const decoded = decodeStream(raw, dict, NOOP_SINK, (obj) =>
    resolver.resolve(obj),
  );
  const image = referenceDecodeImageSamples(
    decoded.bytes,
    width,
    height,
    bitsPerComponent,
    colorSpace,
    inverted,
  );
  return encodePng(alpha === undefined ? image : { ...image, alpha });
}

const DICT_COLOR_SPACES: readonly (readonly [
  PdfObject,
  DecodableColorSpace,
])[] = [
  [pdfName("DeviceGray"), { kind: "gray" }],
  [pdfName("DeviceRGB"), { kind: "rgb" }],
  [pdfName("DeviceCMYK"), { kind: "cmyk" }],
  [
    pdfArray([
      pdfName("Indexed"),
      pdfName("DeviceRGB"),
      pdfNum(255),
      pdfHexString(Uint8Array.from({ length: 768 }, (_, i) => (i * 37) & 0xff)),
    ]),
    {
      kind: "indexed",
      base: { kind: "rgb" },
      lookup: Uint8Array.from({ length: 768 }, (_, i) => (i * 37) & 0xff),
    },
  ],
];

describe("readImageXObject against the reference decode, through every filter and with and without a soft mask", () => {
  const width = 11;
  const height = 6;
  const random = seededRandom(0x6a6);

  for (const [csObject, colorSpace] of DICT_COLOR_SPACES) {
    const colors = componentsPerPixel(colorSpace);
    for (const bitsPerComponent of BIT_DEPTHS) {
      const rowBytes = bytesPerRow(width, colors, bitsPerComponent);
      const filters = [
        ...FILTERS,
        ...predictorCases(width, colors, bitsPerComponent),
      ];
      for (const filter of filters) {
        it(`reads a ${colorSpace.kind} image at ${String(bitsPerComponent)} bits through ${filter.name} to the reference PNG`, () => {
          const samples = randomBytes(random, rowBytes * height);
          const raw = Uint8Array.from(filter.encode(samples, rowBytes, colors));
          const maskBytes = randomBytes(random, width * height);
          const objects = new Map<number, PdfObject>([
            [
              7,
              pdfStream(
                pdfDict({
                  Width: pdfNum(width),
                  Height: pdfNum(height),
                  BitsPerComponent: pdfNum(8),
                  ColorSpace: pdfName("DeviceGray"),
                  Filter: pdfName("FlateDecode"),
                }),
                deflate(maskBytes),
              ),
            ],
          ]);
          const resolver = makeResolver(objects);
          // The filter itself decodes back to exactly the samples encoded.
          expect(
            decodeStream(raw, pdfDict(filter.entries), NOOP_SINK).bytes,
          ).toEqual(samples);
          for (const masked of [false, true]) {
            for (const inverted of [false, true]) {
              const dict = pdfDict({
                Width: pdfNum(width),
                Height: pdfNum(height),
                BitsPerComponent: pdfNum(bitsPerComponent),
                ColorSpace: csObject,
                ...filter.entries,
                ...(inverted
                  ? { Decode: pdfArray([pdfNum(1), pdfNum(0)]) }
                  : {}),
                ...(masked ? { SMask: pdfRef(7, 0) } : {}),
              });
              const actual = readImageXObject(dict, raw, resolver, NOOP_SINK);
              expect(actual?.bytes).toEqual(
                referenceRead(
                  dict,
                  raw,
                  resolver,
                  width,
                  height,
                  bitsPerComponent,
                  colorSpace,
                  inverted && colorSpace.kind !== "indexed",
                  masked ? maskBytes : undefined,
                ),
              );
            }
          }
        });
      }
    }
  }

  it("reads every CCITT fax fixture to the reference PNG", () => {
    for (const fixture of CCITT_FAX_FIXTURES) {
      for (const [encoding, k] of [
        [fixture.encodings.group4, -1],
        [fixture.encodings.group3OneDimensional, 0],
        [fixture.encodings.group3TwoDimensional, 1],
        [fixture.encodings.group3TwoDimensionalFilled, 1],
      ] as const) {
        const dict = pdfDict({
          Width: pdfNum(fixture.columns),
          Height: pdfNum(fixture.rows),
          BitsPerComponent: pdfNum(1),
          ColorSpace: pdfName("DeviceGray"),
          Filter: pdfName("CCITTFaxDecode"),
          DecodeParms: pdfDict({
            K: pdfNum(k),
            Columns: pdfNum(fixture.columns),
            Rows: pdfNum(fixture.rows),
          }),
        });
        const raw = ccittFixtureBytes(encoding);
        const resolver = makeResolver(new Map());
        expect(
          readImageXObject(dict, raw, resolver, NOOP_SINK)?.bytes,
          fixture.name,
        ).toEqual(
          referenceRead(
            dict,
            raw,
            resolver,
            fixture.columns,
            fixture.rows,
            1,
            { kind: "gray" },
            false,
            undefined,
          ),
        );
      }
    }
  });

  it("reads every JBIG2 fixture to the reference PNG", () => {
    let compared = 0;
    for (const fixture of JBIG2_FIXTURES) {
      const objects = new Map<number, PdfObject>();
      if (fixture.globals !== undefined) {
        objects.set(
          7,
          pdfStream(pdfDict({}), jbig2FixtureBytes(fixture.globals)),
        );
      }
      const dict = pdfDict({
        Width: pdfNum(fixture.width),
        Height: pdfNum(fixture.height),
        BitsPerComponent: pdfNum(1),
        ColorSpace: pdfName("DeviceGray"),
        Filter: pdfName("JBIG2Decode"),
        ...(fixture.globals !== undefined
          ? { DecodeParms: pdfDict({ JBIG2Globals: pdfRef(7, 0) }) }
          : {}),
      });
      const raw = jbig2FixtureBytes(fixture.stream);
      const resolver = makeResolver(objects);
      const actual = readImageXObject(dict, raw, resolver, NOOP_SINK);
      if (actual === undefined) {
        continue; // a fixture this decoder refuses never reaches the sample decode
      }
      expect(actual.bytes, fixture.name).toEqual(
        referenceRead(
          dict,
          raw,
          resolver,
          fixture.width,
          fixture.height,
          1,
          { kind: "gray" },
          false,
          undefined,
        ),
      );
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });
});
