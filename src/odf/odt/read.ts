import type { ContentBlock, ContentDocument } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import type { Package, XmlElement, XmlNode } from 'odf.js';
import { findChildElement, readOdt, rootElement } from 'odf.js';
import { buildFormulaBlock } from '../../model/formula';
import type { DetectedFormulaFrame } from '../formula/detect';
import { collectFormulaFrames } from '../formula/detect';

// Package -> ContentDocument (the wordprocessing variant). A thin adapter over odf.js's own readOdt, mirroring src/ooxml/docx/read.ts's readDocxContent exactly: odf.js's OdtDocument is already { metadata, sections }, the identical shape readDocx produces, so this is nothing more than the envelope wrap. This is the concrete, load-bearing proof that odt and docx genuinely share one pivot and one layout engine -- convertWordprocessingToLayout (src/layout/engine.ts) takes a WordprocessingContentDocument and has no idea, and no way to tell, which format produced it.
//
// An embedded formula is a real ContentEmbeddedObjectBlock in the returned document, carrying its own MathML inside a 'formula'-kind ContentDocument (see src/model/formula.ts) -- there is no side-channel map returned alongside, and no caller needs to thread one anywhere.
//
// Embedded-formula detection is a second, independent pass over the SAME package's own raw content.xml, run after readOdt itself: odf.js's own readOdt (readDrawFrameContent, specifically) does not yet recognise a draw:frame containing a draw:object at all -- it reads a frame's own table/text-box/image content but silently produces no block whatsoever for anything else, including a formula. This pass finds a formula frame wherever it actually is (a direct child of office:text, one nested inside a draw:g group, and one anchored inline inside a paragraph's or table cell's own run content -- see collectFormulaFrames), and inserts each one's block at its TRUE position among the paragraphs/tables odf.js already read, not appended at the end of the section.
//
// Detection is skipped outright for a document odf.js reads into more than one ContentSection: ODF itself has no notion of a docx-style w:sectPr page-setup boundary, so readOdt should never actually produce more than one -- this is a defensive guard against that assumption changing under this module, not an expected real-world case.
export function readOdtContent(pkg: Package): ContentDocument {
  const odtDoc = readOdt(pkg);

  const contentPart = pkg.parts['content.xml'];
  if (contentPart?.kind === 'xml' && odtDoc.sections.length === 1) {
    const root = rootElement(contentPart.nodes);
    const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
    const text = body === undefined ? undefined : findChildElement(body.children, 'office:text');
    if (text !== undefined) {
      const section = odtDoc.sections[0]!;
      const { placements, consumedBlockIndices } = collectFormulaPlacements(text.children, pkg);
      if (placements.length > 0) {
        odtDoc.sections[0] = { ...section, blocks: spliceFormulaBlocks(section.blocks, placements, consumedBlockIndices) };
      }
    }
  }

  return { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: { ...odtDoc.metadata }, sections: odtDoc.sections };
}

// Where one detected formula belongs in the section's own block list: `index` is the position in odf.js's OWN (formula-free) blocks array immediately BEFORE which this formula's block is inserted. Placements are produced in document order and their indices are non-decreasing, so a single forward pass splices them all.
interface FormulaPlacement {
  readonly index: number;
  readonly detected: DetectedFormulaFrame;
}

interface BlockCountState {
  blockCount: number;
}

// The placements plus the indices of odf.js's OWN blocks that a formula replaces outright rather than following. A text:p carrying nothing but a formula frame IS the formula (the shape OdtBody.appendFormula writes, and the shape LibreOffice writes for a display formula on its own line), so emitting both its empty ContentParagraph and the formula block would leave a blank paragraph beside every formula -- and, since buildOdtPackage writes each formula back into a paragraph of its own, one more blank paragraph on every odt -> docx -> odt hop after that.
interface FormulaPlacements {
  readonly placements: readonly FormulaPlacement[];
  readonly consumedBlockIndices: ReadonlySet<number>;
}

interface CollectState extends BlockCountState {
  readonly placements: FormulaPlacement[];
  readonly consumedBlockIndices: Set<number>;
}

function pushPlacements(out: FormulaPlacement[], index: number, detected: readonly DetectedFormulaFrame[]): void {
  for (const frame of detected) {
    out.push({ index, detected: frame });
  }
}

// True when every one of a paragraph's own children is one of the formula frames just detected inside it (or whitespace between them) -- i.e. the paragraph has no text and no other content of its own.
function isFormulaOnlyParagraph(paragraph: XmlElement, detected: readonly DetectedFormulaFrame[]): boolean {
  if (detected.length === 0) {
    return false;
  }
  const frames = detected.map((entry) => entry.frameElement);
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
    if (!frames.includes(child)) {
      return false;
    }
  }
  return true;
}

// One paragraph/heading's own contribution: its block, then every formula frame found inside it placed immediately after -- unless the paragraph is nothing but those frames, in which case the block is consumed and the formulas take its place.
function pushParagraphPlacements(node: XmlElement, pkg: Package, state: CollectState): void {
  const detected = collectFormulaFrames(node.children, pkg);
  state.blockCount += 1;
  if (isFormulaOnlyParagraph(node, detected)) {
    state.consumedBlockIndices.add(state.blockCount - 1);
  }
  pushPlacements(state.placements, state.blockCount, detected);
}

// Mirrors odf.js's own readOdt/readBlocks walk (typed/odt/read.ts) exactly, counting how many ContentBlocks each office:text child contributes, so a formula frame's own insertion point is COUNTED rather than approximated. That count is what true positional interleaving needs and what this adapter previously did not have: "one raw XML child = one block" does not hold in general, since a single text:list unwraps into one ContentParagraph per list item at every nesting level, and a text:section contributes its whole nested block run.
//
// A formula anchored inline inside a paragraph (or inside a table's own cell content) is placed immediately AFTER that paragraph's/table's own block, the closest true position ContentBlock can express: ContentRun is text-only, so there is no inline slot inside a paragraph for an embedded object to occupy, and splitting the paragraph in two around the formula would invent a paragraph boundary the source never had. A formula in a container that contributes no block of its own (a top-level draw:frame, a draw:g group) is placed at the current index instead -- i.e. exactly where it sits, between the blocks either side of it.
function collectFormulaPlacements(nodes: readonly XmlNode[], pkg: Package): FormulaPlacements {
  const state: CollectState = { blockCount: 0, placements: [], consumedBlockIndices: new Set<number>() };
  walkForPlacements(nodes, pkg, state);
  return { placements: state.placements, consumedBlockIndices: state.consumedBlockIndices };
}

function walkForPlacements(nodes: readonly XmlNode[], pkg: Package, state: CollectState): void {
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'text:p' || node.tag === 'text:h') {
      pushParagraphPlacements(node, pkg, state);
    } else if (node.tag === 'text:list') {
      walkListForPlacements(node.children, pkg, state);
    } else if (node.tag === 'table:table') {
      state.blockCount += 1;
      pushPlacements(state.placements, state.blockCount, collectFormulaFrames(node.children, pkg));
    } else if (node.tag === 'text:section') {
      walkForPlacements(node.children, pkg, state);
    } else {
      // Every other child contributes no block at all to readOdt's own output -- a draw:frame, a draw:g, a text:table-of-content placeholder, a text:sequence-decls. A formula found beneath one belongs at the current index, before whatever block the next content child produces.
      pushPlacements(state.placements, state.blockCount, collectFormulaFrames([node], pkg));
    }
  }
}

// The list half of the same mirror: readOdt's own readListItems descends text:list-item children only, emitting one block per text:p/text:h and recursing one nesting level per nested text:list. Anything else inside a list item (including a bare draw:frame) contributes no block, exactly as at top level.
function walkListForPlacements(itemNodes: readonly XmlNode[], pkg: Package, state: CollectState): void {
  for (const item of itemNodes) {
    if (item.type !== 'element' || item.tag !== 'text:list-item') {
      continue;
    }
    for (const itemChild of item.children) {
      if (itemChild.type !== 'element') {
        continue;
      }
      if (itemChild.tag === 'text:p' || itemChild.tag === 'text:h') {
        pushParagraphPlacements(itemChild, pkg, state);
      } else if (itemChild.tag === 'text:list') {
        walkListForPlacements(itemChild.children, pkg, state);
      } else {
        pushPlacements(state.placements, state.blockCount, collectFormulaFrames([itemChild], pkg));
      }
    }
  }
}

// One forward pass over the original blocks, emitting every placement due before each one and skipping every block a formula-only paragraph contributed. Each formula block's own sourcePath names its FINAL index in the combined array (the array a consumer actually sees), matching how every other block's sourcePath addresses the document it is part of.
function spliceFormulaBlocks(blocks: readonly ContentBlock[], placements: readonly FormulaPlacement[], consumedBlockIndices: ReadonlySet<number>): ContentBlock[] {
  const out: ContentBlock[] = [];
  let next = 0;
  for (let index = 0; index <= blocks.length; index++) {
    while (next < placements.length && placements[next]!.index === index) {
      const { detected } = placements[next]!;
      out.push(buildFormulaBlock(detected.formula, detected.frame, `sections[0].blocks[${out.length}]`));
      next += 1;
    }
    const block = blocks[index];
    if (block !== undefined && !consumedBlockIndices.has(index)) {
      out.push(block);
    }
  }
  return out;
}
