import type { ContentSection } from 'document-schema.js';
import type { XmlElement, XmlNode } from 'ooxml.js';
import { buildDrawingBlock } from '../../model/embedded-drawing';
import { buildFormulaBlock } from '../../model/formula';
import type { BlockPlacement } from '../../model/block-splice';
import { spliceBlocks } from '../../model/block-splice';
import { collectOfficeMathElements, readOfficeMath } from '../../omml/read';
import type { DetectedParagraphVector } from './vector';
import { collectParagraphVectors } from './vector';
import type { OmmlDiagnosticSink } from './formula';
import { collectBodyParagraphs, equationFrame, PARAGRAPH_NON_CONTENT_TAGS } from './formula';

// A second, independent pass over the SAME word/document.xml readDocx already read, splicing every OOXML math equation AND every recovered vector-only shape it found into the ContentSections readDocx produced -- the docx-side counterpart to src/odf/odt/read.ts's own combined embedded-formula/vector pass, and the direct replacement of what used to be a formula-only spliceDocxFormulas (src/ooxml/docx/formula.ts). Merging the two into ONE splice pass rather than running two sequential ones is load-bearing, not tidiness: a second pass run against the ALREADY-spliced block array would count paragraph ordinals against the wrong (post-formula-splice) indices, since formula.ts's own paragraph-to-block ordinal correspondence assumes nothing has moved yet.
//
// A formula's own detection (collectOfficeMathElements/readOfficeMath) is unchanged from the old spliceDocxFormulas; collectParagraphVectors (./vector.ts) is the new vector-side detector, mirroring src/odf/odt/read.ts's own collectContainerVectors call exactly one paragraph at a time.

function isVectorOnlyRun(run: XmlElement, vectors: readonly DetectedParagraphVector[]): boolean {
  const elementChildren = run.children.filter((child): child is XmlElement => child.type === 'element');
  if (elementChildren.length !== 1) {
    return false;
  }
  const hasNonWhitespaceText = run.children.some((child) => child.type === 'text' && child.value.trim().length > 0);
  if (hasNonWhitespaceText) {
    return false;
  }
  return vectors.some((detected) => detected.drawingElement === elementChildren[0]);
}

// The generalisation of the old isEquationOnlyParagraph: a paragraph carrying nothing but non-content markers, recognised equations, and recognised vector-only runs is itself the embedded object(s), not a paragraph that merely contains one.
function isEmbeddedObjectOnlyParagraph(paragraph: XmlElement, equations: readonly XmlElement[], vectors: readonly DetectedParagraphVector[]): boolean {
  if (equations.length === 0 && vectors.length === 0) {
    return false;
  }
  for (const child of paragraph.children) {
    if (child.type === 'text') {
      if (child.value.trim().length > 0) {
        return false;
      }
      continue;
    }
    if (child.type !== 'element') {
      continue;
    }
    if (PARAGRAPH_NON_CONTENT_TAGS.has(child.tag) || equations.includes(child)) {
      continue;
    }
    // An m:oMathPara wrapping only equations this pass already collected is the display-equation container itself, not extra content.
    if (child.tag === 'm:oMathPara' && collectOfficeMathElements(child.children).every((math) => equations.includes(math))) {
      continue;
    }
    if (child.tag === 'w:r' && isVectorOnlyRun(child, vectors)) {
      continue;
    }
    return false;
  }
  return true;
}

// Rebuilds every section's block list with each recovered equation and vector-only shape spliced in at its own true position. Returns the sections unchanged (a fresh array, never the input array) when the document carries no OOXML math and no recovered vectors at all, which is the overwhelmingly common case and costs one shallow walk to establish.
export function spliceDocxEmbeddedObjects(sections: readonly ContentSection[], bodyChildren: readonly XmlNode[], onMathDiagnostic?: OmmlDiagnosticSink): ContentSection[] {
  const paragraphElements: XmlElement[] = [];
  collectBodyParagraphs(bodyChildren, paragraphElements);

  let paragraphOrdinal = 0;
  const out: ContentSection[] = [];
  for (const [sectionIndex, section] of sections.entries()) {
    const placements: BlockPlacement[] = [];
    const consumedIndices = new Set<number>();

    section.blocks.forEach((block, blockIndex) => {
      if (block.kind !== 'paragraph') {
        return;
      }
      const paragraph = paragraphElements[paragraphOrdinal];
      paragraphOrdinal += 1;
      if (paragraph === undefined) {
        return;
      }

      const equations = collectOfficeMathElements(paragraph.children);
      const vectors = collectParagraphVectors(paragraph);
      if (equations.length === 0 && vectors.length === 0) {
        return;
      }

      const converted = equations.map((equation) => ({ equation, ...readOfficeMath(equation) }));
      const rendered = converted.filter((result) => result.mathml.length > 0);

      if (rendered.length === 0 && vectors.length === 0) {
        // No equation produced usable MathML at all (every m:oMath was empty), and there is no vector geometry either: the paragraph stays exactly as readDocx read it, and whatever diagnostics the attempt produced are still reported against it.
        for (const result of converted) {
          for (const diagnostic of result.diagnostics) {
            onMathDiagnostic?.(diagnostic, { sourcePath: block.sourcePath });
          }
        }
        return;
      }

      const insertAt = blockIndex + 1;
      if (isEmbeddedObjectOnlyParagraph(paragraph, equations, vectors)) {
        consumedIndices.add(blockIndex);
      }
      for (const result of rendered) {
        // Diagnostics for a rendered equation are reported from inside its own build thunk, at the exact sourcePath the resulting formula block receives -- spliceBlocks only learns that position once it actually places the block, so eagerly computing one here (as the old spliceDocxFormulas did, by reading blocks.length mid-loop) is not available to this lazily-built placement.
        placements.push({
          index: insertAt,
          build: (sourcePath) => {
            for (const diagnostic of result.diagnostics) {
              onMathDiagnostic?.(diagnostic, { sourcePath });
            }
            return buildFormulaBlock({ mathml: result.mathml }, equationFrame(result.equation), sourcePath);
          },
        });
      }
      // An equation whose OMML produced no MathML at all (an empty m:oMath) is not a formula to carry, so nothing is spliced in for it -- but a caller still wants to know it was attempted. Reported eagerly, against the paragraph's own original sourcePath, whether or not that paragraph goes on to be consumed by other content in the same pass.
      for (const result of converted) {
        if (result.mathml.length > 0) {
          continue;
        }
        for (const diagnostic of result.diagnostics) {
          onMathDiagnostic?.(diagnostic, { sourcePath: block.sourcePath });
        }
      }
      if (vectors.length > 0) {
        const vectorValues = vectors.map((detected) => detected.vector);
        placements.push({ index: insertAt, build: (sourcePath) => ({ ...buildDrawingBlock(section.pageSize, vectorValues), sourcePath }) });
      }
    });

    if (placements.length === 0 && consumedIndices.size === 0) {
      out.push(section);
      continue;
    }
    const blocks = spliceBlocks(section.blocks, placements, consumedIndices, (position) => `sections[${sectionIndex}].blocks[${position}]`);
    out.push({ ...section, blocks });
  }
  return out;
}
