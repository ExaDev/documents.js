import type { MathBox, MathLayoutItem } from "document-schema.js";

export const EMPTY_BOX: MathBox = {
  widthPt: 0,
  heightPt: 0,
  ascentPt: 0,
  descentPt: 0,
  items: [],
};

// Translates every item in `items` by (dxPt, dyPt) -- the one place this module touches an individual MathLayoutItem's own coordinate fields, since MathStroke's points and MathAssembledGlyphs' placements are each a nested array unlike MathGlyphRun/MathRule's flat xPt/yPt.
export function shiftItems(
  items: readonly MathLayoutItem[],
  dxPt: number,
  dyPt: number,
): MathLayoutItem[] {
  if (dxPt === 0 && dyPt === 0) {
    return [...items];
  }
  return items.map((item) => {
    if (item.kind === "stroke") {
      return {
        ...item,
        points: item.points.map((p) => ({
          xPt: p.xPt + dxPt,
          yPt: p.yPt + dyPt,
        })),
      };
    }
    if (item.kind === "assembled-glyphs") {
      return {
        ...item,
        placements: item.placements.map((p) => ({
          glyphId: p.glyphId,
          xPt: p.xPt + dxPt,
          yPt: p.yPt + dyPt,
        })),
      };
    }
    return { ...item, xPt: item.xPt + dxPt, yPt: item.yPt + dyPt };
  });
}

// Embeds `child` into a box whose own overall ascent is `overallAscentPt`, at horizontal offset `dxPt`, with the child's own baseline shifted `baselineOffsetPt` below the box's main baseline (negative = above -- a superscript or an mfrac numerator; positive = below -- a subscript or an mfrac denominator; zero = the ordinary same-baseline case every mrow child uses). This is the single placement primitive every composing construct in layout.ts (mrow, msub/msup/msubsup, mfrac's numerator/denominator) shares, derived once here: the child's own baseline sits at `child.ascentPt` from ITS OWN top, and needs to land at `overallAscentPt + baselineOffsetPt` from the PARENT box's top, so the y-shift to apply is the difference of those two.
export function placeChild(
  child: MathBox,
  dxPt: number,
  baselineOffsetPt: number,
  overallAscentPt: number,
): readonly MathLayoutItem[] {
  const dyPt = overallAscentPt + baselineOffsetPt - child.ascentPt;
  return shiftItems(child.items, dxPt, dyPt);
}

// Concatenates `boxes` left to right, every child's own baseline aligned to one shared baseline (the standard mrow merge) -- ascent/descent of the result are the max across children, and each child is placed via placeChild with baselineOffsetPt=0. `gapsPt[i]` (default 0) is extra horizontal space inserted BEFORE boxes[i] (i>0), letting a caller thread MathML operator lspace/rspace into the same pass without a second traversal.
export function concatBoxesHorizontally(
  boxes: readonly MathBox[],
  gapsPt: readonly number[] = [],
): MathBox {
  const ascentPt = boxes.reduce((max, b) => Math.max(max, b.ascentPt), 0);
  const descentPt = boxes.reduce((max, b) => Math.max(max, b.descentPt), 0);
  const items: MathLayoutItem[] = [];
  let cursorXPt = 0;
  boxes.forEach((box, index) => {
    cursorXPt += gapsPt[index] ?? 0;
    items.push(...placeChild(box, cursorXPt, 0, ascentPt));
    cursorXPt += box.widthPt;
  });
  return {
    widthPt: cursorXPt,
    ascentPt,
    descentPt,
    heightPt: ascentPt + descentPt,
    items,
  };
}
