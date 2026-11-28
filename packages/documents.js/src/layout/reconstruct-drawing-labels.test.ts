import { describe, expect, it } from "vitest";
import type { ContentParagraph } from "document-schema.js";
import {
  LAYOUT_FORMAT_VERSION,
  readPdf,
  writePdf,
  type LayoutDocument,
  type LayoutText,
} from "pdf-codec";
import { reconstructWordprocessing } from "./reconstruct";

// An engineering drawing's sheet, written to a real PDF and read back, so the runs reconstruction meets carry the widths pdf-codec measures from the font rather than ones a test states (ExaDev/documents.js#1846). Its upright title block outweighs the labels, so the sheet is read in its own frame, as a drawing whose dimension labels are turned is.

const LABEL_PT = 7.5;
const FIGURE_PT = 11;

// Helvetica's advance for a digit, as a fraction of an em: its AFM states `WX 556`, in thousandths, for every figure.
const HELVETICA_DIGIT_ADVANCE_EM = 0.556;

// The share of a digit's own advance a figure set under tight character spacing steps by, so each glyph's measured advance runs past the next glyph's start by a tenth of the glyph.
const TIGHT_STEP_SHARE = 0.9;

function run(
  text: string,
  xPt: number,
  yPt: number,
  sizePt: number,
  rotationDeg?: number,
): LayoutText {
  return {
    kind: "text",
    text,
    xPt,
    yPt,
    sizePt,
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    color: { r: 0, g: 0, b: 0 },
    ...(rotationDeg === undefined ? {} : { rotationDeg }),
  };
}

// A figure drawn one glyph at a time, each glyph `stepPt` after the one before, as a CAD export draws a dimension.
function glyphByGlyph(
  figure: string,
  xPt: number,
  yPt: number,
  sizePt: number,
  stepPt: number,
): LayoutText[] {
  return Array.from(figure).map((glyph, index) =>
    run(glyph, xPt + index * stepPt, yPt, sizePt),
  );
}

function drawingSheet(): Uint8Array<ArrayBuffer> {
  const layout: LayoutDocument = {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {},
    images: {},
    pages: [
      {
        widthPt: 1190,
        heightPt: 842,
        items: [
          run(
            "Single line diagram of the auxiliary supplies panel",
            100,
            800,
            LABEL_PT,
          ),
          run(
            "All dimensions are in millimetres unless stated otherwise",
            100,
            790,
            LABEL_PT,
          ),
          // Two dimension labels turned a quarter turn on one vertical baseline, 600pt apart along it.
          run("(Load : 6000W)", 263.5, 100, LABEL_PT, 90),
          run("(Load : 5000W)", 263.5, 700, LABEL_PT, 90),
          run("Scale 1:", 100, 400, FIGURE_PT),
          ...glyphByGlyph(
            "2500",
            140,
            400,
            FIGURE_PT,
            HELVETICA_DIGIT_ADVANCE_EM * FIGURE_PT * TIGHT_STEP_SHARE,
          ),
        ],
      },
    ],
  };
  // readPdf takes bytes on an ArrayBuffer of their own, which a copy always has.
  return new Uint8Array(writePdf(layout));
}

function paragraphTexts(bytes: Uint8Array<ArrayBuffer>): string[] {
  const doc = reconstructWordprocessing(readPdf(bytes));
  if (doc.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return doc.sections.flatMap((section) =>
    section.blocks
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .map((paragraph) => paragraph.runs.map((r) => r.text).join("")),
  );
}

describe("reconstructWordprocessing: a drawing sheet read back from a PDF", () => {
  it("keeps both of two similar labels turned a quarter turn on one baseline", () => {
    const texts = paragraphTexts(drawingSheet());
    expect(texts.some((t) => t.includes("(Load : 6000W)"))).toBe(true);
    expect(texts.some((t) => t.includes("(Load : 5000W)"))).toBe(true);
  });

  it("keeps every digit of an upright figure drawn glyph by glyph under tight spacing", () => {
    const texts = paragraphTexts(drawingSheet());
    expect(texts.some((t) => t.includes("1:2500"))).toBe(true);
  });
});
