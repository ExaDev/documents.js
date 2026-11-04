/**
 * Unit tests for `isFlatColourPng` and `dropFlatColourImages`, and the same removal end to end through `DocumentsJsTextExtractionAdapter` on a real PDF built with `writePdf`, so a flat-colour image is proved to be gone from the extracted text while a picture stays.
 */
import { describe, expect, it, vi } from "vitest";
import { bytesToBase64, decodePng } from "byte-codec";
import type { LayoutDocument, LayoutItem } from "pdf-codec";
import { zlibSync } from "fflate";
import { renderContentDocumentToMarkdown } from "../markdown/render";
import { reconstructWordprocessing } from "./reconstruct";
import { isFlatColourPng, dropFlatColourImages } from "./flat-colour-images";

// Wraps the real decoder so a test can say whether an image was decoded whole.
vi.mock("byte-codec", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const realDecodePng = actual.decodePng as typeof decodePng;
  return { ...actual, decodePng: vi.fn(realDecodePng) };
});

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const NO_FILTER = 0;
const SUB = 1;
const UP = 2;
const AVERAGE = 3;
const PAETH = 4;

/** The PNG Paeth predictor: whichever of the left, upper and upper-left bytes is nearest `left + up - upperLeft`, the left one winning a tie, then the upper. */
function paethPredictor(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpperLeft = Math.abs(estimate - upperLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft) {
    return left;
  }
  return distanceUp <= distanceUpperLeft ? up : upperLeft;
}

/** `pixels` (one array of channel bytes per pixel, row by row) as a PNG, each scanline written with `filter` applied to the raw bytes, as an encoder would. */
function png(options: {
  width: number;
  height: number;
  colourType: 0 | 2 | 3 | 4 | 6;
  pixels: number[][];
  filter?: number;
  bitDepth?: number;
  interlace?: number;
  idat?: Uint8Array;
  /** How many `IDAT` chunks the compressed data is split across; one when omitted. */
  idatChunks?: number;
}): string {
  const { width, height, colourType, pixels } = options;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  const rowBytes = width * channels;
  const rows = Array.from({ length: height }, (_, y) =>
    Uint8Array.from(
      pixels.slice(y * width, (y + 1) * width).flatMap((pixel) => pixel),
    ),
  );
  const filter = options.filter ?? NO_FILTER;
  const scanlines = rows.flatMap((row, y) => {
    const above = rows[y - 1] ?? new Uint8Array(rowBytes);
    const filtered = row.map((raw, x) => {
      const left = x >= channels ? (row[x - channels] ?? 0) : 0;
      const up = above[x] ?? 0;
      const upperLeft = x >= channels ? (above[x - channels] ?? 0) : 0;
      switch (filter) {
        case SUB:
          return (raw - left) & 0xff;
        case UP:
          return (raw - up) & 0xff;
        case AVERAGE:
          return (raw - Math.floor((left + up) / 2)) & 0xff;
        case PAETH:
          return (raw - paethPredictor(left, up, upperLeft)) & 0xff;
        default:
          return raw;
      }
    });
    return [filter, ...filtered];
  });
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = options.bitDepth ?? 8;
  ihdr[9] = colourType;
  ihdr[12] = options.interlace ?? 0;
  const compressed = options.idat ?? zlibSync(Uint8Array.from(scanlines));
  const idatChunks = options.idatChunks ?? 1;
  const idatSize = Math.ceil(compressed.length / idatChunks);
  const parts = [
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    // A palette image names its colours in a PLTE chunk, three entries so an index of 0, 1 or 2 is defined.
    ...(colourType === 3 ? [chunk("PLTE", PALETTE)] : []),
    ...Array.from({ length: idatChunks }, (_, index) =>
      chunk(
        "IDAT",
        compressed.subarray(index * idatSize, (index + 1) * idatSize),
      ),
    ),
    chunk("IEND", new Uint8Array()),
  ];
  return bytesToBase64(Uint8Array.from(parts.flatMap((part) => [...part])));
}

/** Three distinct colours, as red, green and blue bytes in turn. */
const PALETTE = Uint8Array.of(0, 0, 0, 10, 20, 30, 40, 50, 60);

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const swatch = (pixel: number[]) =>
  png({
    width: 2,
    height: 2,
    colourType: 2,
    pixels: [pixel, pixel, pixel, pixel],
  });
const picture = png({
  width: 2,
  height: 2,
  colourType: 2,
  pixels: [RED, BLUE, BLUE, RED],
});

describe("isFlatColourPng", () => {
  it("is true for a PNG every pixel of which is one colour", () => {
    expect(isFlatColourPng(swatch(RED))).toBe(true);
  });

  it("is false when one pixel differs, in any row", () => {
    expect(isFlatColourPng(picture)).toBe(false);
    expect(
      isFlatColourPng(
        png({
          width: 2,
          height: 2,
          colourType: 2,
          pixels: [RED, RED, RED, BLUE],
        }),
      ),
    ).toBe(false);
  });

  it.each([
    ["no filter", NO_FILTER],
    ["Sub", SUB],
    ["Up", UP],
    ["Average", AVERAGE],
    ["Paeth", PAETH],
  ])("reads a PNG written with the %s filter", (_name, filter) => {
    const flat = [RED, RED, RED, RED, RED, RED];
    const varied = [RED, BLUE, RED, BLUE, RED, RED];
    expect(
      isFlatColourPng(
        png({ width: 3, height: 2, colourType: 2, pixels: flat, filter }),
      ),
    ).toBe(true);
    expect(
      isFlatColourPng(
        png({ width: 3, height: 2, colourType: 2, pixels: varied, filter }),
      ),
    ).toBe(false);
  });

  it.each([
    ["greyscale", 0, [[7]]],
    ["palette index", 3, [[1]]],
    ["greyscale with alpha", 4, [[7, 9]]],
    ["RGBA", 6, [[1, 2, 3, 4]]],
  ] as const)(
    "reads a %s PNG, its alpha included",
    (_name, colourType, one) => {
      const flat: number[][] = Array.from({ length: 4 }, () => [...one[0]]);
      expect(
        isFlatColourPng(png({ width: 2, height: 2, colourType, pixels: flat })),
      ).toBe(true);
      const last: number[] = [...one[0]];
      last[last.length - 1] = (last[last.length - 1] ?? 0) + 1;
      expect(
        isFlatColourPng(
          png({
            width: 2,
            height: 2,
            colourType,
            pixels: [flat[0] ?? [], flat[1] ?? [], flat[2] ?? [], last],
          }),
        ),
      ).toBe(false);
    },
  );

  it("reads compressed data split across several IDAT chunks as one stream", () => {
    const flat = [RED, RED, RED, RED, RED, RED];
    const varied = [RED, BLUE, RED, BLUE, RED, RED];
    expect(
      isFlatColourPng(
        png({
          width: 3,
          height: 2,
          colourType: 2,
          pixels: flat,
          idatChunks: 3,
        }),
      ),
    ).toBe(true);
    expect(
      isFlatColourPng(
        png({
          width: 3,
          height: 2,
          colourType: 2,
          pixels: varied,
          idatChunks: 3,
        }),
      ),
    ).toBe(false);
  });

  it.each([
    ["greyscale", 0, [[10], [200]]],
    [
      "truecolour",
      2,
      [
        [1, 2, 3],
        [1, 2, 4],
      ],
    ],
    [
      "greyscale with alpha",
      4,
      [
        [10, 255],
        [10, 0],
      ],
    ],
    [
      "truecolour with alpha",
      6,
      [
        [1, 2, 3, 255],
        [1, 2, 3, 0],
      ],
    ],
  ] as const)(
    "answers a %s image whose first scanline varies without decoding the rest of it",
    (_name, colourType, [first, second]) => {
      vi.mocked(decodePng).mockClear();
      const pixels = [[...first], [...second], [...first], [...first]];

      expect(
        isFlatColourPng(png({ width: 2, height: 2, colourType, pixels })),
      ).toBe(false);
      expect(decodePng).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["flat", [RED, RED, RED, RED], true],
    ["differing only after its first scanline", [RED, RED, RED, BLUE], false],
  ] as const)(
    "reads an eight-bit image %s from its scanlines, without decoding it into pixels",
    (_name, pixels, flat) => {
      vi.mocked(decodePng).mockClear();

      expect(
        isFlatColourPng(
          png({ width: 2, height: 2, colourType: 2, pixels: [...pixels] }),
        ),
      ).toBe(flat);
      expect(decodePng).not.toHaveBeenCalled();
    },
  );

  it("is false for an image whose scanline names a filter the format does not define", () => {
    const unknownFilter = zlibSync(Uint8Array.of(9, 255, 0, 0, 255, 0, 0));

    expect(
      isFlatColourPng(
        png({
          width: 2,
          height: 1,
          colourType: 2,
          pixels: [RED, RED],
          idat: unknownFilter,
        }),
      ),
    ).toBe(false);
  });

  it("is false for an image whose inflated data is shorter than its scanlines need", () => {
    const short = zlibSync(Uint8Array.of(0, 255, 0, 0));

    expect(
      isFlatColourPng(
        png({
          width: 2,
          height: 2,
          colourType: 2,
          pixels: [RED, RED, RED, RED],
          idat: short,
        }),
      ),
    ).toBe(false);
  });

  it("is false for what it cannot read, so the image is kept", () => {
    const flat = [RED, RED, RED, RED];
    expect(
      isFlatColourPng(
        png({ width: 2, height: 2, colourType: 2, pixels: flat, bitDepth: 16 }),
      ),
    ).toBe(false);
    expect(
      isFlatColourPng(
        png({ width: 2, height: 2, colourType: 2, pixels: flat, interlace: 1 }),
      ),
    ).toBe(false);
    expect(
      isFlatColourPng(
        png({
          width: 2,
          height: 2,
          colourType: 2,
          pixels: flat,
          idat: Uint8Array.of(1, 2, 3),
        }),
      ),
    ).toBe(false);
    expect(isFlatColourPng(bytesToBase64(Uint8Array.of(1, 2, 3, 4)))).toBe(
      false,
    );
  });
});

const BLACK = { r: 0, g: 0, b: 0 };

function text(value: string, yPt: number): LayoutItem {
  return {
    kind: "text",
    text: value,
    xPt: 72,
    yPt,
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: 10,
    color: BLACK,
  };
}

function image(imageId: string, yPt: number): LayoutItem {
  return { kind: "image", imageId, xPt: 72, yPt, widthPt: 100, heightPt: 12 };
}

function documentOf(
  images: Record<string, string>,
  items: LayoutItem[],
): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    images: Object.fromEntries(
      Object.entries(images).map(([id, base64]) => [
        id,
        { format: "png", base64, widthPx: 2, heightPx: 2 },
      ]),
    ),
    pages: [{ widthPt: 612, heightPt: 792, items }],
  };
}

describe("dropFlatColourImages", () => {
  it("removes every use of a flat-colour image and its asset, and keeps a picture and the text", () => {
    const stripped = dropFlatColourImages(
      documentOf({ flat: swatch(RED), picture }, [
        image("flat", 700),
        text("Body.", 680),
        image("picture", 600),
        image("flat", 500),
      ]),
    );

    expect(Object.keys(stripped.images)).toEqual(["picture"]);
    expect(stripped.pages[0]?.items.map((item) => item.kind)).toEqual([
      "text",
      "image",
    ]);
  });

  it("returns a document with no flat-colour image as the same object", () => {
    const layout = documentOf({ picture }, [image("picture", 600)]);

    expect(dropFlatColourImages(layout)).toBe(layout);
  });

  it("keeps an asset that is not a PNG", () => {
    const layout: LayoutDocument = {
      ...documentOf({}, [image("jpeg", 600)]),
      images: {
        jpeg: { format: "jpeg", base64: swatch(RED), widthPx: 2, heightPx: 2 },
      },
    };

    expect(dropFlatColourImages(layout)).toBe(layout);
  });
});

describe("reconstructWordprocessing on a page carrying flat-colour images", () => {
  it("drops the images that are one colour and keeps the picture and the words", () => {
    const content = reconstructWordprocessing(
      documentOf({ flat: swatch(RED), picture }, [
        image("flat", 740),
        text("Cable drums shall be marked.", 700),
        image("picture", 600),
        image("flat", 500),
      ]),
    );
    const markdown = renderContentDocumentToMarkdown(content);

    expect(markdown).toContain("Cable drums shall be marked");
    expect(markdown.match(/!\[[^\]]*\]\(data:image/g)).toHaveLength(1);
  });

  it("keeps white numbers set over a flat-colour image, which is removed only after the line numbers are read", () => {
    const WHITE = { r: 1, g: 1, b: 1 };
    const band: LayoutItem = {
      kind: "image",
      imageId: "flat",
      xPt: 20,
      yPt: 560,
      widthPt: 40,
      heightPt: 160,
    };
    const numbers: LayoutItem[] = [1, 2, 3, 4].flatMap((n, index) => [
      { ...text(String(n), 700 - index * 20), xPt: 34, color: WHITE },
      { ...text(`Body line ${String(index)}`, 700 - index * 20), xPt: 70 },
    ]);
    const content = reconstructWordprocessing(
      documentOf({ flat: swatch(RED) }, [band, ...numbers]),
    );
    const markdown = renderContentDocumentToMarkdown(content);

    expect(markdown).toContain("Body line 3");
    expect(markdown).not.toContain("data:image");
    expect(markdown).toContain("4Body line 3");
  });
});
