// A local, structurally-compatible mirror of documents.js's own src/mathml/layout-types.ts + src/mathml/metrics.ts (the MathML layout engine itself stays in documents.js -- see this package's own README for why). Deliberately not imported from documents.js, for the same "zero dependency, zero circular reference" reason documents.js's own nodes.ts mirrors odf.js's XmlNode rather than importing it: passing a real MathBox value produced by documents.js's own layoutFormula() into this package's writePdf({ formulas }) type-checks with no cast, no wrapper, and no transformation, since the shapes are structurally identical. Only MathFontMetrics carries methods (glyph(), stretch()); every other type here is plain data.
//
// This file is the single highest-risk correctness point in the whole pdf-codec extraction: any field drift between this copy and documents.js's own src/mathml/layout-types.ts + src/mathml/metrics.ts breaks silently at documents.js's own call sites (a TS error there, not a failing test here). Cross-reference both files whenever either changes.
import type { MathStretchAxis } from './math-stretch';

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

// One glyph of the embedded math font addressed by GLYPH ID rather than by Unicode character, drawn at an explicitly computed position. `yPt` is that glyph's own BASELINE origin, box-local and y-down, exactly as MathGlyphRun.yPt is.
export interface MathGlyphPlacement {
  readonly glyphId: number;
  readonly xPt: number;
  readonly yPt: number;
}

// A stretchy operator drawn from the font's own OpenType MATH MathVariants data (math-stretch.ts): either one pre-built larger variant glyph, or a genuine multi-part assembly whose pieces are stacked along the stretch axis with overlapping connectors, sized to the content the operator wraps rather than to the operator's own fixed base size. Addressed by glyph ID because most of these glyphs have NO Unicode code point at all in this font's own cmap -- verified against the real vendored STIX Two Math font in math-stretch.test.ts: every pre-built variant beyond the base glyph is unencoded, as are the radical's and the over-brace's assembly pieces, and only the bracket family's own pieces have code points (the U+239B..U+23AD block) -- so they cannot travel through MathGlyphRun.text at all. They are still drawable, because the composite font this package embeds is Identity-H with CID == GID (see math-font.ts's own module comment), which makes a bare glyph ID directly showable with no cmap involvement. `text` is the operator's own original Unicode text ("(", "["), carried so this package's own math-content-write.ts can emit it as an /ActualText marked-content span -- copy/paste and text search keep working for a construction whose glyphs have no ToUnicode mapping of their own. `sizePt` is the font size the glyphs are shown at (the same meaning MathGlyphRun.sizePt carries), not the size the construction was stretched to -- that extent is already baked into the placements' own positions.
export interface MathAssembledGlyphs {
  readonly kind: 'assembled-glyphs';
  readonly placements: readonly MathGlyphPlacement[];
  readonly text: string;
  readonly sizePt: number;
  readonly color: MathColor;
}

export type MathLayoutItem = MathGlyphRun | MathRule | MathStroke | MathAssembledGlyphs;

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
  // This glyph's own TIGHT INK extent above and below the baseline, measured from its actual outline (math-font.ts walks the embedded font's Type 2 charstrings -- see cff-bounds.ts) rather than from the font-wide nominal ascent/descent below. A layout engine sizing a token box from these gets a box that fits the characters it actually contains: a full stop is a few tenths of an em tall, a bracket most of an em, where ascentPerEm/descentPerEm would give both the same vertical extent.
  //
  // Both are in points at the caller's requested size, and both follow ascentPerEm/descentPerEm's own sign convention: ink above the baseline is a positive ascent, ink below it a positive descent. `inkDescentPt` is therefore NEGATIVE for a glyph that draws nothing below the baseline (its lowest ink genuinely sits above it) -- a consumer wanting a box that never crosses the baseline clamps at zero itself rather than being handed a pre-clamped, less informative number.
  //
  // Both are undefined together, for a glyph that draws nothing at all (a space) or whose outline this package declines to walk; a caller falls back to the nominal metrics for that glyph. They are optional for that reason and because this interface is a structural mirror shared with documents.js (see this file's own header): an implementation that supplies neither still satisfies it.
  readonly inkAscentPt?: number;
  readonly inkDescentPt?: number;
}

// Structurally identical to (and deliberately re-exported from) math-stretch.ts's own MathStretchAxis, so this package carries one definition rather than a second copy that could drift from it -- documents.js's own src/mathml/metrics.ts declares the same union locally, which is all the structural compatibility this mirror needs.
export type { MathStretchAxis };

// One glyph of a resolved stretchy construction. `offsetPt` is measured along the STRETCH AXIS, from the construction's own drawing origin to this glyph's own drawing origin -- upward for a vertical construction (whose parts are ordered bottom to top), rightward for a horizontal one. Every other glyph in the construction shares the same position on the other axis. This is math-stretch.ts's own MathStretchPlacement expressed in points and without `advance`, which a layout engine placing the construction never needs -- a distinct type under a distinct name, since both are exported from this package's own index.
export interface MathStretchGlyph {
  readonly glyphId: number;
  readonly offsetPt: number;
}

// A stretchy glyph resolved to concrete, drawable placements at one target size. `kind` records which of the OpenType MATH spec's three outcomes produced it: 'base' when the glyph's own unstretched form was already big enough (or is all the font offers), 'variant' when a pre-built larger glyph was selected, 'assembly' when the construction was genuinely built from repeated parts. `sizePt` is the extent actually achieved along the stretch axis, which is >= the requested target whenever the font can reach it and the largest reachable size otherwise.
//
// `inkAscentPt`/`inkDescentPt` are the whole construction's own REAL ink extent above and below its drawing origin, measured from actual glyph outlines (cff-bounds.ts) rather than from the nominal advances -- the only thing that lets a caller centre the construction on the maths axis and give it a box that genuinely fits it, since a construction's ink neither starts at its drawing origin (a large parenthesis variant straddles the baseline; a vertical bar's assembly parts descend below it) nor is bounded by `sizePt` (which measures advance along the axis, not ink). Both follow the same sign convention as MathGlyphMetrics.inkAscentPt/inkDescentPt: ink above the origin is a positive ascent, ink below it a positive descent. `advanceWidthPt` is the construction's own horizontal advance -- wider than the base glyph's for a stretched fence, since a taller bracket is drawn from heavier parts.
export interface MathStretchResult {
  readonly kind: 'base' | 'variant' | 'assembly';
  readonly sizePt: number;
  readonly advanceWidthPt: number;
  readonly inkAscentPt: number;
  readonly inkDescentPt: number;
  readonly placements: readonly MathStretchGlyph[];
}

export interface MathFontMetrics {
  // The font's own overall design ascent/descent, as a fraction of its own em size (e.g. 0.762 for an ascender at 762/1000 units-per-em): one uniform vertical extent every glyph in the face shares. Still the right measure for anything sized against the FONT rather than against particular characters (a line's own leading, a fallback for a glyph with no outline to measure), but no longer the only thing on offer for a token box: MathGlyphMetrics.inkAscentPt/inkDescentPt above now carry each glyph's own real, tight ink extent, measured from its outline.
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

  // Resolves this font's own OpenType MATH MathVariants data for `codePoint` into concrete, drawable glyph placements reaching `targetSizePt` along `axis`, for an operator being set at `sizePt`. Every length on the result is in points at `sizePt`, matching every other *Pt field here. math-font.ts implements it over math-stretch.ts's own assembleStretchyGlyph, adding the real ink measurement a layout engine needs to place the result.
  //
  // Returns undefined in two cases, both of which mean the caller should draw the unstretched base glyph as ordinary text instead: the font declares no stretching for that glyph on that axis at all (the character is simply not stretchy in this font, whatever an operator dictionary may say about it), or no placement's own outline could be measured, leaving nothing to position the construction by. Layout never needs to distinguish the two, since the response to both is identical.
  stretch(codePoint: number, axis: MathStretchAxis, targetSizePt: number, sizePt: number): MathStretchResult | undefined;
}
