import type { Box, ContentDrawPage, ContentPathPoint, ContentVector, LayoutDocument, LayoutImageAsset, LayoutItem, LayoutPage, LayoutSubpath } from 'document-schema.js';
import { LAYOUT_FORMAT_VERSION } from 'document-schema.js';
import { flipY } from '../model/geometry';
import type { ContentDocument } from '../model/content';
import type { TextMeasurer } from 'pdf-codec';
import { convertShape } from './slides';

// ContentDocument (the drawing variant, odf.js's .odg target) -> LayoutDocument: structurally the same shape as slides.ts's own pptx/odp direction (one ContentDrawPage per PDF page, direct placement, no pagination), extended with one new emission path -- ContentVector, the vector-primitive vocabulary a drawing carries that a slide typically doesn't. rect/ellipse/line vectors map onto the LayoutRect/LayoutEllipse/LayoutLine kinds documents.js already had before this module existed; 'path' is the one genuinely new LayoutItem kind (document-schema.js's LayoutPathSchema), constructed here as a plain value -- writePath (pdf-codec's content-write.ts) is what later turns that value into PDF content-stream operators, a separate, downstream concern from building it. ContentShape content (draw:frame text/image/table, and salvaged custom-shape text) reuses convertShape verbatim from slides.ts, which is what makes odg free-riding on odp's/pptx's own already-correct paragraph flow, image placement, and table layout, not a second reimplementation of any of it.
//
// PAINT ORDER, a documented, bounded limitation rather than a silent one: ContentDrawPageSchema (document-schema.js's content.ts) keeps `shapes` and `vectors` as two separate arrays, each independently paint-ordered by odf.js's own reader (typed/draw/shapes.ts's byPaintOrder, honouring a real draw:z-index when present and falling back to document order otherwise) -- but there is no field recording the RELATIVE order between the two arrays when a shape and a vector genuinely overlap on the same page. This is a real gap in the shared schema, not something a layout engine can reconstruct after the fact (odf.js's own module doc says exactly this). convertDrawingToLayout resolves it with one fixed, explicit choice: every vector paints first, every shape paints after -- vectors are the overwhelmingly common "diagram" content in a real .odg (rectangles, ellipses, connecting lines, curves), and shapes are far more often text labels/callouts layered on top of them than the reverse, so this is the choice that renders correctly for the common case. A page that genuinely interleaves shapes and vectors mid-stack will not paint in true document z-order until ContentDrawPageSchema itself grows a shared ordering field.

export interface DrawingLayoutOptions {
  readonly measurer: TextMeasurer;
}

type DrawingContentDocument = Extract<ContentDocument, { kind: 'drawing' }>;
type RectVector = Extract<ContentVector, { kind: 'rect' }>;
type EllipseVector = Extract<ContentVector, { kind: 'ellipse' }>;
type LineVector = Extract<ContentVector, { kind: 'line' }>;
type PathVector = Extract<ContentVector, { kind: 'path' }>;

function convertRectVector(vector: RectVector, pageHeightPt: number, out: LayoutItem[]): void {
  const flipped = flipY(vector.frame, pageHeightPt);
  out.push({ kind: 'rect', xPt: flipped.xPt, yPt: flipped.yPt, widthPt: flipped.widthPt, heightPt: flipped.heightPt, fill: vector.fill, stroke: vector.stroke, sourcePath: vector.sourcePath });
}

function convertEllipseVector(vector: EllipseVector, pageHeightPt: number, out: LayoutItem[]): void {
  const flipped = flipY(vector.frame, pageHeightPt);
  out.push({ kind: 'ellipse', xPt: flipped.xPt, yPt: flipped.yPt, widthPt: flipped.widthPt, heightPt: flipped.heightPt, fill: vector.fill, stroke: vector.stroke, sourcePath: vector.sourcePath });
}

function convertLineVector(vector: LineVector, pageHeightPt: number, out: LayoutItem[]): void {
  out.push({
    kind: 'line',
    x1Pt: vector.from.xPt,
    y1Pt: pageHeightPt - vector.from.yPt,
    x2Pt: vector.to.xPt,
    y2Pt: pageHeightPt - vector.to.yPt,
    color: vector.stroke.color,
    widthPt: vector.stroke.widthPt,
    sourcePath: vector.sourcePath,
  });
}

// A path's own subpath/segment points are in the path's LOCAL coordinate space -- top-left origin, y down, sized to frame.widthPt x frame.heightPt (ContentVectorSchema's own 'path' variant contract, document-schema.js's content.ts) -- distinct from frame's own PAGE-space placement. Resolving one point to absolute PDF user space is therefore two steps in one: add the frame's own offset (placing the local point into page-space, still y-down), then flip that page-space y-down point into PDF's bottom-left/y-up space -- the same flipY math LayoutRect/LayoutEllipse use above, just applied to a bare point rather than a whole box.
function placePathPoint(frame: Box, point: ContentPathPoint, pageHeightPt: number): { readonly xPt: number; readonly yPt: number } {
  return { xPt: frame.xPt + point.xPt, yPt: pageHeightPt - frame.yPt - point.yPt };
}

function convertPathVector(vector: PathVector, pageHeightPt: number, out: LayoutItem[]): void {
  const subpaths: LayoutSubpath[] = vector.subpaths.map((subpath) => {
    const start = placePathPoint(vector.frame, subpath.start, pageHeightPt);
    return {
      startXPt: start.xPt,
      startYPt: start.yPt,
      closed: subpath.closed,
      segments: subpath.segments.map((segment) => {
        if (segment.kind === 'line') {
          const to = placePathPoint(vector.frame, segment.to, pageHeightPt);
          return { kind: 'line' as const, xPt: to.xPt, yPt: to.yPt };
        }
        const control1 = placePathPoint(vector.frame, segment.control1, pageHeightPt);
        const control2 = placePathPoint(vector.frame, segment.control2, pageHeightPt);
        const to = placePathPoint(vector.frame, segment.to, pageHeightPt);
        return { kind: 'cubic' as const, c1xPt: control1.xPt, c1yPt: control1.yPt, c2xPt: control2.xPt, c2yPt: control2.yPt, xPt: to.xPt, yPt: to.yPt };
      }),
    };
  });
  out.push({ kind: 'path', subpaths, fill: vector.fill, fillRule: vector.fillRule, stroke: vector.stroke, sourcePath: vector.sourcePath });
}

function convertVector(vector: ContentVector, pageHeightPt: number, out: LayoutItem[]): void {
  if (vector.kind === 'rect') {
    convertRectVector(vector, pageHeightPt, out);
  } else if (vector.kind === 'ellipse') {
    convertEllipseVector(vector, pageHeightPt, out);
  } else if (vector.kind === 'line') {
    convertLineVector(vector, pageHeightPt, out);
  } else {
    convertPathVector(vector, pageHeightPt, out);
  }
}

function convertPage(page: ContentDrawPage, measurer: TextMeasurer, images: Record<string, LayoutImageAsset>): LayoutPage {
  const items: LayoutItem[] = [];
  // See this module's own top-of-file note on why vectors paint before shapes.
  for (const vector of page.vectors) {
    convertVector(vector, page.size.heightPt, items);
  }
  for (const shape of page.shapes) {
    convertShape(shape, page.size.heightPt, measurer, images, items);
  }
  return { widthPt: page.size.widthPt, heightPt: page.size.heightPt, items };
}

export function convertDrawingToLayout(doc: DrawingContentDocument, options: DrawingLayoutOptions): LayoutDocument {
  const images: Record<string, LayoutImageAsset> = {};
  const pages = doc.pages.map((page) => convertPage(page, options.measurer, images));
  return { formatVersion: LAYOUT_FORMAT_VERSION, metadata: doc.metadata, pages, images };
}
