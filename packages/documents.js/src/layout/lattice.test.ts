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

// A real NGED specification's page (novus-power/hive#1397) crashed pdfToMarkdown with "Maximum call stack size exceeded" -- not from recursion, but from Math.min(...cells.map(...))/Math.max(...cells.map(...)) spreading a merged region's cell list into a function call, which throws once the array exceeds the JS engine's own argument-count limit (V8's is roughly 65536-125000 depending on version). A page whose line detection turns up a dense or malformed grid can merge tens of thousands of atomic cells into one region with no drawn boundary between them.
describe("findCellRegions: a merged region far larger than the JS engine's argument-count limit", () => {
  it("computes the region's bounds without spreading the cell list into Math.min/max", () => {
    const rowCount = 200_000;
    // Two columns, kept apart by one fully-drawn divider at position 1; every one of the 200,000 interior row dividers is undrawn, so each column merges top-to-bottom into a single region of 200,000 cells -- two regions, each far past the argument-count limit a naive Math.min(...cells) would hit. Every line needs its own distinct position: two dividers sharing a position give bestRunCoverageRatio a zero-length span, which it treats as fully covered regardless of ranges.
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
