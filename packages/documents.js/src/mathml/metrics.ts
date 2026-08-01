// The font-metrics port this layout engine depends on, never a concrete implementation: src/mathml/ has zero PDF or font-parsing knowledge of its own (matching this package's "layout only" isolation rule), so every measurement it needs -- glyph advance widths, italic correction, top-accent attachment, and the ~30 OpenType MATH "MathConstants" values that drive fraction/radical/script positioning -- arrives through this interface instead. src/pdf/math-font.ts is the real implementation, parsing the actual embedded STIX Two Math font's own MATH table; src/test-support/mathml.ts supplies a small synthetic implementation for this module's own unit tests, so layout correctness can be verified without needing a real font file in play.
//
// Every *Pt field here is already in points at the CALLER's requested font size (glyph()'s own sizePt parameter) -- not font design units, and not em-relative -- so layout.ts never needs to know the font's unitsPerEm or do any of its own unit conversion; that conversion is entirely the implementation's job (see math-font.ts's own toPt helper).
export interface MathGlyphMetrics {
  readonly advanceWidthPt: number;
  // The glyph's own italic correction (OpenType MATH's MathItalicsCorrectionInfo): how far a following glyph should shift right to clear this glyph's own slant -- applied after the last glyph of an italic run before whatever follows it (e.g. before a following superscript, per the OpenType MATH spec's own guidance).
  readonly italicCorrectionPt: number;
  // The x position (from the glyph's own left origin) where a combining accent placed above/below this glyph via mover/munder accent="true" should centre itself -- undefined when the font's MathTopAccentAttachment table has no entry for this glyph, in which case the caller falls back to the glyph's own horizontal midpoint.
  readonly topAccentXPt?: number;
}

export interface MathFontMetrics {
  // The font's own overall design ascent/descent, as a fraction of its own em size (e.g. 0.762 for an ascender at 762/1000 units-per-em) -- used as a uniform vertical extent for every token glyph run (mi/mn/mo/mtext), since this module deliberately does not parse per-glyph ink bounding boxes (no glyf/CFF outline parsing -- see math-font.ts's own module comment on why). A real, honest simplification: a token run's box is sized from the font's nominal vertical metrics, not this specific glyph's own tight ink extent, which is accurate enough for box-model layout (spacing, alignment, pagination) but not pixel-tight around unusually tall or shallow glyphs.
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
}
