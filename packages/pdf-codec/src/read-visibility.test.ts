import { describe, expect, it } from "vitest";
import type { LayoutDocument, LayoutItem, LayoutPage } from "./layout";
import {
  CONTENT_OBJ,
  EMPTY_DICT,
  FixtureBuilder,
  PDF_1_4,
  catalogPagesPageFontObjects,
} from "./test-support/pdf";
import { readPdf } from "./read";
import { writePdf } from "./write";

// readPdf's per-item visibility filter (contentItemBounds/itemIntersectsVisibleRegion in read.ts) decides which painted items survive into the page: the round trip through this package's own writer is what lets a test place an item at a chosen coordinate with a chosen rotation and assert whether it comes back, which no hand-built fixture offers a way to steer.
const HELVETICA = {
  family: "Helvetica",
  weight: "normal",
  style: "normal",
} as const;
const BLACK = { r: 0, g: 0, b: 0 };

function docWithItems(items: readonly LayoutItem[]): LayoutDocument {
  const page: LayoutPage = { widthPt: 300, heightPt: 200, items: [...items] };
  return { formatVersion: 1, metadata: {}, pages: [page], images: {} };
}

// Every case writes the document, reads it back, and reports which item kinds survived the visibility filter, so each assertion is exactly "an item placed thus is kept (or dropped)".
function roundTrippedKinds(items: readonly LayoutItem[]): string[] {
  const doc = readPdf(writePdf(docWithItems(items), { compress: false }));
  return doc.pages[0]!.items.map((item) => item.kind);
}

describe("readPdf: per-item visibility", () => {
  it("keeps an obliquely rotated run whose rotated hull reaches back onto the page from an anchor off its right edge", () => {
    // Anchored past the right edge with a 135-degree rotation: the run's ink swings back left and down onto the page, so the rotated-corner hull intersects it. The run's own unrotated frame (anchor rightwards) lies wholly off the page, which is what makes this case discriminate the hull path from the axis-aligned one.
    const kinds = roundTrippedKinds([
      {
        kind: "text",
        text: "swung back",
        xPt: 305,
        yPt: 100,
        font: HELVETICA,
        sizePt: 12,
        color: BLACK,
        rotationDeg: 135,
      },
    ]);
    expect(kinds).toContain("text");
  });

  it("drops a run whose whole extent, rotation included, lies beyond the right edge", () => {
    const kinds = roundTrippedKinds([
      {
        kind: "text",
        text: "gone",
        xPt: 340,
        yPt: 100,
        font: HELVETICA,
        sizePt: 12,
        color: BLACK,
      },
    ]);
    expect(kinds).not.toContain("text");
  });

  it("keeps a line drawn right-to-left that straddles the page's right edge", () => {
    // x1Pt beyond the edge, x2Pt well inside: the bounds walk must take its minimum from whichever endpoint is smaller, not from x1Pt by name. A min/max swap collapses the box to the off-page endpoint and mis-drops the line.
    const kinds = roundTrippedKinds([
      {
        kind: "line",
        x1Pt: 350,
        y1Pt: 190,
        x2Pt: 100,
        y2Pt: 10,
        color: BLACK,
        widthPt: 1,
      },
    ]);
    expect(kinds).toContain("line");
  });

  it("keeps a line drawn bottom-to-top that straddles the page's top edge", () => {
    // The same discrimination on the y axis: y1Pt above the page, y2Pt inside.
    const kinds = roundTrippedKinds([
      {
        kind: "line",
        x1Pt: 150,
        y1Pt: 260,
        x2Pt: 150,
        y2Pt: 20,
        color: BLACK,
        widthPt: 1,
      },
    ]);
    expect(kinds).toContain("line");
  });

  it("keeps a path whose every stated point lies on the page", () => {
    // A one-subpath path with one cubic segment: the bounds fold in the subpath start, the segment end, and both cubic control points. Every one of those folds is the only thing pulling the corresponding extreme in from Infinity, so suppressing any single one leaves the box open on that side and the visibility comparison mis-drops the path.
    const kinds = roundTrippedKinds([
      {
        kind: "path",
        stroke: { color: BLACK, widthPt: 1 },
        subpaths: [
          {
            startXPt: 40,
            startYPt: 40,
            segments: [
              {
                kind: "cubic",
                xPt: 200,
                yPt: 120,
                c1xPt: 90,
                c1yPt: 180,
                c2xPt: 160,
                c2yPt: 30,
              },
            ],
            closed: false,
          },
        ],
      },
    ]);
    expect(kinds).toContain("path");
  });

  it("keeps a link whose rectangle lies wholly off the page", () => {
    // Links are annotations, not painted content: their region is never geometry-filtered, however far outside the page it sits.
    const kinds = roundTrippedKinds([
      {
        kind: "link",
        uri: "https://example.com/off-page",
        xPt: 400,
        yPt: 150,
        widthPt: 20,
        heightPt: 10,
      },
    ]);
    expect(kinds).toContain("link");
  });
});

describe("readPdf: the %PDF- header search itself", () => {
  // hasPdfHeader's window arithmetic only shows at its own edges, and readPdf's header check runs before ANY parsing, so the cases below assert only on the header diagnostic itself: a real PDF body is unnecessary (and a stub one would fail later parsing for unrelated reasons). Each case is caught by the exact error message the no-header path throws.
  function headerDiagnostic(
    stream: Uint8Array<ArrayBuffer>,
  ): string | undefined {
    try {
      readPdf(stream);
      return undefined;
    } catch (error) {
      const message = (error as Error).message;
      return message.includes("header") ? message : `other: ${message}`;
    }
  }

  it("accepts a header preceded by a UTF-8 BOM, rejecting only for downstream reasons", () => {
    const bom = new TextEncoder().encode("\u{feff}");
    const stream = new Uint8Array([
      ...bom,
      ...new TextEncoder().encode("%PDF-1.7\n"),
    ]);
    // The header WAS found: whatever failure follows is a parsing matter, never the no-header diagnostic.
    expect(headerDiagnostic(stream)).not.toMatch(/no "%PDF-" header/);
  });

  it("accepts a header preceded by blank lines, as the spec itself permits", () => {
    const stream = new TextEncoder().encode("\n\n\n%PDF-1.7\n");
    expect(headerDiagnostic(stream)).not.toMatch(/no "%PDF-" header/);
  });

  it("rejects a document whose only %PDF- sits past the search window", () => {
    // 1030 junk bytes push the header past the 1024-byte window: no header found within it.
    const junk = new Uint8Array(1030).fill(0x20);
    const stream = new Uint8Array([
      ...junk,
      ...new TextEncoder().encode("%PDF-1.7\n"),
    ]);
    expect(headerDiagnostic(stream)).toMatch(/no "%PDF-" header/);
  });
});

describe("readPdf: tagged-content channels the writer cannot emit", () => {
  // writePdf emits no /ActualText or /Alt spans, so these reader channels are unreachable through this package's own round trip; the fixture below builds the PDF by hand instead, wrapping the text-showing operators in a /Span BDC exactly the way a producer with a real structure tree does.
  it("keeps a BDC span's /ActualText and /Alt on the recovered text item", () => {
    const b = new FixtureBuilder().header(PDF_1_4);
    catalogPagesPageFontObjects(b, CONTENT_OBJ);
    b.stream(
      CONTENT_OBJ,
      EMPTY_DICT,
      new TextEncoder().encode(
        "/Span << /ActualText (replaced reading) /Alt (the alt rendering) >> BDC BT /F1 12 Tf 10 50 Td (ffi) Tj ET EMC",
      ),
    );
    b.classicXrefAndTrailer(CONTENT_OBJ, "/Root 1 0 R");
    const doc = readPdf(b.bytes());
    const item = doc.pages[0]!.items[0];
    expect(item).toMatchObject({
      kind: "text",
      actualText: "replaced reading",
      alt: "the alt rendering",
    });
  });
});
