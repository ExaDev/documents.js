import type { ContentBlock, ContentShape, ContentSlide, ContentVector } from 'document-schema.js';
import type { XmlNode } from 'ooxml.js';
import { childrenWithTag } from 'ooxml.js';
import { readDrawingMlVector } from '../../edit/drawingml/vector';
import { buildDrawingBlock } from '../../model/embedded-drawing';

// Detects and collapses a slide's own vector-only p:sp shapes back into a real drawing block -- the pptx-side counterpart to src/ooxml/docx/vector.ts. Unlike docx (where a vector-only w:drawing leaves no trace in the flat docx reader's output at all, needing a new block INSERTED) and odp (where a bare vector primitive produces no shape at all either), ooxml.js's own readPptxContent ALWAYS produces an ordinary, EMPTY ContentShape for a p:sp regardless of its content -- so recovering a vector here is attach-and-replace, collapsing a run of already-existing (empty) shape slots into one synthetic shape carrying the recovered geometry, never an insertion that would shift any other shape's index.

// A shape-tree walk mirroring ooxml.js's own walkShapeTreeChildren exactly: p:sp/p:pic/p:graphicFrame each occupy one shape slot (in that document order), p:grpSp recurses (flattening a group's own shapes into the same flat array, exactly as readPptxContent does), and p:cxnSp -- a connector -- never occupies a slot and is never recursed into, since readPptxContent does not visit one at all.
interface WalkState {
  shapeIndex: number;
}

function isBlankParagraphBlocks(blocks: readonly ContentBlock[]): boolean {
  return blocks.length === 0 || blocks.every((block) => block.kind === 'paragraph' && block.runs.every((run) => run.text.trim().length === 0));
}

interface FoundVector {
  readonly shapeIndex: number;
  readonly vector: ContentVector;
}

function collectVectorOnlyShapes(children: readonly XmlNode[], shapes: readonly ContentShape[], state: WalkState, out: FoundVector[]): void {
  for (const node of children) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'p:sp') {
      const shapeIndex = state.shapeIndex;
      state.shapeIndex += 1;
      const shape = shapes[shapeIndex];
      if (shape !== undefined && isBlankParagraphBlocks(shape.blocks)) {
        const spPr = childrenWithTag(node, 'p:spPr')[0];
        const vector = spPr === undefined ? undefined : readDrawingMlVector(spPr);
        if (vector !== undefined) {
          out.push({ shapeIndex, vector });
        }
      }
    } else if (node.tag === 'p:pic' || node.tag === 'p:graphicFrame') {
      state.shapeIndex += 1;
    } else if (node.tag === 'p:grpSp') {
      collectVectorOnlyShapes(node.children, shapes, state, out);
    }
    // p:cxnSp (a connector) occupies no shape slot and is never recursed into -- ooxml.js's own walkShapeTreeChildren does not visit one either.
  }
}

interface DetectedSlideVectorGroup {
  readonly insertAt: number;
  readonly length: number;
  readonly vectors: ContentVector[];
}

interface MutableGroup {
  insertAt: number;
  length: number;
  vectors: ContentVector[];
}

// Every vector-only p:sp found on the slide, grouped into MAXIMAL RUNS of consecutive shape indices -- a single vector-carrying drawing collapses to one synthetic shape per run, matching how this package's own writer groups every vector of one recovered drawing block as unwrapped bare shapes with no container (src/edit/pptx/content.ts's own appendShape).
function collectSlideVectorGroups(spTreeChildren: readonly XmlNode[], shapes: readonly ContentShape[]): readonly DetectedSlideVectorGroup[] {
  const state: WalkState = { shapeIndex: 0 };
  const found: FoundVector[] = [];
  collectVectorOnlyShapes(spTreeChildren, shapes, state, found);

  const groups: MutableGroup[] = [];
  for (const item of found) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.insertAt + last.length === item.shapeIndex) {
      last.vectors.push(item.vector);
      last.length += 1;
      continue;
    }
    groups.push({ insertAt: item.shapeIndex, length: 1, vectors: [item.vector] });
  }
  // paintOrder resets to each group's own 0-based position, matching buildDrawingBlock's own fixture-relative numbering.
  return groups.map((group) => ({
    insertAt: group.insertAt,
    length: group.length,
    vectors: group.vectors.map((vector, index) => ({ ...vector, paintOrder: index })),
  }));
}

// Rebuilds a slide's own shapes array, replacing each maximal run of vector-only p:sp shapes with one synthetic shape carrying the recovered drawing block -- frame = the full slide at zero origin (not the bounding box of the vectors), since embeddedDrawingVectors(block, containerOriginPt) only translates by block.frame + containerOriginPt and buildDrawingBlock's own block.frame is always (0,0,size) by construction, so a zero-origin container reproduces each vector's already-absolute coordinates unchanged -- the exact invariant src/edit/pptx/content.test.ts's own writer tests already rely on. Returns `slide` unchanged when the slide carries no recoverable vector geometry at all.
export function collapseVectorShapeRuns(slide: ContentSlide, slideIndex: number, spTreeChildren: readonly XmlNode[]): ContentSlide {
  const groups = collectSlideVectorGroups(spTreeChildren, slide.shapes);
  if (groups.length === 0) {
    return slide;
  }
  const shapes: ContentShape[] = [];
  let index = 0;
  let groupIndex = 0;
  while (index < slide.shapes.length) {
    const group = groups[groupIndex];
    const startsHere = group?.insertAt === index;
    if (startsHere && group !== undefined) {
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
      index += group.length;
      groupIndex += 1;
      continue;
    }
    const shape = slide.shapes[index];
    if (shape !== undefined) {
      shapes.push(shape);
    }
    index += 1;
  }
  return { ...slide, shapes };
}
