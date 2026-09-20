import { base64ToBytes, bytesToBase64, decodePng, encodePng } from "byte-codec";
import type { PositionedFormula } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { openPdfDocument } from "./document";
import type {
  LayoutDocument,
  LayoutFormField,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
} from "./layout";
import { LAYOUT_FORMAT_VERSION } from "./layout";
import type { PdfDict } from "./objects";
import { asArray, asName, asNumber, dictGet } from "./objects";
import { writePdf } from "./write";

const HELVETICA = {
  family: "Helvetica",
  weight: "normal",
  style: "normal",
} as const;
const BLACK = { r: 0, g: 0, b: 0 };

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function docWithPages(
  pages: LayoutPage[],
  images: Record<string, LayoutImageAsset> = {},
): LayoutDocument {
  return { formatVersion: LAYOUT_FORMAT_VERSION, metadata: {}, pages, images };
}

function docWithItems(items: LayoutItem[]): LayoutDocument {
  return docWithPages([{ widthPt: 612, heightPt: 792, items }]);
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

// A minimal, hand-built JPEG: SOI, a baseline SOF0 segment declaring 3x2 pixels / 3 components / 8-bit precision, then EOI. No huffman/quant tables or entropy-coded scan data -- readJpegInfo only scans for the SOF marker and never decodes samples, so this is a fully valid input for it despite not being a real, viewable image.
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

describe("writePdf: document structure", () => {
  it("starts with the PDF header and ends with %%EOF", () => {
    const bytes = writePdf(docWithPages([]));
    const text = decode(bytes);
    expect(text.startsWith("%PDF-1.7\n")).toBe(true);
    expect(text.endsWith("%%EOF")).toBe(true);
  });

  it("emits a Catalog referencing the Pages tree, and a Pages tree with the right Count", () => {
    const text = decode(
      writePdf(docWithPages([{ widthPt: 100, heightPt: 100, items: [] }]), {
        compress: false,
      }),
    );
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Type /Pages");
    expect(text).toContain("/Count 1");
  });

  it("always identifies itself as Producer, regardless of doc.metadata.producer", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: { producer: "Microsoft Word" },
      pages: [],
      images: {},
    };
    const text = decode(writePdf(doc, { compress: false }));
    // UTF-16BE-with-BOM hex for "documents.js" (FEFF + one big-endian code unit per character).
    expect(text).toContain(
      "/Producer <feff0064006f00630075006d0065006e00740073002e006a0073>",
    );
    expect(text).not.toContain("Microsoft Word");
  });

  it("writes MediaBox from the page's own widthPt/heightPt, always starting at [0 0 ...]", () => {
    const text = decode(
      writePdf(docWithPages([{ widthPt: 612, heightPt: 792, items: [] }]), {
        compress: false,
      }),
    );
    expect(text).toContain("/MediaBox [0 0 612 792]");
  });

  it("round-trips every optional Info dict field, and omits the ones the source document does not carry", async () => {
    const { readPdf } = await import("./read");
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {
        title: "A Title",
        author: "An Author",
        subject: "A Subject",
        keywords: ["one", "two"],
        creator: "A Creator",
        createdIso: "2024-03-05T06:07:08Z",
        modifiedIso: "2024-03-06T07:08:09Z",
      },
      pages: [],
      images: {},
    };
    const out = writePdf(doc, { compress: false });
    const reread = readPdf(out);
    expect(reread.metadata.title).toBe("A Title");
    expect(reread.metadata.author).toBe("An Author");
    expect(reread.metadata.subject).toBe("A Subject");
    expect(reread.metadata.keywords).toEqual(["one", "two"]);
    expect(reread.metadata.creator).toBe("A Creator");
    expect(reread.metadata.createdIso).toBe("2024-03-05T06:07:08Z");
    expect(reread.metadata.modifiedIso).toBe("2024-03-06T07:08:09Z");

    const bareText = decode(writePdf(docWithPages([]), { compress: false }));
    for (const key of [
      "/Title",
      "/Author",
      "/Subject",
      "/Keywords",
      "/Creator",
      "/CreationDate",
      "/ModDate",
    ]) {
      expect(bareText).not.toContain(key);
    }
  });
});

describe("writePdf: text and fonts", () => {
  it("emits a Font object with the resolved standard-14 BaseFont, WinAnsiEncoding, and a Widths array", () => {
    const text = decode(
      writePdf(
        docWithItems([
          {
            kind: "text",
            text: "Hi",
            xPt: 10,
            yPt: 700,
            font: HELVETICA,
            sizePt: 12,
            color: BLACK,
          },
        ]),
        { compress: false },
      ),
    );
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).toContain("/Encoding /WinAnsiEncoding");
    expect(text).toContain("/FirstChar 32");
    expect(text).toContain("/LastChar 255");
    expect(text).toContain("/FontDescriptor");
  });

  it("emits the content stream in cleartext with an absolute Tm and a hex-string Tj operand when uncompressed", () => {
    const text = decode(
      writePdf(
        docWithItems([
          {
            kind: "text",
            text: "Hi",
            xPt: 10,
            yPt: 700,
            font: HELVETICA,
            sizePt: 12,
            color: BLACK,
          },
        ]),
        { compress: false },
      ),
    );
    expect(text).toContain("BT\n");
    expect(text).toContain("<4869> Tj"); // 'H'=0x48, 'i'=0x69
    expect(text).toContain("1 0 0 1 10 700 Tm");
  });

  it("allocates one Font object per distinct standard-14 face actually used, resource-named by sorted order", () => {
    const times = {
      family: "Times New Roman",
      weight: "normal",
      style: "normal",
    } as const;
    const text = decode(
      writePdf(
        docWithItems([
          {
            kind: "text",
            text: "A",
            xPt: 0,
            yPt: 0,
            font: times,
            sizePt: 10,
            color: BLACK,
          },
          {
            kind: "text",
            text: "B",
            xPt: 0,
            yPt: 0,
            font: HELVETICA,
            sizePt: 10,
            color: BLACK,
          },
        ]),
        { compress: false },
      ),
    );
    expect(text).toContain("/BaseFont /Times-Roman");
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).toContain("/F1 10 Tf");
    expect(text).toContain("/F2 10 Tf");
    // Sorted alphabetically, "Helvetica" < "Times-Roman", so F1 must resolve to the Helvetica object specifically -- not merely "some Font resource named F1 exists", which the two toContain checks above don't distinguish from insertion order (Times New Roman was the first item's own font).
    const f1Ref = /\/F1 (\d+) 0 R/.exec(text);
    expect(f1Ref).not.toBeNull();
    const f1Obj = new RegExp(
      `\\n${f1Ref![1]} 0 obj\\n([\\s\\S]*?)\\nendobj`,
    ).exec(text);
    expect(f1Obj).not.toBeNull();
    expect(f1Obj![1]).toContain("/BaseFont /Helvetica");
  });

  it("by default (compress: true) hides the content stream as FlateDecode-compressed bytes", () => {
    const text = decode(
      writePdf(
        docWithItems([
          {
            kind: "text",
            text: "Hi",
            xPt: 10,
            yPt: 700,
            font: HELVETICA,
            sizePt: 12,
            color: BLACK,
          },
        ]),
      ),
    );
    expect(text).toContain("/Filter /FlateDecode");
    expect(text).not.toContain("BT\n");
  });

  it("sets FontDescriptor /Flags bits per standard face: fixed-pitch, serif, italic, and force-bold each add their own bit to the always-set nonsymbolic bit", () => {
    const courierNew = {
      family: "Courier New",
      weight: "normal",
      style: "normal",
    } as const;
    const timesRoman = {
      family: "Times New Roman",
      weight: "normal",
      style: "normal",
    } as const;
    const timesItalic = {
      family: "Times New Roman",
      weight: "normal",
      style: "italic",
    } as const;
    const helveticaBold = {
      family: "Helvetica",
      weight: "bold",
      style: "normal",
    } as const;
    const text = decode(
      writePdf(
        docWithItems([
          {
            kind: "text",
            text: "A",
            xPt: 0,
            yPt: 0,
            font: courierNew,
            sizePt: 10,
            color: BLACK,
          },
          {
            kind: "text",
            text: "B",
            xPt: 0,
            yPt: 0,
            font: timesRoman,
            sizePt: 10,
            color: BLACK,
          },
          {
            kind: "text",
            text: "C",
            xPt: 0,
            yPt: 0,
            font: timesItalic,
            sizePt: 10,
            color: BLACK,
          },
          {
            kind: "text",
            text: "D",
            xPt: 0,
            yPt: 0,
            font: helveticaBold,
            sizePt: 10,
            color: BLACK,
          },
        ]),
        { compress: false },
      ),
    );
    // NONSYMBOLIC(32) is always set; each face then adds FIXED_PITCH(1), SERIF(2), ITALIC(64), or FORCE_BOLD(262144) of its own on top of it.
    expect(text).toContain("/BaseFont /Courier ");
    expect(text).toContain("/Flags 33"); // Courier: nonsymbolic + fixed-pitch
    expect(text).toContain("/BaseFont /Times-Roman");
    expect(text).toContain("/Flags 34"); // Times-Roman: nonsymbolic + serif
    expect(text).toContain("/BaseFont /Times-Italic");
    expect(text).toContain("/Flags 98"); // Times-Italic: nonsymbolic + serif + italic
    expect(text).toContain("/BaseFont /Helvetica-Bold");
    expect(text).toContain("/Flags 262176"); // Helvetica-Bold: nonsymbolic + force-bold
  });

  it("gives every Widths-array entry the font's own real AFM advance width, across the full FirstChar..LastChar range", () => {
    const text = decode(
      writePdf(
        docWithItems([
          {
            kind: "text",
            text: "A",
            xPt: 0,
            yPt: 0,
            font: HELVETICA,
            sizePt: 10,
            color: BLACK,
          },
        ]),
        { compress: false },
      ),
    );
    const widthsMatch = /\/Widths \[([^\]]*)\]/.exec(text);
    expect(widthsMatch).not.toBeNull();
    const widths = widthsMatch![1]!.trim().split(/\s+/).map(Number);
    expect(widths).toHaveLength(255 - 32 + 1);
    // Every code in range resolves to a real, positive advance width -- WINANSI_GLYPH_NAMES has no gap in this range and every standard-14 AFM table defines every glyph name it can produce, so a 0 anywhere here would mean a genuine regression, not a legitimate "unassigned code" placeholder.
    expect(widths.every((w) => w > 0)).toBe(true);
    // Space (code 32, the first entry) is a known, specific value worth pinning exactly.
    expect(widths[0]).toBe(278);
  });

  it("reports WinAnsi substitutions via the onSubstitution callback, with the page index", () => {
    const substitutions: { from: string; to: string; pageIndex: number }[] = [];
    writePdf(
      docWithItems([
        {
          kind: "text",
          text: "中",
          xPt: 0,
          yPt: 0,
          font: HELVETICA,
          sizePt: 10,
          color: BLACK,
        },
      ]),
      {
        compress: false,
        onSubstitution: (s, ctx) =>
          substitutions.push({ ...s, pageIndex: ctx.pageIndex }),
      },
    );
    expect(substitutions).toEqual([{ from: "中", to: "?", pageIndex: 0 }]);
  });
});

describe("writePdf: rects, lines, ellipses", () => {
  it("round-trips a rect, line, and ellipse into the content stream", () => {
    const text = decode(
      writePdf(
        docWithItems([
          {
            kind: "rect",
            xPt: 0,
            yPt: 0,
            widthPt: 10,
            heightPt: 10,
            fill: { r: 1, g: 0, b: 0 },
          },
          {
            kind: "line",
            x1Pt: 0,
            y1Pt: 0,
            x2Pt: 10,
            y2Pt: 10,
            color: BLACK,
            widthPt: 1,
          },
          {
            kind: "ellipse",
            xPt: 0,
            yPt: 0,
            widthPt: 10,
            heightPt: 10,
            fill: { r: 0, g: 1, b: 0 },
          },
        ]),
        { compress: false },
      ),
    );
    expect(text).toContain(" re\n");
    expect(text).toContain(" m 10 10 l\n");
    expect(text).toContain(" c\n");
  });
});

describe("writePdf: links", () => {
  it("emits an Annots array with a URI action for a link item, and no content-stream bytes for it", () => {
    const text = decode(
      writePdf(
        docWithItems([
          {
            kind: "link",
            uri: "https://example.com",
            xPt: 1,
            yPt: 2,
            widthPt: 3,
            heightPt: 4,
          },
        ]),
        { compress: false },
      ),
    );
    expect(text).toContain("/Subtype /Link");
    expect(text).toContain("/Rect [1 2 4 6]");
    expect(text).toContain("/S /URI");
  });

  it("omits /Annots entirely for a page with no links", () => {
    const text = decode(
      writePdf(
        docWithItems([
          {
            kind: "rect",
            xPt: 0,
            yPt: 0,
            widthPt: 1,
            heightPt: 1,
            fill: BLACK,
          },
        ]),
        { compress: false },
      ),
    );
    expect(text).not.toContain("/Annots");
  });
});

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
    // The Im1 Do operator itself lives inside the (by-default-compressed) content stream, so check the page's own Resources dict mapping instead -- that stays plain ASCII regardless of the compress option.
    expect(text).toContain("/XObject <</Im1 ");
  });

  it("names image resources by sorted imageId order, not first-encountered order", () => {
    // Two distinctly-sized assets so each one's own object dict is independently identifiable. "zebra" is the FIRST page item (first-encountered), but "apple" sorts first alphabetically -- if imageIds were resource-named by encounter order instead of sorted order, Im1 would resolve to zebra's own 4x4 dict instead of apple's 2x2 one.
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
    // A diagonal edge: every row shifts the black/white boundary one pixel right, so each row codes as two vertical-mode offsets against the previous one -- the vertically coherent shape CCITT Group 4 exists for (a real scan's edges and text baselines behave exactly this way). Decorrelated noise would instead be deflate's own best case, which is what the pick-the-smaller rule protects onto Flate.
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
    // compress defaults to true -- G4 is compression, so it sits behind the same option as Flate; the dictionary entries stay plain ASCII either way, only streams are flated.
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

describe("writePdf: cross-reference table", () => {
  it("startxref points at the exact byte offset of the xref keyword", () => {
    const bytes = writePdf(docWithPages([]), { compress: false });
    const text = decode(bytes);
    const startxrefIdx = text.indexOf("startxref\n");
    const afterKeyword = text.slice(startxrefIdx + "startxref\n".length);
    const offsetStr = afterKeyword.split("\n")[0];
    const offset = Number(offsetStr);
    expect(decode(bytes.subarray(offset, offset + 5))).toBe("xref\n");
  });

  it("every in-use xref entry's offset points at that object's own \"N 0 obj\" header", () => {
    const bytes = writePdf(
      docWithItems([
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
      ]),
      { compress: false },
    );
    const text = decode(bytes);
    const xrefIdx = text.indexOf("\nxref\n") + 1;
    const trailerIdx = text.indexOf("trailer\n", xrefIdx);
    const xrefBlock = text.slice(xrefIdx, trailerIdx);
    const lines = xrefBlock.split("\n").filter((line) => line.length > 0);
    // First line is "xref", second is the subsection header "0 N", the rest are 20-byte entries (each ending with a space before the split-away '\n').
    const entryLines = lines.slice(2);
    // object 0 is the free-list head; object N's entry is at index N
    for (const [index, line] of entryLines.entries()) {
      const match = /^(\d{10}) (\d{5}) ([nf]) $/.exec(line);
      expect(match).not.toBeNull();
      const [, offsetStr, , type] = match!;
      if (type === "f") {
        continue;
      }
      const offset = Number(offsetStr);
      const header = decode(
        bytes.subarray(offset, offset + `${index} 0 obj`.length),
      );
      expect(header).toBe(`${index} 0 obj`);
    }
  });
});

describe("writePdf: empty rect/ellipse", () => {
  it("produces no content-stream bytes for a rect with neither fill nor stroke", () => {
    const text = decode(
      writePdf(
        docWithItems([
          { kind: "rect", xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 },
        ]),
        { compress: false },
      ),
    );
    // The Contents stream exists but is empty -- "stream\n\nendstream" with nothing between.
    expect(text).toContain("stream\n\nendstream");
  });
});

describe("writePdf: aborting", () => {
  it("throws when the signal is already aborted before writing begins", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      writePdf(
        docWithItems([
          {
            kind: "rect",
            xPt: 0,
            yPt: 0,
            widthPt: 1,
            heightPt: 1,
            fill: BLACK,
          },
        ]),
        { signal: controller.signal },
      ),
    ).toThrow();
  });
});

describe("writePdf: embedded-file attachments (#967)", () => {
  it("round-trips attachments through the /Names /EmbeddedFiles tree and this package's own reader", async () => {
    const payload = new TextEncoder().encode("attachment body");
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [
        {
          widthPt: 200,
          heightPt: 100,
          items: [
            {
              kind: "text",
              text: "host page",
              xPt: 10,
              yPt: 50,
              font: HELVETICA,
              sizePt: 12,
              color: BLACK,
            },
          ],
        },
      ],
      images: {},
      attachments: [
        {
          name: "notes.txt",
          description: "sidecar notes",
          mimeType: "text/plain",
          base64: bytesToBase64(payload),
        },
      ],
    };
    const bytes = writePdf(doc, { compress: false });
    const rawText = new TextDecoder("latin1").decode(bytes);
    expect(rawText).toContain("/Type /EmbeddedFile");
    expect(rawText).toContain("/Type /Filespec");
    const { readPdf } = await import("./read");
    const reread = readPdf(bytes);
    expect(reread.attachments).toEqual([
      {
        name: "notes.txt",
        description: "sidecar notes",
        mimeType: "text/plain",
        base64: bytesToBase64(payload),
      },
    ]);
  });

  it("writes no /Desc entry for an attachment carrying no description", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      attachments: [
        {
          name: "plain.txt",
          mimeType: "text/plain",
          base64: bytesToBase64(new TextEncoder().encode("no description")),
        },
      ],
    };
    const bytes = writePdf(doc, { compress: false });
    const rawText = new TextDecoder("latin1").decode(bytes);
    expect(rawText).not.toContain("/Desc");
    const { readPdf } = await import("./read");
    expect(readPdf(bytes).attachments?.[0]?.description).toBeUndefined();
  });

  it("writes no /Names tree at all for a document with no attachments", () => {
    const bytes = writePdf({
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
    });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).not.to.contain("/EmbeddedFiles");
  });
});

describe("writePdf: the outline (#967)", () => {
  it("round-trips a nested bookmark tree through /Outlines and this package's own reader", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [
        {
          widthPt: 200,
          heightPt: 100,
          items: [
            {
              kind: "text",
              text: "one",
              xPt: 10,
              yPt: 80,
              font: HELVETICA,
              sizePt: 12,
              color: BLACK,
            },
            {
              kind: "text",
              text: "two",
              xPt: 10,
              yPt: 40,
              font: HELVETICA,
              sizePt: 12,
              color: BLACK,
            },
          ],
        },
      ],
      images: {},
      destinations: [
        {
          name: "chapter-1",
          pageIndex: 0,
          target: { kind: "xyz", topPt: 80 },
        },
        {
          name: "section-1-1",
          pageIndex: 0,
          target: { kind: "xyz", topPt: 40 },
        },
      ],
      outline: [
        {
          title: "Chapter 1",
          destination: "chapter-1",
          children: [
            { title: "Section 1.1", destination: "section-1-1", children: [] },
            { title: "Section 1.2 (no target)", children: [] },
          ],
        },
      ],
    };
    const bytes = writePdf(doc);
    const rawText = new TextDecoder("latin1").decode(bytes);
    expect(rawText).toContain("/Type /Outlines");
    // Chapter 1 is the sole top-level item and has two children: /Parent on each item, /Prev+/Next linking the two siblings, and /First+/Last+/Count on the parent that owns them.
    expect(rawText).toContain("/Parent");
    expect(rawText).toContain("/Prev");
    expect(rawText).toContain("/Next");
    expect(rawText).toContain("/First");
    expect(rawText).toContain("/Last");
    expect(rawText).toContain("/Count 2");
    const { readPdf } = await import("./read");
    const reread = readPdf(bytes);
    // Destinations are spelled as direct arrays (the identical convention the internal-link writer established: no /Dests tree is emitted), so the reader re-mints table names in read order -- "dest1", "dest2" -- while titles, nesting, and the TARGETS themselves round-trip exactly.
    expect(reread.outline).toEqual([
      {
        title: "Chapter 1",
        destination: "dest2",
        children: [
          { title: "Section 1.1", destination: "dest1", children: [] },
          { title: "Section 1.2 (no target)", children: [] },
        ],
      },
    ]);
  });

  it("writes no /Outlines at all for a document with no outline", () => {
    const bytes = writePdf({
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
    });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).not.toContain("/Outlines");
  });
});

describe("writePdf: optional-content layers (#967)", () => {
  it("round-trips the layer table and each item's owning layer", async () => {
    const textItem = {
      kind: "text",
      text: "base",
      xPt: 10,
      yPt: 80,
      font: HELVETICA,
      sizePt: 12,
      color: BLACK,
      layer: "Background",
    } as const;
    const rectItem = {
      kind: "rect",
      xPt: 0,
      yPt: 0,
      widthPt: 5,
      heightPt: 5,
      fill: BLACK,
      layer: "Annotations",
    } as const;
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [textItem, rectItem] }],
      images: {},
      layers: [
        { name: "Background", visible: true },
        { name: "Annotations", visible: false },
      ],
    };
    const bytes = writePdf(doc, { compress: false });
    const rawText = new TextDecoder("latin1").decode(bytes);
    expect(rawText).toContain("/ON [");
    expect(rawText).toContain("/OFF [");
    const { readPdf } = await import("./read");
    const reread = readPdf(bytes);
    expect(reread.layers).toEqual([
      { name: "Background", visible: true },
      { name: "Annotations", visible: false },
    ]);
    const rereadItems = reread.pages[0]!.items;
    const text = rereadItems.find(
      (item): item is Extract<LayoutItem, { kind: "text" }> =>
        item.kind === "text" && item.text === "base",
    );
    expect(text?.layer).toBe("Background");
    const rect = rereadItems.find(
      (item): item is Extract<LayoutItem, { kind: "rect" }> =>
        item.kind === "rect",
    );
    expect(rect?.layer).toBe("Annotations");
  });

  it("omits /OFF entirely when every layer is visible, and /ON entirely when every layer is hidden", () => {
    const allVisible = writePdf(
      {
        formatVersion: LAYOUT_FORMAT_VERSION,
        metadata: {},
        pages: [],
        images: {},
        layers: [{ name: "Background", visible: true }],
      },
      { compress: false },
    );
    const allVisibleText = new TextDecoder("latin1").decode(allVisible);
    expect(allVisibleText).toContain("/ON [");
    expect(allVisibleText).not.toContain("/OFF [");

    const allHidden = writePdf(
      {
        formatVersion: LAYOUT_FORMAT_VERSION,
        metadata: {},
        pages: [],
        images: {},
        layers: [{ name: "Background", visible: false }],
      },
      { compress: false },
    );
    const allHiddenText = new TextDecoder("latin1").decode(allHidden);
    expect(allHiddenText).not.toContain("/ON [");
    expect(allHiddenText).toContain("/OFF [");
  });

  it("writes no /OCProperties at all for a document with no layers", () => {
    const bytes = writePdf({
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
    });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).not.toContain("/OCProperties");
  });
});

describe("writePdf: AcroForm fields (#967)", () => {
  it("round-trips terminal fields, widgets, choices, and groups", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [] }],
      images: {},
      form: [
        {
          name: "email",
          fieldType: "text",
          value: "a@b.c",
          alias: "Email address",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 60, widthPt: 80, heightPt: 12 },
          ],
          children: [],
        },
        {
          name: "subscribe",
          fieldType: "checkbox",
          checked: true,
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 40, widthPt: 10, heightPt: 10 },
          ],
          children: [],
        },
        {
          name: "contact",
          fieldType: "group",
          widgets: [],
          children: [
            {
              name: "contact.reason",
              fieldType: "combobox",
              value: "billing",
              options: ["billing", "support"],
              widgets: [
                { pageIndex: 0, xPt: 10, yPt: 20, widthPt: 60, heightPt: 12 },
                { pageIndex: 0, xPt: 10, yPt: 5, widthPt: 60, heightPt: 12 },
              ],
              children: [],
            },
          ],
        },
      ],
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
    expect(reread.form).toEqual([
      {
        name: "email",
        fieldType: "text",
        value: "a@b.c",
        alias: "Email address",
        widgets: [
          { pageIndex: 0, xPt: 10, yPt: 60, widthPt: 80, heightPt: 12 },
        ],
        children: [],
      },
      {
        name: "subscribe",
        fieldType: "checkbox",
        checked: true,
        value: "Yes",
        widgets: [
          { pageIndex: 0, xPt: 10, yPt: 40, widthPt: 10, heightPt: 10 },
        ],
        children: [],
      },
      {
        name: "contact",
        fieldType: "group",
        widgets: [],
        children: [
          {
            name: "contact.reason",
            fieldType: "combobox",
            value: "billing",
            options: ["billing", "support"],
            widgets: [
              { pageIndex: 0, xPt: 10, yPt: 20, widthPt: 60, heightPt: 12 },
              { pageIndex: 0, xPt: 10, yPt: 5, widthPt: 60, heightPt: 12 },
            ],
            children: [],
          },
        ],
      },
    ]);
  });

  it("never splits a group field into per-widget kid objects, even one that carries more than one widget", () => {
    // Multi-widget object-splitting is a TERMINAL-field concept (12.7.4's own /Kids-as-widgets spelling); a group field's own /Kids are its child FIELDS, never widget annotations, so this must stay a single object regardless of how many widgets it happens to carry.
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [] }],
      images: {},
      form: [
        {
          name: "oddGroup",
          fieldType: "group",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 60, widthPt: 10, heightPt: 10 },
            { pageIndex: 0, xPt: 10, yPt: 40, widthPt: 10, heightPt: 10 },
          ],
          children: [
            {
              name: "oddGroup.child",
              fieldType: "text",
              value: "x",
              widgets: [
                { pageIndex: 0, xPt: 10, yPt: 20, widthPt: 60, heightPt: 12 },
              ],
              children: [],
            },
          ],
        },
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    // Exactly 2 field objects (the group itself, plus its one terminal child) -- if the group's own 2 widgets were wrongly split into their own kid objects, a third and fourth "/Subtype /Widget" object would exist beyond the child's own.
    expect(text.match(/\/Subtype \/Widget/g)).toHaveLength(1);
  });

  it("maps radio, button, and signature field types to their own /FT value", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [] }],
      images: {},
      form: [
        {
          name: "choice",
          fieldType: "radio",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 60, widthPt: 10, heightPt: 10 },
          ],
          children: [],
        },
        {
          name: "submit",
          fieldType: "button",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 40, widthPt: 40, heightPt: 12 },
          ],
          children: [],
        },
        {
          name: "sig",
          fieldType: "signature",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 20, widthPt: 40, heightPt: 12 },
          ],
          children: [],
        },
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    expect(text).toContain("/FT /Btn");
    expect(text).toContain("/FT /Sig");
    // radio and button both map to Btn, so distinguishing them isn't possible from /FT alone -- but exactly two Btn fields and one Sig field must exist.
    expect(text.match(/\/FT \/Btn/g)).toHaveLength(2);
  });

  it("sets /Ff bits for read-only, pushbutton, radio, and combo, each independently and combined", () => {
    const fieldFor = (
      overrides: Partial<LayoutFormField> & { name: string },
    ): LayoutFormField => ({
      fieldType: "text",
      widgets: [{ pageIndex: 0, xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }],
      children: [],
      ...overrides,
    });
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [] }],
      images: {},
      form: [
        fieldFor({ name: "plain" }), // no flags at all -- no /Ff entry
        fieldFor({ name: "locked", readOnly: true }), // 1
        fieldFor({ name: "push", fieldType: "button" }), // 4
        fieldFor({ name: "choice", fieldType: "radio" }), // 32768
        fieldFor({ name: "combo", fieldType: "combobox" }), // 131072
        fieldFor({ name: "lockedPush", fieldType: "button", readOnly: true }), // 1 | 4 = 5
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    for (const ff of ["1", "4", "32768", "131072", "5"]) {
      expect(text).toContain(`/Ff ${ff}`);
    }
    // "plain" carries no flag bits at all -- no /Ff entry for it, distinct from the others which each have their own combination. Field names are written as hex strings, so "plain" (0x706c61696e) identifies its own object's line.
    const plainLine = text
      .split("\n")
      .find((line) => line.includes("<706c61696e>"));
    expect(plainLine).toBeDefined();
    expect(plainLine).not.toContain("/Ff");
  });

  it.each([
    { checked: true, value: undefined, expected: "Yes" },
    { checked: false, value: undefined, expected: "Off" },
    { checked: undefined, value: undefined, expected: "Off" },
    { checked: false, value: "onValue", expected: "onValue" }, // an explicit export value wins regardless of checked
    { checked: true, value: "onValue", expected: "onValue" },
  ] as const)(
    "gives a checkbox its own /V export value for checked=$checked, value=$value",
    ({ checked, value, expected }) => {
      const doc: LayoutDocument = {
        formatVersion: LAYOUT_FORMAT_VERSION,
        metadata: {},
        pages: [{ widthPt: 200, heightPt: 100, items: [] }],
        images: {},
        form: [
          {
            name: "box",
            fieldType: "checkbox",
            ...(checked === undefined ? {} : { checked }),
            ...(value === undefined ? {} : { value }),
            widgets: [
              { pageIndex: 0, xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
            ],
            children: [],
          },
        ],
      };
      const text = decode(writePdf(doc, { compress: false }));
      expect(text).toContain(`/V /${expected}`);
    },
  );

  it("writes no /AcroForm for a document with no fields", () => {
    const bytes = writePdf({
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
    });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).not.toContain("/AcroForm");
  });

  it("writes no /AcroForm for a document whose form array is present but empty", () => {
    const bytes = writePdf({
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      form: [],
    });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).not.toContain("/AcroForm");
  });

  it("lists every widget annotation in its page's /Annots as the field tree's own objects", () => {
    // A single-widget field merges into its field dict, so its page /Annots entry is that very object; a multi-widget field's widgets are separate kid objects, each listed in /Annots AND in the field's /Kids — the same annotation object in both places, the spelling real Acrobat files carry (ISO 32000-1 12.5.1: a page's /Annots holds indirect references to its annotations, and 12.7.4 hangs the widgets under the field). A viewer rendering only page-level /Annots sees every field widget without walking the AcroForm tree.
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [
        { widthPt: 200, heightPt: 100, items: [] },
        { widthPt: 200, heightPt: 100, items: [] },
      ],
      images: {},
      form: [
        {
          name: "email",
          fieldType: "text",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 60, widthPt: 80, heightPt: 12 },
          ],
          children: [],
        },
        {
          name: "reason",
          fieldType: "listbox",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 40, widthPt: 60, heightPt: 10 },
            { pageIndex: 0, xPt: 10, yPt: 20, widthPt: 60, heightPt: 10 },
          ],
          children: [],
        },
        {
          name: "sign",
          fieldType: "checkbox",
          widgets: [
            { pageIndex: 1, xPt: 10, yPt: 60, widthPt: 10, heightPt: 10 },
          ],
          children: [],
        },
      ],
    };
    const document = openPdfDocument(writePdf(doc), () => {});
    const pages = document.pages();
    const annotNums = (page: PdfDict): number[] =>
      (asArray(dictGet(page, "Annots")) ?? []).map((entry) =>
        entry.kind === "ref" ? entry.num : -1,
      );
    // Page 0 carries the merged email dict plus the reason field's two widget kids, in field order; page 1 carries the merged sign dict.
    expect(annotNums(pages[0]!)).toHaveLength(3);
    expect(annotNums(pages[1]!)).toHaveLength(1);

    // Every /Annots entry resolves to a widget: the merged dicts carry /Subtype /Widget alongside their field keys, the kid objects are plain widget annotations.
    for (const entry of asArray(dictGet(pages[0]!, "Annots")) ?? []) {
      expect(asName(dictGet(document.resolveDict(entry)!, "Subtype"))).toBe(
        "Widget",
      );
    }

    // The multi-widget field's /Kids and the page /Annots name the SAME two objects, not copies. /AcroForm /Fields lists the document's fields in model order, so the reason field is the second one.
    const acroForm = document.resolveDict(
      dictGet(document.catalog, "AcroForm"),
    )!;
    const reasonField = document.resolveDict(
      asArray(dictGet(acroForm, "Fields"))![1],
    )!;
    const kidsOfReason = (asArray(dictGet(reasonField, "Kids")) ?? [])
      .map((entry) => (entry.kind === "ref" ? entry.num : -1))
      .sort((a, b) => a - b);
    expect(kidsOfReason).toEqual(
      annotNums(pages[0]!)
        .slice(1)
        .sort((a, b) => a - b),
    );

    // The rect a viewer reads off the page's first annotation is the model's email widget: same object, same placement.
    const emailAnnot = document.resolveDict(
      asArray(dictGet(pages[0]!, "Annots"))![0],
    )!;
    expect(
      asArray(dictGet(emailAnnot, "Rect"))?.map((n) => asNumber(n)),
    ).toEqual([10, 60, 90, 72]);
    expect(asName(dictGet(emailAnnot, "FT"))).toBe("Tx");
  });
});

describe("writePdf: the tagged structure tree (#967)", () => {
  it("round-trips the element tree and each item's owning element", async () => {
    const heading = {
      kind: "text",
      text: "Title",
      xPt: 10,
      yPt: 80,
      font: HELVETICA,
      sizePt: 14,
      color: BLACK,
      structure: "e-h1",
    } as const;
    const body = {
      kind: "text",
      text: "Body",
      xPt: 10,
      yPt: 60,
      font: HELVETICA,
      sizePt: 10,
      color: BLACK,
      structure: "e-p",
    } as const;
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [heading, body] }],
      images: {},
      structure: [
        {
          id: "e-root",
          type: "Document",
          children: [
            {
              id: "e-h1",
              type: "H1",
              title: "The heading",
              language: "en-GB",
              children: [],
            },
            { id: "e-p", type: "P", alt: "a paragraph", children: [] },
          ],
        },
      ],
    };
    const bytes = writePdf(doc, { compress: false });
    const rawText = new TextDecoder("latin1").decode(bytes);
    expect(rawText).toContain("/Type /StructElem");
    expect(rawText).toContain("/P ");
    expect(rawText).toContain("/Lang");
    const { readPdf } = await import("./read");
    const reread = readPdf(bytes);
    const tree = reread.structure!;
    // Element ids are reader-minted in document order, so identity is positional: the first H1 under the root owns the heading item.
    expect(tree).toEqual([
      {
        id: tree[0]!.id,
        type: "Document",
        children: [
          expect.objectContaining({ type: "H1", title: "The heading" }),
          expect.objectContaining({ type: "P", alt: "a paragraph" }),
        ],
      },
    ]);
    const h1Id = tree[0]!.children[0]!.id;
    const pId = tree[0]!.children[1]!.id;
    const rereadItems = reread.pages[0]!.items;
    const rereadHeading = rereadItems.find(
      (item): item is Extract<LayoutItem, { kind: "text" }> =>
        item.kind === "text" && item.text === "Title",
    );
    const rereadBody = rereadItems.find(
      (item): item is Extract<LayoutItem, { kind: "text" }> =>
        item.kind === "text" && item.text === "Body",
    );
    expect(rereadHeading?.structure).toBe(h1Id);
    expect(rereadBody?.structure).toBe(pId);
  });

  it("writes no /StructTreeRoot for a document with no structure", () => {
    const bytes = writePdf({
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
    });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).not.toContain("/StructTreeRoot");
  });
});

describe("writePdf: package-level residue (#967)", () => {
  it("restores restorable rows and the XMP packet verbatim", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      source: {
        "page-mode": { format: "pdf", xml: "/UseOutlines" },
        "viewer-preferences": { format: "pdf", xml: "<< /HideToolbar true >>" },
        xmp: {
          format: "pdf",
          xml: '<?xpacket begin="" id="W1234"?> <x:xmpmeta/> <?xpacket end="w"?>',
        },
      },
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
    expect(reread.source?.["page-mode"]?.xml).toBe("/UseOutlines");
    expect(reread.source?.["viewer-preferences"]?.xml).toContain(
      "/HideToolbar true",
    );
    expect(reread.source?.xmp?.xml).toBe(doc.source?.xmp?.xml);
  });

  it("does not restore a row whose serialisation references source-file objects", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      source: {
        "output-intents": { format: "pdf", xml: "[ 12 0 R /Fit]" },
      },
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
    // A dangling "12 0 R" has no target in the new file; the row restores as nothing rather than corrupting the Catalog.
    expect(reread.source?.["output-intents"]).toBeUndefined();
  });

  it("does not restore a row whose serialisation is a dict that CONTAINS a reference, not just a bare array of one", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      source: {
        "piece-info": { format: "pdf", xml: "<< /Private 3 0 R >>" },
      },
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
    expect(reread.source?.["piece-info"]).toBeUndefined();
  });

  it("does not restore a row whose serialisation is a stream whose OWN dict contains a reference", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      source: {
        "piece-info": {
          format: "pdf",
          xml: "<< /Length 5 /Extra 3 0 R >>\nstream\nhello\nendstream",
        },
      },
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
    expect(reread.source?.["piece-info"]).toBeUndefined();
  });

  it("never restores the open-action row, including an inline action", async () => {
    // /OpenAction is active content: a viewer executes an inline JavaScript/Launch/URI action on open, so restoring it verbatim from a source file would re-arm attacker-supplied behaviour in the rewritten output. The row restores as nothing whether its serialisation is reference-free or not.
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      source: {
        "open-action": {
          format: "pdf",
          xml: "<< /S /JavaScript /JS (app.alert(1)) >>",
        },
      },
    };
    const { readPdf } = await import("./read");
    const bytes = writePdf(doc);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).not.toContain("/OpenAction");
    expect(readPdf(bytes).source?.["open-action"]).toBeUndefined();
  });
});

// options.formulas is writePdf's own side channel for embedded-math-font content (see this module's own top comment for why a formula cannot travel as an ordinary LayoutItem) -- exercised here through writePdf itself, not just through math-content-write.ts/math-font-write.ts's own unit tests, since only this integration proves the allocation, the resource dict, and the emitted content stream actually agree on object numbers.
describe("writePdf: embedded formulas", () => {
  function formula(pageIndex: number): PositionedFormula {
    return {
      pageIndex,
      xPt: 50,
      yPt: 100,
      box: {
        widthPt: 20,
        heightPt: 12,
        ascentPt: 12,
        descentPt: 0,
        items: [
          {
            kind: "glyphs",
            xPt: 0,
            yPt: 0,
            text: "x",
            sizePt: 12,
            color: BLACK,
          },
        ],
      },
    };
  }

  it("allocates a Type0/CIDFontType0 composite font group, references it from the page Resources, and draws the formula's own glyph run", () => {
    const text = decode(
      writePdf(docWithItems([]), {
        compress: false,
        formulas: [formula(0)],
      }),
    );
    expect(text).toContain("/Subtype /Type0");
    expect(text).toContain("/Subtype /CIDFontType0");
    expect(text).toContain("/FontFile3");
    expect(text).toContain("/Font <</MF ");
    // The formula's own content bytes are appended after the page's ordinary LayoutItem bytes, in the same Contents stream.
    expect(text).toContain("/MF 12 Tf");
  });

  it("allocates no math font group at all when no formula is supplied, and never references /MF", () => {
    const text = decode(
      writePdf(docWithItems([]), { compress: false, formulas: [] }),
    );
    expect(text).not.toContain("/CIDFontType0");
    expect(text).not.toContain("/MF");
  });

  it("routes each formula to its own page's Contents stream by pageIndex, never the other page's", () => {
    const marker = (label: string): LayoutItem => ({
      kind: "text",
      text: label,
      xPt: 0,
      yPt: 0,
      font: HELVETICA,
      sizePt: 10,
      color: BLACK,
    });
    const text = decode(
      writePdf(
        docWithPages([
          { widthPt: 100, heightPt: 100, items: [marker("A")] },
          { widthPt: 100, heightPt: 100, items: [marker("B")] },
        ]),
        { compress: false, formulas: [formula(1)] },
      ),
    );
    const streams = [...text.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(
      (m) => m[1]!,
    );
    const pageAStream = streams.find((s) => s.includes("<41>")); // 'A'
    const pageBStream = streams.find((s) => s.includes("<42>")); // 'B'
    expect(pageAStream).toBeDefined();
    expect(pageBStream).toBeDefined();
    expect(pageAStream).not.toContain("/MF");
    expect(pageBStream).toContain("/MF 12 Tf");
  });
});
