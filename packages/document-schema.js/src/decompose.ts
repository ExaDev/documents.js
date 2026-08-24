import {
  findConstructMarkerImbalance,
  type ConstructMarkerImbalance,
  type ContentBlock,
  type ContentDocument,
  type ContentDrawPage,
  type ContentFormula,
  type ContentParagraph,
  type ContentSection,
  type ContentShape,
  type ContentSheet,
  type ContentSlide,
} from "./content";
import type { ConstructDescriptor } from "./construct";
import type {
  DrawPageGroupNode,
  HeadingGroupNode,
  HeadingParagraph,
  ListGroupNode,
  ListParagraph,
  SectionChild,
  SectionGroupNode,
  ShapeChild,
  ShapeGroupNode,
  SheetGroupNode,
  SlideGroupNode,
} from "./package-node";

// The flat-to-tree half of the package boundary, ported from document-outline.js's phase-1 reference implementation (that repo's pre-re-charter git history) onto this package's own tree vocabulary -- src/package-node.ts is the same shape's schema-home port, so this module imports the group types instead of redeclaring them. The one forced adaptation beyond types: the reference decomposed a 3.x DocumentTree's `content` field and rebuilt envelopes through a separate documentEnvelope helper, while the 4.x DocumentTree IS the tree (the envelope -- kind, metadata, symbolTable -- rides the root), so decompose takes the flat ContentDocument directly and assembleTree splices the envelope fields out of it. Everything else -- the stack semantics, the container rule, the ownership discipline -- is the reviewed reference verbatim.
//
// Decomposition follows the container rule: sections, slides, sheets, and draw pages each become one top-level group per container, a shape is its own group with its inner blocks grouped inside it (never a slide's paragraphs flattened across its shapes -- that is a table-of-contents projection, not a decomposition), a sheet's grid rides ON the sheet node while children carry its images and embedded objects, and an embedded document (the recursive ContentEmbeddedObject arm) stays intact as one leaf. The input's node objects are embedded, not copied -- decompose owns no content, it only wraps -- so the frames a layout pass stamped onto content survive into the tree as the same objects. The one node the tree cannot embed is a construct-boundary marker: TreeBlockLeaf excludes both marker kinds by construction, so a constructStart's own ConstructDescriptor becomes the group's `node` (that descriptor object IS embedded, uncopied) while the marker wrapper around it has no tree spelling and is rebuilt by flatten from the descriptor plus the group's extent.
//
// Construct boundaries (4.2.0's constructStart/constructEnd blocks in src/content.ts -- docx SDTs, ODF fields, tracked changes, and the rest of #22's fidelity-construct vocabulary) are promoted here, not passed through: a marker pair delimits a region of the block stream that becomes one construct group whose children are that region decomposed on its own. The region's extent is stated by the markers themselves rather than by any level comparison, which is why the block walks below run off a shared forward cursor rather than a plain for-of loop -- a nested walk consumes from exactly where its parent stopped and hands the position back by returning once it meets its own close marker. Promotion reaches exactly as far as grouping does, which is one container's own block flow: a marker inside a table cell's blocks or inside an embedded document rides through untouched on its leaf, unpromoted and unchecked, the same boundary a heading level inside a table cell already sits outside of.

// Property-presence predicates over ContentParagraph, so decompose's branches narrow the paragraph itself (not just a property access) to the anchor types -- a plain property `!== undefined` check narrows the access, never the object, and `{ node: paragraph }` needs the narrowed object. The schema exports the anchor types but not these predicates; they are three lines of structural fact, not a second copy of a schema shape.
export function isHeadingParagraph(
  paragraph: ContentParagraph,
): paragraph is HeadingParagraph {
  return paragraph.headingLevel !== undefined;
}

export function isListParagraph(
  paragraph: ContentParagraph,
): paragraph is ListParagraph {
  return paragraph.list !== undefined;
}

// A container's block stream whose construct markers do not pair up: a constructEnd closing nothing, or a constructStart never closed. Promotion is defined only over balanced markers -- an unbalanced stream has no region for the group to span -- so decompose refuses it loudly rather than inventing a boundary (silently closing an unclosed construct at the container's end, or dropping a stray close) and losing the producer's real error in a plausible-looking tree. Balance is a per-container property, checked over one section's, shape's, or sheet's own block flow: a pair cannot span two containers, because each container decomposes independently. The payload is src/content.ts's own ConstructMarkerImbalance so the failure vocabulary stays the one the balance check already states rather than a second one restated here, and `imbalance.index` indexes that container's own blocks.
export class ConstructMarkerImbalanceError extends Error {
  readonly imbalance: ConstructMarkerImbalance;

  constructor(imbalance: ConstructMarkerImbalance) {
    super(
      imbalance.kind === "unmatchedEnd"
        ? `decompose: the constructEnd marker at index ${imbalance.index} of this container's block flow closes no open construct`
        : `decompose: the constructStart marker at index ${imbalance.index} of this container's block flow is never closed`,
    );
    this.name = "ConstructMarkerImbalanceError";
    this.imbalance = imbalance;
  }
}

// What decompose returns and every tree arm's children hold: the per-kind roots the schema's DocumentTree union states (section groups for wordprocessing, slide groups for presentation, sheet groups for spreadsheet, draw-page groups for drawing, the single ContentFormula leaf for formula). Spelled as the explicit union rather than the indexed access DocumentTree['children'] so tooling that resolves types one hop at a time (this repo's ESLint typed rules) sees named imports instead of an index into the zod-inferred union.
export type TreeChildren =
  | SectionGroupNode[]
  | SlideGroupNode[]
  | SheetGroupNode[]
  | DrawPageGroupNode[]
  | ContentFormula[];

// Decomposes a flat ContentDocument into the tree a DocumentTree's children carry. The same node objects are embedded, never cloned -- the one exception being a construct-boundary marker pair, which has no tree spelling of its own and contributes its ConstructDescriptor (that object, uncopied) to the group it promotes to. Throws ConstructMarkerImbalanceError when a container's markers do not pair up.
export function decompose(content: ContentDocument): TreeChildren {
  switch (content.kind) {
    case "wordprocessing":
      return content.sections.map(decomposeSection);
    case "presentation":
      return content.slides.map(decomposeSlide);
    case "spreadsheet":
      return content.sheets.map(decomposeSheet);
    case "drawing":
      return content.pages.map(decomposeDrawPage);
    case "formula":
      return [content.formula];
  }
}

// Section groups are mandatory, one per ContentSection: the descriptor keeps the section's own page geometry (which no rendered-pages array can hold), and the section's blocks become the group's children, grouped by the wordprocessing stack semantics -- but per section, because each section is its own container and the heading/list stacks reset at its boundary rather than flowing across sections the way a table-of-contents view deliberately does. Rest-destructuring lifts exactly `blocks` out, so a ContentSection field added by a future schema release rides the descriptor without this package being touched.
export function decomposeSection(section: ContentSection): SectionGroupNode {
  const { blocks, ...rest } = section;
  return {
    node: { kind: "section", ...rest },
    children: decomposeSectionBlocks(blocks),
  };
}

// One forward cursor over a container's flat block stream, shared by every walk below it. A construct region's extent is delimited by markers inside the stream, so a nested walk must start exactly where its parent stopped and leave the parent resuming exactly past the close marker it consumed -- which is precisely what one shared iterator is: the parent keeps pulling after the nested call returns, with no index to thread back or get wrong. An iterator rather than an index into `blocks` also keeps end-of-stream a real answer (the iterator protocol's own done flag) instead of an indexed read that noUncheckedIndexedAccess types as possibly-undefined and that would need a branch nothing can ever take.
type BlockCursor = Iterator<ContentBlock>;

// Refuses a block stream whose construct markers do not pair up, before any grouping runs. The check is the schema's own findConstructMarkerImbalance rather than a second implementation folded into the walks, which is also what lets each walk return plainly at end-of-stream: over a balanced stream a nested walk always terminates on its own close marker, so no walk needs an unreachable "ran out mid-construct" arm of its own.
function assertBalancedConstructMarkers(blocks: readonly ContentBlock[]): void {
  const imbalance = findConstructMarkerImbalance(blocks);
  if (imbalance !== undefined) {
    throw new ConstructMarkerImbalanceError(imbalance);
  }
}

// The wordprocessing stack semantics: a heading paragraph opens a group nested under the deepest open heading group with a strictly shallower level, popping equal-or-deeper groups closed (an H4 after an H2 becomes its direct child with no synthetic intermediates; an H1 after an H3 pops to the root); list paragraphs nest by list.level on the same stack semantics inside the innermost heading scope; non-paragraph blocks attach as leaves at the current depth without changing it; a plain paragraph -- no heading level, no list membership -- sits flat at its scope and closes the list nesting. headingLevel is the only heading signal read; a Heading styleId without headingLevel does not group.
function decomposeSectionBlocks(
  blocks: readonly ContentBlock[],
): SectionChild[] {
  assertBalancedConstructMarkers(blocks);
  return walkSectionBlocks(blocks.values());
}

// Consumes a section flow off the cursor, returning at the constructEnd marker that closes the region it was called for (or at end of stream, for the container's own outermost call).
function walkSectionBlocks(cursor: BlockCursor): SectionChild[] {
  const root: SectionChild[] = [];
  // Heading groups currently open, deepest last. Each entry is the group itself -- a group carries both its anchor paragraph (and thereby its level) and its children, so it is the scope. An empty stack means the section root: content before any heading, and sections with no headings at all, attach directly to the section group's children.
  const headingStack: HeadingGroupNode[] = [];
  // List groups currently open inside the innermost heading scope. Reset by every heading and every plain paragraph: list nesting is a sub-structure of a heading group, never a bridge across groups or across intervening unlevelled paragraphs -- otherwise a later deeper item would traverse before an earlier sibling and document order would not survive flatten.
  const listStack: ListGroupNode[] = [];
  // The scope every non-heading attachment targets: the innermost open heading group's children, or the section root when no heading is open.
  const headingScope = (): SectionChild[] =>
    headingStack.at(-1)?.children ?? root;
  for (let step = cursor.next(); step.done !== true; step = cursor.next()) {
    const block = step.value;
    if (block.kind === "constructEnd") {
      return root;
    }
    if (block.kind === "constructStart") {
      openConstructGroup(block.descriptor, cursor, listStack, headingScope());
      continue;
    }
    if (block.kind !== "paragraph") {
      const parent = listStack.at(-1);
      (parent !== undefined ? parent.children : headingScope()).push(block);
      continue;
    }
    if (isHeadingParagraph(block)) {
      listStack.length = 0;
      const level = block.headingLevel;
      for (
        let top = headingStack.at(-1);
        top !== undefined && top.node.headingLevel >= level;
        top = headingStack.at(-1)
      ) {
        headingStack.pop();
      }
      const group: HeadingGroupNode = { node: block, children: [] };
      const parent = headingStack.at(-1);
      (parent !== undefined ? parent.children : root).push(group);
      headingStack.push(group);
    } else if (isListParagraph(block)) {
      openListGroup(listStack, headingScope(), block);
    } else {
      listStack.length = 0;
      headingScope().push(block);
    }
  }
  return root;
}

// A slide becomes one group whose children are one shape group per shape, in shape order -- never the slide's paragraphs taken across its shapes, which would silently discard the shape boundary the source format carries. notes rides the descriptor because it is slide-level data with no block-flow position, exactly like a section's own margins.
export function decomposeSlide(slide: ContentSlide): SlideGroupNode {
  const { shapes, ...rest } = slide;
  return {
    node: { kind: "slide", ...rest },
    children: shapes.map(decomposeShape),
  };
}

// A sheet's children are its images then its embedded objects (sibling arrays with no cross-array ordering field; this fixed order is what flatten's partition reverses). The grid and print settings ride ON the sheet descriptor -- they are addressable data, not block flow. embeddedObjects is optional on ContentSheet (a sheet may legitimately carry none), so absence spreads as nothing: children then hold images alone, and flatten reconstructs the field's absence from exactly that. A present-but-empty array also contributes no children -- the one spelling the concatenated children cannot distinguish from absence -- so it round-trips to the field absent: the bijection's one declared normalisation, stated in bijection.test.ts rather than left to be discovered as a law failure.
export function decomposeSheet(sheet: ContentSheet): SheetGroupNode {
  const { images, embeddedObjects, ...rest } = sheet;
  const children = [...images, ...(embeddedObjects ?? [])];
  return { node: { kind: "sheet", ...rest }, children };
}

// A drawing page's children are its shape groups then its vectors: shapes are containers of their own (groups), vectors are textless primitives with no inner structure (leaves) that stay in the tree so structural diffing still sees them.
export function decomposeDrawPage(page: ContentDrawPage): DrawPageGroupNode {
  const { shapes, vectors, ...rest } = page;
  const children = [...shapes.map(decomposeShape), ...vectors];
  return { node: { kind: "drawPage", ...rest }, children };
}

// A shape is its own group: its frame and insets ride the descriptor (blocks lifted out by the rest-destructure, so future ContentShape fields ride too), and its inner blocks group by list.level inside it. headingLevel is deliberately not read in a shape's flow -- slides and drawing pages have no heading hierarchy of their own, and list.level is the only depth signal their paragraphs actually carry. The list stack is per shape: list nesting never crosses the shape boundary either.
export function decomposeShape(shape: ContentShape): ShapeGroupNode {
  const { blocks, ...rest } = shape;
  return { node: rest, children: decomposeShapeBlocks(blocks) };
}

function decomposeShapeBlocks(blocks: readonly ContentBlock[]): ShapeChild[] {
  assertBalancedConstructMarkers(blocks);
  return walkShapeBlocks(blocks.values());
}

// Consumes a shape (or list-item) flow off the cursor, on the same return-at-my-close-marker contract walkSectionBlocks holds.
function walkShapeBlocks(cursor: BlockCursor): ShapeChild[] {
  const root: ShapeChild[] = [];
  const listStack: ListGroupNode[] = [];
  for (let step = cursor.next(); step.done !== true; step = cursor.next()) {
    const block = step.value;
    if (block.kind === "constructEnd") {
      return root;
    }
    if (block.kind === "constructStart") {
      const parent = listStack.at(-1);
      (parent !== undefined ? parent.children : root).push({
        node: block.descriptor,
        children: walkShapeBlocks(cursor),
      });
      continue;
    }
    if (block.kind !== "paragraph") {
      const parent = listStack.at(-1);
      (parent !== undefined ? parent.children : root).push(block);
      continue;
    }
    if (isListParagraph(block)) {
      openListGroup(listStack, root, block);
      continue;
    }
    // A paragraph with no list membership sits directly under the shape group and closes any open list nesting, so document order survives the walk back out. This includes a paragraph carrying headingLevel: in a shape's flow that field is not a depth signal (see decomposeShape), so the paragraph is plain content here.
    listStack.length = 0;
    root.push(block);
  }
  return root;
}

// Attaches the construct region a section-flow constructStart opened, recursing over the cursor to build its children and resuming the caller past the close marker that recursion consumed. Two things follow from a construct being a semantic wrapper rather than a container: it attaches at the CURRENT scope exactly as any other non-paragraph block does (the innermost open list group, else the innermost open heading scope), and it disturbs neither stack -- content after the close marker resumes at the same heading depth and the same list depth as content before the open marker. Its own children walk with FRESH stacks, the same reset a section boundary already performs, because the region is its own flow. Which stack it lands in also decides which group type it is, and the schema states both halves of that: the section flow's SectionChild admits a SectionConstructGroupNode (whose children are a full section flow, headings included), while a list group's ListChild admits only a ShapeConstructGroupNode (whose children are a list/shape flow, where a heading paragraph is ordinary content) -- a construct inside a list therefore groups its interior by list level alone, which is exactly the vocabulary a list group's subtree already has.
function openConstructGroup(
  descriptor: ConstructDescriptor,
  cursor: BlockCursor,
  listStack: readonly ListGroupNode[],
  headingScope: SectionChild[],
): void {
  const parent = listStack.at(-1);
  if (parent === undefined) {
    headingScope.push({
      node: descriptor,
      children: walkSectionBlocks(cursor),
    });
    return;
  }
  parent.children.push({ node: descriptor, children: walkShapeBlocks(cursor) });
}

// Opens a list-item group anchored on `paragraph` at its list.level under the deepest open list group with a strictly shallower level (or directly under `scopeChildren` when none is open), popping equal-or-deeper groups closed -- the same stack semantics heading groups follow, on list.level's 0-based scale, so a level jump nests directly under the nearest shallower item with no synthetic intermediates.
function openListGroup(
  listStack: ListGroupNode[],
  scopeChildren: SectionChild[] | ShapeChild[],
  paragraph: ListParagraph,
): void {
  const level = paragraph.list.level;
  for (
    let top = listStack.at(-1);
    top !== undefined && top.node.list.level >= level;
    top = listStack.at(-1)
  ) {
    listStack.pop();
  }
  const group: ListGroupNode = { node: paragraph, children: [] };
  const parent = listStack.at(-1);
  (parent !== undefined ? parent.children : scopeChildren).push(group);
  listStack.push(group);
}
