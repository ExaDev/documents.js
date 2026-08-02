import type { ContentDocument } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import type { Package } from 'odf.js';
import { childrenWithTag, findChildElement, readOdp, rootElement } from 'odf.js';
import type { EmbeddedFormula } from '../../model/formula';
import { detectEmbeddedFormulaFrames } from '../formula/detect';
import { buildFormulaPlaceholderBlock } from '../formula/placeholder';

export interface OdpContentResult {
  readonly document: ContentDocument;
  // Every embedded formula found, keyed by the sourcePath of the placeholder shape (containing the formula's own placeholder block) in `document` -- see readOdtContent's own identical field for the general reasoning.
  readonly formulas: ReadonlyMap<string, EmbeddedFormula>;
}

// Package -> ContentDocument (the presentation variant), plus any embedded formulas found. A thin adapter over odf.js's own readOdp, mirroring src/ooxml/pptx/read.ts's readPptxContent exactly: odf.js's OdpDocument is already { metadata, slides }, the identical shape readPptx produces, so this is nothing more than the envelope wrap. This is the concrete, load-bearing proof that odp and pptx genuinely share one pivot and one layout engine -- convertPresentationToLayout (src/layout/slides.ts) takes a PresentationContentDocument and has no idea, and no way to tell, which format produced it.
//
// Embedded-formula detection is a second, independent pass over the same package's own raw content.xml, run after readOdp itself, for the identical reason readOdtContent's own does (see that module's own comment): odf.js's readDrawFrameContent doesn't recognise draw:object at all yet. Unlike odt's own text-flow case, this one recovers the formula's TRUE position exactly, not merely in frame-document-order: odf.js's own readSlide builds each slide's shapes array via walkDrawShapes(page.children, ...), which produces exactly one ContentShape per top-level draw:frame in document order (a draw:frame containing draw:object already becomes an empty-blocks ContentShape today, since readDrawFrameContent silently returns [] for it) -- so the Nth top-level draw:frame on a slide is exactly shapes[N], with no ambiguity of the kind odt's own text:list unwrapping creates. This exact correspondence breaks down the moment a slide also contains a draw:g (group) sibling, since walkDrawShapes recurses into a group's own children and splices THEIR shapes into the same flat array at that position -- so this adapter skips formula detection entirely for any slide containing a draw:g, rather than risk mismatching a formula onto the wrong shape. A formula frame nested inside a group is consequently not detected either -- a documented, bounded scope narrowing, matching odt's own "not inside a paragraph's inline content" narrowing in spirit.
export function readOdpContent(pkg: Package): OdpContentResult {
  const odpDoc = readOdp(pkg);
  const formulas = new Map<string, EmbeddedFormula>();

  const contentPart = pkg.parts['content.xml'];
  if (contentPart?.kind === 'xml') {
    const root = rootElement(contentPart.nodes);
    const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
    const presentation = body === undefined ? undefined : findChildElement(body.children, 'office:presentation');
    const pageElements = presentation === undefined ? [] : childrenWithTag(presentation, 'draw:page');

    pageElements.forEach((pageElement, slideIndex) => {
      if (childrenWithTag(pageElement, 'draw:g').length > 0) {
        return;
      }
      const slide = odpDoc.slides[slideIndex];
      if (slide === undefined) {
        return;
      }
      const frameElements = childrenWithTag(pageElement, 'draw:frame');
      const detected = detectEmbeddedFormulaFrames(frameElements, pkg);
      for (const found of detected) {
        const shapeIndex = frameElements.indexOf(found.frameElement);
        const shape = slide.shapes[shapeIndex];
        if (shape === undefined) {
          continue;
        }
        const sourcePath = `slides[${slideIndex}].shapes[${shapeIndex}]`;
        slide.shapes[shapeIndex] = { ...shape, blocks: [buildFormulaPlaceholderBlock(found.formula, found.frame, sourcePath)] };
        formulas.set(sourcePath, found.formula);
      }
    });
  }

  const document: ContentDocument = { kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: { ...odpDoc.metadata }, slides: odpDoc.slides };
  return { document, formulas };
}
