import type { Color } from './color';

// The MathML layout port contracts: the box/item shapes a MathML typesetting engine produces and the font-metrics port it consumes. The engine itself (documents.js's src/mathml/) and the font-metrics implementation (pdf-codec's math-font.ts, over the embedded STIX Two Math font) stay in their packages; only the shared shapes live here, so the engine and the writer agree on one canonical definition rather than maintaining structural mirrors that can silently drift. Mirrors src/codec.ts's own precedent of hosting contracts alongside the Zod schemas.

// Identical to Color (sRGB r/g/b in 0..1). Aliased rather than repeated so a MathColor value IS a Color value, structurally and nominally.
export type MathColor = Color;

// One contiguous run of same-size, same-baseline Unicode text (already mathvariant-mapped), positioned box-local (top-left origin, y-down). `yPt` is the run's own baseline, not its top edge.
export interface MathGlyphRun {
  readonly kind: 'glyphs';
  readonly xPt: number;
  readonly yPt: number;
  readonly text: string;
  readonly sizePt: number;
  readonly color: MathColor;
}

// A filled, axis-aligned bar: a fraction's rule, a radical's vinculum, or an over/underline. Box-local, top-left corner + size, y-down.
export interface MathRule {
  readonly kind: 'rule';
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly color: MathColor;
}

// An open polyline stroke: the radical sign's own diagonal hook, which a filled MathRule cannot express (it is not axis-aligned). Box-local, y-down, at least two points, connected by straight segments in order.
export interface MathStroke {
  readonly kind: 'stroke';
  readonly points: readonly { readonly xPt: number; readonly yPt: number }[];
  readonly widthPt: number;
  readonly color: MathColor;
}

// One glyph of the embedded math font addressed by GLYPH ID rather than by Unicode character, drawn at an explicitly computed position. `yPt` is that glyph's own baseline origin, box-local and y-down, exactly as MathGlyphRun.yPt is. Most stretchy-construction glyphs have no Unicode code point in the font's cmap, so they travel by glyph id, not by text.
export interface MathGlyphPlacement {
  readonly glyphId: number;
  readonly xPt: number;
  readonly yPt: number;
}

// A stretchy operator drawn from the font's own OpenType MATH MathVariants data: either one pre-built larger variant glyph, or a genuine multi-part assembly. Addressed by glyph id (most construction glyphs are unencoded); `text` carries the operator's original Unicode text so a consuming writer can emit it for copy/paste and search, since the glyphs themselves have no ToUnicode mapping. `sizePt` is the font size the glyphs are shown at, not the size the construction was stretched to -- that extent is baked into the placements' positions.
export interface MathAssembledGlyphs {
  readonly kind: 'assembled-glyphs';
  readonly placements: readonly MathGlyphPlacement[];
  readonly text: string;
  readonly sizePt: number;
  readonly color: MathColor;
}

export type MathLayoutItem = MathGlyphRun | MathRule | MathStroke | MathAssembledGlyphs;

// The result of laying out one MathML (sub)tree: a bounding box (widthPt = full width; heightPt = ascentPt + descentPt) plus every positioned item inside it, already flattened to box-local absolute coordinates -- a parent box embeds a child by adding its own child-placement offset to every one of the child's items and splicing them into its own flat `items` array, rather than nesting MathBox values. Deliberately the flattest shape that still lets a consuming writer walk a whole formula non-recursively: add the box's own page-placement offset once, emit every item.
export interface MathBox {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly ascentPt: number;
  readonly descentPt: number;
  readonly items: readonly MathLayoutItem[];
}

// Per-glyph metrics in points at the caller's requested size. `advanceWidthPt` is what a layout engine uses to advance glyph-to-glyph; `italicCorrectionPt` shifts a following glyph clear of this glyph's slant; `topAccentXPt` is where a combining accent above/below should centre; `inkAscentPt`/`inkDescentPt` are this glyph's own tight ink extent (measured from its outline, not the font-wide nominal), undefined together for a glyph that draws nothing or whose outline is not walked. `inkDescentPt` is negative for a glyph whose lowest ink sits above the baseline.
export interface MathGlyphMetrics {
  readonly advanceWidthPt: number;
  readonly italicCorrectionPt: number;
  readonly topAccentXPt?: number;
  readonly inkAscentPt?: number;
  readonly inkDescentPt?: number;
}

// Which extent a stretchy glyph is being stretched along: its height (a tall parenthesis, brace, bracket, or radical sign) or its width (an over/under-brace, a long arrow). A font declares a separate construction per axis.
export type MathStretchAxis = 'vertical' | 'horizontal';

// One glyph of a resolved stretchy construction. `offsetPt` is measured along the stretch axis, from the construction's own drawing origin to this glyph's own drawing origin -- upward for a vertical construction (parts ordered bottom to top), rightward for a horizontal one.
export interface MathStretchGlyph {
  readonly glyphId: number;
  readonly offsetPt: number;
}

// A stretchy glyph resolved to concrete, drawable placements at one target size. `kind` records the OpenType MATH outcome: 'base' (the unstretched form already reaches the target, or is all the font offers), 'variant' (a pre-built larger glyph), 'assembly' (built from repeated parts). `sizePt` is the extent actually achieved along the stretch axis, >= the requested target whenever the font can reach it. `inkAscentPt`/`inkDescentPt` are the whole construction's real ink extent (from outlines, not advances) -- the only thing that lets a caller centre the construction on the maths axis and give it a box that fits it. `advanceWidthPt` is the construction's horizontal advance.
export interface MathStretchResult {
  readonly kind: 'base' | 'variant' | 'assembly';
  readonly sizePt: number;
  readonly advanceWidthPt: number;
  readonly inkAscentPt: number;
  readonly inkDescentPt: number;
  readonly placements: readonly MathStretchGlyph[];
}

// The font-metrics port a MathML layout engine consumes. Every *Pt field is already in points at the caller's requested font size (not design units, not em-relative) -- a layout engine never needs the font's unitsPerEm or its own unit conversion; that is entirely the implementation's job. `glyph()` returns undefined for a code point the font has no glyph for; `stretch()` returns undefined when the font declares no construction for that glyph/axis or no placement's outline could be measured -- in both cases the caller draws the unstretched base glyph as ordinary text.
export interface MathFontMetrics {
  readonly ascentPerEm: number;
  readonly descentPerEm: number;
  readonly axisHeightPt: number;
  readonly fractionRuleThicknessPt: number;
  readonly fractionNumeratorShiftUpPt: number;
  readonly fractionNumeratorDisplayShiftUpPt: number;
  readonly fractionDenominatorShiftDownPt: number;
  readonly fractionDenominatorDisplayShiftDownPt: number;
  readonly fractionNumeratorGapMinPt: number;
  readonly fractionDenominatorGapMinPt: number;
  readonly radicalRuleThicknessPt: number;
  readonly radicalExtraAscenderPt: number;
  readonly radicalVerticalGapPt: number;
  readonly radicalKernBeforeDegreePt: number;
  readonly radicalKernAfterDegreePt: number;
  readonly radicalDegreeBottomRaisePercent: number; // a percentage (0..100) of the radicand's own (ascent - descent), per the OpenType MATH spec
  readonly subscriptShiftDownPt: number;
  readonly superscriptShiftUpPt: number;
  readonly superscriptShiftUpCrampedPt: number;
  readonly subSuperscriptGapMinPt: number;
  readonly superscriptBaselineDropMaxPt: number;
  readonly subscriptBaselineDropMinPt: number;
  readonly spaceAfterScriptPt: number;
  readonly upperLimitGapMinPt: number;
  readonly upperLimitBaselineRiseMinPt: number;
  readonly lowerLimitGapMinPt: number;
  readonly lowerLimitBaselineDropMinPt: number;
  readonly stackTopShiftUpPt: number;
  readonly stackBottomShiftDownPt: number;
  readonly stackGapMinPt: number;
  readonly scriptPercentScaleDown: number; // e.g. 0.71, not 71 -- already divided by 100
  readonly scriptScriptPercentScaleDown: number;
  // Line thickness for a plain (non-fraction) rule -- derived by the implementation from FractionRuleThickness, the nearest genuine spec field, since most math fonts use the same nominal rule weight for both.
  readonly defaultRuleThicknessPt: number;

  glyph(codePoint: number, sizePt: number): MathGlyphMetrics | undefined;

  stretch(codePoint: number, axis: MathStretchAxis, targetSizePt: number, sizePt: number): MathStretchResult | undefined;
}

// A formula laid out to a MathBox, positioned on a PDF page (page index + x/y). The bridge between a layout engine's output and a writer that renders it; the writer takes PositionedFormula[] so a formula's CID-font glyph runs (which have no LayoutItem kind of their own) travel beside the LayoutDocument rather than inside it.
export interface PositionedFormula {
  readonly pageIndex: number;
  readonly xPt: number;
  readonly yPt: number;
  readonly box: MathBox;
}
