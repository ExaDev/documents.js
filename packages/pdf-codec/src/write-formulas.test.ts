import { bytesToBase64 } from "byte-codec";
import type { PositionedFormula } from "document-schema.js";
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

// A minimal, hand-built JPEG: SOI, a baseline SOF0 segment declaring 3x2 pixels / 3 components / 8-bit precision, then EOI. No huffman/quant tables or entropy-coded scan data — readJpegInfo only scans for the SOF marker and never decodes samples, so this is a fully valid input for it despite not being a real, viewable image.

// Same shape as tinyJpegAsset, generalised over component count and an optional Adobe APP14 marker (ISO 32000-1 has no opinion on this marker; it's a de facto Adobe convention every real CMYK JPEG carries), for exercising prepareJpegImage's colour-space and /Decode-inversion branches.

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

// The exact object count each document shape produces. Every allocation in writePdf is a
// nextObjNum++ in a fixed order, so the trailer's /Size is a checksum over the whole allocation
// walk: any mutant that skips, repeats, or spuriously takes an allocation branch moves it.
describe("writePdf: object numbering", () => {
  it("numbers a minimal one-page document as exactly six objects", () => {
    const text = decode(
      writePdf(docWithPages([{ widthPt: 100, heightPt: 100, items: [] }]), {
        compress: false,
      }),
    );
    // Catalog 1, Pages 2, Info 3, then page 4 and Contents 5 — nothing else, so the xref holds 6.
    expect(text).toContain("/Size 6 ");
  });

  it("allocates no math-font objects at all when no formula is supplied", () => {
    const text = decode(writePdf(docWithItems([]), { compress: false }));
    expect(text).toContain("/Size 6 ");
  });

  it("allocates exactly five further objects for a formula's font group", () => {
    const text = decode(
      writePdf(docWithItems([]), {
        compress: false,
        formulas: [
          {
            pageIndex: 0,
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
          },
        ],
      }),
    );
    // Catalog/Pages/Info plus the Type0, CIDFont, FontDescriptor, FontFile3 and ToUnicode of the
    // math group, then page and contents: 10 objects, xref of 11.
    expect(text).toContain("/Size 11 ");
  });

  it("draws two formulas routed to one and the same page, both in that page's Contents", () => {
    const formulaAt = (xPt: number): PositionedFormula => ({
      pageIndex: 0,
      xPt,
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
    });
    const text = decode(
      writePdf(docWithItems([]), {
        compress: false,
        formulas: [formulaAt(50), formulaAt(150)],
      }),
    );
    // Two glyph runs in one stream means the font is selected twice; a formula dropped on the
    // floor by the per-page grouping shows up here as a single selection.
    expect(text.match(/\/MF 12 Tf/g)).toHaveLength(2);
    expect(text).toContain("/Size 11 ");
  });

  it("allocates the outline root plus one object per bookmark, in pre-order", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 100, heightPt: 100, items: [] }],
      images: {},
      outline: [
        {
          title: "One",
          destination: undefined,
          children: [],
        },
        { title: "Two", destination: undefined, children: [] },
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    // Catalog/Pages/Info, page 4 and contents 5, root 6, items 7 and 8: xref of 9.
    expect(text).toContain("/Size 9 ");
    expect(text).toContain("/First 7 0 R");
    expect(text).toContain("/Last 8 0 R");
  });

  it("allocates one object per structure element plus the root and parent tree", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 100, heightPt: 100, items: [] }],
      images: {},
      structure: [
        {
          id: "s1",
          type: "Document",
          children: [{ id: "s2", type: "P", children: [] }],
        },
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    // Catalog/Pages/Info, elements 4 and 5, StructTreeRoot 6, ParentTree 7, page 8, contents 9.
    expect(text).toContain("/Size 10 ");
    expect(text).toContain("/Type /StructTreeRoot");
  });

  it("allocates one object per form field and no more for single-widget fields", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 100, heightPt: 100, items: [] }],
      images: {},
      form: [
        {
          name: "q",
          fieldType: "text",
          widgets: [
            { pageIndex: 0, xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
          ],
          children: [],
        },
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    // Catalog/Pages/Info, the field's own merged dict 4 (its single widget is not a separate
    // object), page 5, contents 6: xref of 7.
    expect(text).toContain("/Size 7 ");
  });

  it("allocates the encryption dictionary's own object only when encryption is requested", () => {
    const encrypted = decode(
      writePdf(docWithPages([{ widthPt: 100, heightPt: 100, items: [] }]), {
        compress: false,
        encryption: { scheme: "rc4-40" },
      }),
    );
    expect(encrypted).toContain("/Size 7 ");
  });

  it("allocates attachment objects in document order: stream, filespec, then the name-tree node", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      attachments: [
        {
          name: "a.txt",
          mimeType: "text/plain",
          base64: bytesToBase64(new TextEncoder().encode("x")),
        },
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    // Catalog/Pages/Info, embedded file 4, filespec 5, names node 6: xref of 7.
    expect(text).toContain("/Size 7 ");
  });
});
