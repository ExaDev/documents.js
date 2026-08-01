// A local, structurally-compatible mirror of documents.js's own src/mathml/layout-types.ts + src/mathml/metrics.ts (the MathML layout engine itself stays in documents.js -- see this package's own README for why). Deliberately not imported from documents.js, for the same "zero dependency, zero circular reference" reason documents.js's own nodes.ts mirrors odf.js's XmlNode rather than importing it: passing a real MathBox value produced by documents.js's own layoutFormula() into this package's writePdf({ formulas }) type-checks with no cast, no wrapper, and no transformation, since the shapes are structurally identical. Only MathFontMetrics carries a method (glyph()); every other type here is plain data.
//
// This file is the single highest-risk correctness point in the whole pdf-codec extraction: any field drift between this copy and documents.js's own src/mathml/layout-types.ts + src/mathml/metrics.ts breaks silently at documents.js's own call sites (a TS error there, not a failing test here). Cross-reference both files whenever either changes.

// A local, structurally-compatible mirror of document-schema.js's own Color (r/g/b, 0..1) -- deliberately not imported, for the same "zero dependency" reason documented above: passing document-schema.js's own COLOR_BLACK (or any Color value) into a MathColor-typed field type-checks with no cast, since the shapes are identical.
export interface MathColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

// One contiguous run of same-size, same-baseline Unicode text (already mathvariant-mapped by documents.js's own variant.ts), positioned box-local (top-left origin, y-down, matching the OOXML/ODF-derived coordinate convention this package's own geometry.ts flipY expects). `yPt` is the run's own BASELINE, not its top edge. A consuming PDF writer advances glyph-to-glyph using its own embedded font's hmtx widths (the same widths this package's own math-font.ts already measured `text` with via MathFontMetrics.glyph), so this is deliberately one string per run rather than one item per glyph.
export interface MathGlyphRun {
  readonly kind: 'glyphs';
  readonly xPt: number;
  readonly yPt: number;
  readonly text: string;
  readonly sizePt: number;
  readonly color: MathColor;
}

// A filled, axis-aligned horizontal or vertical bar: a fraction's own rule, a radical's own vinculum (the horizontal bar over the radicand), or an over/underline. Box-local, top-left corner + size, y-down.
export interface MathRule {
  readonly kind: 'rule';
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly color: MathColor;
}

// An open polyline stroke: the radical sign's own diagonal hook, which a filled MathRule can't express (it isn't axis-aligned). Box-local, y-down, at least two points, connected by straight line segments in order -- no curves, since a hand-constructed radical hook is a small number of straight segments, not a font glyph outline.
export interface MathStroke {
  readonly kind: 'stroke';
  readonly points: readonly { readonly xPt: number; readonly yPt: number }[];
  readonly widthPt: number;
  readonly color: MathColor;
}

export type MathLayoutItem = MathGlyphRun | MathRule | MathStroke;

// The result of laying out one MathML (sub)tree: a bounding box (widthPt = full width; heightPt = ascentPt + descentPt) plus every positioned item inside it, already flattened to box-local absolute coordinates -- a parent box that embeds a child box does so by adding its own child-placement offset to every one of the child's items and splicing them into its own flat `items` array, rather than nesting MathBox values inside each other. This is deliberately the flattest shape that still lets this package's own math-content-write.ts consume a whole formula with a single, non-recursive walk: add the box's own page-placement offset once, emit every item.
export interface MathBox {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly ascentPt: number;
  readonly descentPt: number;
  readonly items: readonly MathLayoutItem[];
}

// The font-metrics port this package's own math-font.ts implements, structurally mirroring documents.js's own src/mathml/metrics.ts -- see that file's own comment for the full rationale (documents.js's layout engine has zero PDF or font-parsing knowledge of its own, so every measurement it needs arrives through this interface). math-font.ts parses the actual embedded STIX Two Math font's own MATH table to implement it.
//
// Every *Pt field here is already in points at the CALLER's requested font size (glyph()'s own sizePt parameter) -- not font design units, and not em-relative -- so a layout engine never needs to know the font's unitsPerEm or do any of its own unit conversion; that conversion is entirely the implementation's job (see math-font.ts's own toPt helper).
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

  // Per-glyph metrics for the Unicode code point `codePoint`, rendered at `sizePt`. Returns undefined when the font has no glyph for this code point at all (documents.js's own mapMathVariant already degrades a character with no styled glyph back to its base form before this is ever called, so an undefined result here means the BASE character itself is missing from the font -- a genuinely unsupported character, not a variant-mapping gap).
  glyph(codePoint: number, sizePt: number): MathGlyphMetrics | undefined;
}
