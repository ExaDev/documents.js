import type { ContentDocument } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import type { Package } from 'odf.js';
import { childrenWithTag, findChildElement, readOdp, rootElement } from 'odf.js';
import { buildFormulaBlock } from '../../model/formula';
import { collectSlideFormulaFrames } from '../formula/detect';

// Package -> ContentDocument (the presentation variant). A thin adapter over odf.js's own readOdp, mirroring src/ooxml/pptx/read.ts's readPptxContent exactly: odf.js's OdpDocument is already { metadata, slides }, the identical shape readPptx produces, so this is nothing more than the envelope wrap. This is the concrete, load-bearing proof that odp and pptx genuinely share one pivot and one layout engine -- convertPresentationToLayout (src/layout/slides.ts) takes a PresentationContentDocument and has no idea, and no way to tell, which format produced it.
//
// An embedded formula is a real ContentEmbeddedObjectBlock in the returned document, carrying its own MathML inside a 'formula'-kind ContentDocument (see src/model/formula.ts) -- there is no side-channel map returned alongside, exactly as for readOdtContent.
//
// Embedded-formula detection is a second, independent pass over the same package's own raw content.xml, run after readOdp itself, for the identical reason readOdtContent's own does (see that module's own comment): odf.js's readDrawFrameContent doesn't recognise draw:object at all yet. Each detected formula lands on its TRUE shape, including one nested inside a draw:g group: collectSlideFormulaFrames (src/odf/formula/detect.ts) replicates odf.js's own walkDrawShapes traversal -- document order, recursing into groups, one shape per draw:frame whose geometry readDrawFrame resolves -- so the shape index it counts is exactly the index readOdp assigned. A slide containing a group no longer disables formula detection for that whole slide, which is what the previous top-level-frames-only correspondence forced.
export function readOdpContent(pkg: Package): ContentDocument {
  const odpDoc = readOdp(pkg);

  const contentPart = pkg.parts['content.xml'];
  if (contentPart?.kind === 'xml') {
    const root = rootElement(contentPart.nodes);
    const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
    const presentation = body === undefined ? undefined : findChildElement(body.children, 'office:presentation');
    const pageElements = presentation === undefined ? [] : childrenWithTag(presentation, 'draw:page');

    pageElements.forEach((pageElement, slideIndex) => {
      const slide = odpDoc.slides[slideIndex];
      if (slide === undefined) {
        return;
      }
      for (const found of collectSlideFormulaFrames(pageElement.children, pkg)) {
        const shape = slide.shapes[found.shapeIndex];
        if (shape === undefined) {
          continue;
        }
        slide.shapes[found.shapeIndex] = { ...shape, blocks: [buildFormulaBlock(found.formula, found.frame, `slides[${slideIndex}].shapes[${found.shapeIndex}]`)] };
      }
    });
  }

  return { kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: { ...odpDoc.metadata }, slides: odpDoc.slides };
}
