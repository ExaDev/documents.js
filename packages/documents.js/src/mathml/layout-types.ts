// A local, structurally-compatible mirror of document-content-model's own Color (r/g/b, 0..1) -- deliberately not imported, for the same "zero dependency" reason nodes.ts mirrors odf.js's XmlNode rather than importing it: passing document-content-model's own COLOR_BLACK (or any Color value) into a MathColor-typed field type-checks with no cast, since the shapes are identical.
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

export type MathLayoutItem = MathGlyphRun | MathRule | MathStroke;

// The result of laying out one MathML (sub)tree: a bounding box (widthPt = full width; heightPt = ascentPt + descentPt) plus every positioned item inside it, already flattened to box-local absolute coordinates -- a parent box that embeds a child box does so by adding its own child-placement offset to every one of the child's items and splicing them into its own flat `items` array, rather than nesting MathBox values inside each other. This is deliberately the flattest shape that still lets src/pdf/math-content-write.ts consume a whole formula with a single, non-recursive walk: add the box's own page-placement offset once, emit every item.
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
