import { bytesToBase64 } from "byte-codec";
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
    // The Contents stream exists but is empty — "stream\n\nendstream" with nothing between.
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
    // Destinations are spelled as direct arrays (the identical convention the internal-link writer established: no /Dests tree is emitted), so the reader re-mints table names in read order — "dest1", "dest2" — while titles, nesting, and the TARGETS themselves round-trip exactly.
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
