import {
  EMPTY_BOX,
  concatBoxesHorizontally,
  placeChild,
  shiftItems,
} from "./compose";
import { parseMathLength } from "./length";
import type {
  MathBox,
  MathColor,
  MathFontMetrics,
  MathGlyphPlacement,
  MathLayoutItem,
  MathStretchResult,
} from "document-schema.js";
import type { MathDiagnostic, MathLayoutResult } from "./layout-types";
import type { MathMlElement, MathMlNode } from "./nodes";
import {
  attrValue,
  elementChildren,
  elementLocalName,
  isMathMlElement,
  textContent,
} from "./nodes";
import { operatorProperties } from "./operators";
import { buildRadicalSign } from "./radical";
import type { MathVariant } from "./variant";
import { applyMathVariant, isMathVariant } from "./variant";

export interface LayoutFormulaOptions {
  readonly metrics: MathFontMetrics;
  readonly sizePt: number;
  readonly color: MathColor;
}

interface LayoutContext {
  readonly metrics: MathFontMetrics;
  readonly sizePt: number;
  readonly color: MathColor;
  // undefined = "no ancestor mstyle/mathvariant attribute set one explicitly" -- a token element then applies its own intrinsic default (mi: italic iff single-character content, else normal; mn/mo/mtext: always normal). A defined value overrides every descendant's own intrinsic default, matching MathML's own mathvariant inheritance rule.
  readonly inheritedVariant: MathVariant | undefined;
  readonly displayStyle: boolean;
  readonly cramped: boolean;
  readonly scriptLevel: number;
  readonly diagnostics: MathDiagnostic[];
}

function rootContext(
  options: LayoutFormulaOptions,
  diagnostics: MathDiagnostic[],
): LayoutContext {
  return {
    metrics: options.metrics,
    sizePt: options.sizePt,
    color: options.color,
    inheritedVariant: undefined,
    displayStyle: true,
    cramped: false,
    scriptLevel: 0,
    diagnostics,
  };
}

function scriptContext(ctx: LayoutContext, cramped: boolean): LayoutContext {
  const scale =
    ctx.scriptLevel === 0
      ? ctx.metrics.scriptPercentScaleDown
      : ctx.metrics.scriptScriptPercentScaleDown;
  return {
    ...ctx,
    sizePt: ctx.sizePt * scale,
    displayStyle: false,
    cramped,
    scriptLevel: ctx.scriptLevel + 1,
  };
}

function unsupported(ctx: LayoutContext, element: MathMlElement): MathBox {
  ctx.diagnostics.push({
    kind: "unsupported-element",
    detail: elementLocalName(element),
  });
  return layoutToken(textContent(element), "normal", ctx);
}

// Renders `text` (already resolved to its final display string -- the caller has already applied mathvariant) as one MathGlyphRun, measuring its width one code point at a time via ctx.metrics.glyph and skipping (with a diagnostic) any code point the embedded font has no glyph for at all. Ascent/descent are the UNION of every rendered character's own real ink bounds (MathGlyphMetrics.inkAscentPt/inkDescentPt) when a glyph carries them -- not just the first character's -- falling back per-character to the font's own nominal design metrics (ascentPerEm/descentPerEm) for a glyph that carries no ink bounds at all (e.g. an implementation with no glyf/CFF outline parsing). A single-character token is the degenerate case of this same union.
function layoutToken(
  rawText: string,
  variant: MathVariant,
  ctx: LayoutContext,
): MathBox {
  const styled = applyMathVariant(rawText, variant);
  const nominalAscentPt = ctx.metrics.ascentPerEm * ctx.sizePt;
  const nominalDescentPt = ctx.metrics.descentPerEm * ctx.sizePt;
  let widthPt = 0;
  let ascentPt = 0;
  let descentPt = 0;
  let text = "";
  for (const ch of styled) {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    const glyph = ctx.metrics.glyph(codePoint, ctx.sizePt);
    if (glyph === undefined) {
      ctx.diagnostics.push({
        kind: "missing-glyph",
        detail: `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
      });
      continue;
    }
    text += ch;
    widthPt += glyph.advanceWidthPt;
    ascentPt = Math.max(ascentPt, glyph.inkAscentPt ?? nominalAscentPt);
    descentPt = Math.max(descentPt, glyph.inkDescentPt ?? nominalDescentPt);
  }
  if (text.length === 0) {
    return EMPTY_BOX;
  }
  const items: MathLayoutItem[] = [
    {
      kind: "glyphs",
      xPt: 0,
      yPt: ascentPt,
      text,
      sizePt: ctx.sizePt,
      color: ctx.color,
    },
  ];
  return {
    widthPt,
    ascentPt,
    descentPt,
    heightPt: ascentPt + descentPt,
    items,
  };
}

function tokenVariant(
  element: MathMlElement,
  intrinsicDefault: MathVariant,
  ctx: LayoutContext,
): MathVariant {
  const attr = attrValue(element, "mathvariant");
  if (attr !== undefined && isMathVariant(attr)) {
    return attr;
  }
  return ctx.inheritedVariant ?? intrinsicDefault;
}

// mi's own intrinsic default (MathML3 3.2.3): italic for a single-character identifier, normal for anything longer (a multi-letter identifier like "sin" is a function name convention, not a product of single-letter variables, so it is not italicised by default).
function miIntrinsicDefault(content: string): MathVariant {
  return [...content].length === 1 ? "italic" : "normal";
}

// Whether `element` is an operator that stretches to whatever it wraps or spans -- a row's own content (a vertical fence, via stretchRowOperators) or a munder/mover/munderover base's own width (a horizontal over/under-brace, via layoutUnderOverChild). The operator dictionary's own `stretchy` property is the default; MathML lets a document override it per element, and only an explicit stretchy="false" is honoured here, since stretchy="true" cannot make a glyph the font declares no MathVariants construction for stretchable anyway (metrics.stretch simply returns undefined for it and the operator draws at its base size).
function isStretchyOperator(element: MathMlElement): boolean {
  if (elementLocalName(element) !== "mo") {
    return false;
  }
  if (attrValue(element, "stretchy") === "false") {
    return false;
  }
  return operatorProperties(textContent(element).trim()).stretchy;
}

// Turns one resolved stretchy construction into a box holding a single 'assembled-glyphs' item. The construction's own real ink is centred on the maths axis -- the default `symmetric` behaviour MathML gives a fence, and the reason a pair of tall brackets lines up with the fraction rule between them rather than with the text baseline -- so the drawing origin sits `originAboveBaselinePt` above the shared baseline and the box's own edges land exactly on the ink's own top and bottom.
function stretchedBox(
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

// The stretched replacement box for one operator, or undefined to keep the ordinary text run already laid out for it. Kept deliberately: a 'base' result means the font's own smallest form already reaches the target, and the existing MathGlyphRun carries the operator's real Unicode text where an assembled-glyphs item can only carry glyph IDs -- so an ordinary inline (x+1) renders exactly as it did before this stretching path existed, text extraction included.
function stretchOperator(
  element: MathMlElement,
  targetSizePt: number,
  ctx: LayoutContext,
): MathBox | undefined {
  const text = textContent(element).trim();
  const codePoints = [...text];
  // A multi-character operator has no single glyph to look a construction up for; the font's MathVariants data is keyed per glyph.
  if (codePoints.length !== 1) {
    return undefined;
  }
  const codePoint = codePoints[0]?.codePointAt(0);
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

// Turns one resolved HORIZONTAL stretchy construction (an over/under-brace spanning its own munder/mover base) into a box holding a single 'assembled-glyphs' item. Deliberately a sibling of stretchedBox, not a shared axis-branching function -- the geometry genuinely differs on both axes measured:
//
// Width is `result.sizePt`, the extent the construction actually reached along the stretch axis -- NEVER `result.advanceWidthPt`, which for a horizontal construction is only the widest individual glyph's own natural hmtx advance (a handful of points), not the assembled construction's own total span (confirmed empirically against the real embedded font: a 100pt-target assembly reports sizePt≈100 and advanceWidthPt≈11.5).
//
// Ascent/descent come directly and UNCLAMPED from result.inkAscentPt/result.inkDescentPt -- no maths-axis centring the way stretchedBox applies for a symmetric fence, since an over/under-brace is script content that layoutUnderOver already stacks against the base's own ascent/descent edges using whatever ascent/descent this box reports. One of the two is legitimately NEGATIVE for both U+23DE and U+23DF (confirmed against the real font: the over-brace's own inkDescentPt, and the under-brace's own inkAscentPt, both come back negative) -- each glyph's own ink sits almost entirely on one side of its own natural drawing origin, and that is honest ink data, not a bug, so it is never clamped to zero here.
function horizontallyStretchedBox(
  result: MathStretchResult,
  text: string,
  ctx: LayoutContext,
): MathBox {
  const ascentPt = result.inkAscentPt;
  const descentPt = result.inkDescentPt;
  // Box-local, y-down: every placement shares the construction's own single baseline (`ascentPt` down from the box's own top), since offsetPt for a horizontal construction runs along x, not y -- unlike stretchedBox's vertical construction, where offsetPt varies each placement's own y and x stays fixed.
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

// The stretched replacement box for one munder/mover/munderover over/under-script operator, or undefined to keep whatever ordinary layout the caller already has for it -- mirrors stretchOperator exactly, but targets a box's own WIDTH (the base's) rather than a row's height/depth.
function stretchHorizontalOperator(
  element: MathMlElement,
  targetWidthPt: number,
  ctx: LayoutContext,
): MathBox | undefined {
  const text = textContent(element).trim();
  const codePoints = [...text];
  // A multi-character operator has no single glyph to look a construction up for; the font's MathVariants data is keyed per glyph.
  if (codePoints.length !== 1) {
    return undefined;
  }
  const codePoint = codePoints[0]?.codePointAt(0);
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

// Lays out one munder/mover/munderover over- or under-script element, stretching it horizontally to `targetWidthPt` (the base's own width, computed independently for the over and under script -- real \overbrace{...}^{label}/\underbrace{...}_{label} semantics need no synchronisation between the two) when it is a stretchy operator the font can genuinely construct at that width, and falling through to the ordinary layout otherwise -- an operator isStretchyOperator declines (not an <mo>, an explicit stretchy="false", or a glyph the dictionary doesn't mark stretchy), or one metrics.stretch has nothing to offer (no horizontal MathVariants construction for that glyph in this font, or the construction already reaches the target at its base size, MathStretchResult.kind === 'base').
function layoutUnderOverChild(
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

// Replaces each stretchy operator's own box with one stretched to cover the rest of the row. Per MathML3 3.2.5.8 the target is the maximum height and depth of the row's OTHER children -- a stretchy operator's own natural size never counts towards it, so several fences in one row all size to the same content rather than escalating off each other -- and a fence stretches symmetrically about the maths axis, which is what makes the target twice the larger of the two half-extents rather than the plain content height.
//
// Only the VERTICAL axis is wired up here -- this function specifically stretches a row's fences to that row's own height/depth, which is inherently a vertical-extent target. Horizontal stretching (an over/under-brace spanning its own munder/mover/munderover base, U+23DE/U+23DF) needs a target derived from a single box's WIDTH instead, which is a different call site entirely: see stretchHorizontalOperator/layoutUnderOverChild below, called from layoutUnderOverElement rather than from here.
function stretchRowOperators(
  children: readonly MathMlElement[],
  boxes: readonly MathBox[],
  ctx: LayoutContext,
): readonly MathBox[] {
  const stretchy = children.map(isStretchyOperator);
  if (!stretchy.includes(true)) {
    return boxes;
  }
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

function layoutRowChildren(
  children: readonly MathMlElement[],
  ctx: LayoutContext,
): MathBox {
  const boxes = stretchRowOperators(
    children,
    children.map((child) => layoutNode(child, ctx)),
    ctx,
  );
  const gapsPt = children.map((child, index) => {
    if (index === 0) {
      return 0;
    }
    const previous = children[index - 1];
    let gapEm = 0;
    if (previous !== undefined && elementLocalName(previous) === "mo") {
      gapEm += operatorProperties(textContent(previous).trim()).rspaceEm;
    }
    if (elementLocalName(child) === "mo") {
      gapEm += operatorProperties(textContent(child).trim()).lspaceEm;
    }
    return gapEm * ctx.sizePt;
  });
  return concatBoxesHorizontally(boxes, gapsPt);
}

// semantics wraps its actual content plus one or more parallel-markup annotations (annotation / annotation-xml) -- real MathML producers (confirmed against LibreOffice's own content.xml) always wrap a formula this way, pairing the presentation-MathML tree this module renders with a StarMath (or similar) annotation odf.js's own readOdfFormulaMathMl already extracts separately (OdfFormulaDocument.starMath). Only the first non-annotation child is rendered; every annotation/annotation-xml child is skipped.
function layoutSemantics(element: MathMlElement, ctx: LayoutContext): MathBox {
  const content = elementChildren(element).find((child) => {
    const name = elementLocalName(child);
    return name !== "annotation" && name !== "annotation-xml";
  });
  return content === undefined ? EMPTY_BOX : layoutNode(content, ctx);
}

function mstyleContext(
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

function layoutScripts(
  base: MathBox,
  subscript: MathBox | undefined,
  superscript: MathBox | undefined,
  ctx: LayoutContext,
): MathBox {
  const metrics = ctx.metrics;
  let supShiftUpPt = 0;
  let subShiftDownPt = 0;

  if (superscript !== undefined) {
    supShiftUpPt = Math.max(
      ctx.cramped
        ? metrics.superscriptShiftUpCrampedPt
        : metrics.superscriptShiftUpPt,
      base.ascentPt - metrics.superscriptBaselineDropMaxPt,
    );
  }
  if (subscript !== undefined) {
    subShiftDownPt = Math.max(
      metrics.subscriptShiftDownPt,
      base.descentPt + metrics.subscriptBaselineDropMinPt,
    );
  }
  if (superscript !== undefined && subscript !== undefined) {
    const gapPt =
      supShiftUpPt -
      superscript.descentPt +
      (subShiftDownPt - subscript.ascentPt);
    const deficitPt = metrics.subSuperscriptGapMinPt - gapPt;
    if (deficitPt > 0) {
      supShiftUpPt += deficitPt / 2;
      subShiftDownPt += deficitPt / 2;
    }
  }

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

// The absolute (combined-box-local) x-position an over/under script should centre itself at when accent-attachment-point centring applies -- undefined falls back to plain geometric centring against the combined box's own width.
interface AccentAttachment {
  readonly overXPt?: number;
  readonly underXPt?: number;
}

// True under/over stacking (munder/mover/munderover, or a movablelimits operator's own limits in displaystyle): centres `over`/`under` horizontally over the widest of the three boxes by default, and stacks them directly against `base`'s own ascent/descent edges with a fixed minimum gap. When `accentAttachment` supplies a resolved position for `over`/`under` (a genuine accent="true"/accentunder="true" script over a single-glyph base the font has a MathTopAccentAttachment entry for), that script is instead centred at the base glyph's own font-declared attachment point rather than the combined box's geometric centre -- see layoutUnderOverElement's own resolveTopAccentXPt for how that position is resolved, and this module's own README/gotchas note for the fallback boundary.
function layoutUnderOver(
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
    // The over box's own bottom edge (descent) must land `gapPt` above base's own top edge (ascent above the shared baseline) -- i.e. its baseline sits `base.ascentPt + gapPt + over.descentPt` above the shared baseline.
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

function isMovableLimitsOperator(element: MathMlElement): boolean {
  return (
    elementLocalName(element) === "mo" &&
    operatorProperties(textContent(element).trim()).movablelimits
  );
}

// Resolves the font's own MathTopAccentAttachment x-position (metrics.ts's own MathGlyphMetrics.topAccentXPt) for `baseElement`, when it is simple enough for the metric to apply at all: a single token element (mi/mn/mo/mtext) whose own mathvariant-styled content is exactly one code point. Returns undefined for anything else -- a multi-character base, a non-token base (e.g. an mrow or another munder/mover), or a single glyph the embedded font's MATH table has no attachment entry for -- so the caller falls back to plain geometric centring exactly as before.
function resolveTopAccentXPt(
  baseElement: MathMlElement,
  ctx: LayoutContext,
): number | undefined {
  const name = elementLocalName(baseElement);
  let rawText: string;
  let intrinsicDefault: MathVariant;
  if (name === "mi") {
    rawText = textContent(baseElement);
    intrinsicDefault = miIntrinsicDefault(rawText);
  } else if (name === "mn" || name === "mtext") {
    rawText = textContent(baseElement);
    intrinsicDefault = "normal";
  } else if (name === "mo") {
    rawText = textContent(baseElement).trim();
    intrinsicDefault = "normal";
  } else {
    return undefined;
  }

  const styled = applyMathVariant(
    rawText,
    tokenVariant(baseElement, intrinsicDefault, ctx),
  );
  const codePoints = [...styled];
  if (codePoints.length !== 1) {
    return undefined;
  }
  const codePoint = codePoints[0]?.codePointAt(0);
  if (codePoint === undefined) {
    return undefined;
  }
  return ctx.metrics.glyph(codePoint, ctx.sizePt)?.topAccentXPt;
}

function layoutUnderOverElement(
  element: MathMlElement,
  kind: "munder" | "mover" | "munderover",
  ctx: LayoutContext,
): MathBox {
  const children = elementChildren(element);
  const baseElement = children[0];
  if (baseElement === undefined) {
    return EMPTY_BOX;
  }

  // A movablelimits operator (sum, product, union, ...) renders its limits as an ordinary sub/sup pair outside display style -- the same \nolimits-vs-\limits distinction TeX makes -- and as a true stacked over/under only in display style.
  if (!ctx.displayStyle && isMovableLimitsOperator(baseElement)) {
    const base = layoutNode(baseElement, ctx);
    const scriptCtx = scriptContext(ctx, ctx.cramped);
    if (kind === "munder") {
      const sub =
        children[1] === undefined
          ? undefined
          : layoutNode(children[1], scriptCtx);
      return layoutScripts(base, sub, undefined, ctx);
    }
    if (kind === "mover") {
      const sup =
        children[1] === undefined
          ? undefined
          : layoutNode(children[1], scriptCtx);
      return layoutScripts(base, undefined, sup, ctx);
    }
    const sub =
      children[1] === undefined
        ? undefined
        : layoutNode(children[1], scriptCtx);
    const sup =
      children[2] === undefined
        ? undefined
        : layoutNode(children[2], scriptCtx);
    return layoutScripts(base, sub, sup, ctx);
  }

  const base = layoutNode(baseElement, ctx);
  const scriptCtx = scriptContext(ctx, false);
  // accent/accentunder each opt only their own respective script (over for accent, under for accentunder) into attachment-point centring -- munderover's two scripts are independent, so each is resolved against its own flag.
  const isAccent = attrValue(element, "accent") === "true";
  const isAccentUnder = attrValue(element, "accentunder") === "true";
  const topAccentXPt =
    isAccent || isAccentUnder
      ? resolveTopAccentXPt(baseElement, ctx)
      : undefined;
  const accentAttachment: AccentAttachment = {
    overXPt: isAccent ? topAccentXPt : undefined,
    underXPt: isAccentUnder ? topAccentXPt : undefined,
  };

  if (kind === "munder") {
    const under =
      children[1] === undefined
        ? undefined
        : layoutUnderOverChild(children[1], base.widthPt, scriptCtx);
    return layoutUnderOver(base, under, undefined, ctx, accentAttachment);
  }
  if (kind === "mover") {
    const over =
      children[1] === undefined
        ? undefined
        : layoutUnderOverChild(children[1], base.widthPt, scriptCtx);
    return layoutUnderOver(base, undefined, over, ctx, accentAttachment);
  }
  const under =
    children[1] === undefined
      ? undefined
      : layoutUnderOverChild(children[1], base.widthPt, scriptCtx);
  const over =
    children[2] === undefined
      ? undefined
      : layoutUnderOverChild(children[2], base.widthPt, scriptCtx);
  return layoutUnderOver(base, under, over, ctx, accentAttachment);
}

function layoutFraction(element: MathMlElement, ctx: LayoutContext): MathBox {
  const children = elementChildren(element);
  const numeratorElement = children[0];
  const denominatorElement = children[1];
  if (numeratorElement === undefined || denominatorElement === undefined) {
    return EMPTY_BOX;
  }

  const fracCtx = { ...ctx, displayStyle: false, cramped: false };
  const numerator = layoutNode(numeratorElement, fracCtx);
  const denominator = layoutNode(denominatorElement, {
    ...fracCtx,
    cramped: true,
  });

  const metrics = ctx.metrics;
  const lineThicknessAttr = attrValue(element, "linethickness");
  const ruleThicknessPt =
    (lineThicknessAttr === undefined
      ? undefined
      : parseMathLength(lineThicknessAttr, ctx.sizePt)) ??
    metrics.fractionRuleThicknessPt;
  const axisPt = metrics.axisHeightPt;

  const numShiftUpPt = Math.max(
    ctx.displayStyle
      ? metrics.fractionNumeratorDisplayShiftUpPt
      : metrics.fractionNumeratorShiftUpPt,
    axisPt +
      ruleThicknessPt / 2 +
      metrics.fractionNumeratorGapMinPt +
      numerator.descentPt,
  );
  const denShiftDownPt = Math.max(
    ctx.displayStyle
      ? metrics.fractionDenominatorDisplayShiftDownPt
      : metrics.fractionDenominatorShiftDownPt,
    ruleThicknessPt / 2 +
      metrics.fractionDenominatorGapMinPt +
      denominator.ascentPt -
      axisPt,
  );

  const widthPt = Math.max(numerator.widthPt, denominator.widthPt);
  const ascentPt = numShiftUpPt + numerator.ascentPt;
  const descentPt = denShiftDownPt + denominator.descentPt;

  const items: MathLayoutItem[] = [
    ...placeChild(
      numerator,
      (widthPt - numerator.widthPt) / 2,
      -numShiftUpPt,
      ascentPt,
    ),
    ...placeChild(
      denominator,
      (widthPt - denominator.widthPt) / 2,
      denShiftDownPt,
      ascentPt,
    ),
    {
      kind: "rule",
      xPt: 0,
      yPt: ascentPt - axisPt - ruleThicknessPt / 2,
      widthPt,
      heightPt: ruleThicknessPt,
      color: ctx.color,
    },
  ];
  return {
    widthPt,
    ascentPt,
    descentPt,
    heightPt: ascentPt + descentPt,
    items,
  };
}

function layoutRadical(
  element: MathMlElement,
  kind: "msqrt" | "mroot",
  ctx: LayoutContext,
): MathBox {
  const children = elementChildren(element);

  if (kind === "msqrt") {
    // msqrt's own content model is an IMPLICIT mrow of every child (unlike mroot, which takes exactly two children: the radicand, then the index) -- see MathML3 3.3.6.
    const radicand = layoutRowChildren(children, { ...ctx, cramped: true });
    return wrapRadical(radicand, undefined, ctx);
  }

  const radicandElement = children[0];
  const indexElement = children[1];
  if (radicandElement === undefined) {
    return EMPTY_BOX;
  }
  const radicand = layoutNode(radicandElement, { ...ctx, cramped: true });
  const index =
    indexElement === undefined
      ? undefined
      : layoutNode(
          indexElement,
          scriptContext(scriptContext(ctx, false), false),
        );
  return wrapRadical(radicand, index, ctx);
}

function wrapRadical(
  radicand: MathBox,
  index: MathBox | undefined,
  ctx: LayoutContext,
): MathBox {
  const metrics = ctx.metrics;
  const ruleThicknessPt = metrics.radicalRuleThicknessPt;
  const gapPt = metrics.radicalVerticalGapPt;
  const signHeightPt =
    metrics.radicalExtraAscenderPt +
    ruleThicknessPt +
    gapPt +
    radicand.heightPt;

  const degreeWidthPt =
    index === undefined
      ? 0
      : metrics.radicalKernBeforeDegreePt +
        index.widthPt +
        metrics.radicalKernAfterDegreePt;
  const signOriginXPt = Math.max(0, degreeWidthPt);

  const ascentPt =
    metrics.radicalExtraAscenderPt +
    ruleThicknessPt +
    gapPt +
    radicand.ascentPt;
  const descentPt = radicand.descentPt;

  const items: MathLayoutItem[] = [];
  // Prefer the font's own vertical radical construction (its real √ MathVariants data, sized to the radicand) over the hand-drawn hook -- the font designer's glyph is the authentic radical silhouette this module's fixed-fraction approximation only echoes. 'base' (the font's smallest √ already reaches the target), 'variant' (a pre-built larger √), and 'assembly' (a multi-part construction) are all real radical glyphs and all used here; only a font that declares no √ construction at all (stretch returns undefined) falls back to the hand-drawn sign, so a different font backend with no radical MathVariants keeps rendering a radical rather than vanishing.
  //
  // The construction is stretched to (signHeightPt - radicalExtraAscenderPt) and its ink-top placed at y = radicalExtraAscenderPt -- the SAME y as the separately drawn vinculum rule below -- so the glyph's own top shelf and the vinculum read as one continuous bar rather than a step. Stretching to the reduced target (not the full signHeightPt) keeps the hook's bottom at the radicand's bottom (signHeightPt) once the ink-top is lowered by radicalExtraAscenderPt: the glyph spans [extraAscender, signHeightPt].
  const stretched = ctx.metrics.stretch(
    0x221a,
    "vertical",
    signHeightPt - metrics.radicalExtraAscenderPt,
    ctx.sizePt,
  );
  let signWidthPt: number;
  if (stretched !== undefined) {
    // Place the construction so its ink-top (the shelf) lands at y = radicalExtraAscenderPt, aligning with the vinculum. The drawing origin sits inkAscentPt below that ink-top; each part a further offsetPt up the vertical axis.
    const placements = stretched.placements.map((placement) => ({
      glyphId: placement.glyphId,
      xPt: signOriginXPt,
      yPt:
        metrics.radicalExtraAscenderPt +
        stretched.inkAscentPt -
        placement.offsetPt,
    }));
    items.push({
      kind: "assembled-glyphs",
      placements,
      text: "√",
      sizePt: ctx.sizePt,
      color: ctx.color,
    });
    items.push({
      kind: "rule",
      xPt: signOriginXPt,
      yPt: metrics.radicalExtraAscenderPt,
      widthPt: stretched.advanceWidthPt + radicand.widthPt,
      heightPt: ruleThicknessPt,
      color: ctx.color,
    });
    signWidthPt = stretched.advanceWidthPt;
  } else {
    const sign = buildRadicalSign(
      signOriginXPt,
      0,
      signHeightPt,
      radicand.widthPt,
      ruleThicknessPt,
      ctx.color,
    );
    items.push(sign.hook, sign.vinculum);
    signWidthPt = sign.widthPt;
  }
  items.push(...placeChild(radicand, signOriginXPt + signWidthPt, 0, ascentPt));

  if (index !== undefined) {
    // The degree sits raised from the sign's own bottom by radicalDegreeBottomRaisePercent% of the sign's own visible height (ascentPt + descentPt of the WHOLE radical, per the OpenType MATH spec's own definition) -- a real, font-driven placement, not a fixed fraction picked by this module.
    const raisePt =
      ((ascentPt + descentPt) * metrics.radicalDegreeBottomRaisePercent) / 100;
    const degreeBaselineFromTopPt =
      ascentPt + descentPt - raisePt - index.descentPt;
    items.push(
      ...shiftItems(
        index.items,
        metrics.radicalKernBeforeDegreePt,
        degreeBaselineFromTopPt - index.ascentPt,
      ),
    );
  }

  const widthPt = signOriginXPt + signWidthPt + radicand.widthPt;
  return {
    widthPt,
    ascentPt,
    descentPt,
    heightPt: ascentPt + descentPt,
    items,
  };
}

function layoutTable(element: MathMlElement, ctx: LayoutContext): MathBox {
  const rows = elementChildren(element).filter(
    (child) => elementLocalName(child) === "mtr",
  );
  if (rows.length === 0) {
    return EMPTY_BOX;
  }
  const columnAligns = (attrValue(element, "columnalign") ?? "")
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);

  const rowCells: MathBox[][] = rows.map((row) =>
    elementChildren(row)
      .filter((child) => elementLocalName(child) === "mtd")
      .map((cell) => layoutRowChildren(elementChildren(cell), ctx)),
  );

  const columnCount = rowCells.reduce(
    (max, row) => Math.max(max, row.length),
    0,
  );
  if (columnCount === 0) {
    return EMPTY_BOX;
  }
  const columnWidthsPt: number[] = [];
  for (let column = 0; column < columnCount; column++) {
    columnWidthsPt.push(
      rowCells.reduce(
        (max, row) => Math.max(max, row[column]?.widthPt ?? 0),
        0,
      ),
    );
  }

  const columnGapPt = 0.8 * ctx.sizePt;
  const rowGapPt = 0.5 * ctx.sizePt;

  const items: MathLayoutItem[] = [];
  let cursorYTopPt = 0;
  rowCells.forEach((row, rowIndex) => {
    const rowAscentPt = row.reduce(
      (max, cell) => Math.max(max, cell.ascentPt),
      0,
    );
    const rowDescentPt = row.reduce(
      (max, cell) => Math.max(max, cell.descentPt),
      0,
    );
    let cursorXPt = 0;
    row.forEach((cell, columnIndex) => {
      const columnWidthPt = columnWidthsPt[columnIndex] ?? cell.widthPt;
      const align =
        columnAligns[columnIndex] ??
        columnAligns[columnAligns.length - 1] ??
        "center";
      const extraPt = columnWidthPt - cell.widthPt;
      const dxPt =
        align === "left" ? 0 : align === "right" ? extraPt : extraPt / 2;
      items.push(
        ...placeChild(cell, cursorXPt + dxPt, 0, cursorYTopPt + rowAscentPt),
      );
      cursorXPt += columnWidthPt + columnGapPt;
    });
    cursorYTopPt +=
      rowAscentPt +
      rowDescentPt +
      (rowIndex < rowCells.length - 1 ? rowGapPt : 0);
  });

  const widthPt =
    columnWidthsPt.reduce((sum, w) => sum + w, 0) +
    columnGapPt * Math.max(0, columnCount - 1);
  let descentPt = cursorYTopPt - (cursorYTopPt / 2 + ctx.metrics.axisHeightPt);
  if (descentPt < 0) {
    descentPt = 0;
  }
  const ascentPt = cursorYTopPt - descentPt;
  return { widthPt, ascentPt, descentPt, heightPt: cursorYTopPt, items };
}

function layoutSpace(element: MathMlElement, ctx: LayoutContext): MathBox {
  const widthAttr = attrValue(element, "width");
  const heightAttr = attrValue(element, "height");
  const depthAttr = attrValue(element, "depth");
  const widthPt = Math.max(
    0,
    (widthAttr === undefined
      ? undefined
      : parseMathLength(widthAttr, ctx.sizePt)) ?? 0,
  );
  const ascentPt = Math.max(
    0,
    (heightAttr === undefined
      ? undefined
      : parseMathLength(heightAttr, ctx.sizePt)) ?? 0,
  );
  const descentPt = Math.max(
    0,
    (depthAttr === undefined
      ? undefined
      : parseMathLength(depthAttr, ctx.sizePt)) ?? 0,
  );
  return {
    widthPt,
    ascentPt,
    descentPt,
    heightPt: ascentPt + descentPt,
    items: [],
  };
}

// The single recursive dispatch every MathML element in this module's own supported set (and every unsupported one, via the textContent fallback) goes through. A non-element node (a whitespace-only text node between siblings -- normal, valid MathML formatting) contributes nothing and is not itself a diagnostic-worthy event.
export function layoutNode(node: MathMlNode, ctx: LayoutContext): MathBox {
  if (!isMathMlElement(node)) {
    return EMPTY_BOX;
  }
  const name = elementLocalName(node);

  switch (name) {
    case "mrow":
      return layoutRowChildren(elementChildren(node), ctx);
    case "semantics":
      return layoutSemantics(node, ctx);
    case "mstyle":
      return layoutRowChildren(elementChildren(node), mstyleContext(node, ctx));
    case "mi": {
      const text = textContent(node);
      return layoutToken(
        text,
        tokenVariant(node, miIntrinsicDefault(text), ctx),
        ctx,
      );
    }
    case "mn":
      return layoutToken(
        textContent(node),
        tokenVariant(node, "normal", ctx),
        ctx,
      );
    case "mo":
      return layoutToken(
        textContent(node).trim(),
        tokenVariant(node, "normal", ctx),
        ctx,
      );
    case "mtext":
      return layoutToken(
        textContent(node),
        tokenVariant(node, "normal", ctx),
        ctx,
      );
    case "mspace":
      return layoutSpace(node, ctx);
    case "msub": {
      const children = elementChildren(node);
      const base =
        children[0] === undefined ? EMPTY_BOX : layoutNode(children[0], ctx);
      const sub =
        children[1] === undefined
          ? undefined
          : layoutNode(children[1], scriptContext(ctx, ctx.cramped));
      return layoutScripts(base, sub, undefined, ctx);
    }
    case "msup": {
      const children = elementChildren(node);
      const base =
        children[0] === undefined ? EMPTY_BOX : layoutNode(children[0], ctx);
      const sup =
        children[1] === undefined
          ? undefined
          : layoutNode(children[1], scriptContext(ctx, ctx.cramped));
      return layoutScripts(base, undefined, sup, ctx);
    }
    case "msubsup": {
      const children = elementChildren(node);
      const base =
        children[0] === undefined ? EMPTY_BOX : layoutNode(children[0], ctx);
      const scriptCtx = scriptContext(ctx, ctx.cramped);
      const sub =
        children[1] === undefined
          ? undefined
          : layoutNode(children[1], scriptCtx);
      const sup =
        children[2] === undefined
          ? undefined
          : layoutNode(children[2], scriptCtx);
      return layoutScripts(base, sub, sup, ctx);
    }
    case "munder":
      return layoutUnderOverElement(node, "munder", ctx);
    case "mover":
      return layoutUnderOverElement(node, "mover", ctx);
    case "munderover":
      return layoutUnderOverElement(node, "munderover", ctx);
    case "mfrac":
      return layoutFraction(node, ctx);
    case "msqrt":
      return layoutRadical(node, "msqrt", ctx);
    case "mroot":
      return layoutRadical(node, "mroot", ctx);
    case "mtable":
      return layoutTable(node, ctx);
    case "mtr":
    case "mtd":
      // Reached only if a caller lays one out directly rather than through 'mtable' (e.g. a malformed tree) -- treated as an implicit mrow of its own children, the same fallback MathML itself defines for an mtd encountered outside any row/table context.
      return layoutRowChildren(elementChildren(node), ctx);
    default:
      return unsupported(ctx, node);
  }
}

// The public entry point: lays out a full formula (odf.js's own readOdfFormulaMathMl's `mathml: XmlNode[]` -- the children of the <math> root element) at a given font size/colour, using `options.metrics` for every measurement. Multiple root-level nodes (rare, but the MathML content model permits more than one child directly under <math>) are laid out as an implicit row, matching how a <mrow> would combine them.
export function layoutFormula(
  mathml: readonly MathMlNode[],
  options: LayoutFormulaOptions,
): MathLayoutResult {
  const diagnostics: MathDiagnostic[] = [];
  const ctx = rootContext(options, diagnostics);
  const elements = mathml.filter(isMathMlElement);
  const box = layoutRowChildren(elements, ctx);
  return { box, diagnostics };
}
