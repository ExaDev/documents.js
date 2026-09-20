import { describe, expect, it } from "vitest";
import type { LayoutText } from "./layout";
import { readPdf } from "./read";
import { compositeFontWritingModePdf } from "./test-support/pdf";

// Vertical writing mode (ExaDev/documents.js#1358). A composite font whose /Encoding CMap selects writing mode 1 advances its glyphs DOWN the page, not across it, using the descendant CIDFont's own vertical metrics (/DW2 and /W2) rather than its horizontal widths, and paints each glyph offset from the vertical origin by that glyph's position vector. Reading it as horizontal stacks a whole column of text on top of itself at one point.
//
// Every figure below is exact rather than font-dependent: the fixture's two CIDs are each 1000/1000 em wide, shown at 20pt from (100, 700), so one em is exactly 20pt of page space.

const SIZE_PT = 20;
const ORIGIN_X_PT = 100;
const ORIGIN_Y_PT = 700;
const GLYPH_COUNT = 2;

function textItems(bytes: Uint8Array<ArrayBuffer>): LayoutText[] {
  const page = readPdf(bytes).pages[0];
  return (page?.items ?? []).filter(
    (item): item is LayoutText => item.kind === "text",
  );
}

describe("Identity-V", () => {
  const items = (): LayoutText[] =>
    textItems(compositeFontWritingModePdf({ encoding: "/Identity-V" }));

  it("recovers the shown text", () => {
    expect(items()[0]?.text).toBe("あい");
  });

  it("marks the run as vertically set", () => {
    expect(items()[0]?.writingMode).toBe("vertical");
  });

  it("advances the run down the page by one em per glyph", () => {
    // The default /DW2 vertical displacement is -1000/1000 em, so two glyphs at 20pt cover 40pt downward, and widthPt reports that advance along the column.
    expect(items()[0]?.widthPt).toBeCloseTo(SIZE_PT * GLYPH_COUNT, 6);
  });

  it("places the run's origin at the first glyph's own painted position", () => {
    // The default position vector is (w0/2, 880/1000) em: half the glyph's horizontal width to the left, and 880/1000 of an em below the vertical origin.
    const item = items()[0];
    expect(item?.xPt).toBeCloseTo(ORIGIN_X_PT - SIZE_PT / 2, 6);
    expect(item?.yPt).toBeCloseTo(ORIGIN_Y_PT - SIZE_PT * 0.88, 6);
  });

  it("leaves the glyphs themselves unrotated", () => {
    // Vertical setting stacks upright glyphs down a column; it does not turn them on their side, so the text rendering matrix carries no rotation and rotationDeg must not claim one.
    expect(items()[0]?.rotationDeg).toBe(undefined);
  });
});

describe("Identity-H", () => {
  const items = (): LayoutText[] =>
    textItems(compositeFontWritingModePdf({ encoding: "/Identity-H" }));

  it("advances the run across the page and reports no writing mode", () => {
    const item = items()[0];
    expect(item?.writingMode).toBe(undefined);
    expect(item?.xPt).toBeCloseTo(ORIGIN_X_PT, 6);
    expect(item?.yPt).toBeCloseTo(ORIGIN_Y_PT, 6);
    expect(item?.widthPt).toBeCloseTo(SIZE_PT * GLYPH_COUNT, 6);
  });
});

describe("predefined vertical CMaps", () => {
  it("reads writing mode 1 from a predefined CMap's own -V suffix", () => {
    const item = textItems(
      compositeFontWritingModePdf({ encoding: "/UniJIS-UCS2-V" }),
    )[0];
    expect(item?.writingMode).toBe("vertical");
  });

  it("reads writing mode 0 from the matching horizontal CMap", () => {
    const item = textItems(
      compositeFontWritingModePdf({ encoding: "/UniJIS-UCS2-H" }),
    )[0];
    expect(item?.writingMode).toBe(undefined);
  });

  it("treats the bare V CMap as vertical", () => {
    const item = textItems(compositeFontWritingModePdf({ encoding: "/V" }))[0];
    expect(item?.writingMode).toBe("vertical");
  });

  it("does not mistake a name merely ending in the letter V for a vertical CMap", () => {
    const item = textItems(
      compositeFontWritingModePdf({ encoding: "/ETenms-B5-UCS2" }),
    )[0];
    expect(item?.writingMode).toBe(undefined);
  });
});

describe("an embedded CMap stream", () => {
  it("reads writing mode 1 from the stream's own /WMode", () => {
    const item = textItems(
      compositeFontWritingModePdf({
        encoding: "9 0 R",
        encodingStream: "<< /Type /CMap /CMapName /Custom-V /WMode 1 >>",
      }),
    )[0];
    expect(item?.writingMode).toBe("vertical");
  });

  it("reads writing mode 0 from a stream that states it", () => {
    const item = textItems(
      compositeFontWritingModePdf({
        encoding: "9 0 R",
        encodingStream: "<< /Type /CMap /CMapName /Custom-H /WMode 0 >>",
      }),
    )[0];
    expect(item?.writingMode).toBe(undefined);
  });

  it("treats a stream with no /WMode as horizontal", () => {
    const item = textItems(
      compositeFontWritingModePdf({
        encoding: "9 0 R",
        encodingStream: "<< /Type /CMap /CMapName /Custom >>",
      }),
    )[0];
    expect(item?.writingMode).toBe(undefined);
  });
});

describe("/DW2 and /W2", () => {
  it("advances by an explicit /DW2 displacement instead of the default one", () => {
    // /DW2 [880 -500] halves the per-glyph advance, so two glyphs cover one em rather than two.
    const item = textItems(
      compositeFontWritingModePdf({
        encoding: "/Identity-V",
        verticalMetrics: "/DW2 [880 -500]",
      }),
    )[0];
    expect(item?.widthPt).toBeCloseTo(SIZE_PT, 6);
  });

  it("takes the position vector's y from /DW2", () => {
    const item = textItems(
      compositeFontWritingModePdf({
        encoding: "/Identity-V",
        verticalMetrics: "/DW2 [500 -1000]",
      }),
    )[0];
    expect(item?.yPt).toBeCloseTo(ORIGIN_Y_PT - SIZE_PT * 0.5, 6);
  });

  it("lets /W2 override a single CID's displacement and position vector", () => {
    // The first CID (65) gets a half-em displacement and a position vector of (200, 900)/1000 em; the second falls back to /DW2's default full em. The run therefore covers 10pt plus 20pt, and starts 200/1000 em left and 900/1000 em below its vertical origin.
    const item = textItems(
      compositeFontWritingModePdf({
        encoding: "/Identity-V",
        verticalMetrics: "/W2 [65 [-500 200 900]]",
      }),
    )[0];
    expect(item?.widthPt).toBeCloseTo(SIZE_PT * 0.5 + SIZE_PT, 6);
    expect(item?.xPt).toBeCloseTo(ORIGIN_X_PT - SIZE_PT * 0.2, 6);
    expect(item?.yPt).toBeCloseTo(ORIGIN_Y_PT - SIZE_PT * 0.9, 6);
  });

  it("applies a /W2 range to every CID it covers", () => {
    const item = textItems(
      compositeFontWritingModePdf({
        encoding: "/Identity-V",
        verticalMetrics: "/W2 [65 66 -250 100 800]",
      }),
    )[0];
    expect(item?.widthPt).toBeCloseTo(SIZE_PT * 0.5, 6);
    expect(item?.xPt).toBeCloseTo(ORIGIN_X_PT - SIZE_PT * 0.1, 6);
    expect(item?.yPt).toBeCloseTo(ORIGIN_Y_PT - SIZE_PT * 0.8, 6);
  });
});
