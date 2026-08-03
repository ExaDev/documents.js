// A local, structurally-compatible mirror of document-schema.js's own Color (r/g/b, 0..1) -- deliberately not imported, for the same "zero dependency" reason nodes.ts mirrors odf.js's XmlNode rather than importing it: passing document-schema.js's own COLOR_BLACK (or any Color value) into a MathColor-typed field type-checks with no cast, since the shapes are identical.
export interface MathColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

// One contiguous run of same-size, same-baseline Unicode text (already mathvariant-mapped -- see variant.ts), positioned box-local (top-left origin, y-down, matching this package's own established OOXML/ODF-derived coordinate convention -- see src/model/geometry.ts's flipY). `yPt` is the run's own BASELINE, not its top edge. A consuming PDF writer advances glyph-to-glyph using its own embedded font's hmtx widths (the same widths this module already measured `text` with via MathFontMetrics.glyph), so this is deliberately one string per run rather than one item per glyph.
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

// An open polyline stroke: the radical sign's own diagonal hook, which a filled MathRule can't express (it isn't axis-aligned). Box-local, y-down, at least two points, connected by straight line segments in order -- no curves, since a hand-constructed radical hook is a small number of straight segments (see layout.ts's own buildRadicalHook), not a font glyph outline.
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

// A stretchy operator drawn from the font's own OpenType MATH MathVariants data: either one pre-built larger variant glyph, or a genuine multi-part assembly whose pieces are stacked along the stretch axis with overlapping connectors, sized to the content the operator wraps rather than to the operator's own fixed base size. Addressed by glyph ID because most of these glyphs have NO Unicode code point at all in the font's own cmap -- verified against the real STIX Two Math font (see pdf-codec's own math-stretch.test.ts): every pre-built variant beyond the base glyph is unencoded, as are the radical's and the over-brace's assembly pieces, and only the bracket family's own pieces have code points (the U+239B..U+23AD block) -- so they cannot travel through MathGlyphRun.text at all. They are still drawable, because the PDF composite font this family renders formulas through is Identity-H with CID == GID (see pdf-codec's own math-font.ts), which makes a bare glyph ID directly showable with no cmap involvement. `text` is the operator's own original Unicode text ("(", "["), carried so a consumer can still declare what the drawn construction MEANS: pdf-codec's math-content-write.ts emits it as an /ActualText marked-content span, so copy/paste and text search keep working for a construction whose glyphs have no ToUnicode mapping of their own. `sizePt` is the font size the glyphs are shown at (the same meaning MathGlyphRun.sizePt carries), not the size the construction was stretched to -- that extent is already baked into the placements' own positions.
export interface MathAssembledGlyphs {
  readonly kind: 'assembled-glyphs';
  readonly placements: readonly MathGlyphPlacement[];
  readonly text: string;
  readonly sizePt: number;
  readonly color: MathColor;
}

export type MathLayoutItem = MathGlyphRun | MathRule | MathStroke | MathAssembledGlyphs;

// The result of laying out one MathML (sub)tree: a bounding box (widthPt = full width; heightPt = ascentPt + descentPt) plus every positioned item inside it, already flattened to box-local absolute coordinates -- a parent box that embeds a child box does so by adding its own child-placement offset to every one of the child's items and splicing them into its own flat `items` array, rather than nesting MathBox values inside each other. This is deliberately the flattest shape that still lets pdf-codec's math-content-write.ts (which redeclares its own structurally-identical MathBox -- see pdf-codec's math-types.ts) consume a whole formula with a single, non-recursive walk: add the box's own page-placement offset once, emit every item.
export interface MathBox {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly ascentPt: number;
  readonly descentPt: number;
  readonly items: readonly MathLayoutItem[];
}

// Mirrors this package's existing three-tier PDF-read diagnostic policy (see README's own "Conventions" section) at formula-layout granularity: 'unsupported-element' for a MathML construct this engine doesn't implement (rendered as its own plain-text content instead, so the formula still lays out rather than vanishing); 'missing-glyph' for a code point the embedded math font has no glyph for at all (rendered as nothing -- an empty run -- rather than crashing layout, in the same spirit as encodeForShow's own WinAnsi substitution reporting for the standard-14 text path).
export type MathDiagnosticKind = 'unsupported-element' | 'missing-glyph';

export interface MathDiagnostic {
  readonly kind: MathDiagnosticKind;
  readonly detail: string; // the element's own local tag name, or the missing code point formatted as "U+XXXX"
}

export interface MathLayoutResult {
  readonly box: MathBox;
  readonly diagnostics: readonly MathDiagnostic[];
}
