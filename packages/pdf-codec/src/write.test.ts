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
    // Sorted alphabetically, "Helvetica" < "Times-Roman", so F1 must resolve to the Helvetica object specifically — not merely "some Font resource named F1 exists", which the two toContain checks above don't distinguish from insertion order (Times New Roman was the first item's own font).
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
    // Every code in range resolves to a real, positive advance width — WINANSI_GLYPH_NAMES has no gap in this range and every standard-14 AFM table defines every glyph name it can produce, so a 0 anywhere here would mean a genuine regression, not a legitimate "unassigned code" placeholder.
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
        onSubstitution: (s, ctx) => {
          substitutions.push({ ...s, pageIndex: ctx.pageIndex });
        },
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
