import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Filters from "./filters";
import type * as Interpret from "./interpret";
import type { PdfDiagnostic } from "./diagnostics";
import { PdfPageSelectionError, PdfParseError } from "./diagnostics";
import { decodeStream } from "./filters";
import { interpretContentStream } from "./interpret";
import { sourcePageIndex } from "./layout";
import { asName, dictGet } from "./objects";
import { readPdf } from "./read";
import { PdfPartialDocumentError, writePdf } from "./write";
import {
  PAGE_SELECTION_ATTACHMENT_NAME,
  PAGE_SELECTION_IMAGE_PAGE_INDEX,
  PAGE_SELECTION_STREAM,
  PAGE_SELECTION_TRAP_PAGE_INDEX,
  navigationClusterPdf,
  pagelessPdf,
  pageSelectionPdf,
} from "./test-support/pdf";
import { parentTreeMissingEntryPdf } from "./test-support/pdf-structures";

// The interpreter entry readPage calls, wrapped so a test can count how many content streams a read interpreted. The real implementation still runs: this observes, it does not stub.
vi.mock("./interpret", async (importOriginal) => {
  const actual = await importOriginal<typeof Interpret>();
  return {
    ...actual,
    interpretContentStream: vi.fn(actual.interpretContentStream),
  };
});

// The stream decoder every reader goes through, wrapped the same way, so a test can see which of the fixture's marked streams a read decoded.
vi.mock("./filters", async (importOriginal) => {
  const actual = await importOriginal<typeof Filters>();
  return { ...actual, decodeStream: vi.fn(actual.decodeStream) };
});

// The /FixtureStream names of the streams the last read decoded.
function decodedFixtureStreams(): string[] {
  return vi
    .mocked(decodeStream)
    .mock.calls.flatMap(([, dict]) => {
      const marker = asName(dictGet(dict, "FixtureStream"));
      return marker === undefined ? [] : [marker];
    })
    .sort();
}

const PAGE_COUNT = 4;
const LAST_PAGE_INDEX = PAGE_COUNT - 1;

function pageTexts(doc: ReturnType<typeof readPdf>): string[] {
  return doc.pages.map((page) =>
    page.items
      .flatMap((item) => (item.kind === "text" ? [item.text] : []))
      .join(""),
  );
}

function collectingSink(): {
  readonly diagnostics: PdfDiagnostic[];
  readonly sink: (diagnostic: PdfDiagnostic) => void;
} {
  const diagnostics: PdfDiagnostic[] = [];
  return {
    diagnostics,
    sink: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
  };
}

beforeEach(() => {
  vi.mocked(interpretContentStream).mockClear();
  vi.mocked(decodeStream).mockClear();
});

describe("readPdf: page selection never touches an unselected page's content", () => {
  it("interprets one content stream per selected page, and none for the rest", () => {
    readPdf(pageSelectionPdf());
    expect(interpretContentStream).toHaveBeenCalledTimes(PAGE_COUNT);

    vi.mocked(interpretContentStream).mockClear();
    readPdf(pageSelectionPdf(), { pages: [0, -1] });
    expect(interpretContentStream).toHaveBeenCalledTimes(2);
  });

  it("never decodes an unselected page's content stream: the trap page's undecodable filter is reported only when that page is read", () => {
    const full = collectingSink();
    readPdf(pageSelectionPdf(), { sink: full.sink });
    expect(full.diagnostics.map((d) => d.code)).toContain(
      "pdf/unsupported-filter",
    );

    const selected = collectingSink();
    readPdf(pageSelectionPdf(), {
      sink: selected.sink,
      pages: [...Array(PAGE_COUNT).keys()].filter(
        (index) => index !== PAGE_SELECTION_TRAP_PAGE_INDEX,
      ),
    });
    expect(selected.diagnostics).toEqual([]);
  });

  it("never decodes a font program only an unselected page uses, nor the content stream of that page", () => {
    readPdf(pageSelectionPdf());
    expect(decodedFixtureStreams()).toEqual(
      expect.arrayContaining([
        PAGE_SELECTION_STREAM.trapContent,
        PAGE_SELECTION_STREAM.trapFontProgram,
      ]),
    );

    vi.mocked(decodeStream).mockClear();
    readPdf(pageSelectionPdf(), { pages: [0, -1] });
    expect(decodedFixtureStreams()).toEqual([]);
  });

  it("decodes no embedded file on a page-selected read, and leaves attachments out of its result", () => {
    const full = readPdf(pageSelectionPdf());
    expect(decodedFixtureStreams()).toContain(PAGE_SELECTION_STREAM.attachment);
    expect(full.attachments?.map((attachment) => attachment.name)).toEqual([
      PAGE_SELECTION_ATTACHMENT_NAME,
    ]);

    for (const pages of [[], [0], [PAGE_SELECTION_TRAP_PAGE_INDEX]]) {
      vi.mocked(decodeStream).mockClear();
      const selected = readPdf(pageSelectionPdf(), { pages });
      expect(decodedFixtureStreams()).not.toContain(
        PAGE_SELECTION_STREAM.attachment,
      );
      expect(selected.attachments).toBeUndefined();
    }
  });

  it("builds structure ownership only for selected pages: an unselected page's broken /StructParents reports nothing", () => {
    const full = collectingSink();
    readPdf(parentTreeMissingEntryPdf(), { sink: full.sink });
    expect(full.diagnostics.map((d) => d.code)).toContain(
      "pdf/parent-tree-missing-entry",
    );

    const selected = collectingSink();
    const doc = readPdf(parentTreeMissingEntryPdf(), {
      sink: selected.sink,
      pages: [],
    });
    expect(selected.diagnostics).toEqual([]);
    expect(doc.structure).toEqual(
      readPdf(parentTreeMissingEntryPdf()).structure,
    );
  });

  it("never resolves an image only an unselected page draws", () => {
    expect(Object.keys(readPdf(pageSelectionPdf()).images)).toHaveLength(1);
    expect(readPdf(pageSelectionPdf(), { pages: [0, -1] }).images).toEqual({});
    expect(
      Object.keys(
        readPdf(pageSelectionPdf(), {
          pages: [PAGE_SELECTION_IMAGE_PAGE_INDEX],
        }).images,
      ),
    ).toHaveLength(1);
  });
});

describe("readPdf: page selection result", () => {
  it("returns exactly the selected pages, page-for-page equal to the same pages of a full read, each carrying its source index", () => {
    const full = readPdf(pageSelectionPdf());
    const selection = [0, PAGE_SELECTION_IMAGE_PAGE_INDEX, LAST_PAGE_INDEX];
    const selected = readPdf(pageSelectionPdf(), { pages: selection });
    expect(selected.pages).toEqual(
      selection.map((index) => ({ ...full.pages[index], index })),
    );
    expect(selected.images).toEqual(full.images);
  });

  it("reports the page tree's length as pageCount on a selected read, and leaves both pageCount and index off a full read", () => {
    const full = readPdf(pageSelectionPdf());
    expect(full.pageCount).toBeUndefined();
    expect(full.pages.every((page) => page.index === undefined)).toBe(true);
    expect(readPdf(pageSelectionPdf(), { pages: [0] }).pageCount).toBe(
      PAGE_COUNT,
    );
  });

  it("counts a negative index from the end", () => {
    const doc = readPdf(pageSelectionPdf(), { pages: [-1, -PAGE_COUNT] });
    expect(doc.pages.map((page) => page.index)).toEqual([0, LAST_PAGE_INDEX]);
    expect(pageTexts(doc)).toEqual(["Page 1", `Page ${PAGE_COUNT}`]);
  });

  it("collapses duplicates, including a negative and a positive index naming the same page, and orders the result by document order", () => {
    const doc = readPdf(pageSelectionPdf(), {
      pages: [LAST_PAGE_INDEX, 0, -1, 0],
    });
    expect(doc.pages.map((page) => page.index)).toEqual([0, LAST_PAGE_INDEX]);
  });

  it("reads no page for an empty selection, while still reporting pageCount and the document-level surfaces", () => {
    const doc = readPdf(navigationClusterPdf(), { pages: [] });
    expect(interpretContentStream).not.toHaveBeenCalled();
    const full = readPdf(navigationClusterPdf());
    expect(doc.pages).toEqual([]);
    expect(doc.pageCount).toBe(full.pages.length);
    expect(doc.outline).toEqual(full.outline);
  });

  it("keeps document-level page references on source indices", () => {
    const full = readPdf(navigationClusterPdf());
    const secondPageOnly = readPdf(navigationClusterPdf(), { pages: [1] });
    expect(secondPageOnly.outline).toEqual(full.outline);
    const named = (doc: ReturnType<typeof readPdf>, name: string) =>
      doc.destinations?.find((destination) => destination.name === name);
    expect(named(secondPageOnly, "second")).toEqual(named(full, "second"));
    expect(named(secondPageOnly, "second")?.pageIndex).toBe(1);
    expect(secondPageOnly.pages[0]?.index).toBe(1);
  });

  it("reads every page when pages is omitted", () => {
    expect(pageTexts(readPdf(pageSelectionPdf()))).toEqual([
      "Page 1",
      "Page 2",
      "Page 3",
      "Page 4",
    ]);
  });
});

describe("readPdf: an invalid page selection throws", () => {
  it.each([PAGE_COUNT, -PAGE_COUNT - 1])(
    "refuses index %i, naming the index and the page count",
    (requested) => {
      const read = () => readPdf(pageSelectionPdf(), { pages: [0, requested] });
      expect(read).toThrow(PdfPageSelectionError);
      expect(read).toThrow(PdfParseError);
      try {
        read();
      } catch (error) {
        expect(error).toMatchObject({
          code: "pdf/page-out-of-range",
          pageIndex: requested,
          pageCount: PAGE_COUNT,
        });
        expect(String(error)).toContain(String(requested));
        expect(String(error)).toContain(String(PAGE_COUNT));
      }
    },
  );

  it.each([
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("refuses the non-integer index %d", (requested) => {
    expect(() => readPdf(pageSelectionPdf(), { pages: [requested] })).toThrow(
      expect.objectContaining({
        code: "pdf/page-index-not-integer",
        pageIndex: requested,
      }),
    );
  });

  it("reads -0 as page 0", () => {
    expect(
      readPdf(pageSelectionPdf(), { pages: [-0] }).pages.map(
        (page) => page.index,
      ),
    ).toEqual([0]);
  });

  it("refuses any index on a document with no pages", () => {
    expect(() => readPdf(pagelessPdf(), { pages: [0] })).toThrow(
      expect.objectContaining({ code: "pdf/page-out-of-range", pageCount: 0 }),
    );
    expect(readPdf(pagelessPdf(), { pages: [] }).pageCount).toBe(0);
  });

  it("throws before interpreting any page", () => {
    expect(() =>
      readPdf(pageSelectionPdf(), { pages: [0, PAGE_COUNT] }),
    ).toThrow(PdfPageSelectionError);
    expect(interpretContentStream).not.toHaveBeenCalled();
  });
});

describe("sourcePageIndex", () => {
  it("prefers a page's own index over its position, and falls back to the position", () => {
    const page = { widthPt: 1, heightPt: 1, items: [] };
    expect(sourcePageIndex({ ...page, index: LAST_PAGE_INDEX }, 0)).toBe(
      LAST_PAGE_INDEX,
    );
    expect(sourcePageIndex(page, 2)).toBe(2);
  });
});

describe("writePdf refuses a page-selected read", () => {
  it("throws PdfPartialDocumentError naming both counts, and still writes a full read", () => {
    const selected = readPdf(pageSelectionPdf(), { pages: [0, -1] });
    expect(() => writePdf(selected)).toThrow(PdfPartialDocumentError);
    expect(() => writePdf(selected)).toThrow(
      expect.objectContaining({ pageCount: PAGE_COUNT, selectedPageCount: 2 }),
    );
    expect(writePdf(readPdf(pageSelectionPdf())).length).toBeGreaterThan(0);
  });
});
