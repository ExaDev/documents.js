import { encodePng } from "byte-codec";
import { bytesToBase64 } from "./util/base64";
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
    // Sorted alphabetically, "Helvetica" < "Times-Roman", so Helvetica gets F1 and is used by the second item's Tf.
    expect(text).toContain("/F1 10 Tf");
    expect(text).toContain("/F2 10 Tf");
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
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("/Width 3");
    expect(text).toContain("/Height 2");
    expect(text).toContain("/ColorSpace /DeviceRGB");
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
    const bytes = writePdf(doc);
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
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
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
            { id: "e-h1", type: "H1", title: "The heading", children: [] },
            { id: "e-p", type: "P", alt: "a paragraph", children: [] },
          ],
        },
      ],
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
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
        "open-action": { format: "pdf", xml: "[ 12 0 R /Fit]" },
      },
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
    // A dangling "12 0 R" has no target in the new file; the row restores as nothing rather than corrupting the Catalog.
    expect(reread.source?.["open-action"]).toBeUndefined();
  });
});
