import { EMPTY_BOX, concatBoxesHorizontally, placeChild } from "./compose";
import type { LayoutContext } from "./layout";
import type {
  MathBox,
  MathGlyphPlacement,
  MathLayoutItem,
  MathStretchResult,
} from "document-schema.js";
import type { MathMlElement } from "./nodes";
import {
  attrValue,
  elementChildren,
  elementLocalName,
  textContent,
} from "./nodes";
import { isMathVariant } from "./variant";
import { layoutNode } from "./layout";
import { operatorProperties } from "./operators";
// The stretchy-operator and script-layout machinery of MathML layout, split from layout.ts: detecting and building stretched operators, then the constructs that lean on stretching (under/over attachment, movable limits, sub/superscript pairs, row children and semantics/mstyle context selection). layout.ts keeps the token walk, fractions, radicals, tables, space and the node dispatch.
// Whether `element` is an operator that stretches to whatever it wraps or spans — a row's own content (a vertical fence, via stretchRowOperators) or a munder/mover/munderover base's own width (a horizontal over/under-brace, via layoutUnderOverChild). The operator dictionary's own `stretchy` property is the default; MathML lets a document override it per element, and only an explicit stretchy="false" is honoured here, since stretchy="true" cannot make a glyph the font declares no MathVariants construction for stretchable anyway (metrics.stretch simply returns undefined for it and the operator draws at its base size).
export function isStretchyOperator(element: MathMlElement): boolean {
  if (elementLocalName(element) !== "mo") {
    return false;
  }
  if (attrValue(element, "stretchy") === "false") {
    return false;
  }
  return operatorProperties(textContent(element).trim()).stretchy;
}

// The one code point of `text` when it is exactly one code point long, undefined for empty or multi-code-point text: the font's MathVariants data is keyed per glyph, so a multi-character operator has no single construction to look up, and a top-accent attachment point belongs to exactly one glyph. One shared definition for its three callers (vertical stretch, horizontal stretch, accent-attachment resolution) rather than three copies of the same spread-and-count — the multi-code-point branch is reachable through resolveTopAccentXPt's own multi-character-base fallback, keeping it honestly covered rather than dead behind one caller's own guard.
export function singleCodePoint(text: string): number | undefined {
  const codePoints = [...text];
  return codePoints.length === 1 ? codePoints[0]?.codePointAt(0) : undefined;
}

// Turns one resolved stretchy construction into a box holding a single 'assembled-glyphs' item. The construction's own real ink is centred on the maths axis — the default `symmetric` behaviour MathML gives a fence, and the reason a pair of tall brackets lines up with the fraction rule between them rather than with the text baseline — so the drawing origin sits `originAboveBaselinePt` above the shared baseline and the box's own edges land exactly on the ink's own top and bottom.
export function stretchedBox(
  result: MathStretchResult,
  text: string,
  ctx: LayoutContext,
): MathBox {
  const axisPt = ctx.metrics.axisHeightPt;
  const inkHeightPt = result.inkAscentPt + result.inkDescentPt;
  const originAboveBaselinePt =
    axisPt - (result.inkAscentPt - result.inkDescentPt) / 2;
  const ascentPt = axisPt + inkHeightPt / 2;
  const descentPt = inkHeightPt / 2 - axisPt;
  // Box-local y-down from the box's own top: the baseline is `ascentPt` down, the drawing origin `originAboveBaselinePt` above that, and each placement a further `offsetPt` up the stretch axis.
  const placements: MathGlyphPlacement[] = result.placements.map(
    (placement) => ({
      glyphId: placement.glyphId,
      xPt: 0,
      yPt: ascentPt - originAboveBaselinePt - placement.offsetPt,
    }),
  );
  const items: MathLayoutItem[] = [
    {
      kind: "assembled-glyphs",
      placements,
      text,
      sizePt: ctx.sizePt,
      color: ctx.color,
    },
  ];
  return {
    widthPt: result.advanceWidthPt,
    ascentPt,
    descentPt,
    heightPt: ascentPt + descentPt,
    items,
  };
}

// The stretched replacement box for one operator, or undefined to keep the ordinary text run already laid out for it. Kept deliberately: a 'base' result means the font's own smallest form already reaches the target, and the existing MathGlyphRun carries the operator's real Unicode text where an assembled-glyphs item can only carry glyph IDs — so an ordinary inline (x+1) renders exactly as it did before this stretching path existed, text extraction included.
export function stretchOperator(
  element: MathMlElement,
  targetSizePt: number,
  ctx: LayoutContext,
): MathBox | undefined {
  const text = textContent(element).trim();
  // A multi-character operator has no single glyph to look a construction up for; the font's MathVariants data is keyed per glyph.
  const codePoint = singleCodePoint(text);
  if (codePoint === undefined) {
    return undefined;
  }
  const result = ctx.metrics.stretch(
    codePoint,
    "vertical",
    targetSizePt,
    ctx.sizePt,
  );
  if (result === undefined || result.kind === "base") {
    return undefined;
  }
  return stretchedBox(result, text, ctx);
}

// Turns one resolved HORIZONTAL stretchy construction (an over/under-brace spanning its own munder/mover base) into a box holding a single 'assembled-glyphs' item. Deliberately a sibling of stretchedBox, not a shared axis-branching function — the geometry genuinely differs on both axes measured:
//
// Width is `result.sizePt`, the extent the construction actually reached along the stretch axis — NEVER `result.advanceWidthPt`, which for a horizontal construction is only the widest individual glyph's own natural hmtx advance (a handful of points), not the assembled construction's own total span (confirmed empirically against the real embedded font: a 100pt-target assembly reports sizePt≈100 and advanceWidthPt≈11.5).
//
// Ascent/descent come directly and UNCLAMPED from result.inkAscentPt/result.inkDescentPt — no maths-axis centring the way stretchedBox applies for a symmetric fence, since an over/under-brace is script content that layoutUnderOver already stacks against the base's own ascent/descent edges using whatever ascent/descent this box reports. One of the two is legitimately NEGATIVE for both U+23DE and U+23DF (confirmed against the real font: the over-brace's own inkDescentPt, and the under-brace's own inkAscentPt, both come back negative) — each glyph's own ink sits almost entirely on one side of its own natural drawing origin, and that is honest ink data, not a bug, so it is never clamped to zero here.
export function horizontallyStretchedBox(
  result: MathStretchResult,
  text: string,
  ctx: LayoutContext,
): MathBox {
  const ascentPt = result.inkAscentPt;
  const descentPt = result.inkDescentPt;
  // Box-local, y-down: every placement shares the construction's own single baseline (`ascentPt` down from the box's own top), since offsetPt for a horizontal construction runs along x, not y — unlike stretchedBox's vertical construction, where offsetPt varies each placement's own y and x stays fixed.
  const placements: MathGlyphPlacement[] = result.placements.map(
    (placement) => ({
      glyphId: placement.glyphId,
      xPt: placement.offsetPt,
      yPt: ascentPt,
    }),
  );
  const items: MathLayoutItem[] = [
    {
      kind: "assembled-glyphs",
      placements,
      text,
      sizePt: ctx.sizePt,
      color: ctx.color,
    },
  ];
  return {
    widthPt: result.sizePt,
    ascentPt,
    descentPt,
    heightPt: ascentPt + descentPt,
    items,
  };
}

// The stretched replacement box for one munder/mover/munderover over/under-script operator, or undefined to keep whatever ordinary layout the caller already has for it — mirrors stretchOperator exactly, but targets a box's own WIDTH (the base's) rather than a row's height/depth.
export function stretchHorizontalOperator(
  element: MathMlElement,
  targetWidthPt: number,
  ctx: LayoutContext,
): MathBox | undefined {
  const text = textContent(element).trim();
  // A multi-character operator has no single glyph to look a construction up for; the font's MathVariants data is keyed per glyph.
  const codePoint = singleCodePoint(text);
  if (codePoint === undefined) {
    return undefined;
  }
  const result = ctx.metrics.stretch(
    codePoint,
    "horizontal",
    targetWidthPt,
    ctx.sizePt,
  );
  if (result === undefined || result.kind === "base") {
    return undefined;
  }
  return horizontallyStretchedBox(result, text, ctx);
}

// Lays out one munder/mover/munderover over- or under-script element, stretching it horizontally to `targetWidthPt` (the base's own width, computed independently for the over and under script — real \overbrace{...}^{label}/\underbrace{...}_{label} semantics need no synchronisation between the two) when it is a stretchy operator the font can genuinely construct at that width, and falling through to the ordinary layout otherwise — an operator isStretchyOperator declines (not an <mo>, an explicit stretchy="false", or a glyph the dictionary doesn't mark stretchy), or one metrics.stretch has nothing to offer (no horizontal MathVariants construction for that glyph in this font, or the construction already reaches the target at its base size, MathStretchResult.kind === 'base').
export function layoutUnderOverChild(
  childElement: MathMlElement,
  targetWidthPt: number,
  scriptCtx: LayoutContext,
): MathBox {
  if (isStretchyOperator(childElement)) {
    const stretched = stretchHorizontalOperator(
      childElement,
      targetWidthPt,
      scriptCtx,
    );
    if (stretched !== undefined) {
      return stretched;
    }
  }
  return layoutNode(childElement, scriptCtx);
}

// Replaces each stretchy operator's own box with one stretched to cover the rest of the row. Per MathML3 3.2.5.8 the target is the maximum height and depth of the row's OTHER children — a stretchy operator's own natural size never counts towards it, so several fences in one row all size to the same content rather than escalating off each other — and a fence stretches symmetrically about the maths axis, which is what makes the target twice the larger of the two half-extents rather than the plain content height.
//
// Only the VERTICAL axis is wired up here — this function specifically stretches a row's fences to that row's own height/depth, which is inherently a vertical-extent target. Horizontal stretching (an over/under-brace spanning its own munder/mover/munderover base, U+23DE/U+23DF) needs a target derived from a single box's WIDTH instead, which is a different call site entirely: see stretchHorizontalOperator/layoutUnderOverChild below, called from layoutUnderOverElement rather than from here.
export function stretchRowOperators(
  children: readonly MathMlElement[],
  boxes: readonly MathBox[],
  ctx: LayoutContext,
): readonly MathBox[] {
  const stretchy = children.map(isStretchyOperator);
  const others = boxes.filter((_, index) => stretchy[index] !== true);
  if (others.length === 0) {
    return boxes;
  }
  const axisPt = ctx.metrics.axisHeightPt;
  const maxAscentPt = others.reduce(
    (max, box) => Math.max(max, box.ascentPt),
    0,
  );
  const maxDescentPt = others.reduce(
    (max, box) => Math.max(max, box.descentPt),
    0,
  );
  const targetSizePt =
    2 * Math.max(maxAscentPt - axisPt, maxDescentPt + axisPt);
  return boxes.map((box, index) => {
    if (stretchy[index] !== true) {
      return box;
    }
    const element = children[index];
    return (
      (element === undefined
        ? undefined
        : stretchOperator(element, targetSizePt, ctx)) ?? box
    );
  });
}

export function layoutRowChildren(
  children: readonly MathMlElement[],
  ctx: LayoutContext,
): MathBox {
  const boxes = stretchRowOperators(
    children,
    children.map((child) => layoutNode(child, ctx)),
    ctx,
  );
  // One operator-dictionary lookup per child rather than two: an operator's own rspace feeds the gap AFTER it and its lspace the gap BEFORE it, so carrying each child's rspace into the next iteration computes the identical rspace[i-1] + lspace[i] sum a pairwise form would, with no prev-element lookup at all. The row's own first child gets no gap (there is nothing to its left to space against), matching MathML's own leading-edge behaviour.
  const gapsPt: number[] = [];
  let carriedRspaceEm = 0;
  for (const [index, child] of children.entries()) {
    const properties =
      elementLocalName(child) === "mo"
        ? operatorProperties(textContent(child).trim())
        : undefined;
    const gapEm =
      index === 0 ? 0 : carriedRspaceEm + (properties?.lspaceEm ?? 0);
    gapsPt.push(gapEm * ctx.sizePt);
    carriedRspaceEm = properties?.rspaceEm ?? 0;
  }
  return concatBoxesHorizontally(boxes, gapsPt);
}

// semantics wraps its actual content plus one or more parallel-markup annotations (annotation / annotation-xml) — real MathML producers (confirmed against LibreOffice's own content.xml) always wrap a formula this way, pairing the presentation-MathML tree this module renders with a StarMath (or similar) annotation odf.js's own readOdfFormulaMathMl already extracts separately (OdfFormulaDocument.starMath). Only the first non-annotation child is rendered; every annotation/annotation-xml child is skipped.
export function layoutSemantics(
  element: MathMlElement,
  ctx: LayoutContext,
): MathBox {
  const content = elementChildren(element).find((child) => {
    const name = elementLocalName(child);
    return name !== "annotation" && name !== "annotation-xml";
  });
  return content === undefined ? EMPTY_BOX : layoutNode(content, ctx);
}

export function mstyleContext(
  element: MathMlElement,
  ctx: LayoutContext,
): LayoutContext {
  let next = ctx;
  const displayAttr = attrValue(element, "displaystyle");
  if (displayAttr === "true" || displayAttr === "false") {
    next = { ...next, displayStyle: displayAttr === "true" };
  }
  const variantAttr = attrValue(element, "mathvariant");
  if (variantAttr !== undefined && isMathVariant(variantAttr)) {
    next = { ...next, inheritedVariant: variantAttr };
  }
  return next;
}

export function layoutScripts(
  base: MathBox,
  subscript: MathBox | undefined,
  superscript: MathBox | undefined,
  ctx: LayoutContext,
): MathBox {
  const metrics = ctx.metrics;
  // Both shifts depend only on the base and the font's own constants, never on whether their script exists, so they are computed unconditionally and simply go unused when their script is absent.
  const initialSupShiftUpPt = Math.max(
    ctx.cramped
      ? metrics.superscriptShiftUpCrampedPt
      : metrics.superscriptShiftUpPt,
    base.ascentPt - metrics.superscriptBaselineDropMaxPt,
  );
  const initialSubShiftDownPt = Math.max(
    metrics.subscriptShiftDownPt,
    base.descentPt + metrics.subscriptBaselineDropMinPt,
  );
  // The gap correction is clamped at zero rather than branch-guarded: a negative deficit (the two scripts already clear each other by more than subSuperscriptGapMinPt) must move neither script, and adding a negative correction would pull them towards each other. Split evenly, so the combined box grows symmetrically.
  let correctionPt = 0;
  if (superscript !== undefined && subscript !== undefined) {
    const gapPt =
      initialSupShiftUpPt -
      superscript.descentPt +
      (initialSubShiftDownPt - subscript.ascentPt);
    correctionPt = Math.max(0, metrics.subSuperscriptGapMinPt - gapPt) / 2;
  }
  const supShiftUpPt = initialSupShiftUpPt + correctionPt;
  const subShiftDownPt = initialSubShiftDownPt + correctionPt;

  const ascentPt = Math.max(
    base.ascentPt,
    superscript === undefined ? 0 : supShiftUpPt + superscript.ascentPt,
  );
  const descentPt = Math.max(
    base.descentPt,
    subscript === undefined ? 0 : subShiftDownPt + subscript.descentPt,
  );
  const scriptWidthPt = Math.max(
    superscript?.widthPt ?? 0,
    subscript?.widthPt ?? 0,
  );
  const widthPt =
    base.widthPt +
    (scriptWidthPt > 0 ? scriptWidthPt + metrics.spaceAfterScriptPt : 0);

  const items: MathLayoutItem[] = [...placeChild(base, 0, 0, ascentPt)];
  if (superscript !== undefined) {
    items.push(
      ...placeChild(superscript, base.widthPt, -supShiftUpPt, ascentPt),
    );
  }
  if (subscript !== undefined) {
    items.push(
      ...placeChild(subscript, base.widthPt, subShiftDownPt, ascentPt),
    );
  }
  return {
    widthPt,
    ascentPt,
    descentPt,
    heightPt: ascentPt + descentPt,
    items,
  };
}

// The absolute (combined-box-local) x-position an over/under script should centre itself at when accent-attachment-point centring applies — undefined falls back to plain geometric centring against the combined box's own width.
export interface AccentAttachment {
  readonly overXPt?: number;
  readonly underXPt?: number;
}

// True under/over stacking (munder/mover/munderover, or a movablelimits operator's own limits in displaystyle): centres `over`/`under` horizontally over the widest of the three boxes by default, and stacks them directly against `base`'s own ascent/descent edges with a fixed minimum gap. When `accentAttachment` supplies a resolved position for `over`/`under` (a genuine accent="true"/accentunder="true" script over a single-glyph base the font has a MathTopAccentAttachment entry for), that script is instead centred at the base glyph's own font-declared attachment point rather than the combined box's geometric centre — see layoutUnderOverElement's own resolveTopAccentXPt for how that position is resolved, and this module's own README/gotchas note for the fallback boundary.
export function layoutUnderOver(
  base: MathBox,
  under: MathBox | undefined,
  over: MathBox | undefined,
  ctx: LayoutContext,
  accentAttachment: AccentAttachment = {},
): MathBox {
  const gapPt = ctx.metrics.stackGapMinPt;
  const overHeightPt = over === undefined ? 0 : gapPt + over.heightPt;
  const underHeightPt = under === undefined ? 0 : gapPt + under.heightPt;
  const ascentPt = base.ascentPt + overHeightPt;
  const descentPt = base.descentPt + underHeightPt;
  const widthPt = Math.max(
    base.widthPt,
    under?.widthPt ?? 0,
    over?.widthPt ?? 0,
  );

  const baseXPt = (widthPt - base.widthPt) / 2;
  const items: MathLayoutItem[] = [...placeChild(base, baseXPt, 0, ascentPt)];
  if (over !== undefined) {
    const overXPt =
      accentAttachment.overXPt === undefined
        ? (widthPt - over.widthPt) / 2
        : baseXPt + accentAttachment.overXPt - over.widthPt / 2;
    // The over box's own bottom edge (descent) must land `gapPt` above base's own top edge (ascent above the shared baseline) — i.e. its baseline sits `base.ascentPt + gapPt + over.descentPt` above the shared baseline.
    items.push(
      ...placeChild(
        over,
        overXPt,
        -(base.ascentPt + gapPt + over.descentPt),
        ascentPt,
      ),
    );
  }
  if (under !== undefined) {
    const underXPt =
      accentAttachment.underXPt === undefined
        ? (widthPt - under.widthPt) / 2
        : baseXPt + accentAttachment.underXPt - under.widthPt / 2;
    items.push(
      ...placeChild(
        under,
        underXPt,
        base.descentPt + gapPt + under.ascentPt,
        ascentPt,
      ),
    );
  }
  return {
    widthPt,
    ascentPt,
    descentPt,
    heightPt: ascentPt + descentPt,
    items,
  };
}

export function isMovableLimitsOperator(element: MathMlElement): boolean {
  return (
    elementLocalName(element) === "mo" &&
    operatorProperties(textContent(element).trim()).movablelimits
  );
}
