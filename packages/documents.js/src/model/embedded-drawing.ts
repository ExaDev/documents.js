import type { ContentDocument, ContentDrawPage, ContentEmbeddedObjectBlock, ContentVector, PageSize } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';

// Vector primitives (rect/ellipse/line/path) recovered from a page, packaged as the ContentEmbeddedObjectBlock the shared schema already models for exactly this -- the counterpart to src/model/formula.ts's buildFormulaBlock/formulaOfBlock, for the drawing objectKind rather than the formula one.
//
// WHY A NESTED DRAWING DOCUMENT RATHER THAN A VECTORS ARRAY: only ContentDrawPage carries `vectors` at all. ContentSection (wordprocessing) holds a flat ContentBlock[] and ContentSlide (presentation) holds a ContentShape[], and neither ContentBlock nor ContentShape has any fill/stroke/geometry vocabulary of its own -- so a recovered rect has nowhere to live in either container directly. ContentEmbeddedObject IS the shared schema's own designed answer to "a document of one kind nested at a frame inside a document of another", with 'drawing' among its declared objectKind members; wrapping the page's recovered vectors in a one-page drawing document is therefore using the model as specified, not widening it. A caller wanting those vectors as a real file can hand the nested document straight to buildOdgPackage -- it is an ordinary, complete drawing ContentDocument, not a private shape.
//
// The nested page is sized to the SOURCE page and the block's own frame is that same full-page box, so every recovered vector's own frame stays in the coordinates it was recovered in (page-relative, top-left origin, y down) with no re-origining arithmetic anywhere -- an offset step that could only introduce error, since the recovered geometry is already page-relative by construction.
export function buildDrawingBlock(size: PageSize, vectors: readonly ContentVector[]): ContentEmbeddedObjectBlock {
  const page: ContentDrawPage = { size, shapes: [], vectors: [...vectors] };
  const document: ContentDocument = { kind: 'drawing', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, pages: [page] };
  return { kind: 'embeddedObject', objectKind: 'drawing', document, frame: { xPt: 0, yPt: 0, widthPt: size.widthPt, heightPt: size.heightPt } };
}

// The drawing ContentDocument an embedded-object block actually carries, or undefined when its own document is not a drawing document -- the exact narrowing shape formulaOfBlock uses, so every consumer that has to tell a formula block from a drawing block does it one way rather than each re-deriving the discriminant checks.
export function drawingOfBlock(block: ContentEmbeddedObjectBlock): Extract<ContentDocument, { kind: 'drawing' }> | undefined {
  return block.document.kind === 'drawing' ? block.document : undefined;
}
