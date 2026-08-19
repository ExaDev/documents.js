import type { ContentVector } from 'document-schema.js';
import type { XmlElement } from 'ooxml.js';
import { buildVectorShapeProperties, vectorShapeName } from '../drawingml/vector';
import { el } from '../../xml/fragment';

// A ContentVector as a real PresentationML autoshape -- the pptx half of the shared DrawingML vector writer (src/edit/drawingml/vector.ts holds everything inside p:spPr, which docx expresses identically inside its own wps:spPr). A slide positions a shape directly, so the vector's own frame IS the shape's a:xfrm box and there is no anchoring or wrapping to express beyond it, unlike the docx side.
//
// No p:txBody is written. CT_Shape declares it optional (ECMA-376 19.3.1.43), a geometric primitive carries no text, and inventing an empty paragraph for one would make ooxml.js's own readPptxContent report a text shape where the source had pure geometry.
export function buildVectorShape(vector: ContentVector, shapeId: number): XmlElement {
  const nvSpPr = el('p:nvSpPr', {}, [
    el('p:cNvPr', { id: String(shapeId), name: vectorShapeName(vector, shapeId) }),
    el('p:cNvSpPr'),
    el('p:nvPr'),
  ]);
  return el('p:sp', {}, [nvSpPr, el('p:spPr', {}, buildVectorShapeProperties(vector))]);
}
