import type { MathBox, MathMlNode } from '../mathml';

// A raw, unlaid-out embedded formula, recovered from an odt/odp package's own embedded sub-object (see src/odf/formula/read.ts) and threaded alongside a ContentDocument rather than inside it: document-content-model's own ContentEmbeddedObjectSchema models objectKind: 'formula' as a valid discriminant value, but ContentEmbeddedObject.document is typed ContentDocument -- a closed union of wordprocessing/presentation/spreadsheet/drawing, with no formula-shaped variant to carry a raw MathML tree in. Rather than force an ill-fitting shape through that field (or widen a shared, versioned, externally-published schema for one package's own local need), each embedded formula block in a read ContentDocument instead carries a plain-text fallback ContentDocument in its own `document` field (a single-paragraph wordprocessing document showing the formula's own StarMath annotation, or "[formula]" when none is present) -- genuinely useful on its own to a consumer with no MathML support -- while the REAL MathML tree for actual rendering is returned alongside the ContentDocument as a side map, keyed by the same positional sourcePath convention this package already uses for LayoutItem.sourcePath (see the README's own "sourcePath" gotcha): valid only against the exact read pass that produced it.
export interface EmbeddedFormula {
  readonly mathml: readonly MathMlNode[];
  readonly starMath: string | undefined;
}

// A formula's own MathBox, already laid out (see src/mathml/layout.ts's layoutFormula) and positioned on a page in PDF coordinate space (bottom-left origin, y-up, already through src/model/geometry.ts's flipY -- the same convention every LayoutItem already uses). This is the side-channel src/layout/engine.ts and src/layout/slides.ts return alongside their own LayoutDocument, and src/pdf/write.ts's WritePdfOptions.formulas consumes directly -- see write.ts's own module comment for why a formula's own CID-font glyph runs cannot be expressed as an ordinary LayoutItem and therefore cannot travel through LayoutDocument.pages[].items itself.
export interface PositionedFormula {
  readonly pageIndex: number;
  readonly xPt: number;
  readonly yPt: number;
  readonly box: MathBox;
}
