import { describe, expect, it } from "vitest";
import type { LayoutDocument, LayoutText } from "./layout";
import { LAYOUT_FORMAT_VERSION } from "./layout";
import { readPdf } from "./read";
import { groupPdfTextRuns } from "./text-group";
import { writePdf } from "./write";

// text-group.test.ts exercises the grouping rules against runs stated directly, which is where the exact thresholds can be pinned to the point. This file proves the same rules hold against runs that came out of a real PDF: written by this package's own writer, parsed back by its own reader, and grouped with whatever widths, baselines and rounding that round trip actually produced, rather than with figures a test chose. The page is deliberately small, one page of a handful of runs, because every mutant of the grouper re-runs it.

const HELVETICA = {
  family: "Helvetica",
  weight: "normal",
  style: "normal",
} as const;
const HELVETICA_BOLD = {
  family: "Helvetica",
  weight: "bold",
  style: "normal",
} as const;
const BLACK = { r: 0, g: 0, b: 0 };

function text(
  content: string,
  xPt: number,
  yPt: number,
  sizePt: number,
  bold = false,
): LayoutText {
  return {
    kind: "text",
    text: content,
    xPt,
    yPt,
    font: bold ? HELVETICA_BOLD : HELVETICA,
    sizePt,
    color: BLACK,
  };
}

// A page with the three shapes the grouping has to get right at once: a large heading directly above a small body line, a word broken across a style change, and a table row whose cells are separated by a gutter rather than by spaces.
function samplePage(): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {},
    pages: [
      {
        widthPt: 400,
        heightPt: 300,
        items: [
          text("Results", 40, 250, 30, true),
          text("Measured over four quarters", 40, 238, 9),
          text("Com", 40, 210, 10),
          text("plete", 60.0, 210, 10, true),
          text("ly", 84.0, 210, 10),
          text("Region", 40, 180, 9),
          text("Revenue", 200, 180, 9),
          text("North", 40, 166, 9),
          text("4.2m", 200, 166, 9),
        ],
      },
    ],
    images: {},
  };
}

function groupedLinesOfSamplePage(): string[] {
  const page = readPdf(writePdf(samplePage())).pages[0];
  const runs = (page?.items ?? []).filter(
    (item): item is LayoutText => item.kind === "text",
  );
  return groupPdfTextRuns(runs).map((line) => line.text);
}

describe("groupPdfTextRuns over a PDF this package wrote and read back", () => {
  it("keeps the heading off the line beneath it", () => {
    expect(groupedLinesOfSamplePage()).toContain("Results");
  });

  it("recovers the body line under the heading whole", () => {
    expect(groupedLinesOfSamplePage()).toContain("Measured over four quarters");
  });

  it("joins a word broken across a style change without a space in it", () => {
    expect(groupedLinesOfSamplePage()).toContain("Completely");
  });

  it("keeps a table row's cells apart", () => {
    expect(groupedLinesOfSamplePage()).toContain("Region\tRevenue");
  });

  it("recovers every line of the page in reading order", () => {
    expect(groupedLinesOfSamplePage()).toEqual([
      "Results",
      "Measured over four quarters",
      "Completely",
      "Region\tRevenue",
      "North\t4.2m",
    ]);
  });
});
