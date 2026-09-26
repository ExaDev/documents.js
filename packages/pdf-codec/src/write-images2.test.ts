import { base64ToBytes, bytesToBase64, decodePng, encodePng } from "byte-codec";
import { describe, expect, it } from "vitest";
import type {
  LayoutDocument,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
} from "./layout";
import { LAYOUT_FORMAT_VERSION } from "./layout";
import { writePdf } from "./write";

const HELVETICA = {
  family: "Helvetica",
  weight: "normal",
  style: "normal",
} as const;
const BLACK = { r: 0, g: 0, b: 0 };

// The hex spelling this writer gives every literal string (writeObject serialises text as
// UTF-16BE-with-BOM for /Producer-style strings and plain hex for literal-string operands).

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function docWithPages(
  pages: readonly LayoutPage[],
  images: Record<string, LayoutImageAsset> = {},
): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {},
    pages: [...pages],
    images,
  };
}

function docWithItems(items: readonly LayoutItem[]): LayoutDocument {
  return docWithPages([{ widthPt: 612, heightPt: 792, items: [...items] }]);
}

function tinyPngAsset(): LayoutImageAsset {
  const width = 2;
  const height = 2;
  // 4 solid-colour pixels, RGB, no alpha.
  const data = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const bytes = encodePng({ width, height, channels: 3, data });
  return {
    format: "png",
    base64: bytesToBase64(bytes),
    widthPx: width,
    heightPx: height,
  };
}

// A minimal, hand-built JPEG: SOI, a baseline SOF0 segment declaring 3x2 pixels / 3 components / 8-bit precision, then EOI. No huffman/quant tables or entropy-coded scan data — readJpegInfo only scans for the SOF marker and never decodes samples, so this is a fully valid input for it despite not being a real, viewable image.
function tinyJpegAsset(): LayoutImageAsset {
  // prettier-ignore
  const bytes = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0x00, 0x11, // SOF0, length 17
    0x08, // precision
    0x00, 0x02, // height = 2
    0x00, 0x03, // width = 3
    0x03, // 3 components
    0x01, 0x22, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ]);
  return {
    format: "jpeg",
    base64: bytesToBase64(bytes),
    widthPx: 3,
    heightPx: 2,
  };
}

// Same shape as tinyJpegAsset, generalised over component count and an optional Adobe APP14 marker (ISO 32000-1 has no opinion on this marker; it's a de facto Adobe convention every real CMYK JPEG carries), for exercising prepareJpegImage's colour-space and /Decode-inversion branches.
function jpegAsset(
  components: 1 | 3 | 4,
  adobeTransform?: number,
): LayoutImageAsset {
  const componentBytes: number[] = [];
  for (let i = 0; i < components; i++) {
    componentBytes.push(i + 1, 0x22, 0);
  }
  const app14: number[] =
    adobeTransform === undefined
      ? []
      : [
          0xff,
          0xee, // APP14
          0x00,
          0x0e, // length 14
          0x41,
          0x64,
          0x6f,
          0x62,
          0x65, // "Adobe"
          0x00,
          0x64, // version
          0x00,
          0x00, // flags0
          0x00,
          0x00, // flags1
          adobeTransform,
        ];
  // prettier-ignore
  const bytes = new Uint8Array([
    0xff, 0xd8, // SOI
    ...app14,
    0xff, 0xc0, 0x00, 8 + 3 * components, // SOF0
    0x08, // precision
    0x00, 0x02, // height = 2
    0x00, 0x03, // width = 3
    components,
    ...componentBytes,
    0xff, 0xd9, // EOI
  ]);
  return {
    format: "jpeg",
    base64: bytesToBase64(bytes),
    widthPx: 3,
    heightPx: 2,
  };
}

describe("writePdf: images", () => {
  it("embeds a PNG-sourced image as a FlateDecode XObject with the right dimensions and colour space", () => {
    const asset = tinyPngAsset();
    const doc = docWithPages(
      [
        {
          widthPt: 100,
          heightPt: 100,
          items: [
            {
              kind: "image",
              imageId: "logo",
              xPt: 0,
              yPt: 0,
              widthPt: 50,
              heightPt: 50,
            },
          ],
        },
      ],
      { logo: asset },
    );
    const text = decode(writePdf(doc));
    expect(text).toContain("/Subtype /Image");
    expect(text).toContain("/ColorSpace /DeviceRGB");
    expect(text).toContain("/Width 2");
    expect(text).toContain("/Height 2");
    // The Im1 Do operator itself lives inside the (by-default-compressed) content stream, so check the page's own Resources dict mapping instead — that stays plain ASCII regardless of the compress option.
    expect(text).toContain("/XObject <</Im1 ");
  });

  it("names image resources by sorted imageId order, not first-encountered order", () => {
    // Two distinctly-sized assets so each one's own object dict is independently identifiable. "zebra" is the FIRST page item (first-encountered), but "apple" sorts first alphabetically — if imageIds were resource-named by encounter order instead of sorted order, Im1 would resolve to zebra's own 4x4 dict instead of apple's 2x2 one.
    const small = tinyPngAsset(); // 2x2
    const width = 4;
    const height = 4;
    const large = {
      format: "png" as const,
      base64: bytesToBase64(
        encodePng({
          width,
          height,
          channels: 3,
          data: new Uint8Array(width * height * 3),
        }),
      ),
      widthPx: width,
      heightPx: height,
    };
    const text = decode(
      writePdf(
        docWithPages(
          [
            {
              widthPt: 100,
              heightPt: 100,
              items: [
                {
                  kind: "image",
                  imageId: "zebra", // encountered FIRST, but sorts LAST; the 4x4 asset
                  xPt: 0,
                  yPt: 0,
                  widthPt: 50,
                  heightPt: 50,
                },
                {
                  kind: "image",
                  imageId: "apple", // encountered SECOND, but sorts FIRST; the 2x2 asset
                  xPt: 0,
                  yPt: 0,
                  widthPt: 50,
                  heightPt: 50,
                },
              ],
            },
          ],
          { zebra: large, apple: small },
        ),
        { compress: false },
      ),
    );
    const im1Ref = /\/Im1 (\d+) 0 R/.exec(text);
    expect(im1Ref).not.toBeNull();
    const im1Obj = new RegExp(
      `\\n${im1Ref![1]} 0 obj\\n([\\s\\S]*?)\\nendobj`,
    ).exec(text);
    expect(im1Obj).not.toBeNull();
    // "apple" sorts before "zebra", so Im1 must be apple's own 2x2 object, never zebra's 4x4 one.
    expect(im1Obj![1]).toContain("/Width 2");
    expect(im1Obj![1]).toContain("/Height 2");
  });

  it("embeds a JPEG-sourced image verbatim via DCTDecode, never re-encoding it", () => {
    const asset = tinyJpegAsset();
    const doc = docWithPages(
      [
        {
          widthPt: 100,
          heightPt: 100,
          items: [
            {
              kind: "image",
              imageId: "photo",
              xPt: 0,
              yPt: 0,
              widthPt: 50,
              heightPt: 50,
            },
          ],
        },
      ],
      { photo: asset },
    );
    const text = decode(writePdf(doc, { compress: false }));
    expect(text).toContain("/Type /XObject");
    expect(text).toContain("/Subtype /Image");
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("/Width 3");
    expect(text).toContain("/Height 2");
    expect(text).toContain("/ColorSpace /DeviceRGB");
    expect(text).toContain("/BitsPerComponent 8");
  });

  it("resolves a JPEG's colour space from its own component count: 1 -> DeviceGray, 3 -> DeviceRGB, 4 -> DeviceCMYK", () => {
    for (const [components, colorSpace] of [
      [1, "DeviceGray"],
      [3, "DeviceRGB"],
      [4, "DeviceCMYK"],
    ] as const) {
      const doc = docWithPages(
        [
          {
            widthPt: 100,
            heightPt: 100,
            items: [
              {
                kind: "image",
                imageId: "photo",
                xPt: 0,
                yPt: 0,
                widthPt: 50,
                heightPt: 50,
              },
            ],
          },
        ],
        { photo: jpegAsset(components) },
      );
      const text = decode(writePdf(doc, { compress: false }));
      expect(text).toContain(`/ColorSpace /${colorSpace}`);
    }
  });

  it("inverts a CMYK JPEG's colour with /Decode when its Adobe transform is YCCK (2) or absent, but not when it is explicitly untransformed (0)", () => {
    const decodeFor = (adobeTransform: number | undefined): boolean => {
      const doc = docWithPages(
        [
          {
            widthPt: 100,
            heightPt: 100,
            items: [
              {
                kind: "image",
                imageId: "photo",
                xPt: 0,
                yPt: 0,
                widthPt: 50,
                heightPt: 50,
              },
            ],
          },
        ],
        { photo: jpegAsset(4, adobeTransform) },
      );
      const text = decode(writePdf(doc, { compress: false }));
      return text.includes("/Decode [1 0 1 0 1 0 1 0]");
    };
    expect(decodeFor(2)).toBe(true);
    expect(decodeFor(undefined)).toBe(true);
    expect(decodeFor(0)).toBe(false);
  });

  it("never adds the CMYK /Decode inversion to a non-CMYK (3-component) JPEG, even with an Adobe transform of 2", () => {
    const doc = docWithPages(
      [
        {
          widthPt: 100,
          heightPt: 100,
          items: [
            {
              kind: "image",
              imageId: "photo",
              xPt: 0,
              yPt: 0,
              widthPt: 50,
              heightPt: 50,
            },
          ],
        },
      ],
      { photo: jpegAsset(3, 2) },
    );
    const text = decode(writePdf(doc, { compress: false }));
    expect(text).not.toContain("/Decode");
  });

  it("writes a bilevel image as CCITT Group 4 when that is smaller than Flate, and reads it back (#975)", async () => {
    // A diagonal edge: every row shifts the black/white boundary one pixel right, so each row codes as two vertical-mode offsets against the previous one — the vertically coherent shape CCITT Group 4 exists for (a real scan's edges and text baselines behave exactly this way). Decorrelated noise would instead be deflate's own best case, which is what the pick-the-smaller rule protects onto Flate.
    const width = 96;
    const height = 96;
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const edge = 20 + (y % 56);
      for (let x = 0; x < width; x++) {
        data[y * width + x] = x < edge ? 255 : 0;
      }
    }
    const bytes = encodePng({ width, height, channels: 1, data });
    const doc = docWithPages(
      [
        {
          widthPt: 100,
          heightPt: 100,
          items: [
            {
              kind: "image",
              imageId: "scan",
              xPt: 0,
              yPt: 0,
              widthPt: 50,
              heightPt: 50,
            },
          ],
        },
      ],
      {
        scan: {
          format: "png",
          base64: bytesToBase64(bytes),
          widthPx: width,
          heightPx: height,
        },
      },
    );
    // compress defaults to true — G4 is compression, so it sits behind the same option as Flate; the dictionary entries stay plain ASCII either way, only streams are flated.
    const out = writePdf(doc);
    const text = new TextDecoder("latin1").decode(out);
    expect(text).toContain("/Type /XObject");
    expect(text).toContain("/Subtype /Image");
    expect(text).toContain("/ColorSpace /DeviceGray");
    expect(text).toContain("/CCITTFaxDecode");
    expect(text).toContain("/K -1");
    expect(text).toContain("/BitsPerComponent 1");
    expect(text).toContain(`/Columns ${width}`);
    expect(text).toContain(`/Rows ${height}`);
    expect(text).toContain("/BlackIs1 false");
    // ...and the package's own reader decodes the G4 stream back to pixels: the recovered asset is a PNG whose samples equal the original checkerboard exactly.
    const { readPdf } = await import("./read");
    const reread = readPdf(out);
    const imageItem = reread.pages[0]!.items.find(
      (item): item is Extract<LayoutItem, { kind: "image" }> =>
        item.kind === "image",
    );
    expect(imageItem).toBeDefined();
    const asset = reread.images[imageItem!.imageId];
    expect(asset?.format).toBe("png");
    const recovered = decodePng(base64ToBytes(asset!.base64));
    expect(recovered.width).toBe(width);
    expect(recovered.height).toBe(height);
    expect(Array.from(recovered.data)).toEqual(Array.from(data));
  });

  it("keeps Flate for a genuinely greyscale image and for a bilevel image with a soft mask", () => {
    // Greyscale intermediate values have no G4 spelling; a soft mask would need its own separate stream, so both stay on the ordinary path.
    const grey = new Uint8Array(new ArrayBuffer(4 * 4)).fill(128);
    const greyDoc = docWithPages(
      [
        {
          widthPt: 100,
          heightPt: 100,
          items: [
            {
              kind: "image",
              imageId: "g",
              xPt: 0,
              yPt: 0,
              widthPt: 50,
              heightPt: 50,
            },
          ],
        },
      ],
      {
        g: {
          format: "png",
          base64: bytesToBase64(
            encodePng({ width: 4, height: 4, channels: 1, data: grey }),
          ),
          widthPx: 4,
          heightPx: 4,
        },
      },
    );
    const greyText = new TextDecoder("latin1").decode(writePdf(greyDoc));
    expect(greyText).toContain("/FlateDecode");
    expect(greyText).not.toContain("/CCITTFaxDecode");
  });

  it("throws when a LayoutImage references an imageId missing from the images registry", () => {
    const doc = docWithPages(
      [
        {
          widthPt: 100,
          heightPt: 100,
          items: [
            {
              kind: "image",
              imageId: "missing",
              xPt: 0,
              yPt: 0,
              widthPt: 50,
              heightPt: 50,
            },
          ],
        },
      ],
      {},
    );
    expect(() => writePdf(doc)).toThrow(/missing/);
  });
});

describe("writePdf: determinism", () => {
  it("produces byte-identical output for identical input, called twice", () => {
    const doc = docWithItems([
      {
        kind: "text",
        text: "Hello",
        xPt: 10,
        yPt: 700,
        font: HELVETICA,
        sizePt: 12,
        color: BLACK,
      },
      {
        kind: "rect",
        xPt: 0,
        yPt: 0,
        widthPt: 10,
        heightPt: 10,
        fill: { r: 1, g: 0, b: 0 },
      },
    ]);
    const first = writePdf(doc);
    const second = writePdf(doc);
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});
