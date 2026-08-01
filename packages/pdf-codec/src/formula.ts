import type { MathBox } from './math-types';

// A formula's own MathBox, already laid out (see documents.js's own src/mathml/layout.ts layoutFormula) and positioned on a page in PDF coordinate space (bottom-left origin, y-up, already through documents.js's own src/model/geometry.ts flipY -- the same convention every LayoutItem already uses). This is the side-channel documents.js's own layout engines (src/layout/engine.ts, src/layout/slides.ts) return alongside their own LayoutDocument, and this package's own write.ts WritePdfOptions.formulas consumes directly -- see write.ts's own module comment for why a formula's own CID-font glyph runs cannot be expressed as an ordinary LayoutItem and therefore cannot travel through LayoutDocument.pages[].items itself.
export interface PositionedFormula {
  readonly pageIndex: number;
  readonly xPt: number;
  readonly yPt: number;
  readonly box: MathBox;
}
