import type { Box, ContentBlock, ContentSection } from 'document-schema.js';
import type { XmlElement, XmlNode } from 'ooxml.js';
import { childrenWithTag } from 'ooxml.js';
import { buildFormulaBlock } from '../../model/formula';
import { collectOfficeMathElements, readOfficeMath } from '../../omml/read';
import type { OmmlDiagnostic } from '../../omml/shared';

// A second, independent pass over the SAME word/document.xml readDocx already read, splicing every OOXML math equation it found into the ContentSections readDocx produced -- the docx-side counterpart to src/odf/odt/read.ts's own embedded-formula pass, and needed for the same reason: ooxml.js's readDocx has no m:oMath handling at all (readParagraphRuns walks w:r/w:fldSimple/w:hyperlink/w:ins and nothing else), so a Word-authored equation -- or one this package itself wrote via src/omml/write.ts -- reads back as a paragraph with no runs whatsoever unless something recovers it.
//
// Positioning is DERIVED rather than approximated, and by a much shorter route than the odt side's own block-counting mirror needs: every w:p produces exactly one top-level ContentParagraph block and nothing else produces one at all (a w:tbl becomes a table block, a w:drawing an image block, w:pageBreakBefore a pageBreak block), so the Nth w:p in the body IS the Nth paragraph-kind block across the sections readDocx returned. collectBodyParagraphs below walks exactly the containers readDocx's own readSections/readBodyBlocks descend into, so that correspondence holds for a paragraph nested in a w:sdt, a w:ins, or an mc:AlternateContent branch too.

export type OmmlDiagnosticSink = (diagnostic: OmmlDiagnostic, context: { readonly sourcePath?: string }) => void;

// The containers readDocx's own body walk descends into, mirrored exactly. w:tbl is deliberately absent: a paragraph inside a table cell becomes a block of that ContentTableCell rather than a top-level one, so it neither participates in this ordinal correspondence nor has a top-level position to splice a formula into -- an equation inside a table cell is consequently not recovered, a bounded, tracked gap mirroring buildDocxPackage's own "nested tables and images inside a table cell are out of scope" boundary on the write side.
function collectBodyParagraphs(nodes: readonly XmlNode[], out: XmlElement[]): void {
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'w:p') {
      out.push(node);
    } else if (node.tag === 'w:sdt') {
      const content = childrenWithTag(node, 'w:sdtContent')[0];
      if (content !== undefined) {
        collectBodyParagraphs(content.children, out);
      }
    } else if (node.tag === 'w:ins') {
      collectBodyParagraphs(node.children, out);
    } else if (node.tag === 'mc:AlternateContent') {
      // readDocx prefers mc:Fallback over mc:Choice, so this must too -- picking the other branch could see a different paragraph count entirely.
      const target = childrenWithTag(node, 'mc:Fallback')[0] ?? childrenWithTag(node, 'mc:Choice')[0];
      if (target !== undefined) {
        collectBodyParagraphs(target.children, out);
      }
    }
  }
}

// A w:p carrying nothing but its equation(s) and non-content markers IS the equation, not a paragraph that happens to contain one -- which is exactly what src/edit/docx/content.ts's own appendEmbeddedObject writes (a fresh, otherwise-empty w:p holding one m:oMathPara) and what Word writes for a display equation on its own line. Consuming it, rather than emitting an empty paragraph block alongside the formula block, is what keeps a docx -> odt -> docx round trip from accumulating one spurious blank paragraph per formula per hop. A paragraph carrying real text alongside an inline equation keeps its own block and takes the formula immediately after it, the same position src/odf/odt/read.ts gives an inline ODF formula frame.
const PARAGRAPH_NON_CONTENT_TAGS: ReadonlySet<string> = new Set(['w:pPr', 'w:bookmarkStart', 'w:bookmarkEnd', 'w:proofErr', 'w:commentRangeStart', 'w:commentRangeEnd']);

function isEquationOnlyParagraph(paragraph: XmlElement, equations: readonly XmlElement[]): boolean {
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
    return false;
  }
  return true;
}

// OMML records no geometry for an equation at all -- no frame, no size, nothing an ODF draw:frame's own svg:width/svg:height would correspond to -- so a formula block recovered from a docx needs a stand-in frame. Only its heightPt is ever read: src/layout/engine.ts's own formulaSizePtFromFrame picks a rendered point size from it (half the frame height, a single-line formula being roughly twice its base size tall), and the rendered WIDTH comes from the laid-out formula itself, never from the frame. This states the exact inverse of that heuristic, so a recovered equation renders at the size the source document actually asked for rather than at an invented one.
const FRAME_HEIGHT_PER_SIZE_PT = 2;

// Word's own default body text size, and therefore the size an equation renders at in a document that never overrides it. Used only when the equation's own runs carry no explicit size at all -- see mathRunSizePt below.
const DEFAULT_MATH_SIZE_PT = 11;

// The first explicit run size anywhere inside the equation, in points. A math run's size lives in an ordinary WordprocessingML w:rPr/w:sz nested inside the m:r (half-points, ST_HpsMeasure), which is genuinely present whenever Word's own equation size differs from the document default -- real source data, preferred over the fallback constant above wherever the document states it.
function mathRunSizePt(equation: XmlElement): number | undefined {
  const stack: XmlNode[] = [equation];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.type !== 'element') {
      continue;
    }
    if (node.tag === 'w:sz') {
      const halfPoints = Number.parseFloat(node.attributes.find((attribute) => attribute.name === 'w:val')?.value ?? '');
      if (Number.isFinite(halfPoints) && halfPoints > 0) {
        return halfPoints / 2;
      }
    }
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index];
      if (child !== undefined) {
        stack.push(child);
      }
    }
  }
  return undefined;
}

function equationFrame(equation: XmlElement): Box {
  return { xPt: 0, yPt: 0, widthPt: 0, heightPt: (mathRunSizePt(equation) ?? DEFAULT_MATH_SIZE_PT) * FRAME_HEIGHT_PER_SIZE_PT };
}

// Rebuilds every section's block list with each recovered equation spliced in at its own true position. Returns the sections unchanged (a fresh array, never the input array) when the document carries no OOXML math at all, which is the overwhelmingly common case and costs one shallow walk to establish.
//
// A formula block's own sourcePath names its FINAL index in the section it lands in, exactly as src/odf/odt/read.ts's own spliceFormulaBlocks numbers an ODF formula block.
export function spliceDocxFormulas(sections: readonly ContentSection[], bodyChildren: readonly XmlNode[], onMathDiagnostic?: OmmlDiagnosticSink): ContentSection[] {
  const paragraphElements: XmlElement[] = [];
  collectBodyParagraphs(bodyChildren, paragraphElements);

  let paragraphOrdinal = 0;
  const out: ContentSection[] = [];
  for (const [sectionIndex, section] of sections.entries()) {
    const blocks: ContentBlock[] = [];
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        blocks.push(block);
        continue;
      }
      const paragraph = paragraphElements[paragraphOrdinal];
      paragraphOrdinal += 1;
      const equations = paragraph === undefined ? [] : collectOfficeMathElements(paragraph.children);
      if (equations.length === 0 || paragraph === undefined) {
        blocks.push(block);
        continue;
      }

      const converted = equations.map((equation) => ({ equation, ...readOfficeMath(equation) }));
      const rendered = converted.filter((result) => result.mathml.length > 0);
      if (rendered.length === 0) {
        // An equation whose OMML produced no MathML at all (an empty m:oMath) is not a formula to carry -- the paragraph stays exactly as readDocx read it, and whatever diagnostics the attempt produced are still reported against that paragraph.
        blocks.push(block);
        for (const result of converted) {
          for (const diagnostic of result.diagnostics) {
            onMathDiagnostic?.(diagnostic, { sourcePath: block.sourcePath });
          }
        }
        continue;
      }

      if (!isEquationOnlyParagraph(paragraph, equations)) {
        blocks.push(block);
      }
      for (const result of converted) {
        const sourcePath = `sections[${sectionIndex}].blocks[${blocks.length}]`;
        if (result.mathml.length > 0) {
          blocks.push(buildFormulaBlock({ mathml: result.mathml }, equationFrame(result.equation), sourcePath));
        }
        for (const diagnostic of result.diagnostics) {
          onMathDiagnostic?.(diagnostic, { sourcePath });
        }
      }
    }
    out.push({ ...section, blocks });
  }
  return out;
}
