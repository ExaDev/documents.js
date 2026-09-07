import { describe, expect, it } from "vitest";
import type { LayoutItem, LayoutRect } from "pdf-codec";
import {
  detectGridLattice,
  extractLineCandidates,
  findCellRegions,
} from "./lattice";

const BLACK = { r: 0, g: 0, b: 0 };

function rect(overrides: {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
}): LayoutRect {
  return { kind: "rect", fill: BLACK, ...overrides };
}

function line(x1Pt: number, y1Pt: number, x2Pt: number, y2Pt: number) {
  return {
    kind: "line" as const,
    x1Pt,
    y1Pt,
    x2Pt,
    y2Pt,
    color: BLACK,
    widthPt: 1,
  };
}

// A real-world publisher pattern several production PDFs use to draw a table's gridlines: a thin filled rectangle (fill only, no stroke) rather than a genuinely stroked LayoutLine/LayoutPath -- confirmed directly against real documents, where every observed gridline rect measured 0.12-2.30pt thick on its short axis. extractLineCandidates must recognise this shape alongside the line/path shapes it already accepts.
describe("extractLineCandidates: thin filled rects as drawn gridlines", () => {
  it("reads a wide, thin rect as a horizontal line segment along its long axis", () => {
    const items: LayoutItem[] = [
      rect({ xPt: 10, yPt: 99.75, widthPt: 200, heightPt: 0.5 }),
    ];
    expect(extractLineCandidates(items)).toEqual([
      { item: items[0], x1Pt: 10, y1Pt: 100, x2Pt: 210, y2Pt: 100 },
    ]);
  });

  it("reads a tall, thin rect as a vertical line segment along its long axis", () => {
    const items: LayoutItem[] = [
      rect({ xPt: 49.75, yPt: 5, widthPt: 0.5, heightPt: 150 }),
    ];
    expect(extractLineCandidates(items)).toEqual([
      { item: items[0], x1Pt: 50, y1Pt: 5, x2Pt: 50, y2Pt: 155 },
    ]);
  });

  it("ignores a rect that is thin on neither axis (a genuine filled block, a cell shading/background)", () => {
    const items: LayoutItem[] = [
      rect({ xPt: 0, yPt: 0, widthPt: 100, heightPt: 40 }),
    ];
    expect(extractLineCandidates(items)).toEqual([]);
  });

  it("ignores a small square rect (thin on neither axis relative to the other -- a corner-joint artefact, not a line)", () => {
    const items: LayoutItem[] = [
      rect({ xPt: 0, yPt: 0, widthPt: 0.72, heightPt: 0.72 }),
    ];
    expect(extractLineCandidates(items)).toEqual([]);
  });

  it("still requires the resulting segment to clear the existing minimum-length threshold once classified (extractLineCandidates itself does not filter by length, classifyAxisLine does)", () => {
    // A thin-but-short rect produces a candidate segment here; detectGridLattice below (which runs classification + the length threshold) is what actually rejects it -- this test documents that division of responsibility rather than duplicating the length check in extractLineCandidates.
    const items: LayoutItem[] = [
      rect({ xPt: 0, yPt: 0, widthPt: 2, heightPt: 0.5 }),
    ];
    expect(extractLineCandidates(items)).toHaveLength(1);
  });
});

describe("detectGridLattice: rect-drawn lattices", () => {
  function rectLatticeItems(): LayoutItem[] {
    const THICKNESS = 0.5;
    return [
      rect({
        xPt: 0,
        yPt: 200 - THICKNESS / 2,
        widthPt: 300,
        heightPt: THICKNESS,
      }),
      rect({
        xPt: 0,
        yPt: 150 - THICKNESS / 2,
        widthPt: 300,
        heightPt: THICKNESS,
      }),
      rect({
        xPt: 0,
        yPt: 100 - THICKNESS / 2,
        widthPt: 300,
        heightPt: THICKNESS,
      }),
      rect({
        xPt: 0 - THICKNESS / 2,
        yPt: 100,
        widthPt: THICKNESS,
        heightPt: 100,
      }),
      rect({
        xPt: 120 - THICKNESS / 2,
        yPt: 100,
        widthPt: THICKNESS,
        heightPt: 100,
      }),
      rect({
        xPt: 300 - THICKNESS / 2,
        yPt: 100,
        widthPt: THICKNESS,
        heightPt: 100,
      }),
    ];
  }

  it("detects a full lattice drawn entirely as thin filled rects", () => {
    const lattice = detectGridLattice(rectLatticeItems());
    expect(lattice?.rowBoundariesDescPt).toEqual([200, 150, 100]);
    expect(lattice?.columnBoundariesAscPt).toEqual([0, 120, 300]);
  });

  it("does not detect a lattice from a couple of large filled cells alone (no thin rects at all)", () => {
    const items: LayoutItem[] = [
      rect({ xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 }),
      rect({ xPt: 100, yPt: 0, widthPt: 100, heightPt: 100 }),
    ];
    expect(detectGridLattice(items)).toBeUndefined();
  });
});

// ExaDev/documents.js#1077: detectGridLattice used to dedupe every line candidate on the WHOLE page into one shared rowLines/columnLines set before testing closure, so a rule that had nothing to do with the real table -- drawn anywhere else on the page -- could still corrupt the one outer-rectangle test the whole page shared. Clustering first (segmentsCross/clusterSegments) fixes this by testing closure per connected component instead: a candidate line only joins the real table's cluster if it actually crosses one of the table's own perpendicular lines.
describe("detectGridLattice: clustering keeps unrelated page furniture out of the real table's outer rectangle (ExaDev/documents.js#1077)", () => {
  // A real 3x3 (row x column) lattice, geometrically identical to rectLatticeItems() above but drawn as genuine LayoutLines.
  function tableLines() {
    return [
      line(0, 200, 300, 200),
      line(0, 150, 300, 150),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(120, 100, 120, 200),
      line(300, 100, 300, 200),
    ];
  }

  it("ignores a page-wide header rule and footer rule that never reach any of the table's own column lines", () => {
    const items: LayoutItem[] = [
      ...tableLines(),
      line(0, 240, 300, 240), // header rule, full page width, well above the table
      line(0, 20, 300, 20), // footer rule, full page width, well below the table
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([200, 150, 100]);
    expect(lattice?.columnBoundariesAscPt).toEqual([0, 120, 300]);
  });

  it("ignores a caption underline sitting just above the table's own top edge", () => {
    const items: LayoutItem[] = [
      ...tableLines(),
      line(90, 214, 170, 214), // a caption's own underline, narrower than the table and 14pt above its real top edge
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([200, 150, 100]);
    expect(lattice?.columnBoundariesAscPt).toEqual([0, 120, 300]);
  });
});

// ExaDev/documents.js#1077: a border interrupted by one real gap (a single row whose own side rule a producer never drew) is still overwhelmingly a drawn boundary. The old bestRunCoverageRatio scored an edge by its longest unbroken run alone, so a border ~97% drawn but interrupted once by a small gap scored under 50% and failed EDGE_COVERAGE_RATIO; unionCoverageRatio sums every drawn range instead.
describe("detectGridLattice: a border interrupted by one small gap still closes the rectangle (ExaDev/documents.js#1077)", () => {
  it("detects the lattice when the left column is drawn as two segments with a small real gap between them", () => {
    const items: LayoutItem[] = [
      line(0, 300, 300, 300), // top row divider, fully drawn
      line(0, 200, 300, 200), // interior row divider, fully drawn
      line(0, 100, 300, 100), // bottom row divider, fully drawn
      line(0, 100, 0, 197), // left column, lower segment
      line(0, 203, 0, 300), // left column, upper segment -- 6pt gap out of a 200pt span (97% union coverage, ~48.5% best-run)
      line(150, 100, 150, 300), // interior column divider, fully drawn
      line(300, 100, 300, 300), // right column, fully drawn
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([300, 200, 100]);
    expect(lattice?.columnBoundariesAscPt).toEqual([0, 150, 300]);
  });
});

// A real NGED specification's page (novus-power/hive#1397) crashed pdfToMarkdown with "Maximum call stack size exceeded" -- not from recursion, but from Math.min(...cells.map(...))/Math.max(...cells.map(...)) spreading a merged region's cell list into a function call, which throws once the array exceeds the JS engine's own argument-count limit (V8's is roughly 65536-125000 depending on version). A page whose line detection turns up a dense or malformed grid can merge tens of thousands of atomic cells into one region with no drawn boundary between them.
describe("findCellRegions: a merged region far larger than the JS engine's argument-count limit", () => {
  it("computes the region's bounds without spreading the cell list into Math.min/max", () => {
    const rowCount = 200_000;
    // Two columns, kept apart by one fully-drawn divider at position 1; every one of the 200,000 interior row dividers is undrawn, so each column merges top-to-bottom into a single region of 200,000 cells -- two regions, each far past the argument-count limit a naive Math.min(...cells) would hit. Every line needs its own distinct position: two dividers sharing a position give unionCoverageRatio a zero-length span, which it treats as fully covered regardless of ranges.
    const rowLines = Array.from({ length: rowCount + 1 }, (_, i) => ({
      position: i,
      ranges: [],
      items: [],
    }));
    const columnLines = [
      { position: 0, ranges: [], items: [] },
      { position: 1, ranges: [{ startPt: -1e12, endPt: 1e12 }], items: [] },
      { position: 2, ranges: [], items: [] },
    ];

    const regions = findCellRegions(rowLines, columnLines);

    expect(regions).toEqual([
      { rowStart: 0, rowEnd: rowCount, colStart: 0, colEnd: 1 },
      { rowStart: 0, rowEnd: rowCount, colStart: 1, colEnd: 2 },
    ]);
  });
});
