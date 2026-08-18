import type {
  ContentBlock,
  ContentDrawPage,
  ContentSection,
  ContentShape,
  ContentSheet,
  ContentSlide,
  DocumentPackage,
} from 'document-schema.js';
import type {
  DrawPageGroupNode,
  HeadingGroupNode,
  ListGroupNode,
  ListParagraph,
  PackageRoot,
  SectionChild,
  SectionGroupNode,
  ShapeChild,
  ShapeGroupNode,
  SheetChild,
  SheetGroupNode,
  SlideGroupNode,
} from './package-node';
import { isHeadingParagraph, isListParagraph } from './package-node';

// Decomposes a DocumentPackage's flat ContentDocument into the package tree (the phase-1 half of ExaDev/document-schema.js#20's promotion; the phase-2 port moves this into documents.js's package boundary, and these tests travel with it). The input is the flat codec-exchange form; the output tree's leaves are the SAME node objects embedded, not copies -- decompose owns no content, it only wraps. Grouping follows the container rule: sections, slides, sheets, and draw pages each become one top-level group per container, a shape is its own group with its inner blocks grouped inside it (never a slide's paragraphs flattened across its shapes -- that is the outline's lossy TOC projection, not a decomposition), and an embedded document stays intact as one leaf.
export function decompose(pkg: DocumentPackage): PackageRoot[] {
  const doc = pkg.content;
  switch (doc.kind) {
    case 'wordprocessing':
      return doc.sections.map(decomposeSection);
    case 'presentation':
      return doc.slides.map(decomposeSlide);
    case 'spreadsheet':
      return doc.sheets.map(decomposeSheet);
    case 'drawing':
      return doc.pages.map(decomposeDrawPage);
    case 'formula':
      return [doc.formula];
  }
}

// Section groups are mandatory, one per ContentSection: the descriptor keeps the section's own page geometry (which no rendered-pages array can hold), and the section's blocks become the group's children, grouped by the wordprocessing stack semantics -- but per section, because each section is its own container and the heading/list stacks reset at its boundary rather than flowing across sections the way the outline's TOC view deliberately does.
function decomposeSection(section: ContentSection): SectionGroupNode {
  // Rest-destructuring lifts exactly `blocks` out, so a ContentSection field added by a future schema release rides the descriptor without this package being touched; the lifted blocks array is the section's own, walked below.
  const { blocks, ...rest } = section;
  return { node: { kind: 'section', ...rest }, children: decomposeSectionBlocks(blocks) };
}

// The wordprocessing stack semantics, identical to buildOutline's own (they were reviewed there first and phase 2 ports rather than redesigns them): a heading paragraph opens a group nested under the deepest open heading group with a strictly shallower level, popping equal-or-deeper groups closed (an H4 after an H2 becomes its direct child with no synthetic intermediates; an H1 after an H3 pops to the root); list paragraphs nest by list.level on the same stack semantics inside the innermost heading scope; non-paragraph blocks attach as leaves at the current depth without changing it; a plain paragraph -- no heading level, no list membership -- sits flat at its scope and closes the list nesting. headingLevel is the only heading signal read; a Heading styleId without headingLevel does not group.
function decomposeSectionBlocks(blocks: readonly ContentBlock[]): SectionChild[] {
  const root: SectionChild[] = [];
  // Heading groups currently open, deepest last. Each entry is the group itself -- a group carries both its anchor paragraph (and thereby its level) and its children, so it is the scope. An empty stack means the section root: content before any heading, and sections with no headings at all, attach directly to the section group's children.
  const headingStack: HeadingGroupNode[] = [];
  // List groups currently open inside the innermost heading scope. Reset by every heading and every plain paragraph: list nesting is a sub-structure of a heading group, never a bridge across groups or across intervening unlevelled paragraphs -- otherwise a later deeper item would traverse before an earlier sibling and document order would not survive flatten.
  const listStack: ListGroupNode[] = [];
  // The scope every non-heading attachment targets: the innermost open heading group's children, or the section root when no heading is open.
  const headingScope = (): SectionChild[] => headingStack.at(-1)?.children ?? root;
  for (const block of blocks) {
    if (block.kind !== 'paragraph') {
      const parent = listStack.at(-1);
      (parent !== undefined ? parent.children : headingScope()).push(block);
      continue;
    }
    if (isHeadingParagraph(block)) {
      listStack.length = 0;
      const level = block.headingLevel;
      for (let top = headingStack.at(-1); top !== undefined && top.node.headingLevel >= level; top = headingStack.at(-1)) {
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

// A slide becomes one group whose children are one shape group per shape, in shape order -- never the slide's paragraphs taken across its shapes, which would silently discard the shape boundary the source format carries.
function decomposeSlide(slide: ContentSlide): SlideGroupNode {
  const { shapes, ...rest } = slide;
  return { node: { kind: 'slide', ...rest }, children: shapes.map(decomposeShape) };
}

// A sheet's children are its images then its embedded objects (sibling arrays with no cross-array ordering field; this fixed order is what flatten's partition reverses). The grid and print settings ride ON the sheet descriptor -- they are addressable data, not block flow. embeddedObjects is optional on ContentSheet (a sheet may legitimately carry none), so absence spreads as nothing: children then hold images alone, and flatten reconstructs the field's absence from exactly that.
function decomposeSheet(sheet: ContentSheet): SheetGroupNode {
  const { images, embeddedObjects, ...rest } = sheet;
  const children: SheetChild[] = [...images, ...(embeddedObjects ?? [])];
  return { node: { kind: 'sheet', ...rest }, children };
}

// A drawing page's children are its shape groups then its vectors: shapes are containers of their own (groups), vectors are textless primitives with no inner structure (leaves) that stay in the tree so structural diffing still sees them.
function decomposeDrawPage(page: ContentDrawPage): DrawPageGroupNode {
  const { shapes, vectors, ...rest } = page;
  const children = [...shapes.map(decomposeShape), ...vectors];
  return { node: { kind: 'drawPage', ...rest }, children };
}

// A shape is its own group: its frame and insets ride the descriptor (blocks lifted out by the rest-destructure, so future ContentShape fields ride too), and its inner blocks group by list.level inside it. headingLevel is deliberately not read in a shape's flow -- slides and drawing pages have no heading hierarchy of their own, and list.level is the only depth signal their paragraphs actually carry. The list stack is per shape: list nesting never crosses the shape boundary either.
function decomposeShape(shape: ContentShape): ShapeGroupNode {
  const { blocks, ...rest } = shape;
  return { node: rest, children: decomposeShapeBlocks(blocks) };
}

function decomposeShapeBlocks(blocks: readonly ContentBlock[]): ShapeChild[] {
  const root: ShapeChild[] = [];
  const listStack: ListGroupNode[] = [];
  for (const block of blocks) {
    if (block.kind !== 'paragraph') {
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

// Opens a list-item group anchored on `paragraph` at its list.level under the deepest open list group with a strictly shallower level (or directly under `scopeChildren` when none is open), popping equal-or-deeper groups closed -- the same stack semantics heading groups follow, on list.level's 0-based scale, so a level jump nests directly under the nearest shallower item with no synthetic intermediates.
function openListGroup(
  listStack: ListGroupNode[],
  scopeChildren: SectionChild[] | ShapeChild[],
  paragraph: ListParagraph,
): void {
  const level = paragraph.list.level;
  for (let top = listStack.at(-1); top !== undefined && top.node.list.level >= level; top = listStack.at(-1)) {
    listStack.pop();
  }
  const group: ListGroupNode = { node: paragraph, children: [] };
  const parent = listStack.at(-1);
  (parent !== undefined ? parent.children : scopeChildren).push(group);
  listStack.push(group);
}
