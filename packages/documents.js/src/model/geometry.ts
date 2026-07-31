import type { Box } from 'document-content-model';

// Geometry primitives now live in document-content-model (this file's own logic was ported to ooxml.js first, then on to document-content-model, since ContentSection/ContentShape need the same Box/PageSize/Margins types document-content-model's own content vocabulary produces directly) -- re-exported here under documents.js's own established names so every existing caller (src/edit/*, src/pdf/*, src/layout/*, src/index.ts) keeps resolving them unchanged.
export type { Box, Margins, PageSize } from 'document-content-model';
export { BoxSchema, MarginsSchema, PageSizeSchema, PAGE_SIZE_A4, PAGE_SIZE_LETTER, SLIDE_SIZE_STANDARD, SLIDE_SIZE_WIDESCREEN } from 'document-content-model';

// Converts a Box from a top-left-origin, y-down coordinate space (OOXML's own convention, and ContentShape.frame's) into a bottom-left-origin, y-up space (PDF's own convention, and every LayoutItem's) of the given total height, or back again -- the transform is its own exact inverse. This did NOT move to document-content-model: it's PDF-specific, a concern document-content-model has no notion of.
export function flipY(box: Box, containerHeightPt: number): Box {
  return {
    xPt: box.xPt,
    yPt: containerHeightPt - box.yPt - box.heightPt,
    widthPt: box.widthPt,
    heightPt: box.heightPt,
  };
}
