// The font-metrics port this layout engine depends on, never a concrete implementation: src/mathml/ has zero PDF or font-parsing knowledge of its own (matching this package's "layout only" isolation rule), so every measurement it needs -- glyph advance widths, italic correction, top-accent attachment, optional per-glyph ink bounds, and the ~30 OpenType MATH "MathConstants" values that drive fraction/radical/script positioning -- arrives through this interface instead. pdf-codec's math-font.ts is the real implementation, parsing the actual embedded STIX Two Math font's own MATH table; this module's own tests (src/mathml/layout.test.ts) use that real implementation directly via pdf-codec's loadMathFont(), rather than a synthetic one, so layout correctness is verified against real font data throughout.
//
// Every *Pt field here is already in points at the CALLER's requested font size (glyph()'s own sizePt parameter) -- not font design units, and not em-relative -- so layout.ts never needs to know the font's unitsPerEm or do any of its own unit conversion; that conversion is entirely the implementation's job (see math-font.ts's own toPt helper).
export interface MathGlyphMetrics {
  readonly advanceWidthPt: number;
  // The glyph's own italic correction (OpenType MATH's MathItalicsCorrectionInfo): how far a following glyph should shift right to clear this glyph's own slant -- applied after the last glyph of an italic run before whatever follows it (e.g. before a following superscript, per the OpenType MATH spec's own guidance).
  readonly italicCorrectionPt: number;
  // The x position (from the glyph's own left origin) where a combining accent placed above/below this glyph via mover/munder accent="true" should centre itself -- undefined when the font's MathTopAccentAttachment table has no entry for this glyph, in which case the caller falls back to the glyph's own horizontal midpoint.
  readonly topAccentXPt?: number;
  // The glyph's own real, tight ink bounds above/below the baseline (from actual outline/charstring geometry), already in points at sizePt -- both undefined when the implementation has no glyph-outline parsing to derive them from (e.g. a font backend with no glyf/CFF geometry extraction), in which case layoutToken falls back to MathFontMetrics.ascentPerEm/descentPerEm for that glyph instead. Either field may be present independently of the other.
  readonly inkAscentPt?: number;
  readonly inkDescentPt?: number;
}

// Which extent a stretchy glyph is being stretched along: its height (a tall parenthesis, brace, bracket, or radical sign) or its width (an over/under-brace, a long arrow). A font declares a separate construction per axis, and a given glyph is usually covered by exactly one of them.
export type MathStretchAxis = 'vertical' | 'horizontal';

// One glyph of a resolved stretchy construction. `offsetPt` is measured along the STRETCH AXIS, from the construction's own drawing origin to this glyph's own drawing origin -- upward for a vertical construction (whose parts are ordered bottom to top), rightward for a horizontal one. Every other glyph in the construction shares the same position on the other axis.
export interface MathStretchGlyph {
  readonly glyphId: number;
  readonly offsetPt: number;
}

// A stretchy glyph resolved to concrete, drawable placements at one target size. `kind` records which of the OpenType MATH spec's three outcomes produced it: 'base' when the glyph's own unstretched form was already big enough (or is all the font offers), 'variant' when a pre-built larger glyph was selected, 'assembly' when the construction was genuinely built from repeated parts. `sizePt` is the extent actually achieved along the stretch axis, which is >= the requested target whenever the font can reach it and the largest reachable size otherwise.
//
// `inkAscentPt`/`inkDescentPt` are the whole construction's own REAL ink extent above and below its drawing origin, measured from actual glyph outlines rather than from the nominal advances -- the only thing that lets a caller centre the construction on the maths axis and give it a box that genuinely fits it, since a construction's ink neither starts at its drawing origin (a large parenthesis variant straddles the baseline; a vertical bar's assembly parts descend below it) nor is bounded by `sizePt` (which measures advance along the axis, not ink). Both follow the same sign convention as MathGlyphMetrics.inkAscentPt/inkDescentPt: ink above the origin is a positive ascent, ink below it a positive descent. `advanceWidthPt` is the construction's own horizontal advance -- wider than the base glyph's for a stretched fence, since a taller bracket is drawn from heavier parts.
export interface MathStretchResult {
  readonly kind: 'base' | 'variant' | 'assembly';
  readonly sizePt: number;
  readonly advanceWidthPt: number;
  readonly inkAscentPt: number;
  readonly inkDescentPt: number;
  readonly placements: readonly MathStretchGlyph[];
}

export interface MathFontMetrics {
  // The font's own overall design ascent/descent, as a fraction of its own em size (e.g. 0.762 for an ascender at 762/1000 units-per-em) -- used as the fallback vertical extent for a token glyph run (mi/mn/mo/mtext) whenever the queried glyph metric doesn't carry its own real ink bounds (MathGlyphMetrics.inkAscentPt/inkDescentPt), e.g. because the implementation does no glyf/CFF outline parsing at all (see math-font.ts's own module comment on why that may be the case). When a glyph DOES carry ink bounds, layoutToken uses those instead -- and, for a multi-character token, unions every character's own bounds -- for a tighter box than this nominal, uniform-per-font extent would give.
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
  // Line thickness for a plain (non-fraction) rule -- e.g. the em-dash-adjacent default rule width most MATH-aware renderers fall back to for a construct with no dedicated MathConstants field. Not itself an OpenType MATH constant; math-font.ts derives it from FractionRuleThickness, the nearest genuine spec field, since STIX Two Math (like most math fonts) uses the same nominal rule weight for both.
  readonly defaultRuleThicknessPt: number;

  // Per-glyph metrics for the Unicode code point `codePoint`, rendered at `sizePt`. Returns undefined when the font has no glyph for this code point at all (mapMathVariant already degrades a character with no styled glyph back to its base form before this is ever called, so an undefined result here means the BASE character itself is missing from the font -- a genuinely unsupported character, not a variant-mapping gap).
  glyph(codePoint: number, sizePt: number): MathGlyphMetrics | undefined;

  // Resolves the font's own OpenType MATH MathVariants data for `codePoint` into concrete, drawable glyph placements reaching `targetSizePt` along `axis`, for an operator being set at `sizePt`. Every length on the result is in points at `sizePt`, matching every other *Pt field here.
  //
  // Returns undefined in two cases, both of which mean the caller should draw the unstretched base glyph as ordinary text instead: the font declares no stretching for that glyph on that axis at all (the character is simply not stretchy in this font, whatever an operator dictionary may say about it), or the implementation cannot measure the resulting construction's own ink extent and therefore cannot place it. Layout never needs to distinguish the two, since the response to both is identical.
  stretch(codePoint: number, axis: MathStretchAxis, targetSizePt: number, sizePt: number): MathStretchResult | undefined;
}
