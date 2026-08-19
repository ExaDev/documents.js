// A glyph's own tight ink bounding box in font design units: the smallest axis-aligned rectangle containing everything the glyph actually draws, as opposed to the font-wide nominal ascent/descent every glyph in the face shares.
//
// One shape for both outline flavours this package reads, so a consumer measuring a glyph never has to know which it got: glyf.ts derives it from a TrueType glyph's own header bounding box (and, for a composite, from the union of its transformed components), cff-bounds.ts derives it by interpreting a CFF glyph's own Type 2 charstring, since a CFF glyph stores no bounding box anywhere. Both report the same thing in the same units.
//
// y grows upward, matching every sfnt table's own convention: `yMax` above the baseline is positive, and a descender's `yMin` is negative. A glyph that draws nothing (a space) has no ink bounds at all rather than a zero-sized box at the origin -- both producers return `undefined` for one, since "this glyph occupies no vertical extent" and "this glyph's extent is a degenerate point at the baseline" are different claims and only the first is true.
export interface GlyphInkBounds {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

// The union of two ink boxes: the smallest box containing both. Used when a glyph is assembled from parts (a TrueType composite's components) and when a caller measures a whole run of glyphs as one box.
export function unionGlyphInkBounds(a: GlyphInkBounds, b: GlyphInkBounds): GlyphInkBounds {
  return {
    xMin: Math.min(a.xMin, b.xMin),
    yMin: Math.min(a.yMin, b.yMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMax: Math.max(a.yMax, b.yMax),
  };
}
