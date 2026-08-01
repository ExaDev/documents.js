import { EMPTY_BOX, concatBoxesHorizontally, placeChild, shiftItems } from './compose';
import { parseMathLength } from './length';
import type { MathBox, MathColor, MathDiagnostic, MathLayoutItem, MathLayoutResult } from './layout-types';
import type { MathFontMetrics } from './metrics';
import type { MathMlElement, MathMlNode } from './nodes';
import { attrValue, elementChildren, elementLocalName, isMathMlElement, textContent } from './nodes';
import { operatorProperties } from './operators';
import { buildRadicalSign } from './radical';
import type { MathVariant } from './variant';
import { applyMathVariant, isMathVariant } from './variant';

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

function rootContext(options: LayoutFormulaOptions, diagnostics: MathDiagnostic[]): LayoutContext {
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
  const scale = ctx.scriptLevel === 0 ? ctx.metrics.scriptPercentScaleDown : ctx.metrics.scriptScriptPercentScaleDown;
  return { ...ctx, sizePt: ctx.sizePt * scale, displayStyle: false, cramped, scriptLevel: ctx.scriptLevel + 1 };
}

function unsupported(ctx: LayoutContext, element: MathMlElement): MathBox {
  ctx.diagnostics.push({ kind: 'unsupported-element', detail: elementLocalName(element) });
  return layoutToken(textContent(element), 'normal', ctx);
}

// Renders `text` (already resolved to its final display string -- the caller has already applied mathvariant) as one MathGlyphRun, measuring its width one code point at a time via ctx.metrics.glyph and skipping (with a diagnostic) any code point the embedded font has no glyph for at all. Ascent/descent come from the font's own nominal design metrics (metrics.ts's own note explains why this module never parses per-glyph ink bounding boxes), so every token box shares the same vertical extent regardless of which characters it actually contains.
function layoutToken(rawText: string, variant: MathVariant, ctx: LayoutContext): MathBox {
  const styled = applyMathVariant(rawText, variant);
  let widthPt = 0;
  let text = '';
  for (const ch of styled) {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    const glyph = ctx.metrics.glyph(codePoint, ctx.sizePt);
    if (glyph === undefined) {
      ctx.diagnostics.push({ kind: 'missing-glyph', detail: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}` });
      continue;
    }
    text += ch;
    widthPt += glyph.advanceWidthPt;
  }
  if (text.length === 0) {
    return EMPTY_BOX;
  }
  const ascentPt = ctx.metrics.ascentPerEm * ctx.sizePt;
  const descentPt = ctx.metrics.descentPerEm * ctx.sizePt;
  const items: MathLayoutItem[] = [{ kind: 'glyphs', xPt: 0, yPt: ascentPt, text, sizePt: ctx.sizePt, color: ctx.color }];
  return { widthPt, ascentPt, descentPt, heightPt: ascentPt + descentPt, items };
}

function tokenVariant(element: MathMlElement, intrinsicDefault: MathVariant, ctx: LayoutContext): MathVariant {
  const attr = attrValue(element, 'mathvariant');
  if (attr !== undefined && isMathVariant(attr)) {
    return attr;
  }
  return ctx.inheritedVariant ?? intrinsicDefault;
}

// mi's own intrinsic default (MathML3 3.2.3): italic for a single-character identifier, normal for anything longer (a multi-letter identifier like "sin" is a function name convention, not a product of single-letter variables, so it is not italicised by default).
function miIntrinsicDefault(content: string): MathVariant {
  return [...content].length === 1 ? 'italic' : 'normal';
}

function layoutRowChildren(children: readonly MathMlElement[], ctx: LayoutContext): MathBox {
  const boxes = children.map((child) => layoutNode(child, ctx));
  const gapsPt = children.map((child, index) => {
    if (index === 0) {
      return 0;
    }
    const previous = children[index - 1];
    let gapEm = 0;
    if (previous !== undefined && elementLocalName(previous) === 'mo') {
      gapEm += operatorProperties(textContent(previous).trim()).rspaceEm;
    }
    if (elementLocalName(child) === 'mo') {
      gapEm += operatorProperties(textContent(child).trim()).lspaceEm;
    }
    return gapEm * ctx.sizePt;
  });
  return concatBoxesHorizontally(boxes, gapsPt);
}

// semantics wraps its actual content plus one or more parallel-markup annotations (annotation / annotation-xml) -- real MathML producers (confirmed against LibreOffice's own content.xml) always wrap a formula this way, pairing the presentation-MathML tree this module renders with a StarMath (or similar) annotation odf.js's own readOdfFormula already extracts separately (OdfFormulaDocument.starMath). Only the first non-annotation child is rendered; every annotation/annotation-xml child is skipped.
function layoutSemantics(element: MathMlElement, ctx: LayoutContext): MathBox {
  const content = elementChildren(element).find((child) => {
    const name = elementLocalName(child);
    return name !== 'annotation' && name !== 'annotation-xml';
  });
  return content === undefined ? EMPTY_BOX : layoutNode(content, ctx);
}

function mstyleContext(element: MathMlElement, ctx: LayoutContext): LayoutContext {
  let next = ctx;
  const displayAttr = attrValue(element, 'displaystyle');
  if (displayAttr === 'true' || displayAttr === 'false') {
    next = { ...next, displayStyle: displayAttr === 'true' };
  }
  const variantAttr = attrValue(element, 'mathvariant');
  if (variantAttr !== undefined && isMathVariant(variantAttr)) {
    next = { ...next, inheritedVariant: variantAttr };
  }
  return next;
}

function layoutScripts(base: MathBox, subscript: MathBox | undefined, superscript: MathBox | undefined, ctx: LayoutContext): MathBox {
  const metrics = ctx.metrics;
  let supShiftUpPt = 0;
  let subShiftDownPt = 0;

  if (superscript !== undefined) {
    supShiftUpPt = Math.max(ctx.cramped ? metrics.superscriptShiftUpCrampedPt : metrics.superscriptShiftUpPt, base.ascentPt - metrics.superscriptBaselineDropMaxPt);
  }
  if (subscript !== undefined) {
    subShiftDownPt = Math.max(metrics.subscriptShiftDownPt, base.descentPt + metrics.subscriptBaselineDropMinPt);
  }
  if (superscript !== undefined && subscript !== undefined) {
    const gapPt = supShiftUpPt - superscript.descentPt + (subShiftDownPt - subscript.ascentPt);
    const deficitPt = metrics.subSuperscriptGapMinPt - gapPt;
    if (deficitPt > 0) {
      supShiftUpPt += deficitPt / 2;
      subShiftDownPt += deficitPt / 2;
    }
  }

  const ascentPt = Math.max(base.ascentPt, superscript === undefined ? 0 : supShiftUpPt + superscript.ascentPt);
  const descentPt = Math.max(base.descentPt, subscript === undefined ? 0 : subShiftDownPt + subscript.descentPt);
  const scriptWidthPt = Math.max(superscript?.widthPt ?? 0, subscript?.widthPt ?? 0);
  const widthPt = base.widthPt + (scriptWidthPt > 0 ? scriptWidthPt + metrics.spaceAfterScriptPt : 0);

  const items: MathLayoutItem[] = [...placeChild(base, 0, 0, ascentPt)];
  if (superscript !== undefined) {
    items.push(...placeChild(superscript, base.widthPt, -supShiftUpPt, ascentPt));
  }
  if (subscript !== undefined) {
    items.push(...placeChild(subscript, base.widthPt, subShiftDownPt, ascentPt));
  }
  return { widthPt, ascentPt, descentPt, heightPt: ascentPt + descentPt, items };
}

// True under/over stacking (munder/mover/munderover, or a movablelimits operator's own limits in displaystyle): centres `over`/`under` horizontally over the widest of the three boxes, and stacks them directly against `base`'s own ascent/descent edges with a fixed minimum gap -- see this module's own README/gotchas note on the deliberate simplification this makes (geometric centring, not accent-attachment-point centring, for accent="true" mover/munder).
function layoutUnderOver(base: MathBox, under: MathBox | undefined, over: MathBox | undefined, ctx: LayoutContext): MathBox {
  const gapPt = ctx.metrics.stackGapMinPt;
  const overHeightPt = over === undefined ? 0 : gapPt + over.heightPt;
  const underHeightPt = under === undefined ? 0 : gapPt + under.heightPt;
  const ascentPt = base.ascentPt + overHeightPt;
  const descentPt = base.descentPt + underHeightPt;
  const widthPt = Math.max(base.widthPt, under?.widthPt ?? 0, over?.widthPt ?? 0);

  const items: MathLayoutItem[] = [...placeChild(base, (widthPt - base.widthPt) / 2, 0, ascentPt)];
  if (over !== undefined) {
    // The over box's own bottom edge (descent) must land `gapPt` above base's own top edge (ascent above the shared baseline) -- i.e. its baseline sits `base.ascentPt + gapPt + over.descentPt` above the shared baseline.
    items.push(...placeChild(over, (widthPt - over.widthPt) / 2, -(base.ascentPt + gapPt + over.descentPt), ascentPt));
  }
  if (under !== undefined) {
    items.push(...placeChild(under, (widthPt - under.widthPt) / 2, base.descentPt + gapPt + under.ascentPt, ascentPt));
  }
  return { widthPt, ascentPt, descentPt, heightPt: ascentPt + descentPt, items };
}

function isMovableLimitsOperator(element: MathMlElement): boolean {
  return elementLocalName(element) === 'mo' && operatorProperties(textContent(element).trim()).movablelimits;
}

function layoutUnderOverElement(element: MathMlElement, kind: 'munder' | 'mover' | 'munderover', ctx: LayoutContext): MathBox {
  const children = elementChildren(element);
  const baseElement = children[0];
  if (baseElement === undefined) {
    return EMPTY_BOX;
  }

  // A movablelimits operator (sum, product, union, ...) renders its limits as an ordinary sub/sup pair outside display style -- the same \nolimits-vs-\limits distinction TeX makes -- and as a true stacked over/under only in display style.
  if (!ctx.displayStyle && isMovableLimitsOperator(baseElement)) {
    const base = layoutNode(baseElement, ctx);
    const scriptCtx = scriptContext(ctx, ctx.cramped);
    if (kind === 'munder') {
      const sub = children[1] === undefined ? undefined : layoutNode(children[1], scriptCtx);
      return layoutScripts(base, sub, undefined, ctx);
    }
    if (kind === 'mover') {
      const sup = children[1] === undefined ? undefined : layoutNode(children[1], scriptCtx);
      return layoutScripts(base, undefined, sup, ctx);
    }
    const sub = children[1] === undefined ? undefined : layoutNode(children[1], scriptCtx);
    const sup = children[2] === undefined ? undefined : layoutNode(children[2], scriptCtx);
    return layoutScripts(base, sub, sup, ctx);
  }

  const base = layoutNode(baseElement, ctx);
  const scriptCtx = scriptContext(ctx, false);
  if (kind === 'munder') {
    const under = children[1] === undefined ? undefined : layoutNode(children[1], scriptCtx);
    return layoutUnderOver(base, under, undefined, ctx);
  }
  if (kind === 'mover') {
    const over = children[1] === undefined ? undefined : layoutNode(children[1], scriptCtx);
    return layoutUnderOver(base, undefined, over, ctx);
  }
  const under = children[1] === undefined ? undefined : layoutNode(children[1], scriptCtx);
  const over = children[2] === undefined ? undefined : layoutNode(children[2], scriptCtx);
  return layoutUnderOver(base, under, over, ctx);
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
  const denominator = layoutNode(denominatorElement, { ...fracCtx, cramped: true });

  const metrics = ctx.metrics;
  const lineThicknessAttr = attrValue(element, 'linethickness');
  const ruleThicknessPt = (lineThicknessAttr === undefined ? undefined : parseMathLength(lineThicknessAttr, ctx.sizePt)) ?? metrics.fractionRuleThicknessPt;
  const axisPt = metrics.axisHeightPt;

  const numShiftUpPt = Math.max(
    ctx.displayStyle ? metrics.fractionNumeratorDisplayShiftUpPt : metrics.fractionNumeratorShiftUpPt,
    axisPt + ruleThicknessPt / 2 + metrics.fractionNumeratorGapMinPt + numerator.descentPt,
  );
  const denShiftDownPt = Math.max(
    ctx.displayStyle ? metrics.fractionDenominatorDisplayShiftDownPt : metrics.fractionDenominatorShiftDownPt,
    ruleThicknessPt / 2 + metrics.fractionDenominatorGapMinPt + denominator.ascentPt - axisPt,
  );

  const widthPt = Math.max(numerator.widthPt, denominator.widthPt);
  const ascentPt = numShiftUpPt + numerator.ascentPt;
  const descentPt = denShiftDownPt + denominator.descentPt;

  const items: MathLayoutItem[] = [
    ...placeChild(numerator, (widthPt - numerator.widthPt) / 2, -numShiftUpPt, ascentPt),
    ...placeChild(denominator, (widthPt - denominator.widthPt) / 2, denShiftDownPt, ascentPt),
    { kind: 'rule', xPt: 0, yPt: ascentPt - axisPt - ruleThicknessPt / 2, widthPt, heightPt: ruleThicknessPt, color: ctx.color },
  ];
  return { widthPt, ascentPt, descentPt, heightPt: ascentPt + descentPt, items };
}

function layoutRadical(element: MathMlElement, kind: 'msqrt' | 'mroot', ctx: LayoutContext): MathBox {
  const children = elementChildren(element);

  if (kind === 'msqrt') {
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
  const index = indexElement === undefined ? undefined : layoutNode(indexElement, scriptContext(scriptContext(ctx, false), false));
  return wrapRadical(radicand, index, ctx);
}

function wrapRadical(radicand: MathBox, index: MathBox | undefined, ctx: LayoutContext): MathBox {
  const metrics = ctx.metrics;
  const ruleThicknessPt = metrics.radicalRuleThicknessPt;
  const gapPt = metrics.radicalVerticalGapPt;
  const signHeightPt = metrics.radicalExtraAscenderPt + ruleThicknessPt + gapPt + radicand.heightPt;

  const degreeWidthPt = index === undefined ? 0 : metrics.radicalKernBeforeDegreePt + index.widthPt + metrics.radicalKernAfterDegreePt;
  const signOriginXPt = Math.max(0, degreeWidthPt);

  const sign = buildRadicalSign(signOriginXPt, 0, signHeightPt, radicand.widthPt, ruleThicknessPt, ctx.color);

  const ascentPt = metrics.radicalExtraAscenderPt + ruleThicknessPt + gapPt + radicand.ascentPt;
  const descentPt = radicand.descentPt;
  const widthPt = signOriginXPt + sign.widthPt + radicand.widthPt;

  const items: MathLayoutItem[] = [sign.hook, sign.vinculum, ...placeChild(radicand, signOriginXPt + sign.widthPt, 0, ascentPt)];

  if (index !== undefined) {
    // The degree sits raised from the sign's own bottom by radicalDegreeBottomRaisePercent% of the sign's own visible height (ascentPt + descentPt of the WHOLE radical, per the OpenType MATH spec's own definition) -- a real, font-driven placement, not a fixed fraction picked by this module.
    const raisePt = ((ascentPt + descentPt) * metrics.radicalDegreeBottomRaisePercent) / 100;
    const degreeBaselineFromTopPt = ascentPt + descentPt - raisePt - index.descentPt;
    items.push(...shiftItems(index.items, metrics.radicalKernBeforeDegreePt, degreeBaselineFromTopPt - index.ascentPt));
  }

  return { widthPt, ascentPt, descentPt, heightPt: ascentPt + descentPt, items };
}

function layoutTable(element: MathMlElement, ctx: LayoutContext): MathBox {
  const rows = elementChildren(element).filter((child) => elementLocalName(child) === 'mtr');
  if (rows.length === 0) {
    return EMPTY_BOX;
  }
  const columnAligns = (attrValue(element, 'columnalign') ?? '').trim().split(/\s+/).filter((s) => s.length > 0);

  const rowCells: MathBox[][] = rows.map((row) => elementChildren(row).filter((child) => elementLocalName(child) === 'mtd').map((cell) => layoutRowChildren(elementChildren(cell), ctx)));

  const columnCount = rowCells.reduce((max, row) => Math.max(max, row.length), 0);
  if (columnCount === 0) {
    return EMPTY_BOX;
  }
  const columnWidthsPt: number[] = [];
  for (let column = 0; column < columnCount; column++) {
    columnWidthsPt.push(rowCells.reduce((max, row) => Math.max(max, row[column]?.widthPt ?? 0), 0));
  }

  const columnGapPt = 0.8 * ctx.sizePt;
  const rowGapPt = 0.5 * ctx.sizePt;

  const items: MathLayoutItem[] = [];
  let cursorYTopPt = 0;
  rowCells.forEach((row, rowIndex) => {
    const rowAscentPt = row.reduce((max, cell) => Math.max(max, cell.ascentPt), 0);
    const rowDescentPt = row.reduce((max, cell) => Math.max(max, cell.descentPt), 0);
    let cursorXPt = 0;
    row.forEach((cell, columnIndex) => {
      const columnWidthPt = columnWidthsPt[columnIndex] ?? cell.widthPt;
      const align = columnAligns[columnIndex] ?? columnAligns[columnAligns.length - 1] ?? 'center';
      const extraPt = columnWidthPt - cell.widthPt;
      const dxPt = align === 'left' ? 0 : align === 'right' ? extraPt : extraPt / 2;
      items.push(...placeChild(cell, cursorXPt + dxPt, 0, cursorYTopPt + rowAscentPt));
      cursorXPt += columnWidthPt + columnGapPt;
    });
    cursorYTopPt += rowAscentPt + rowDescentPt + (rowIndex < rowCells.length - 1 ? rowGapPt : 0);
  });

  const totalHeightPt = cursorYTopPt;
  const widthPt = columnWidthsPt.reduce((sum, w) => sum + w, 0) + columnGapPt * Math.max(0, columnCount - 1);
  let descentPt = totalHeightPt - (totalHeightPt / 2 + ctx.metrics.axisHeightPt);
  if (descentPt < 0) {
    descentPt = 0;
  }
  const ascentPt = totalHeightPt - descentPt;
  return { widthPt, ascentPt, descentPt, heightPt: totalHeightPt, items };
}

function layoutSpace(element: MathMlElement, ctx: LayoutContext): MathBox {
  const widthAttr = attrValue(element, 'width');
  const heightAttr = attrValue(element, 'height');
  const depthAttr = attrValue(element, 'depth');
  const widthPt = Math.max(0, (widthAttr === undefined ? undefined : parseMathLength(widthAttr, ctx.sizePt)) ?? 0);
  const ascentPt = Math.max(0, (heightAttr === undefined ? undefined : parseMathLength(heightAttr, ctx.sizePt)) ?? 0);
  const descentPt = Math.max(0, (depthAttr === undefined ? undefined : parseMathLength(depthAttr, ctx.sizePt)) ?? 0);
  return { widthPt, ascentPt, descentPt, heightPt: ascentPt + descentPt, items: [] };
}

// The single recursive dispatch every MathML element in this module's own supported set (and every unsupported one, via the textContent fallback) goes through. A non-element node (a whitespace-only text node between siblings -- normal, valid MathML formatting) contributes nothing and is not itself a diagnostic-worthy event.
export function layoutNode(node: MathMlNode, ctx: LayoutContext): MathBox {
  if (!isMathMlElement(node)) {
    return EMPTY_BOX;
  }
  const name = elementLocalName(node);

  switch (name) {
    case 'mrow':
      return layoutRowChildren(elementChildren(node), ctx);
    case 'semantics':
      return layoutSemantics(node, ctx);
    case 'mstyle':
      return layoutRowChildren(elementChildren(node), mstyleContext(node, ctx));
    case 'mi': {
      const text = textContent(node);
      return layoutToken(text, tokenVariant(node, miIntrinsicDefault(text), ctx), ctx);
    }
    case 'mn':
      return layoutToken(textContent(node), tokenVariant(node, 'normal', ctx), ctx);
    case 'mo':
      return layoutToken(textContent(node).trim(), tokenVariant(node, 'normal', ctx), ctx);
    case 'mtext':
      return layoutToken(textContent(node), tokenVariant(node, 'normal', ctx), ctx);
    case 'mspace':
      return layoutSpace(node, ctx);
    case 'msub': {
      const children = elementChildren(node);
      const base = children[0] === undefined ? EMPTY_BOX : layoutNode(children[0], ctx);
      const sub = children[1] === undefined ? undefined : layoutNode(children[1], scriptContext(ctx, ctx.cramped));
      return layoutScripts(base, sub, undefined, ctx);
    }
    case 'msup': {
      const children = elementChildren(node);
      const base = children[0] === undefined ? EMPTY_BOX : layoutNode(children[0], ctx);
      const sup = children[1] === undefined ? undefined : layoutNode(children[1], scriptContext(ctx, ctx.cramped));
      return layoutScripts(base, undefined, sup, ctx);
    }
    case 'msubsup': {
      const children = elementChildren(node);
      const base = children[0] === undefined ? EMPTY_BOX : layoutNode(children[0], ctx);
      const scriptCtx = scriptContext(ctx, ctx.cramped);
      const sub = children[1] === undefined ? undefined : layoutNode(children[1], scriptCtx);
      const sup = children[2] === undefined ? undefined : layoutNode(children[2], scriptCtx);
      return layoutScripts(base, sub, sup, ctx);
    }
    case 'munder':
      return layoutUnderOverElement(node, 'munder', ctx);
    case 'mover':
      return layoutUnderOverElement(node, 'mover', ctx);
    case 'munderover':
      return layoutUnderOverElement(node, 'munderover', ctx);
    case 'mfrac':
      return layoutFraction(node, ctx);
    case 'msqrt':
      return layoutRadical(node, 'msqrt', ctx);
    case 'mroot':
      return layoutRadical(node, 'mroot', ctx);
    case 'mtable':
      return layoutTable(node, ctx);
    case 'mtr':
    case 'mtd':
      // Reached only if a caller lays one out directly rather than through 'mtable' (e.g. a malformed tree) -- treated as an implicit mrow of its own children, the same fallback MathML itself defines for an mtd encountered outside any row/table context.
      return layoutRowChildren(elementChildren(node), ctx);
    default:
      return unsupported(ctx, node);
  }
}

// The public entry point: lays out a full formula (odf.js's own readOdfFormula's `mathml: XmlNode[]` -- the children of the <math> root element) at a given font size/colour, using `options.metrics` for every measurement. Multiple root-level nodes (rare, but the MathML content model permits more than one child directly under <math>) are laid out as an implicit row, matching how a <mrow> would combine them.
export function layoutFormula(mathml: readonly MathMlNode[], options: LayoutFormulaOptions): MathLayoutResult {
  const diagnostics: MathDiagnostic[] = [];
  const ctx = rootContext(options, diagnostics);
  const elements = mathml.filter(isMathMlElement);
  const box = layoutRowChildren(elements, ctx);
  return { box, diagnostics };
}
