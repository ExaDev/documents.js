import type { Box, ContentDocument, ContentDrawPage, ContentEmbeddedObjectBlock, ContentPathPoint, ContentVector, PageSize } from 'document-schema.js';


// Vector primitives (rect/ellipse/line/path) recovered from a page, packaged as the ContentEmbeddedObjectBlock the shared schema already models for exactly this -- the counterpart to src/model/formula.ts's buildFormulaBlock/formulaOfBlock, for the drawing objectKind rather than the formula one.
//
// WHY A NESTED DRAWING DOCUMENT RATHER THAN A VECTORS ARRAY: only ContentDrawPage carries `vectors` at all. ContentSection (wordprocessing) holds a flat ContentBlock[] and ContentSlide (presentation) holds a ContentShape[], and neither ContentBlock nor ContentShape has any fill/stroke/geometry vocabulary of its own -- so a recovered rect has nowhere to live in either container directly. ContentEmbeddedObject IS the shared schema's own designed answer to "a document of one kind nested at a frame inside a document of another", with 'drawing' among its declared objectKind members; wrapping the page's recovered vectors in a one-page drawing document is therefore using the model as specified, not widening it. A caller wanting those vectors as a real file can hand the nested document straight to buildOdgPackage -- it is an ordinary, complete drawing ContentDocument, not a private shape.
//
// The nested page is sized to the SOURCE page and the block's own frame is that same full-page box, so every recovered vector's own frame stays in the coordinates it was recovered in (page-relative, top-left origin, y down) with no re-origining arithmetic anywhere -- an offset step that could only introduce error, since the recovered geometry is already page-relative by construction.
export function buildDrawingBlock(size: PageSize, vectors: readonly ContentVector[]): ContentEmbeddedObjectBlock {
  const page: ContentDrawPage = { size, shapes: [], vectors: [...vectors] };
  const document: ContentDocument = { kind: 'drawing', metadata: {}, pages: [page] };
  return { kind: 'embeddedObject', objectKind: 'drawing', document, frame: { xPt: 0, yPt: 0, widthPt: size.widthPt, heightPt: size.heightPt } };
}

// The drawing ContentDocument an embedded-object block actually carries, or undefined when its own document is not a drawing document -- the exact narrowing shape formulaOfBlock uses, so every consumer that has to tell a formula block from a drawing block does it one way rather than each re-deriving the discriminant checks.
export function drawingOfBlock(block: ContentEmbeddedObjectBlock): Extract<ContentDocument, { kind: 'drawing' }> | undefined {
  return block.document.kind === 'drawing' ? block.document : undefined;
}

function shiftBox(frame: Box, dxPt: number, dyPt: number): Box {
  return { ...frame, xPt: frame.xPt + dxPt, yPt: frame.yPt + dyPt };
}

function shiftPoint(point: ContentPathPoint, dxPt: number, dyPt: number): ContentPathPoint {
  return { xPt: point.xPt + dxPt, yPt: point.yPt + dyPt };
}

// A vector moved bodily by (dxPt, dyPt), leaving everything else -- rotation, fill, stroke, paintOrder, sourcePath, and a path's own local subpath coordinates -- exactly as it was. Rotation survives a translation unchanged because ODF and DrawingML both rotate a shape about its own frame centre, which moves with the frame; a path's subpaths are already frame-local (see document-schema.js's content.ts) and so are unaffected by where the frame sits.
function translateVector(vector: ContentVector, dxPt: number, dyPt: number): ContentVector {
  switch (vector.kind) {
    case 'line':
      return { ...vector, from: shiftPoint(vector.from, dxPt, dyPt), to: shiftPoint(vector.to, dxPt, dyPt) };
    case 'rect':
      return { ...vector, frame: shiftBox(vector.frame, dxPt, dyPt) };
    case 'ellipse':
      return { ...vector, frame: shiftBox(vector.frame, dxPt, dyPt) };
    case 'path':
      return { ...vector, frame: shiftBox(vector.frame, dxPt, dyPt) };
  }
}

// Every vector primitive the block's own nested drawing document carries, across all its pages, translated into the coordinate space of whichever container is about to write them: by the block's OWN frame origin (where the embedded object sits in its parent document) plus `containerOriginPt`, the origin of whatever wraps the block in turn -- a slide shape's frame for the presentation directions, the plain origin for a block sitting directly in a text flow. Returns an empty array for a block whose document is not a drawing document at all, so a caller can use this as the "is there vector geometry to write here?" test and its own extraction in one step, the same way drawingOfBlock above is used as the narrowing test.
//
// This translates and never SCALES: buildDrawingBlock sizes the nested page to the block's own frame by construction, so the two always agree for every producer that exists, and inventing a scale factor for a mismatch none of them can create would be guessing at geometry rather than carrying it.
//
// The nested document's own `shapes` array is deliberately not returned. buildDrawingBlock never populates one, and a caller reaching for this function wants exactly the geometry its own container has no vocabulary for -- text and image content is already handled by whichever paragraph/shape path the container was going to take anyway. The `containerOriginPt` to pass for a block sitting directly in a document's own block flow -- docx's w:body, odt's office:text. Such a container has no frame of its own to offset by, unlike the slide shape a presentation wraps the same block in.
export const FLOW_CONTAINER_ORIGIN: ContentPathPoint = { xPt: 0, yPt: 0 };

export function embeddedDrawingVectors(block: ContentEmbeddedObjectBlock, containerOriginPt: ContentPathPoint): ContentVector[] {
  const drawing = drawingOfBlock(block);
  if (drawing === undefined) {
    return [];
  }
  const dxPt = block.frame.xPt + containerOriginPt.xPt;
  const dyPt = block.frame.yPt + containerOriginPt.yPt;
  return drawing.pages.flatMap((page) => page.vectors.map((vector) => translateVector(vector, dxPt, dyPt)));
}
