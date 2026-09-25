import type { LayoutText } from "pdf-codec";
import type { LayoutFont } from "document-schema.js";
import type { BoundedItem } from "../outline/pdf-regions";
import { layoutItemBounds } from "../outline/pdf-regions";

// Builders local to this test file, the same pattern regions.test.ts uses for its own sheet-cell builders: pdf-codec's LayoutItem family carries several required fields (font, color, sizePt) no test here actually varies, so a fixed default keeps every fixture focused on the one or two fields that matter for the case at hand.
export const FONT: LayoutFont = {
  family: "Helvetica",
  weight: "normal",
  style: "normal",
};
export const BLACK = { r: 0, g: 0, b: 0 };

// A line of text is one LayoutItem, matching how a PDF content stream typically emits one contiguous run per Tj — widthPt is derived from a rough average glyph advance (0.5em per character) rather than hand-computed per fixture, since these tests only care about relative scale (a gutter/gap being comfortably wider or narrower than a line's own font size), not exact glyph metrics.
export const DEFAULT_LINE_SIZE_PT = 10;
// vitest's own toBeCloseTo precision (decimal digits), reused everywhere a floating-point score is checked.
export const PRECISION_DIGITS = 10;
export const GLYPH_ADVANCE_EM = 0.5;

export function line(
  xPt: number,
  yPt: number,
  text: string,
  sizePt = DEFAULT_LINE_SIZE_PT,
): LayoutText {
  return {
    kind: "text",
    text,
    xPt,
    yPt,
    font: FONT,
    sizePt,
    color: BLACK,
    widthPt: text.length * sizePt * GLYPH_ADVANCE_EM,
  };
}

// A BoundedItem whose own item content is irrelevant — only `bounds` matters to the function under test (boundingBox, findCut, isRowAlignedGrid's own band-membership).
export function boundedAt(
  bounds: Readonly<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>,
): BoundedItem {
  return { item: line(0, 0, "x"), bounds };
}

// A BoundedItem wrapping a real text item, with bounds computed via the real layoutItemBounds (so tests exercising groupIntoLines/cellsInLine through a BoundedItem see genuine, consistent geometry).
export function boundedText(
  xPt: number,
  yPt: number,
  text = "cell",
): BoundedItem {
  const item = line(xPt, yPt, text);
  return { item, bounds: layoutItemBounds(item)! };
}

export function textItem(
  xPt: number,
  widthPt: number,
  sizePt = 10,
): LayoutText {
  return {
    kind: "text",
    text: "x",
    xPt,
    yPt: 0,
    font: FONT,
    sizePt,
    color: BLACK,
    widthPt,
  };
}
