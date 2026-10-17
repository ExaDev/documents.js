import { DEFAULT_LAYOUT_FONT } from "document-schema.js";
import type { LayoutDocument, ReadPdfSurfaces } from "pdf-codec";
import { LAYOUT_FORMAT_VERSION, writePdf } from "pdf-codec";
import type * as PdfCodecRead from "pdf-codec/read";
import { readPdf } from "pdf-codec/read";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { convertDocument } from "./composition-to-pdf";
import { markdownToPdf } from "./convert";
import {
  pdfToDocx,
  pdfToMarkdown,
  readContentDocument,
  readDocumentMetadata,
  readNativeDocumentTree,
} from "./from-pdf";
import { decodeMarkdownText, encodeMarkdownText } from "../markdown/text";

// readPdf wrapped so a test can see which surfaces each read asked for. The real reader still runs.
vi.mock("pdf-codec/read", async (importOriginal) => {
  const actual = await importOriginal<typeof PdfCodecRead>();
  return { ...actual, readPdf: vi.fn(actual.readPdf) };
});

const BLACK = { r: 0, g: 0, b: 0 };
const PAGE = { widthPt: 300, heightPt: 300 };
const NO_SURFACES: Required<ReadPdfSurfaces> = {
  outline: false,
  destinations: false,
  form: false,
  layers: false,
  structure: false,
  residue: false,
};
const XMP_PACKET =
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>';

// A two-page PDF carrying every document-level surface readPdf can leave out (an outline, named destinations, a form field, a layer, a structure tree, XMP residue) plus /Info metadata, written by pdf-codec's own writer so the reader sees each of them.
function everySurfacePdf(): Uint8Array<ArrayBuffer> {
  const text = (value: string, yPt: number) => ({
    kind: "text" as const,
    text: value,
    xPt: 20,
    yPt,
    font: DEFAULT_LAYOUT_FONT,
    sizePt: 12,
    color: BLACK,
  });
  const doc: LayoutDocument = {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {
      title: "Surface fixture",
      author: "A. Author",
      subject: "Every surface",
      keywords: ["outline", "structure"],
    },
    images: {},
    pages: [
      {
        ...PAGE,
        items: [
          { ...text("Tagged heading", 250), structure: "s1" },
          { ...text("Layered note", 200), layer: "Notes" },
          {
            kind: "internalLink",
            destination: "second",
            xPt: 20,
            yPt: 100,
            widthPt: 60,
            heightPt: 14,
          },
        ],
      },
      { ...PAGE, items: [text("Second page", 250)] },
    ],
    destinations: [{ name: "second", pageIndex: 1, target: { kind: "fit" } }],
    outline: [{ title: "Second page", destination: "second", children: [] }],
    layers: [{ name: "Notes", visible: false }],
    form: [
      {
        name: "fullname",
        fieldType: "text",
        value: "Jane Doe",
        widgets: [
          { pageIndex: 0, xPt: 20, yPt: 40, widthPt: 100, heightPt: 16 },
        ],
        children: [],
      },
    ],
    structure: [{ id: "s1", type: "H1", children: [] }],
    source: { xmp: { format: "pdf", xml: XMP_PACKET } },
  };
  return writePdf(doc);
}

beforeEach(() => {
  vi.mocked(readPdf).mockClear();
});

function surfacesRead(): (ReadPdfSurfaces | undefined)[] {
  return vi.mocked(readPdf).mock.calls.map(([, options]) => options?.surfaces);
}

describe("readDocumentMetadata for a pdf", () => {
  it("reads no page and no document-level surface, and reports exactly the metadata a full read does", () => {
    const pdf = everySurfacePdf();
    const full = readPdf(pdf);
    for (const field of [
      "outline",
      "destinations",
      "form",
      "layers",
      "structure",
      "source",
    ] as const) {
      expect(full[field]).toBeDefined();
    }
    vi.mocked(readPdf).mockClear();
    const metadata = readDocumentMetadata("pdf", pdf);
    expect(
      vi.mocked(readPdf).mock.calls.map(([, options]) => ({
        pages: options?.pages,
        surfaces: options?.surfaces,
      })),
    ).toEqual([{ pages: [], surfaces: NO_SURFACES }]);
    expect(metadata).toEqual(full.metadata);
    expect(metadata.title).toBe("Surface fixture");
    expect(metadata.author).toBe("A. Author");
  });
});

describe("the pdf conversions with surfaces", () => {
  it("hand surfaces to readPdf from every pdfTo* conversion and from readNativeDocumentTree/readContentDocument", () => {
    const pdf = everySurfacePdf();
    const surfaces: ReadPdfSurfaces = { structure: false, outline: false };
    pdfToMarkdown(pdf, { surfaces });
    pdfToDocx(pdf, { surfaces });
    readNativeDocumentTree("pdf", pdf, { surfaces });
    readContentDocument("pdf", pdf, { surfaces });
    expect(surfacesRead()).toEqual([surfaces, surfaces, surfaces, surfaces]);
  });

  it("leaves a skipped surface's tables off the reported tree, and keeps the rest", () => {
    const pdf = everySurfacePdf();
    const full = readNativeDocumentTree("pdf", pdf);
    const skipped = readNativeDocumentTree("pdf", pdf, {
      surfaces: { layers: false },
    });
    expect(full.layers).toBeDefined();
    expect(skipped.layers).toBeUndefined();
    expect(skipped.source).toEqual(full.source);
  });

  it("keeps hidden-layer content when layers are skipped, since nothing then marks it hidden", () => {
    const pdf = everySurfacePdf();
    const markdown = (surfaces?: ReadPdfSurfaces): string =>
      decodeMarkdownText(pdfToMarkdown(pdf, { surfaces }));
    expect(markdown()).not.toContain("Layered note");
    expect(markdown({ layers: false })).toContain("Layered note");
  });

  it("converts identically with surfaces omitted, empty, or every surface on", () => {
    const pdf = everySurfacePdf();
    const full = pdfToMarkdown(pdf);
    expect(pdfToMarkdown(pdf, { surfaces: {} })).toEqual(full);
    expect(
      pdfToMarkdown(pdf, {
        surfaces: Object.fromEntries(
          Object.keys(NO_SURFACES).map((surface) => [surface, true]),
        ),
      }),
    ).toEqual(full);
  });

  it("applies surfaces only to the caller's own pdf: an intermediate pdf a route renders is read whole", () => {
    const markdown = encodeMarkdownText("# Title\n\nBody.\n");
    convertDocument("markdown", "ods", markdown, { surfaces: NO_SURFACES });
    const intermediateReads = surfacesRead();
    expect(intermediateReads.length).toBeGreaterThan(0);
    expect(intermediateReads.every((surfaces) => surfaces === undefined)).toBe(
      true,
    );

    vi.mocked(readPdf).mockClear();
    convertDocument("pdf", "markdown", markdownToPdf(markdown), {
      surfaces: NO_SURFACES,
    });
    expect(surfacesRead()).toEqual([NO_SURFACES]);
  });
});
