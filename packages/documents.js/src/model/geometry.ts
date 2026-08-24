import type { Box, Point } from "document-schema.js";

// Converts a Box from a top-left-origin, y-down coordinate space (OOXML's own convention, and ContentShape.frame's) into a bottom-left-origin, y-up space (PDF's own convention, and every LayoutItem's) of the given total height, or back again -- the transform is its own exact inverse. This did NOT move to document-schema.js: it's PDF-specific, a concern document-schema.js has no notion of.
export function flipY(box: Box, containerHeightPt: number): Box {
  return {
    xPt: box.xPt,
    yPt: containerHeightPt - box.yPt - box.heightPt,
    widthPt: box.widthPt,
    heightPt: box.heightPt,
  };
}

// Rotates `point` about `center` by `degrees` (counter-clockwise, the PDF/PostScript convention). Moved here from pdf-codec's matrix.ts (rewritten with direct sin/cos rather than pdf-codec's PDF-affine Matrix machinery, which stays there) so src/layout/slides.ts can reconcile DrawingML's centre-pivot shape rotation without fetching a pure-geometry primitive from a backend. pdf-codec had zero internal callers for it.
export function rotatePointAboutCenter(
  point: Point,
  center: Point,
  degrees: number,
): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}
