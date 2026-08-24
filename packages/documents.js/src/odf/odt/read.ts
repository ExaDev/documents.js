import type { ContentDocument, ContentVector } from "document-schema.js";

import type { Package, XmlElement, XmlNode } from "odf.js";
import {
  findChildElement,
  readOdtContent as readOdtFlat,
  rootElement,
} from "odf.js";
import type { BlockPlacement } from "../../model/block-splice";
import { spliceBlocks } from "../../model/block-splice";
import { buildDrawingBlock } from "../../model/embedded-drawing";
import { buildFormulaBlock } from "../../model/formula";
import type { DetectedFormulaFrame } from "../formula/detect";
import { collectFormulaFrames } from "../formula/detect";
import type { DetectedImageFrame } from "../image/detect";
import { collectImageFrames } from "../image/detect";
import { collectContainerVectors, isVectorElementTag } from "../vector/detect";

// Package -> ContentDocument (the wordprocessing variant). A thin adapter over odf.js's own readOdtContent (imported here as readOdtFlat because this module's own export already holds that name; odf.js 5.0.0 renamed this flat reader to readOdtContent and gave the bare readOdt name to its tree-form DocumentTree counterpart), mirroring src/ooxml/docx/read.ts's readDocxContent exactly: odf.js's OdtDocument is already { metadata, sections }, the identical shape the docx reader produces, so this is nothing more than the envelope wrap. This is the concrete, load-bearing proof that odt and docx genuinely share one pivot and one layout engine -- convertWordprocessingToLayout (src/layout/engine.ts) takes a WordprocessingContentDocument and has no idea, and no way to tell, which format produced it.
//
// An embedded formula, a recovered vector-only drawing, or an inline image is a real block in the returned document -- a formula/drawing is a ContentEmbeddedObjectBlock carrying its own MathML/geometry inside a 'formula'/'drawing'-kind ContentDocument (see src/model/formula.ts and src/model/embedded-drawing.ts), and an image is an ordinary ContentImageBlock -- there is no side-channel map returned alongside, and no caller needs to thread one anywhere.
//
// All three are recovered by a second, independent pass over the SAME package's own raw content.xml, run after the upstream read itself: odf.js's own reader (readDrawFrameContent, specifically) does not yet recognise a draw:frame containing a draw:object at all, does not read draw:frame/draw:image back into any ContentBlock at all, and ContentSection.blocks has no vector vocabulary of its own regardless. Formula detection (collectFormulaFrames, ../formula/detect.ts) and image detection (collectImageFrames, ../image/detect.ts) are each their own deep, bespoke walk, since a formula or image frame can sit anywhere at all -- nested in a group, anchored inline in a run; vector detection (collectContainerVectors, ../vector/detect.ts) is a thin call straight through to odf.js's own readDrawPageContent, which already recurses into a group on its own. All three walks run independently over the identical text.children and produce their own placement list; formula and vector placements also produce their own consumed-block-index set (a paragraph carrying nothing but the thing just found is replaced outright, not followed), while an image placement never consumes its containing paragraph at all -- mirroring ooxml.js's own docx reader's convention for a docx inline image exactly, since ContentImageBlock (like ContentRun) has nowhere to record inline membership, so every image arrives as its own block immediately after the paragraph it was found in. The three lists are merged (concatenated, sorted by position, consumed sets unioned) into ONE combined spliceBlocks pass -- running sequential splices here would count a later pass's own paragraph/container positions against the ALREADY-spliced (and therefore wrong) block indices an earlier pass produced.
//
// Detection is skipped outright for a document odf.js reads into more than one ContentSection: ODF itself has no notion of a docx-style w:sectPr page-setup boundary, so the upstream reader should never actually produce more than one -- this is a defensive guard against that assumption changing under this module, not an expected real-world case.
export function readOdtContent(pkg: Package): ContentDocument {
  // frames: 'none' -- this adapter's own formula/image/vector detection passes below read the frames, with the richer placement semantics this module built before odf.js could read a frame at all (consumed formula-only paragraphs, deep walks into cells and groups). odf.js's native lift stays the default for every other consumer; opting out here keeps the two readers from reading each frame twice.
  const odtDoc = readOdtFlat(pkg, { frames: "none" });

  const contentPart = pkg.parts["content.xml"];
  if (contentPart?.kind === "xml" && odtDoc.sections.length === 1) {
    const root = rootElement(contentPart.nodes);
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    const text =
      body === undefined
        ? undefined
        : findChildElement(body.children, "office:text");
    if (text !== undefined) {
      const section = odtDoc.sections[0]!;
      const {
        placements: formulaPlacements,
        consumedBlockIndices: formulaConsumed,
      } = collectFormulaPlacements(text.children, pkg);
      const {
        placements: vectorPlacements,
        consumedBlockIndices: vectorConsumed,
      } = collectVectorPlacements(text.children, pkg);
      const { placements: imagePlacements } = collectImagePlacements(
        text.children,
        pkg,
      );

      if (
        formulaPlacements.length > 0 ||
        vectorPlacements.length > 0 ||
        imagePlacements.length > 0
      ) {
        const combined: BlockPlacement[] = [
          ...formulaPlacements.map((placement): BlockPlacement => ({
            index: placement.index,
            build: (sourcePath) =>
              buildFormulaBlock(
                placement.detected.formula,
                placement.detected.frame,
                sourcePath,
              ),
          })),
          ...vectorPlacements.map((placement): BlockPlacement => ({
            index: placement.index,
            build: (sourcePath) => ({
              ...buildDrawingBlock(section.pageSize, placement.vectors),
              sourcePath,
            }),
          })),
          ...imagePlacements.map((placement): BlockPlacement => ({
            index: placement.index,
            build: (sourcePath) => ({
              ...placement.detected.image,
              sourcePath,
            }),
          })),
        ].sort((a, b) => a.index - b.index);
        // Images never contribute to the consumed set -- see this file's own top-of-file comment.
        const consumedBlockIndices = new Set<number>([
          ...formulaConsumed,
          ...vectorConsumed,
        ]);
        odtDoc.sections[0] = {
          ...section,
          blocks: spliceBlocks(
            section.blocks,
            combined,
            consumedBlockIndices,
            (position) => `sections[0].blocks[${position}]`,
          ),
        };
      }
    }
  }

  return {
    kind: "wordprocessing",
    metadata: { ...odtDoc.metadata },
    sections: odtDoc.sections,
  };
}

// ---------------------------------------------------------------------------
// Formula placement -- unchanged in behaviour from before this module also detected vectors, only renamed where it now shares a helper with the vector walk below.
// ---------------------------------------------------------------------------

// Where one detected formula belongs in the section's own block list: `index` is the position in odf.js's OWN (formula/vector-free) blocks array immediately BEFORE which this formula's block is inserted. Placements are produced in document order and their indices are non-decreasing, so a single forward pass splices them all.
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

interface FormulaCollectState extends BlockCountState {
  readonly placements: FormulaPlacement[];
  readonly consumedBlockIndices: Set<number>;
}

function pushFormulaPlacements(
  out: FormulaPlacement[],
  index: number,
  detected: readonly DetectedFormulaFrame[],
): void {
  for (const frame of detected) {
    out.push({ index, detected: frame });
  }
}

// True when every one of a paragraph's own children is one of the recognised elements just detected inside it (or whitespace between them) -- i.e. the paragraph has no text and no other content of its own. Shared by the formula and vector walks below, each supplying its own recognised-element list, since a paragraph mixing a formula frame with a vector primitive is not a shape any known ODF producer creates.
function isEmbeddedObjectOnlyParagraph(
  paragraph: XmlElement,
  recognisedElements: readonly XmlElement[],
): boolean {
  if (recognisedElements.length === 0) {
    return false;
  }
  for (const child of paragraph.children) {
    if (child.type === "text") {
      if (child.value.trim().length > 0) {
        return false;
      }
      continue;
    }
    if (child.type !== "element") {
      continue;
    }
    if (!recognisedElements.includes(child)) {
      return false;
    }
  }
  return true;
}

// One paragraph/heading's own contribution: its block, then every formula frame found inside it placed immediately after -- unless the paragraph is nothing but those frames, in which case the block is consumed and the formulas take its place.
function pushFormulaParagraphPlacement(
  node: XmlElement,
  pkg: Package,
  state: FormulaCollectState,
): void {
  const detected = collectFormulaFrames(node.children, pkg);
  state.blockCount += 1;
  if (
    isEmbeddedObjectOnlyParagraph(
      node,
      detected.map((entry) => entry.frameElement),
    )
  ) {
    state.consumedBlockIndices.add(state.blockCount - 1);
  }
  pushFormulaPlacements(state.placements, state.blockCount, detected);
}

// Mirrors odf.js's own flat-reader/readBlocks walk (typed/odt/read.ts) exactly, counting how many ContentBlocks each office:text child contributes, so a formula frame's own insertion point is COUNTED rather than approximated. That count is what true positional interleaving needs and what this adapter previously did not have: "one raw XML child = one block" does not hold in general, since a single text:list unwraps into one ContentParagraph per list item at every nesting level, and a text:section contributes its whole nested block run.
//
// A formula anchored inline inside a paragraph (or inside a table's own cell content) is placed immediately AFTER that paragraph's/table's own block, the closest true position ContentBlock can express: ContentRun is text-only, so there is no inline slot inside a paragraph for an embedded object to occupy, and splitting the paragraph in two around the formula would invent a paragraph boundary the source never had. A formula in a container that contributes no block of its own (a top-level draw:frame, a draw:g group) is placed at the current index instead -- i.e. exactly where it sits, between the blocks either side of it.
function collectFormulaPlacements(
  nodes: readonly XmlNode[],
  pkg: Package,
): FormulaPlacements {
  const state: FormulaCollectState = {
    blockCount: 0,
    placements: [],
    consumedBlockIndices: new Set<number>(),
  };
  walkForFormulaPlacements(nodes, pkg, state);
  return {
    placements: state.placements,
    consumedBlockIndices: state.consumedBlockIndices,
  };
}

function walkForFormulaPlacements(
  nodes: readonly XmlNode[],
  pkg: Package,
  state: FormulaCollectState,
): void {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "text:p" || node.tag === "text:h") {
      pushFormulaParagraphPlacement(node, pkg, state);
    } else if (node.tag === "text:list") {
      walkListForFormulaPlacements(node.children, pkg, state);
    } else if (node.tag === "table:table") {
      state.blockCount += 1;
      pushFormulaPlacements(
        state.placements,
        state.blockCount,
        collectFormulaFrames(node.children, pkg),
      );
    } else if (node.tag === "text:section") {
      walkForFormulaPlacements(node.children, pkg, state);
    } else {
      // Every other child contributes no block at all to the upstream reader's own output -- a draw:frame, a draw:g, a text:table-of-content placeholder, a text:sequence-decls. A formula found beneath one belongs at the current index, before whatever block the next content child produces.
      pushFormulaPlacements(
        state.placements,
        state.blockCount,
        collectFormulaFrames([node], pkg),
      );
    }
  }
}

// The list half of the same mirror: the upstream reader's own readListItems descends text:list-item children only, emitting one block per text:p/text:h and recursing one nesting level per nested text:list. Anything else inside a list item (including a bare draw:frame) contributes no block, exactly as at top level.
function walkListForFormulaPlacements(
  itemNodes: readonly XmlNode[],
  pkg: Package,
  state: FormulaCollectState,
): void {
  for (const item of itemNodes) {
    if (item.type !== "element" || item.tag !== "text:list-item") {
      continue;
    }
    for (const itemChild of item.children) {
      if (itemChild.type !== "element") {
        continue;
      }
      if (itemChild.tag === "text:p" || itemChild.tag === "text:h") {
        pushFormulaParagraphPlacement(itemChild, pkg, state);
      } else if (itemChild.tag === "text:list") {
        walkListForFormulaPlacements(itemChild.children, pkg, state);
      } else {
        pushFormulaPlacements(
          state.placements,
          state.blockCount,
          collectFormulaFrames([itemChild], pkg),
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Vector placement -- the new walk, structurally mirroring the formula one above (same containers, same block-counting) but calling collectContainerVectors instead of collectFormulaFrames, and grouping every vector found within one container into a SINGLE placement: "all vectors within one container become one drawing block" is the write side's own convention too (OdtBody.appendVectors writes one paragraph holding every vector of one recovered drawing block), so there is no per-vector placement the way there is a per-frame one for formulas.
//
// Kept as its own, separate walk rather than unified with the formula one above via a shared generic traversal: a formula's detect() call produces zero-or-more items each becoming its OWN placement, while a vector's detect() call produces zero-or-more items that become AT MOST ONE combined placement -- two genuinely different cardinalities that a single generic walker would have to special-case anyway, so writing two small, purpose-built walks is the more honest abstraction of what each already does.
// ---------------------------------------------------------------------------

interface VectorPlacement {
  readonly index: number;
  readonly vectors: readonly ContentVector[];
}

interface VectorPlacements {
  readonly placements: readonly VectorPlacement[];
  readonly consumedBlockIndices: ReadonlySet<number>;
}

interface VectorCollectState extends BlockCountState {
  readonly placements: VectorPlacement[];
  readonly consumedBlockIndices: Set<number>;
}

function vectorTaggedChildren(node: XmlElement): XmlElement[] {
  return node.children.filter(
    (child): child is XmlElement =>
      child.type === "element" && isVectorElementTag(child.tag),
  );
}

function pushVectorParagraphPlacement(
  node: XmlElement,
  pkg: Package,
  state: VectorCollectState,
): void {
  const vectors = collectContainerVectors(node.children, pkg);
  state.blockCount += 1;
  if (
    vectors.length > 0 &&
    isEmbeddedObjectOnlyParagraph(node, vectorTaggedChildren(node))
  ) {
    state.consumedBlockIndices.add(state.blockCount - 1);
  }
  if (vectors.length > 0) {
    state.placements.push({ index: state.blockCount, vectors });
  }
}

function collectVectorPlacements(
  nodes: readonly XmlNode[],
  pkg: Package,
): VectorPlacements {
  const state: VectorCollectState = {
    blockCount: 0,
    placements: [],
    consumedBlockIndices: new Set<number>(),
  };
  walkForVectorPlacements(nodes, pkg, state);
  return {
    placements: state.placements,
    consumedBlockIndices: state.consumedBlockIndices,
  };
}

function walkForVectorPlacements(
  nodes: readonly XmlNode[],
  pkg: Package,
  state: VectorCollectState,
): void {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "text:p" || node.tag === "text:h") {
      pushVectorParagraphPlacement(node, pkg, state);
    } else if (node.tag === "text:list") {
      walkListForVectorPlacements(node.children, pkg, state);
    } else if (node.tag === "table:table") {
      state.blockCount += 1;
      const vectors = collectContainerVectors(node.children, pkg);
      if (vectors.length > 0) {
        state.placements.push({ index: state.blockCount, vectors });
      }
    } else if (node.tag === "text:section") {
      walkForVectorPlacements(node.children, pkg, state);
    } else {
      const vectors = collectContainerVectors([node], pkg);
      if (vectors.length > 0) {
        state.placements.push({ index: state.blockCount, vectors });
      }
    }
  }
}

function walkListForVectorPlacements(
  itemNodes: readonly XmlNode[],
  pkg: Package,
  state: VectorCollectState,
): void {
  for (const item of itemNodes) {
    if (item.type !== "element" || item.tag !== "text:list-item") {
      continue;
    }
    for (const itemChild of item.children) {
      if (itemChild.type !== "element") {
        continue;
      }
      if (itemChild.tag === "text:p" || itemChild.tag === "text:h") {
        pushVectorParagraphPlacement(itemChild, pkg, state);
      } else if (itemChild.tag === "text:list") {
        walkListForVectorPlacements(itemChild.children, pkg, state);
      } else {
        const vectors = collectContainerVectors([itemChild], pkg);
        if (vectors.length > 0) {
          state.placements.push({ index: state.blockCount, vectors });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Image placement -- structurally mirroring the formula walk above (same containers, same block-counting, one placement per detected frame) but calling collectImageFrames instead of collectFormulaFrames, and -- the one deliberate divergence -- NEVER consuming the paragraph an image is found in. ContentImageBlock has nowhere to record inline membership the way ContentEmbeddedObjectBlock's own container can stand in for a formula-only paragraph, so an image always arrives as its own block immediately after the paragraph it was found in, exactly matching ooxml.js's own docx reader's convention for a docx inline image (a paragraph block, always emitted, immediately followed by an image block) -- see this file's own top-of-file comment and buildOdtPackage's own appendBlocks (src/edit/odt/content.ts), which special-cases exactly this shape on the way back out.
// ---------------------------------------------------------------------------

interface ImagePlacement {
  readonly index: number;
  readonly detected: DetectedImageFrame;
}

interface ImagePlacements {
  readonly placements: readonly ImagePlacement[];
}

interface ImageCollectState extends BlockCountState {
  readonly placements: ImagePlacement[];
}

function pushImagePlacements(
  out: ImagePlacement[],
  index: number,
  detected: readonly DetectedImageFrame[],
): void {
  for (const frame of detected) {
    out.push({ index, detected: frame });
  }
}

function pushImageParagraphPlacement(
  node: XmlElement,
  pkg: Package,
  state: ImageCollectState,
): void {
  const detected = collectImageFrames(node.children, pkg);
  state.blockCount += 1;
  pushImagePlacements(state.placements, state.blockCount, detected);
}

function collectImagePlacements(
  nodes: readonly XmlNode[],
  pkg: Package,
): ImagePlacements {
  const state: ImageCollectState = { blockCount: 0, placements: [] };
  walkForImagePlacements(nodes, pkg, state);
  return { placements: state.placements };
}

function walkForImagePlacements(
  nodes: readonly XmlNode[],
  pkg: Package,
  state: ImageCollectState,
): void {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "text:p" || node.tag === "text:h") {
      pushImageParagraphPlacement(node, pkg, state);
    } else if (node.tag === "text:list") {
      walkListForImagePlacements(node.children, pkg, state);
    } else if (node.tag === "table:table") {
      state.blockCount += 1;
      pushImagePlacements(
        state.placements,
        state.blockCount,
        collectImageFrames(node.children, pkg),
      );
    } else if (node.tag === "text:section") {
      walkForImagePlacements(node.children, pkg, state);
    } else {
      pushImagePlacements(
        state.placements,
        state.blockCount,
        collectImageFrames([node], pkg),
      );
    }
  }
}

function walkListForImagePlacements(
  itemNodes: readonly XmlNode[],
  pkg: Package,
  state: ImageCollectState,
): void {
  for (const item of itemNodes) {
    if (item.type !== "element" || item.tag !== "text:list-item") {
      continue;
    }
    for (const itemChild of item.children) {
      if (itemChild.type !== "element") {
        continue;
      }
      if (itemChild.tag === "text:p" || itemChild.tag === "text:h") {
        pushImageParagraphPlacement(itemChild, pkg, state);
      } else if (itemChild.tag === "text:list") {
        walkListForImagePlacements(itemChild.children, pkg, state);
      } else {
        pushImagePlacements(
          state.placements,
          state.blockCount,
          collectImageFrames([itemChild], pkg),
        );
      }
    }
  }
}
