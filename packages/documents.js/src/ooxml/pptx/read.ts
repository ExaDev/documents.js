import type { ContentDocument } from 'document-schema.js';

import type { Package } from 'ooxml.js';
import { attr, childrenWithTag, readPptx, resolveRelationships, rootElement } from 'ooxml.js';
import type { OmmlDiagnosticSink } from './formula';
import { spliceSlideFormulas } from './formula';
import { collapseVectorShapeRuns } from './vector';

export interface ReadPptxContentOptions {
  readonly onMathDiagnostic?: OmmlDiagnosticSink;
}

const PRESENTATION_PART = 'ppt/presentation.xml';

// Every slide's own part path, in p:sldIdLst document order -- the same order readPptx itself resolves slides in (see ooxml.js's own readSlidePathsInOrder), needed here only to locate each slide's raw p:sld root for the second, vector-detecting pass below.
function slidePathsInOrder(pkg: Package): readonly string[] {
  const presentationRoot = rootElement(pkg.parts[PRESENTATION_PART]);
  if (presentationRoot === undefined) {
    return [];
  }
  const sldIdLst = childrenWithTag(presentationRoot, 'p:sldIdLst')[0];
  if (sldIdLst === undefined) {
    return [];
  }
  const rels = resolveRelationships(pkg, PRESENTATION_PART);
  const paths: string[] = [];
  for (const sldId of childrenWithTag(sldIdLst, 'p:sldId')) {
    const rId = attr(sldId, 'r:id');
    const rel = rId === undefined ? undefined : rels.get(rId);
    if (rel !== undefined) {
      paths.push(rel.target);
    }
  }
  return paths;
}

// Package -> ContentDocument (the presentation variant). A thin adapter over ooxml.js's own readPptx: placeholder -> layout -> master -> theme inheritance, the run-property cascade, group-transform flattening, and slide ordering via p:sldIdLst all now live upstream in ooxml.js (readPptx used to be a lossy, geometry-free projection unusable as a layout basis; it no longer is).
//
// An embedded OOXML equation (ExaDev/documents.js#563) and a vector-only p:sp -- one readPptx itself always reads as an ordinary, empty ContentShape regardless of content -- are each carried through too, as second, independent passes over each slide's own raw p:sld: ./formula.ts's own spliceSlideFormulas (a real 'formula'-kind embedded object) runs FIRST, then ./vector.ts's own collapseVectorShapeRuns (a real 'drawing'-kind embedded object collapsing the run of shape slots it occupied) -- that ordering is load-bearing, not incidental, since the vector pass can shrink the shapes array and would invalidate the formula pass's own shape-index correspondence if it ran first (see spliceSlideFormulas's own comment). readPptx has no vector-geometry or embedded-equation handling at all, mirroring how src/ooxml/docx/vector.ts and src/odf/vector/detect.ts recover the same geometry ooxml.js's/odf.js's own readers do not.
export function readPptxContent(pkg: Package, options?: ReadPptxContentOptions): ContentDocument {
  const pptxDoc = readPptx(pkg);
  const slidePaths = slidePathsInOrder(pkg);
  const slides = pptxDoc.slides.map((slide, slideIndex) => {
    const slidePath = slidePaths[slideIndex];
    const slideRoot = slidePath === undefined ? undefined : rootElement(pkg.parts[slidePath]);
    const cSld = slideRoot === undefined ? undefined : childrenWithTag(slideRoot, 'p:cSld')[0];
    const spTree = cSld === undefined ? undefined : childrenWithTag(cSld, 'p:spTree')[0];
    if (spTree === undefined) {
      return slide;
    }
    const withFormulas = spliceSlideFormulas(slide, slideIndex, spTree.children, options?.onMathDiagnostic);
    return collapseVectorShapeRuns(withFormulas, slideIndex, spTree.children);
  });
  return { kind: 'presentation', metadata: { ...pptxDoc.metadata }, slides };
}
