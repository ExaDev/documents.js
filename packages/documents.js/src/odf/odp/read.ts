import type { ContentDocument, ContentShape } from 'document-schema.js';

import type { Package } from 'odf.js';
import { childrenWithTag, findChildElement, readOdpContent as readOdpFlat, rootElement } from 'odf.js';
import { buildDrawingBlock } from '../../model/embedded-drawing';
import { buildFormulaBlock } from '../../model/formula';
import { collectSlideFormulaFrames } from '../formula/detect';
import { collectSlideVectorGroups } from '../vector/detect';

// Package -> ContentDocument (the presentation variant). A thin adapter over odf.js's own readOdpContent (imported here as readOdpFlat because this module's own export already holds that name; odf.js 5.0.0 renamed this flat reader to readOdpContent and gave the bare readOdp name to its tree-form DocumentPackage counterpart), mirroring src/ooxml/pptx/read.ts's readPptxContent exactly: odf.js's OdpDocument is already { metadata, slides }, the identical shape the pptx reader produces, so this is nothing more than the envelope wrap. This is the concrete, load-bearing proof that odp and pptx genuinely share one pivot and one layout engine -- convertPresentationToLayout (src/layout/slides.ts) takes a PresentationContentDocument and has no idea, and no way to tell, which format produced it.
//
// An embedded formula or a recovered vector-only drawing is a real ContentEmbeddedObjectBlock in the returned document, carrying its own MathML/geometry inside a 'formula'/'drawing'-kind ContentDocument (see src/model/formula.ts and src/model/embedded-drawing.ts) -- there is no side-channel map returned alongside, exactly as for readOdtContent.
//
// Embedded-formula detection is a second, independent pass over the same package's own raw content.xml, run after the upstream read itself, for the identical reason readOdtContent's own does (see that module's own comment): odf.js's readDrawFrameContent doesn't recognise draw:object at all yet. Each detected formula lands on its TRUE shape, including one nested inside a draw:g group: collectSlideFormulaFrames (../formula/detect.ts) replicates odf.js's own walkDrawShapes traversal exactly -- document order, recursing into groups, one shape per draw:frame whose geometry readDrawFrame resolves and none for any it cannot -- so the shape index it counts *is* the index the upstream reader assigned.
//
// Vector detection runs as a SECOND, SEPARATE step per slide, strictly AFTER the formula-attach loop above has already run: the formula loop only ever mutates an EXISTING shape's own blocks in place (slide.shapes[i] = {...}), never changing the shapes array's length, so it does not disturb collectSlideFormulaFrames's own shapeIndex correspondence, which is computed against the slide's pristine shape count. The vector step, by contrast, genuinely INSERTS synthetic shapes odf.js's own reader never produced at all (a bare vector primitive is not a draw:frame, so walkDrawShapes never creates a ContentShape for one) -- running it before the formula loop would shift every later shape's index and break that correspondence outright, which is why the ordering here is not incidental.
export function readOdpContent(pkg: Package): ContentDocument {
  const odpDoc = readOdpFlat(pkg);

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

      const groups = collectSlideVectorGroups(pageElement.children, pkg);
      if (groups.length === 0) {
        return;
      }
      const shapes: ContentShape[] = [];
      let shapeIndex = 0;
      let groupIndex = 0;
      // index <= slide.shapes.length (not <) so a group inserted at the very end -- after every real shape -- is handled by the same loop, exactly as src/model/block-splice.ts's own spliceBlocks handles a placement whose index equals blocks.length.
      while (shapeIndex <= slide.shapes.length) {
        while (groupIndex < groups.length && groups[groupIndex]!.insertBeforeShapeIndex === shapeIndex) {
          const group = groups[groupIndex]!;
          const sourcePath = `slides[${slideIndex}].shapes[${shapes.length}]`;
          shapes.push({
            frame: { xPt: 0, yPt: 0, widthPt: slide.size.widthPt, heightPt: slide.size.heightPt },
            insetLeftPt: 0,
            insetTopPt: 0,
            insetRightPt: 0,
            insetBottomPt: 0,
            blocks: [{ ...buildDrawingBlock(slide.size, group.vectors), sourcePath }],
            sourcePath,
          });
          groupIndex += 1;
        }
        const shape = slide.shapes[shapeIndex];
        if (shape !== undefined) {
          shapes.push(shape);
        }
        shapeIndex += 1;
      }
      odpDoc.slides[slideIndex] = { ...slide, shapes };
    });
  }

  return { kind: 'presentation', metadata: { ...odpDoc.metadata }, slides: odpDoc.slides };
}
