import { describe, expect, it } from "vitest";
import type { LayoutItem, LayoutPage, LayoutText } from "pdf-codec";
import type { LayoutFont } from "document-schema.js";
import { segmentPdfRegions } from "./pdf-regions";

// Builders local to this test file, the same pattern regions.test.ts uses for its own sheet-cell builders: pdf-codec's LayoutItem family carries several required fields (font, color, sizePt) no test here actually varies, so a fixed default keeps every fixture focused on the one or two fields that matter for the case at hand.
const FONT: LayoutFont = {
  family: "Helvetica",
  weight: "normal",
  style: "normal",
};
const BLACK = { r: 0, g: 0, b: 0 };

// A line of text is one LayoutItem, matching how a PDF content stream typically emits one contiguous run per Tj -- widthPt is derived from a rough average glyph advance (0.5em per character) rather than hand-computed per fixture, since these tests only care about relative scale (a gutter/gap being comfortably wider or narrower than a line's own font size), not exact glyph metrics.
function line(xPt: number, yPt: number, text: string, sizePt = 10): LayoutText {
  return {
    kind: "text",
    text,
    xPt,
    yPt,
    font: FONT,
    sizePt,
    color: BLACK,
    widthPt: text.length * sizePt * 0.5,
  };
}

function page(items: LayoutItem[]): LayoutPage {
  return { widthPt: 612, heightPt: 792, items };
}

describe("segmentPdfRegions", () => {
  it("returns nothing for a page with no items", () => {
    expect(segmentPdfRegions(page([]))).toEqual([]);
  });

  it("excludes link/internalLink annotations from segmentation", () => {
    const regions = segmentPdfRegions(
      page([
        line(50, 700, "Some prose text here to read."),
        line(50, 686, "Continuing on the very next line below."),
        {
          kind: "link",
          uri: "https://example.com",
          xPt: 50,
          yPt: 680,
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
    const lines = Array.from({ length: 6 }, (_, index) =>
      line(
        50,
        700 - index * 14,
        "The quick brown fox jumps over the lazy dog.",
      ),
    );
    const regions = segmentPdfRegions(page(lines));
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("column");
    expect(regions[0]?.items).toHaveLength(6);
  });

  it("splits a two-column layout at the gutter, classifying each column independently", () => {
    // Short lines, well short of the 200pt gutter, so the gutter is unambiguously wider than either column's own line-height-derived scale. The right column's own line rhythm is deliberately offset from the left's (a different line spacing, 15pt vs 14pt) -- two independent flowing-text columns never share a synchronised row-for-row rhythm in practice, and the offset here is what keeps isRowAlignedGrid from mistaking this for one table's rows.
    const leftColumn = Array.from({ length: 8 }, (_, index) =>
      line(50, 700 - index * 14, "Left column body text."),
    );
    const rightColumn = Array.from({ length: 7 }, (_, index) =>
      line(250, 693 - index * 15, "Right column text."),
    );
    const regions = segmentPdfRegions(page([...leftColumn, ...rightColumn]));

    expect(regions).toHaveLength(2);
    const [left, right] = [...regions].sort(
      (a, b) => a.bounds.xPt - b.bounds.xPt,
    );
    expect(left?.classification).toBe("column");
    expect(left?.items).toHaveLength(8);
    expect(right?.classification).toBe("column");
    expect(right?.items).toHaveLength(7);
  });

  it("classifies a ruled grid of rows and aligned columns as a table, not per-column prose", () => {
    const headers = ["Name", "Age", "City"];
    const rows = [
      ["Alice", "34", "Leeds"],
      ["Bob", "29", "York"],
      ["Carol", "41", "Hull"],
      ["Dave", "37", "Ripon"],
    ];
    const columnX = [50, 200, 320];
    const items: LayoutItem[] = [];
    [headers, ...rows].forEach((row, rowIndex) => {
      const yPt = 700 - rowIndex * 16;
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
    const figure: LayoutItem = {
      kind: "image",
      imageId: "img-1",
      xPt: 100,
      yPt: 500,
      widthPt: 300,
      heightPt: 200,
    };
    // A photo this size' own scale (min(300, 200) = 200pt) would swamp a global gap threshold; the caption gap below is well clear of the LOCAL threshold (1.5 * the caption's own ~10pt font size) that this module actually uses.
    const caption = line(150, 470, "Figure 1: a chart of quarterly results.");
    const proseAbove = Array.from({ length: 4 }, (_, index) =>
      line(
        100,
        760 - index * 14,
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
    // order to classify it, and used to drop the answer -- so a consumer wanting a figure's own label
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
    expect(proseRegion?.items).toHaveLength(4);
  });

  it("gives a figure the nearer of two candidate captions", () => {
    // A figure sandwiched between two short runs has two candidates and only one is its label. The same
    // gap that decides a caption's own confidence decides which figure wins it, so the nearer text is
    // the one recorded on the figure.
    //
    // Both gaps sit in a narrow window the segmentation forces: wider than the LOCAL cut threshold
    // (1.5x the caption's own ~10pt font size, so ~15pt -- below that the run is not split off as its
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
    // agree and the test proves nothing -- verified by mutating the comparison to `if (true)`, under
    // which the earlier version of this case still passed.
    const above = line(150, 618, "Figure 2: the nearer caption.");
    const below = line(150, 368, "Further away, below the figure.");

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
    // Far below the figure -- well past CAPTION_GAP_PT -- so this should stay unclassified rather than being claimed as the figure's caption.
    const farText = line(
      100,
      100,
      "An unrelated short line near the bottom of the page.",
    );

    const regions = segmentPdfRegions(page([figure, farText]));
    const captionRegion = regions.find(
      (region) => region.classification === "caption",
    );
    expect(captionRegion).toBeUndefined();
  });

  it("reports a single small item as unknown, carrying no structural signal", () => {
    const regions = segmentPdfRegions(page([line(50, 700, "x")]));
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("unknown");
    expect(regions[0]?.confidence).toBe(1);
  });

  it("sorts regions top to bottom, then left to right, matching reading order", () => {
    const items = [
      line(300, 500, "Bottom right area of the page with more text here."),
      line(50, 700, "Top left area of the page with more text here too."),
    ];
    const regions = segmentPdfRegions(page(items));
    expect(regions.length).toBeGreaterThanOrEqual(1);
    if (regions.length === 2) {
      expect(regions[0]?.bounds.yPt).toBeGreaterThan(
        regions[1]?.bounds.yPt ?? 0,
      );
    }
  });
});
