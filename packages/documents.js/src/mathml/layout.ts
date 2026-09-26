import { EMPTY_BOX, placeChild, shiftItems } from "./compose";
import { parseMathLength } from "./length";
import type {
  MathBox,
  MathColor,
  MathFontMetrics,
  MathLayoutItem,
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
import { buildRadicalSign } from "./radical";
import type { MathVariant } from "./variant";
import { applyMathVariant, isMathVariant } from "./variant";
import type { AccentAttachment } from "./layout-stretch";
import {
  isMovableLimitsOperator,
  layoutRowChildren,
  layoutScripts,
  layoutSemantics,
  layoutUnderOver,
  layoutUnderOverChild,
  mstyleContext,
  singleCodePoint,
} from "./layout-stretch";

// Hex, for formatting a code point the way Unicode itself writes it; a percentage is hundredths of the whole.
const HEX_RADIX = 16;
const UNICODE_HEX_DIGITS = 4;
const PERCENT_SCALE = 100;
// U+221A, the radical sign the vertical construction stretches from.
const RADICAL_SIGN = 0x221a;
// An mtable's own default inter-column and inter-row gaps, in em (MathML3's table defaults).
const TABLE_COLUMN_GAP_EM = 0.8;
const TABLE_ROW_GAP_EM = 0.5;

export interface LayoutFormulaOptions {
  readonly metrics: MathFontMetrics;
  readonly sizePt: number;
  readonly color: MathColor;
}

export interface LayoutContext {
  readonly metrics: MathFontMetrics;
  readonly sizePt: number;
  readonly color: MathColor;
  // undefined = "no ancestor mstyle/mathvariant attribute set one explicitly" — a token element then applies its own intrinsic default (mi: italic iff single-character content, else normal; mn/mo/mtext: always normal). A defined value overrides every descendant's own intrinsic default, matching MathML's own mathvariant inheritance rule.
  readonly inheritedVariant: MathVariant | undefined;
  readonly displayStyle: boolean;
  readonly cramped: boolean;
  // Whether the next script level to be entered is still the FIRST one (scriptPercentScaleDown) or a deeper one (scriptScriptPercentScaleDown). A level counter would carry the same information, but nothing ever reads its absolute value, only this zero-or-not distinction, and a number whose arithmetic nobody consumes gives equivalent mutants a place to hide.
  readonly firstScriptLevel: boolean;
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
    firstScriptLevel: true,
    diagnostics,
  };
}

function scriptContext(ctx: LayoutContext, cramped: boolean): LayoutContext {
  const scale = ctx.firstScriptLevel
    ? ctx.metrics.scriptPercentScaleDown
    : ctx.metrics.scriptScriptPercentScaleDown;
  return {
    ...ctx,
    sizePt: ctx.sizePt * scale,
    displayStyle: false,
    cramped,
    firstScriptLevel: false,
  };
}

function unsupported(ctx: LayoutContext, element: MathMlElement): MathBox {
  ctx.diagnostics.push({
    kind: "unsupported-element",
    detail: elementLocalName(element),
  });
  return layoutToken(textContent(element), "normal", ctx);
}

// Renders `text` (already resolved to its final display string — the caller has already applied mathvariant) as one MathGlyphRun, measuring its width one code point at a time via ctx.metrics.glyph and skipping (with a diagnostic) any code point the embedded font has no glyph for at all. Ascent/descent are the UNION of every rendered character's own real ink bounds (MathGlyphMetrics.inkAscentPt/inkDescentPt) when a glyph carries them — not just the first character's — falling back per-character to the font's own nominal design metrics (ascentPerEm/descentPerEm) for a glyph that carries no ink bounds at all (e.g. an implementation with no glyf/CFF outline parsing). A single-character token is the degenerate case of this same union.
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
        detail: `U+${codePoint.toString(HEX_RADIX).toUpperCase().padStart(UNICODE_HEX_DIGITS, "0")}`,
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

// Resolves the font's own MathTopAccentAttachment x-position (metrics.ts's own MathGlyphMetrics.topAccentXPt) for `baseElement`, when it is simple enough for the metric to apply at all: a single token element (mi/mn/mo/mtext) whose own mathvariant-styled content is exactly one code point. Returns undefined for anything else — a multi-character base, a non-token base (e.g. an mrow or another munder/mover), or a single glyph the embedded font's MATH table has no attachment entry for — so the caller falls back to plain geometric centring exactly as before.
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
  const codePoint = singleCodePoint(styled);
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

  // A movablelimits operator (sum, product, union, ...) renders its limits as an ordinary sub/sup pair outside display style — the same \nolimits-vs-\limits distinction TeX makes — and as a true stacked over/under only in display style.
  if (!ctx.displayStyle && isMovableLimitsOperator(baseElement)) {
    const base = layoutNode(baseElement, ctx);
    const scriptCtx = scriptContext(ctx, ctx.cramped);
    // "munder" needs no case of its own: the fall-through tail reads its subscript from children[1] and finds children[2] absent, which is exactly the layoutScripts(base, sub, undefined, ...) call a dedicated case would make.
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
  // accent/accentunder each opt only their own respective script (over for accent, under for accentunder) into attachment-point centring, and each flag resolves the base's attachment point independently — munderover carrying both flags resolves the same pure lookup twice rather than sharing one conditional result between two semantically separate opt-ins.
  const isAccent = attrValue(element, "accent") === "true";
  const isAccentUnder = attrValue(element, "accentunder") === "true";
  const accentAttachment: AccentAttachment = {
    overXPt: isAccent ? resolveTopAccentXPt(baseElement, ctx) : undefined,
    underXPt: isAccentUnder ? resolveTopAccentXPt(baseElement, ctx) : undefined,
  };

  // "munder" needs no case of its own: the fall-through below reads its under script from children[1] and finds children[2] absent, which is exactly the layoutUnderOver(base, under, undefined, ...) call a dedicated case would make.
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
  // Two separate guards rather than one ||: elementChildren returns an array, so a present denominator always implies a present numerator, and a single disjunction's right-hand check would be unreachable on its own.
  if (numeratorElement === undefined) {
    return EMPTY_BOX;
  }
  if (denominatorElement === undefined) {
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
    // msqrt's own content model is an IMPLICIT mrow of every child (unlike mroot, which takes exactly two children: the radicand, then the index) — see MathML3 3.3.6.
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
  // Prefer the font's own vertical radical construction (its real √ MathVariants data, sized to the radicand) over the hand-drawn hook — the font designer's glyph is the authentic radical silhouette this module's fixed-fraction approximation only echoes. 'base' (the font's smallest √ already reaches the target), 'variant' (a pre-built larger √), and 'assembly' (a multi-part construction) are all real radical glyphs and all used here; only a font that declares no √ construction at all (stretch returns undefined) falls back to the hand-drawn sign, so a different font backend with no radical MathVariants keeps rendering a radical rather than vanishing.
  //
  // The construction is stretched to (signHeightPt - radicalExtraAscenderPt) and its ink-top placed at y = radicalExtraAscenderPt — the SAME y as the separately drawn vinculum rule below — so the glyph's own top shelf and the vinculum read as one continuous bar rather than a step. Stretching to the reduced target (not the full signHeightPt) keeps the hook's bottom at the radicand's bottom (signHeightPt) once the ink-top is lowered by radicalExtraAscenderPt: the glyph spans [extraAscender, signHeightPt].
  const stretched = ctx.metrics.stretch(
    RADICAL_SIGN,
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
    // The degree sits raised from the sign's own bottom by radicalDegreeBottomRaisePercent% of the sign's own visible height (ascentPt + descentPt of the WHOLE radical, per the OpenType MATH spec's own definition) — a real, font-driven placement, not a fixed fraction picked by this module.
    const raisePt =
      ((ascentPt + descentPt) * metrics.radicalDegreeBottomRaisePercent) /
      PERCENT_SCALE;
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
  // No separate rows-empty guard: a table with no mtr rows yields no row cells and therefore columnCount 0, which the columnCount guard below already returns EMPTY_BOX for.
  const columnAlignAttr = attrValue(element, "columnalign");
  const columnAligns =
    columnAlignAttr === undefined ? [] : (columnAlignAttr.match(/\S+/g) ?? []);

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
  const columnWidthsPt = Array.from({ length: columnCount }, (_, column) =>
    rowCells.reduce((max, row) => Math.max(max, row[column]?.widthPt ?? 0), 0),
  );

  const columnGapPt = TABLE_COLUMN_GAP_EM * ctx.sizePt;
  const rowGapPt = TABLE_ROW_GAP_EM * ctx.sizePt;

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
      // An undefined per-column or last-value align is simply neither "left" nor "right", so the dx ternary's final arm is the default centring — no explicit "center" literal to drift from the two named cases.
      const align =
        columnAligns[columnIndex] ?? columnAligns[columnAligns.length - 1];
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

// The single recursive dispatch every MathML element in this module's own supported set (and every unsupported one, via the textContent fallback) goes through. A non-element node (a whitespace-only text node between siblings — normal, valid MathML formatting) contributes nothing and is not itself a diagnostic-worthy event.
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
      // Reached only if a caller lays one out directly rather than through 'mtable' (e.g. a malformed tree) — treated as an implicit mrow of its own children, the same fallback MathML itself defines for an mtd encountered outside any row/table context.
      return layoutRowChildren(elementChildren(node), ctx);
    default:
      return unsupported(ctx, node);
  }
}

// The public entry point: lays out a full formula (odf.js's own readOdfFormulaMathMl's `mathml: XmlNode[]` — the children of the <math> root element) at a given font size/colour, using `options.metrics` for every measurement. Multiple root-level nodes (rare, but the MathML content model permits more than one child directly under <math>) are laid out as an implicit row, matching how a <mrow> would combine them.
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
