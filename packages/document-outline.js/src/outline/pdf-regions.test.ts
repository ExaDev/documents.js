import { describe, expect, it } from "vitest";
import type { LayoutItem, LayoutPage } from "pdf-codec";
import {
  boundingBox,
  itemScale,
  layoutItemBounds,
  regionReadingOrderComparator,
  segmentPdfRegions,
  type PdfRegionBounds,
} from "./pdf-regions";
import {
  BLACK,
  boundedAt,
  FONT,
  line,
} from "../test-support/pdf-region-fixtures";

function page(items: readonly LayoutItem[]): LayoutPage {
  return { widthPt: 612, heightPt: 792, items: [...items] };
}

describe("segmentPdfRegions", () => {
  it("returns nothing for a page with no items", () => {
    expect(segmentPdfRegions(page([]))).toEqual([]);
  });

  it("excludes link/internalLink annotations from segmentation", () => {
    const leftMargin = 50;
    const topLine = 700;
    const secondLine = 686;
    const linkTop = 680;
    const regions = segmentPdfRegions(
      page([
        line(leftMargin, topLine, "Some prose text here to read."),
        line(leftMargin, secondLine, "Continuing on the very next line below."),
        {
          kind: "link",
          uri: "https://example.com",
          xPt: leftMargin,
          yPt: linkTop,
          widthPt: 100,
          heightPt: 20,
        },
      ]),
    );
    for (const region of regions) {
      expect(region.items.every((item) => item.kind !== "link")).toBe(true);
    }
  });

  it("classifies a single flowing text block as a column", () => {
    const lineCount = 6;
    const leftMargin = 50;
    const topLine = 700;
    const lineHeight = 14;
    const lines = Array.from({ length: lineCount }, (_, index) =>
      line(
        leftMargin,
        topLine - index * lineHeight,
        "The quick brown fox jumps over the lazy dog.",
      ),
    );
    const regions = segmentPdfRegions(page(lines));
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("column");
    expect(regions[0]?.items).toHaveLength(lineCount);
  });

  it("splits a two-column layout at the gutter, classifying each column independently", () => {
    // Short lines, well short of the gutter, so the gutter is unambiguously wider than either column's own line-height-derived scale. The right column's own line rhythm is deliberately offset from the left's (a different line spacing) — two independent flowing-text columns never share a synchronised row-for-row rhythm in practice, and the offset here is what keeps isRowAlignedGrid from mistaking this for one table's rows.
    const leftColumnCount = 8;
    const rightColumnCount = 7;
    const leftX = 50;
    const rightX = 250;
    const topLine = 700;
    const rightTopLine = 693;
    const leftLineHeight = 14;
    const rightLineHeight = 15;
    const leftColumn = Array.from({ length: leftColumnCount }, (_, index) =>
      line(leftX, topLine - index * leftLineHeight, "Left column body text."),
    );
    const rightColumn = Array.from({ length: rightColumnCount }, (_, index) =>
      line(
        rightX,
        rightTopLine - index * rightLineHeight,
        "Right column text.",
      ),
    );
    const regions = segmentPdfRegions(page([...leftColumn, ...rightColumn]));

    expect(regions).toHaveLength(2);
    const [left, right] = [...regions].sort(
      (a, b) => a.bounds.xPt - b.bounds.xPt,
    );
    expect(left?.classification).toBe("column");
    expect(left?.items).toHaveLength(leftColumnCount);
    expect(right?.classification).toBe("column");
    expect(right?.items).toHaveLength(rightColumnCount);
  });

  it("classifies a ruled grid of rows and aligned columns as a table, not per-column prose", () => {
    const headers = ["Name", "Age", "City"];
    const rows = [
      ["Alice", "34", "Leeds"],
      ["Bob", "29", "York"],
      ["Carol", "41", "Hull"],
      ["Dave", "37", "Ripon"],
    ];
    const topLine = 700;
    const rowHeight = 16;
    const column0X = 50;
    const column1X = 200;
    const column2X = 320;
    const columnX = [column0X, column1X, column2X];
    const items: LayoutItem[] = [];
    [headers, ...rows].forEach((row, rowIndex) => {
      const yPt = topLine - rowIndex * rowHeight;
      row.forEach((cell, columnIndex) => {
        const x = columnX[columnIndex];
        if (x !== undefined) items.push(line(x, yPt, cell));
      });
    });

    const regions = segmentPdfRegions(page(items));
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("table");
    expect(regions[0]?.items).toHaveLength(
      headers.length + rows.length * headers.length,
    );
  });

  it("classifies an image-dominated block as a figure, and a short adjacent line as its caption", () => {
    const proseLineCount = 4;
    const figure: LayoutItem = {
      kind: "image",
      imageId: "img-1",
      xPt: 100,
      yPt: 500,
      widthPt: 300,
      heightPt: 200,
    };
    const captionX = 150;
    const captionY = 470;
    const proseX = 100;
    const proseTopY = 760;
    const proseLineHeight = 14;
    // A photo this size' own scale (min(300, 200) = 200pt) would swamp a global gap threshold; the caption gap below is well clear of the LOCAL threshold (1.5 * the caption's own ~10pt font size) that this module actually uses.
    const caption = line(
      captionX,
      captionY,
      "Figure 1: a chart of quarterly results.",
    );
    const proseAbove = Array.from({ length: proseLineCount }, (_, index) =>
      line(
        proseX,
        proseTopY - index * proseLineHeight,
        "Unrelated body text sits well above the figure.",
      ),
    );

    const regions = segmentPdfRegions(page([...proseAbove, figure, caption]));

    const figureRegion = regions.find(
      (region) => region.classification === "figure",
    );
    const captionRegion = regions.find(
      (region) => region.classification === "caption",
    );
    expect(figureRegion).toBeDefined();
    expect(figureRegion?.items).toHaveLength(1);
    expect(captionRegion).toBeDefined();
    expect(captionRegion?.items).toHaveLength(1);
    expect(captionRegion?.confidence).toBeGreaterThan(0);
    expect(captionRegion?.confidence).toBeLessThanOrEqual(1);

    // Recorded in both directions: the caption stays its own region, and the figure it labels now
    // carries that text. The pass already had to work out which figure the caption belonged to in
    // order to classify it, and used to drop the answer — so a consumer wanting a figure's own label
    // had to re-derive the adjacency this function had just computed.
    expect(figureRegion?.caption).toBe(
      "Figure 1: a chart of quarterly results.",
    );
    // Associated, not moved: projecting every region's text must read the caption exactly once. Asserted
    // by counting it across every region rather than by inspecting the caption region's own items, which
    // the fixture already guarantees and which would pass even if the figure had swallowed the item too.
    const occurrences = regions.filter((region) =>
      region.items.some(
        (item) =>
          item.kind === "text" &&
          item.text === "Figure 1: a chart of quarterly results.",
      ),
    );
    expect(occurrences).toHaveLength(1);

    const proseRegion = regions.find(
      (region) => region.classification === "column",
    );
    expect(proseRegion?.items).toHaveLength(proseLineCount);
  });

  it("gives a figure the nearer of two candidate captions", () => {
    // A figure sandwiched between two short runs has two candidates and only one is its label. The same
    // gap that decides a caption's own confidence decides which figure wins it, so the nearer text is
    // the one recorded on the figure.
    //
    // Both gaps sit in a narrow window the segmentation forces: wider than the LOCAL cut threshold
    // (1.5x the caption's own ~10pt font size, so ~15pt — below that the run is not split off as its
    // own region at all) and within CAPTION_GAP_PT (24pt, beyond which it is not a caption). Above is
    // 18pt away, below is 22pt.
    const figure: LayoutItem = {
      kind: "image",
      imageId: "img-2",
      xPt: 100,
      yPt: 400,
      widthPt: 300,
      heightPt: 200,
    };
    // The nearer caption is the one ABOVE, which is the arrangement that makes the tie-break
    // load-bearing: regions arrive sorted top-to-bottom, so `above` is processed first, and a naive
    // last-writer-wins would record `below` instead. With the fixture the other way round both rules
    // agree and the test proves nothing — verified by mutating the comparison to `if (true)`, under
    // which the earlier version of this case still passed.
    const captionX = 150;
    const aboveY = 618;
    const belowY = 368;
    const above = line(captionX, aboveY, "Figure 2: the nearer caption.");
    const below = line(captionX, belowY, "Further away, below the figure.");

    const regions = segmentPdfRegions(page([above, figure, below]));
    const figureRegion = regions.find(
      (region) => region.classification === "figure",
    );

    expect(figureRegion?.caption).toBe("Figure 2: the nearer caption.");
  });

  it("does not attach a caption to a figure it is not vertically adjacent to", () => {
    const figure: LayoutItem = {
      kind: "image",
      imageId: "img-1",
      xPt: 100,
      yPt: 500,
      widthPt: 300,
      heightPt: 200,
    };
    const farX = 100;
    const farY = 100;
    // Far below the figure — well past CAPTION_GAP_PT — so this should stay unclassified rather than being claimed as the figure's caption.
    const farText = line(
      farX,
      farY,
      "An unrelated short line near the bottom of the page.",
    );

    const regions = segmentPdfRegions(page([figure, farText]));
    const captionRegion = regions.find(
      (region) => region.classification === "caption",
    );
    expect(captionRegion).toBeUndefined();
  });

  it("reports a single small item as unknown, carrying no structural signal", () => {
    const leftMargin = 50;
    const topLine = 700;
    const regions = segmentPdfRegions(page([line(leftMargin, topLine, "x")]));
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("unknown");
    expect(regions[0]?.confidence).toBe(1);
  });

  it("sorts regions top to bottom, then left to right, matching reading order", () => {
    const bottomRightX = 300;
    const bottomRightY = 500;
    const topLeftX = 50;
    const topLeftY = 700;
    const items = [
      line(
        bottomRightX,
        bottomRightY,
        "Bottom right area of the page with more text here.",
      ),
      line(
        topLeftX,
        topLeftY,
        "Top left area of the page with more text here too.",
      ),
    ];
    const regions = segmentPdfRegions(page(items));
    expect(regions.length).toBeGreaterThanOrEqual(1);
    if (regions.length === 2) {
      expect(regions[0]?.bounds.yPt).toBeGreaterThan(
        regions[1]?.bounds.yPt ?? 0,
      );
    }
  });

  it("breaks a tie in vertical position by sorting left to right", () => {
    // Two top clusters (A at leftX, B at rightX) sharing the same row band, and one bottom cluster (C) far below both — deliberately listed out of the expected output order (B, C, then A) so the sort must genuinely reorder them, exercising both the primary (y-descending) and tie-break (x-ascending) comparator clauses.
    const clusterSize = 3;
    const leftX = 50;
    const rightX = 400;
    const topLine = 700;
    const bottomLine = 100;
    const leftLineHeight = 14;
    // A distinctly different line spacing than leftLineHeight keeps this from being mistaken for one row-aligned table's columns (isRowAlignedGrid's own rejection, the same reason the two-column test above offsets its own rhythm) — a smaller offset still falls within LINE_TOLERANCE_PT often enough to accidentally "align".
    const rightLineHeight = 20;
    const clusterA = Array.from({ length: clusterSize }, (_, index) =>
      line(
        leftX,
        topLine - index * leftLineHeight,
        "Top left column body text here.",
      ),
    );
    const clusterB = Array.from({ length: clusterSize }, (_, index) =>
      line(
        rightX,
        topLine - index * rightLineHeight,
        "Top right column body text here.",
      ),
    );
    const clusterC = Array.from({ length: clusterSize }, (_, index) =>
      line(
        leftX,
        bottomLine - index * leftLineHeight,
        "Bottom column body text here too.",
      ),
    );
    const regions = segmentPdfRegions(
      page([...clusterB, ...clusterC, ...clusterA]),
    );
    expect(regions).toHaveLength(clusterSize);
    expect(regions.map((region) => region.bounds.xPt)).toEqual([
      leftX,
      rightX,
      leftX,
    ]);
    expect(regions[0]!.bounds.yPt).toBeGreaterThan(regions[2]!.bounds.yPt);
  });

  it("breaks a GENUINE vertical tie (identical bounds.yPt, not merely close) by sorting left to right", () => {
    // Two single-character items at the exact same yPt, far enough apart in x to cut into two leaves whose bounds.yPt are then identical (a single-item leaf's bounds equal the item's own bounds) — this is the one case that actually exercises the sort comparator's second clause, unlike the "close but not equal" tie test above.
    const leftX = 50;
    const rightX = 400;
    const sharedY = 700;
    const items = [line(rightX, sharedY, "B"), line(leftX, sharedY, "A")]; // listed out of order so a broken (or no-op) tie-break would leave them unsorted
    const regions = segmentPdfRegions(page(items));
    expect(regions).toHaveLength(2);
    expect(regions.map((region) => region.bounds.xPt)).toEqual([leftX, rightX]);
  });
});

describe("regionReadingOrderComparator", () => {
  const boundsAt = (xPt: number, yPt: number): PdfRegionBounds => ({
    xPt,
    yPt,
    widthPt: 0,
    heightPt: 0,
  });

  it("sorts top to bottom (descending yPt)", () => {
    const topY = 700;
    const bottomY = 100;
    const top = { bounds: boundsAt(0, topY) };
    const bottom = { bounds: boundsAt(0, bottomY) };
    expect(regionReadingOrderComparator(top, bottom)).toBeLessThan(0);
    expect(regionReadingOrderComparator(bottom, top)).toBeGreaterThan(0);
  });

  it("breaks a genuine vertical tie by sorting left to right, as a subtraction rather than a sum", () => {
    // recursiveXYCut's own internal per-axis sort already fixes which region lands as `a` versus `b` by the time segmentPdfRegions reaches this comparator, so an end-to-end test can never itself control the argument order the tie-break clause receives — only calling the comparator directly, in BOTH argument orders, can prove it is a genuine subtraction. A sum-based tie-break (both xPt values here being positive, the sum is always positive) would report "a sorts after b" for EVERY ordering of this exact pair, which would still happen to look correct for one specific argument order and wrong for the other — checking both orders is what makes that distinguishable from a real subtraction, which correctly reverses sign when the arguments swap.
    const leftX = 50;
    const rightX = 400;
    const sharedY = 700;
    const left = { bounds: boundsAt(leftX, sharedY) };
    const right = { bounds: boundsAt(rightX, sharedY) };
    expect(regionReadingOrderComparator(left, right)).toBeLessThan(0);
    expect(regionReadingOrderComparator(right, left)).toBeGreaterThan(0);
  });
});

describe("layoutItemBounds", () => {
  it("returns undefined for link and internalLink annotations", () => {
    expect(
      layoutItemBounds({
        kind: "link",
        uri: "https://example.com",
        xPt: 0,
        yPt: 0,
        widthPt: 10,
        heightPt: 10,
      }),
    ).toBeUndefined();
    expect(
      layoutItemBounds({
        kind: "internalLink",
        destination: "dest1",
        xPt: 0,
        yPt: 0,
        widthPt: 10,
        heightPt: 10,
      }),
    ).toBeUndefined();
  });

  it("bounds a text item to its anchor plus font size, defaulting a missing width to zero", () => {
    expect(
      layoutItemBounds({
        kind: "text",
        text: "hi",
        xPt: 10,
        yPt: 20,
        font: FONT,
        sizePt: 12,
        color: BLACK,
        widthPt: 30,
      }),
    ).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 32 });
    expect(
      layoutItemBounds({
        kind: "text",
        text: "hi",
        xPt: 10,
        yPt: 20,
        font: FONT,
        sizePt: 12,
        color: BLACK,
      }),
    ).toEqual({ minX: 10, minY: 20, maxX: 10, maxY: 32 });
  });

  it("bounds an image/rect/ellipse to its own frame", () => {
    expect(
      layoutItemBounds({
        kind: "image",
        imageId: "i1",
        xPt: 5,
        yPt: 6,
        widthPt: 7,
        heightPt: 8,
      }),
    ).toEqual({ minX: 5, minY: 6, maxX: 12, maxY: 14 });
    expect(
      layoutItemBounds({
        kind: "rect",
        xPt: 5,
        yPt: 6,
        widthPt: 7,
        heightPt: 8,
      }),
    ).toEqual({ minX: 5, minY: 6, maxX: 12, maxY: 14 });
    expect(
      layoutItemBounds({
        kind: "ellipse",
        xPt: 5,
        yPt: 6,
        widthPt: 7,
        heightPt: 8,
      }),
    ).toEqual({ minX: 5, minY: 6, maxX: 12, maxY: 14 });
  });

  it("bounds a line to the min/max of its own endpoints, whichever order they're given in", () => {
    // x1 > x2 and y1 < y2 — both orderings appear in the same item, so Math.min/max cannot be swapped for either axis without this test catching it.
    expect(
      layoutItemBounds({
        kind: "line",
        x1Pt: 100,
        y1Pt: 5,
        x2Pt: 20,
        y2Pt: 50,
        widthPt: 1,
        color: BLACK,
      }),
    ).toEqual({ minX: 20, minY: 5, maxX: 100, maxY: 50 });
  });

  it("returns undefined for a path with no subpaths at all", () => {
    expect(layoutItemBounds({ kind: "path", subpaths: [] })).toBeUndefined();
  });

  it("bounds a path to the hull of its moveto and line-segment endpoints, each boundary set by a different point", () => {
    // (5,5) is the moveto; (1,8) pushes minX and maxY; (9,2) pushes maxX and minY — no single point sets more than two of the four boundaries, so a broken min/max tracker would show up regardless of which boundary it broke.
    expect(
      layoutItemBounds({
        kind: "path",
        subpaths: [
          {
            startXPt: 5,
            startYPt: 5,
            segments: [
              { kind: "line", xPt: 1, yPt: 8 },
              { kind: "line", xPt: 9, yPt: 2 },
            ],
            closed: false,
          },
        ],
      }),
    ).toEqual({ minX: 1, minY: 2, maxX: 9, maxY: 8 });
  });

  it("bounds a path with only a moveto and no segments to that single point", () => {
    // With no segments at all, the moveto's own visit() call is the ONLY thing that can ever populate the bounds — omitting it would leave minX at +Infinity, wrongly reporting no bounds at all.
    expect(
      layoutItemBounds({
        kind: "path",
        subpaths: [{ startXPt: 7, startYPt: 9, segments: [], closed: false }],
      }),
    ).toEqual({ minX: 7, minY: 9, maxX: 7, maxY: 9 });
  });

  it("bounds a cubic segment to the hull of its own control points too, not just its endpoint", () => {
    // The control points (20,0) and (0,20) sit well outside the moveto (0,0) / final endpoint (5,5) — omitting either visit(c1)/visit(c2) call would shrink the bounds to just the endpoint pair.
    expect(
      layoutItemBounds({
        kind: "path",
        subpaths: [
          {
            startXPt: 0,
            startYPt: 0,
            segments: [
              {
                kind: "cubic",
                c1xPt: 20,
                c1yPt: 0,
                c2xPt: 0,
                c2yPt: 20,
                xPt: 5,
                yPt: 5,
              },
            ],
            closed: false,
          },
        ],
      }),
    ).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
  });
});

describe("boundingBox", () => {
  it("computes the min/max independently for x and y, not by summing or defaulting to the first or last item", () => {
    // Each boundary is set by a DIFFERENT one of the first two items, and the third item holds none of the four extremes at all — so an "always update" bug (ignoring the comparison entirely) would leave the LAST item's own values in place instead of the genuine extremes.
    const items = [
      boundedAt({ minX: 1, minY: 90, maxX: 9, maxY: 99 }), // sets minX, maxY
      boundedAt({ minX: 50, minY: 2, maxX: 90, maxY: 40 }), // sets minY, maxX
      boundedAt({ minX: 20, minY: 20, maxX: 30, maxY: 30 }), // dominated entirely by the other two
    ];
    expect(boundingBox(items)).toEqual({
      xPt: 1,
      yPt: 2,
      widthPt: 89,
      heightPt: 97,
    });
  });
});

describe("itemScale", () => {
  it("returns the smaller of the two axis extents", () => {
    const smallExtent = 3;
    const largeExtent = 10;
    expect(
      itemScale({ minX: 0, minY: 0, maxX: largeExtent, maxY: smallExtent }),
    ).toBe(smallExtent);
    const smallerExtent = 2;
    expect(
      itemScale({ minX: 0, minY: 0, maxX: smallerExtent, maxY: largeExtent }),
    ).toBe(smallerExtent);
  });

  it("computes each extent as a genuine subtraction, not a sum, when the minimum is nonzero", () => {
    // minX(5) is nonzero: maxX - minX = 3 (the smaller extent), but maxX + minX = 13 — only the subtraction gives the right answer.
    const minX = 5;
    const maxX = 8;
    const extent = 3;
    expect(itemScale({ minX, minY: 0, maxX, maxY: 100 })).toBe(extent);
  });
});
