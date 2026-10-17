import {
  assembleTree,
  type ContentBlock,
  type ContentDocument,
  DEFAULT_LAYOUT_FONT,
  type DocumentTree,
} from "document-schema.js";
import {
  LAYOUT_FORMAT_VERSION,
  type LayoutDocument,
  PdfPageSelectionError,
  readPdf,
  sourcePageIndex,
} from "pdf-codec";
import { describe, expect, it } from "vitest";
import { decodePackage } from "odf.js";
import { createDocx } from "../edit/docx/editor";
import { SvgMultiPageNotSpecifiedError } from "../svg/write";
import { buildDocumentBytes } from "./from-package";
import { readOdsContent } from "../odf/ods/read";
import { createPdf, openPdf } from "../edit/pdf/editor";
import { fixedClock } from "../ports/clock";
import { convertDocument } from "./composition-to-pdf";
import {
  reconstructSpreadsheet,
  reconstructWordprocessing,
} from "../layout/reconstruct";
import {
  reconstructDrawing,
  reconstructPresentation,
} from "../layout/reconstruct-presentations-prod";
import { stampPdfPackageTables } from "./pdf-package-tables";
import { readMarkdownContent } from "../markdown/read";
import { decodeMarkdownText } from "../markdown/text";
import {
  buildMarkdownText,
  MarkdownPageNumberCountError,
  PAGE_BREAK_MARKER,
  pageNumberMarker,
} from "../markdown/write";
import { renderContentDocumentToMarkdown } from "../markdown/render";
import {
  pdfToDocx,
  pdfToMarkdown,
  pdfToSvg,
  readContentDocument,
  readNativeDocumentTree,
} from "./from-pdf";

const BLACK = { r: 0, g: 0, b: 0 };
const LETTER = { widthPt: 612, heightPt: 792 };
// A page size differing from LETTER, so the page carrying it starts a section of its own in the wordprocessing reconstruction: a page selection spanning it must still label every page, not only those separated by page breaks.
const WIDE = { widthPt: 792, heightPt: 612 };
const PAGE_SIZES = [LETTER, LETTER, WIDE, LETTER, LETTER] as const;
const LAST_PAGE_INDEX = PAGE_SIZES.length - 1;
const TEXT_SIZE_PT = 12;
const TEXT_X_PT = 72;
const TEXT_Y_PT = 500;

// "Body of page N" on page N (one-based), so the text says which page it came from.
function bodyOf(pageNumber: number): string {
  return `Body of page ${String(pageNumber)}`;
}

function fivePagePdf(): Uint8Array<ArrayBuffer> {
  const [first, ...rest] = PAGE_SIZES;
  const editor = createPdf(first);
  for (const size of rest) {
    editor.appendPage(size);
  }
  editor.pages().forEach((page, index) => {
    page.appendText({
      xPt: TEXT_X_PT,
      yPt: TEXT_Y_PT,
      text: bodyOf(index + 1),
      font: DEFAULT_LAYOUT_FONT,
      sizePt: TEXT_SIZE_PT,
      color: BLACK,
    });
  });
  return editor.toBytes();
}

function markdownOf(pages?: readonly number[]): string {
  return decodeMarkdownText(pdfToMarkdown(fivePagePdf(), { pages }));
}

function frameIndicesOf(value: unknown): number[] {
  const found: number[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object" || node === null) {
      return;
    }
    if ("frames" in node && Array.isArray(node.frames)) {
      const frames: readonly unknown[] = node.frames;
      for (const frame of frames) {
        if (
          typeof frame === "object" &&
          frame !== null &&
          "pageIndex" in frame &&
          typeof frame.pageIndex === "number"
        ) {
          found.push(frame.pageIndex);
        }
      }
    }
    Object.values(node).forEach(walk);
  };
  walk(value);
  return [...new Set(found)].sort((a, b) => a - b);
}

describe("pdfToMarkdown with a page selection", () => {
  it("writes only the selected pages, each opened by its original one-based page number", () => {
    const text = markdownOf([0, -1]);
    expect(text).toContain(bodyOf(1));
    expect(text).toContain(bodyOf(PAGE_SIZES.length));
    for (const pageNumber of [2, 3, 4]) {
      expect(text).not.toContain(bodyOf(pageNumber));
    }
    const labels = text.match(/<!-- page \d+ -->/gu);
    expect(labels).toEqual([
      pageNumberMarker(1),
      pageNumberMarker(PAGE_SIZES.length),
    ]);
    expect(text.indexOf(pageNumberMarker(1))).toBeLessThan(
      text.indexOf(bodyOf(1)),
    );
    expect(text.indexOf(pageNumberMarker(PAGE_SIZES.length))).toBeLessThan(
      text.indexOf(bodyOf(PAGE_SIZES.length)),
    );
    expect(text.indexOf(bodyOf(1))).toBeLessThan(
      text.indexOf(pageNumberMarker(PAGE_SIZES.length)),
    );
  });

  it("keeps the page-break marker between two selected pages that share a section", () => {
    const text = markdownOf([0, -1]);
    expect(text.split(PAGE_BREAK_MARKER)).toHaveLength(2);
  });

  it("labels a page that starts a section of its own as well as pages after a page break", () => {
    const text = markdownOf([1, 2, 3]);
    expect(text.match(/<!-- page \d+ -->/gu)).toEqual([
      pageNumberMarker(2),
      pageNumberMarker(3),
      pageNumberMarker(4),
    ]);
  });

  it("labels nothing on a full conversion, whose output is unchanged by the option's existence", () => {
    const text = markdownOf();
    expect(text).not.toMatch(/<!-- page \d+ -->/u);
    for (const [index] of PAGE_SIZES.entries()) {
      expect(text).toContain(bodyOf(index + 1));
    }
  });

  it("reports a DocumentTree with no pages envelope, its frames naming source page indices", () => {
    let reported: DocumentTree | undefined;
    pdfToMarkdown(fivePagePdf(), {
      pages: [-1],
      onDocument: (tree) => {
        reported = tree;
      },
    });
    expect(reported?.pages).toBeUndefined();
    expect(frameIndicesOf(reported)).toEqual([LAST_PAGE_INDEX]);
  });

  it("reports a tree that cannot be rebuilt to pdf, with an error naming the page-selected case", () => {
    let reported: DocumentTree | undefined;
    pdfToDocx(fivePagePdf(), {
      pages: [0],
      onDocument: (tree) => {
        reported = tree;
      },
    });
    if (reported === undefined) {
      throw new Error("expected onDocument to report a tree");
    }
    const tree = reported;
    expect(() => buildDocumentBytes(tree, "pdf")).toThrow(
      /page-selected pdf-to-<format> conversion/u,
    );
  });

  it("throws PdfPageSelectionError for an index naming no page", () => {
    expect(() => markdownOf([PAGE_SIZES.length])).toThrow(
      PdfPageSelectionError,
    );
  });
});

describe("readNativeDocumentTree and readContentDocument with a page selection", () => {
  it("stamps every frame with the page's index in the source PDF and leaves the pages envelope off", () => {
    const tree = readNativeDocumentTree("pdf", fivePagePdf(), {
      pages: [1, LAST_PAGE_INDEX],
    });
    expect(tree.pages).toBeUndefined();
    expect(frameIndicesOf(tree)).toEqual([1, LAST_PAGE_INDEX]);
    expect(readNativeDocumentTree("pdf", fivePagePdf()).pages).toHaveLength(
      PAGE_SIZES.length,
    );
  });

  it("reconstructs only the selected pages' content", () => {
    const content = readContentDocument("pdf", fivePagePdf(), {
      pages: [-1],
    });
    const text = JSON.stringify(content);
    expect(text).toContain(bodyOf(PAGE_SIZES.length));
    expect(text).not.toContain(bodyOf(1));
  });
});

describe("pdfToSvg with a page selection", () => {
  // The svg writer renders vectors only, so the page is identified by its size: the selected page is the one WIDE page.
  const WIDE_PAGE_INDEX = PAGE_SIZES.indexOf(WIDE);

  it("needs no page option once the selection holds a single page, and writes that page", () => {
    expect(() => pdfToSvg(fivePagePdf())).toThrow(
      SvgMultiPageNotSpecifiedError,
    );
    const svg = new TextDecoder().decode(
      pdfToSvg(fivePagePdf(), { pages: [WIDE_PAGE_INDEX] }),
    );
    expect(svg).toContain(
      `width="${String(WIDE.widthPt)}pt" height="${String(WIDE.heightPt)}pt"`,
    );
  });
});

describe("buildMarkdownText pageNumbers", () => {
  it("is what a caller composing readPdf, reconstructWordprocessing and the writer passes to get the same labels", () => {
    const layout = readPdf(fivePagePdf(), { pages: [0, -1] });
    const composed = renderContentDocumentToMarkdown(
      reconstructWordprocessing(layout),
      {
        pageNumbers: layout.pages.map(
          (page, position) => sourcePageIndex(page, position) + 1,
        ),
      },
    );
    expect(composed.trim()).toBe(markdownOf([0, -1]).trim());
  });

  it("refuses a page-number count that differs from the document's page count", () => {
    const content = reconstructWordprocessing(
      readPdf(fivePagePdf(), { pages: [0, -1] }),
    );
    expect(() => buildMarkdownText(content, { pageNumbers: [1] })).toThrow(
      MarkdownPageNumberCountError,
    );
    expect(() =>
      buildMarkdownText(content, { pageNumbers: [1, 2, 3] }),
    ).toThrow(MarkdownPageNumberCountError);
  });

  it("is output-only: reading markdown keeps a page label, hand-written or generated, as an ordinary paragraph", () => {
    const handWritten = "Intro\n\n<!-- page 12 -->\n\nBody\n";
    const read = readMarkdownContent(handWritten);
    if (read.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    const texts = read.sections
      .flatMap((section) => section.blocks)
      .flatMap((block) =>
        block.kind === "paragraph"
          ? [block.runs.map((run) => run.text).join("")]
          : [],
      );
    expect(texts).toContain(pageNumberMarker(12));
    expect(JSON.stringify(readMarkdownContent(markdownOf([0, -1])))).toContain(
      pageNumberMarker(PAGE_SIZES.length),
    );
  });
});

describe("reconstruction of a page-selected layout", () => {
  // One page, the last of a five-page source: index 4 at position 0, so any reconstruction reading the position instead of the source index reports page 0.

  const selectedLayout: LayoutDocument = {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {},
    pageCount: PAGE_SIZES.length,
    pages: [
      {
        ...LETTER,
        index: LAST_PAGE_INDEX,
        items: [
          {
            kind: "text",
            text: bodyOf(LAST_PAGE_INDEX + 1),
            xPt: TEXT_X_PT,
            yPt: TEXT_Y_PT,
            font: DEFAULT_LAYOUT_FONT,
            sizePt: TEXT_SIZE_PT,
            color: BLACK,
          },
        ],
        annotations: [
          {
            subtype: "Text",
            xPt: TEXT_X_PT,
            yPt: TEXT_Y_PT,
            widthPt: TEXT_SIZE_PT,
            heightPt: TEXT_SIZE_PT,
            contents: "A note",
          },
        ],
      },
    ],
    images: {},
  };

  it.each<{
    readonly kind: string;
    readonly reconstruct: (layout: LayoutDocument) => ContentDocument;
  }>([
    { kind: "wordprocessing", reconstruct: reconstructWordprocessing },
    { kind: "presentation", reconstruct: reconstructPresentation },
    { kind: "drawing", reconstruct: reconstructDrawing },
    { kind: "spreadsheet", reconstruct: reconstructSpreadsheet },
  ])(
    "the $kind reconstruction stamps frames with the source page index",
    ({ reconstruct }) => {
      expect(frameIndicesOf(reconstruct(selectedLayout))).toEqual([
        LAST_PAGE_INDEX,
      ]);
    },
  );

  it("names a reconstructed sheet after the source page", () => {
    const content = reconstructSpreadsheet(selectedLayout);
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet");
    }
    expect(content.sheets.map((sheet) => sheet.name)).toEqual([
      `Sheet${String(LAST_PAGE_INDEX + 1)}`,
    ]);
  });

  it("keys a comment's anchor and its definition by the source page index, so the two still meet", () => {
    const key = `pdf-annot-${String(LAST_PAGE_INDEX)}-0`;
    const content = reconstructWordprocessing(selectedLayout);
    expect(JSON.stringify(content)).toContain(`"name":"${key}"`);
    const tree = assembleTree(content);
    stampPdfPackageTables(tree, selectedLayout);
    expect(Object.keys(tree.definitions ?? {})).toContain(key);
  });
});

describe("buildMarkdownText pageNumbers page-start rule", () => {
  it("does not start a page at a section that continues its predecessor's page", () => {
    const section = {
      pageSize: LETTER,
      margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
    };
    const paragraph = (text: string): ContentBlock => ({
      kind: "paragraph",
      runs: [{ text }],
    });
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        { ...section, blocks: [paragraph("first")] },
        {
          ...section,
          breakType: "continuous",
          blocks: [paragraph("same page")],
        },
        { ...section, blocks: [paragraph("second")] },
      ],
    };
    const text = buildMarkdownText(content, { pageNumbers: [7, 9] });
    expect(text.match(/<!-- page \d+ -->/gu)).toEqual([
      pageNumberMarker(7),
      pageNumberMarker(9),
    ]);
    expect(text.indexOf("same page")).toBeLessThan(
      text.indexOf(pageNumberMarker(9)),
    );
  });
});

describe("pages reaches only the caller's own pdf", () => {
  const CLOCK = fixedClock(new Date("2026-01-02T03:04:05Z"));
  // A docx long enough to render several pages: docx to ods routes through toPdf then fromPdf, so an intermediate pdf exists whose pages a leaked selection would cut.
  function multiPageDocx(): Uint8Array<ArrayBuffer> {
    const editor = createDocx();
    PAGE_SIZES.forEach((_size, index) => {
      if (index > 0) {
        editor.body.appendPageBreak();
      }
      editor.body.appendParagraph({ text: bodyOf(index + 1) });
    });
    return editor.toBytes();
  }

  // Compared by the spreadsheet content read back rather than by bytes: the package records its own write moment, so two conversions a second apart differ in bytes while converting the same content.
  function odsSheetsOf(bytes: Uint8Array<ArrayBuffer>): unknown {
    const content = readOdsContent(decodePackage(bytes));
    return content.kind === "spreadsheet" ? content.sheets : content;
  }

  it("ignores pages on a docx to ods conversion: the whole document converts, and an index past its rendering never throws", () => {
    const whole = odsSheetsOf(
      convertDocument("docx", "ods", multiPageDocx(), { clock: CLOCK }),
    );
    expect(JSON.stringify(whole)).toContain(bodyOf(PAGE_SIZES.length));
    expect(
      odsSheetsOf(
        convertDocument("docx", "ods", multiPageDocx(), {
          clock: CLOCK,
          pages: [0],
        }),
      ),
    ).toEqual(whole);
    expect(
      odsSheetsOf(
        convertDocument("docx", "ods", multiPageDocx(), {
          clock: CLOCK,
          pages: [PAGE_SIZES.length * PAGE_SIZES.length],
        }),
      ),
    ).toEqual(whole);
  });

  it("still reports onDocument exactly once, from the last hop, on a multi-hop route", () => {
    let calls = 0;
    convertDocument("docx", "ods", multiPageDocx(), {
      clock: CLOCK,
      pages: [0],
      onDocument: () => {
        calls++;
      },
    });
    expect(calls).toBe(1);
  });

  it("still selects pages on a conversion whose source is pdf", () => {
    const text = new TextDecoder().decode(
      convertDocument("pdf", "markdown", fivePagePdf(), { pages: [-1] }),
    );
    expect(text).toContain(bodyOf(PAGE_SIZES.length));
    expect(text).not.toContain(bodyOf(1));
  });
});

describe("openPdf reads every page", () => {
  it("opens the whole document even when handed a selection, so its editor can be written back", () => {
    const options: Parameters<typeof readPdf>[1] = { pages: [0] };
    const editor = openPdf(fivePagePdf(), options);
    expect(editor.pages()).toHaveLength(PAGE_SIZES.length);
    expect(editor.toBytes().length).toBeGreaterThan(0);
  });
});
