import type { MathColor, MathRule, MathStroke } from "document-schema.js";

// Builds a real, hand-drawn radical sign -- a short down-then-up hook (MathStroke) plus a horizontal vinculum (MathRule) over the radicand -- rather than substituting the font's own bare U+221A glyph, which has no way to extend its own vinculum to cover an arbitrary-width radicand. Proportions are fixed fractions of the sign's own total height (signHeightPt = radicalExtraAscenderPt + ruleThicknessPt + gapPt + radicand.heightPt, computed by the caller), matching the classic three-segment radical shape real typesetting systems draw: a short initial downstroke, a longer diagonal upstroke to the sign's own top-left corner, then the vinculum running right from there across the full radicand width. `originXPt`/`originYPt` place the sign's own top-left corner (the bounding box corner, not any one stroke point) in the caller's coordinate space.
export interface RadicalSign {
  readonly hook: MathStroke;
  readonly vinculum: MathRule;
  readonly widthPt: number; // the hook's own horizontal footprint -- callers place the radicand starting at originXPt + widthPt
}

// Fixed proportions of the sign's own total height -- not font metrics (a hand-drawn shape has no font to measure), but not arbitrary either: they reproduce the classic radical silhouette (a short shallow tick, then a long steep upstroke to the vinculum) that every real √ glyph, hand-drawn or not, shares.
const TICK_START_Y_FRACTION = 0.55; // the hook's first point, measured down from the sign's own top
const TICK_END_Y_FRACTION = 0.98; // the hook's lowest point, near (not quite at) the very bottom
const TICK_WIDTH_FRACTION = 0.16; // horizontal run of the short initial downstroke
const HOOK_WIDTH_FRACTION = 0.38; // horizontal run of the long upstroke, from the tick's low point to the sign's own top-left
const SIGN_TOP_Y_FRACTION = 0.04; // the vinculum's own y, just shy of the sign's absolute top (leaves a hair of headroom, matching real radical glyphs which never touch their own bounding box's top edge)

export function buildRadicalSign(
  originXPt: number,
  originYPt: number,
  signHeightPt: number,
  radicandWidthPt: number,
  ruleThicknessPt: number,
  color: MathColor,
): RadicalSign {
  const tickStartY = originYPt + signHeightPt * TICK_START_Y_FRACTION;
  const tickEndY = originYPt + signHeightPt * TICK_END_Y_FRACTION;
  const topY = originYPt + signHeightPt * SIGN_TOP_Y_FRACTION;
  const tickWidthPt = signHeightPt * TICK_WIDTH_FRACTION;
  const hookWidthPt = signHeightPt * HOOK_WIDTH_FRACTION;

  const hook: MathStroke = {
    kind: "stroke",
    points: [
      { xPt: originXPt, yPt: tickStartY },
      { xPt: originXPt + tickWidthPt, yPt: tickEndY },
      { xPt: originXPt + hookWidthPt, yPt: topY },
    ],
    widthPt: ruleThicknessPt,
    color,
  };

  const vinculum: MathRule = {
    kind: "rule",
    xPt: originXPt + hookWidthPt,
    yPt: topY,
    widthPt: radicandWidthPt,
    heightPt: ruleThicknessPt,
    color,
  };

  return { hook, vinculum, widthPt: hookWidthPt };
}
