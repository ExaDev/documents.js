import {
  isHeadingGroupNode,
  isListGroupNode,
  isShapeGroupNode,
  type ContentFormula,
  type ContentParagraph,
  type DocumentPackage,
  type DrawPageGroupNode,
  type ListChild,
  type SectionChild,
  type SectionGroupNode,
  type ShapeChild,
  type ShapeGroupNode,
  type SheetGroupNode,
  type SlideGroupNode,
} from 'document-schema.js';
import type { OutlineChild, OutlineLeaf, OutlineNode } from './node';

// Builds the hierarchical outline over a tree-form DocumentPackage (document-schema.js 4.0.0's promoted shape, ExaDev/document-schema.js#20), dispatching on pkg.kind and projecting pkg.children. This is the TOC PROJECTION, not a decomposition: it deliberately re-groups across container boundaries -- a wordprocessing package's sections flow into one tree, a slide's paragraphs are taken across its shapes in shape order -- which is exactly the lossiness a table of contents wants, and exactly why the lossless decompose/flatten pair lives in documents.js's package boundary instead (ExaDev/document-outline.js#2 phase 2: one implementation, one authority; this package keeps no second copy of the grouping semantics). Returns the root scope's children, OutlineChild[]: the root is not itself a node (no synthetic "document" root group), so a wordprocessing document's pre-heading content -- or a document with no grouping signal at all -- appears as leaves directly in the returned array alongside (or instead of) group nodes. Document order is preserved everywhere: a child always appears in the position its source node occupied.
//
// The tree already carries each container's internal grouping (heading groups nest by headingLevel, list groups by list.level), so within one container the projection is a plain structural walk. The stack machinery below exists for the cross-container merge: the heading/list stacks stay open across section boundaries (wordprocessing) and across shape boundaries within a slide (presentation), so a package whose section ends mid-nesting continues that nesting when the next section opens -- pre-order walk of the tree, stack semantics applied to each group anchor exactly as they were applied to each paragraph before the tree form existed. A paragraph at a leaf position sits flat at its scope and closes the list nesting; a group's own text is always its projected label, never duplicated as a leaf.
//
// Per-kind shape (the contract, mirroring how Word's navigation pane and PowerPoint's outline view present structure):
// - wordprocessing: heading groups become outline nodes nested by their anchor's headingLevel with stack semantics (a heading nests under the deepest open group with a strictly shallower level and pops equal-or-deeper groups closed -- an H4 after an H2 becomes its direct child with no synthetic intermediates, an H1 after an H3 pops to the root). headingLevel is the ONLY heading signal read; a Heading styleId without headingLevel does not group, because headingLevel is the canonical field this ecosystem's readers all populate (and in a well-formed tree such a paragraph is a leaf, not an anchor -- the decomposition only wraps paragraphs that actually carry the signal). Inside a heading group, list groups nest further by list.level on the same stack semantics (level 0 items are the group's children, level 1 under the last level 0, a jump 0 -> 2 nests directly under the 0 with no synthetic level 1). Non-paragraph blocks (tables, images, page breaks, embedded objects) attach as leaves at the current depth without changing it; a plain paragraph leaf sits flat at its scope and closes the list nesting. Sections flow into ONE tree: the stacks persist across section group boundaries.
// - presentation: one group per slide labelled "Slide N" (1-based, matching the Markdown renderer's own per-slide heading convention), and the slide's paragraphs -- taken across its shape groups in shape order -- nest under that group by list.level, PowerPoint-outline-view semantics. headingLevel is deliberately not read here (nor anywhere a shape's flow is projected): slides have no heading hierarchy of their own, and list.level is the only depth signal slides actually carry, so a heading-styled paragraph that sits as a leaf in a shape's flow projects flat. Non-paragraph blocks attach as leaves at the current depth without changing it; a slide paragraph with no list level sits flat under its group (and closes the list nesting), so a slide whose paragraphs carry no list levels at all is simply flat under its group.
// - spreadsheet: one group per sheet labelled with the sheet's own name; children are the sheet group's own children -- its images then its embedded objects, the fixed order the tree already carries. Cells are addressable data, not outline content -- they ride the sheet node and never appear.
// - drawing: one group per page labelled "Page N" (1-based, again matching the Markdown renderer); children are the page's shape-group contents flattened to leaves in shape order (a drawing outline is flat under its page -- list structure inside a text box is not TOC hierarchy), then the page's vector leaves. Vectors carry no text but stay as leaves so structural diffing still sees them.
// - formula: a single group whose one leaf child is the ContentFormula itself -- a standalone equation has no hierarchy to build, but chunking consumers still get it as one retrievable unit. The group's label is the formula's LaTeX linearisation when present, else the empty string.
export function buildOutline(pkg: DocumentPackage): OutlineChild[] {
  switch (pkg.kind) {
    case 'wordprocessing':
      return wordprocessingOutline(pkg.children);
    case 'presentation':
      return presentationOutline(pkg.children);
    case 'spreadsheet':
      return spreadsheetOutline(pkg.children);
    case 'drawing':
      return drawingOutline(pkg.children);
    case 'formula':
      // The schema pins a formula package's children to exactly one ContentFormula, so the single element is the whole content and the [0] access can never miss on a schema-valid package.
      return formulaOutline(pkg.children[0]!);
  }
}

function wordprocessingOutline(sections: readonly SectionGroupNode[]): OutlineChild[] {
  const root: OutlineChild[] = [];
  // Heading groups currently open, deepest last. Each entry is the OutlineNode itself -- a node carries both its level and its children, so it is the scope. An empty stack means the root scope: content before any heading, and documents with no headings at all, attach directly to the root array.
  const headingStack: OutlineNode[] = [];
  // List-item groups currently open inside the innermost heading scope. Reset by every heading group and every plain paragraph leaf: list nesting is a sub-structure of a heading group, never a bridge across groups or across intervening unlevelled paragraphs.
  const listStack: OutlineNode[] = [];
  // The scope every non-heading attachment targets: the innermost open heading group's children, or the root array when no heading is open.
  const headingScope = (): OutlineChild[] => headingStack.at(-1)?.children ?? root;
  // One walk serves every nesting depth: a heading/list group projects its anchor through the stack machine, then its children walk with the newly opened node as the live scope -- which is how a tree section's internal nesting survives intact while the stacks still carry open scopes ACROSS section boundaries (the outer loop never resets them).
  const walk = (children: readonly SectionChild[]): void => {
    for (const child of children) {
      if (isHeadingGroupNode(child)) {
        listStack.length = 0;
        const level = child.node.headingLevel;
        for (let top = headingStack.at(-1); top !== undefined && top.level >= level; top = headingStack.at(-1)) {
          headingStack.pop();
        }
        const node: OutlineNode = { text: paragraphText(child.node), level, children: [] };
        const parent = headingStack.at(-1);
        (parent !== undefined ? parent.children : root).push(node);
        headingStack.push(node);
        walk(child.children);
      } else if (isListGroupNode(child)) {
        openListGroup(listStack, headingScope(), paragraphText(child.node), child.node.list.level);
        walk(child.children);
      } else if (child.kind === 'paragraph') {
        // A paragraph at a leaf position carries neither grouping signal (the decomposition only anchors paragraphs that carry one; a Heading-styled paragraph without headingLevel is exactly such a leaf), so it sits flat at its scope and closes the list nesting: list items nest under the last list item, never across an intervening plain paragraph, which would otherwise leave a later deeper item traversing before an earlier sibling and break the document-order guarantee.
        listStack.length = 0;
        headingScope().push(child);
      } else {
        const parent = listStack.at(-1);
        (parent !== undefined ? parent.children : headingScope()).push(child);
      }
    }
  };
  for (const section of sections) {
    walk(section.children);
  }
  return root;
}

function presentationOutline(slides: readonly SlideGroupNode[]): OutlineNode[] {
  return slides.map((slide, index) => {
    const group: OutlineNode = { text: `Slide ${String(index + 1)}`, level: 1, children: [] };
    const listStack: OutlineNode[] = [];
    const walk = (children: readonly ShapeChild[]): void => {
      for (const child of children) {
        if (isListGroupNode(child)) {
          openListGroup(listStack, group.children, paragraphText(child.node), child.node.list.level);
          walk(child.children);
        } else if (child.kind === 'paragraph') {
          // Same flat-and-close rule as wordprocessing's plain paragraphs, and it also covers the heading-styled paragraph leaf a shape's flow legitimately carries (headingLevel is not a depth signal in a shape -- see the per-kind contract above).
          listStack.length = 0;
          group.children.push(child);
        } else {
          const parent = listStack.at(-1);
          (parent !== undefined ? parent.children : group.children).push(child);
        }
      }
    };
    // The slide's own children are its shape groups; walking each shape's children in order takes the slide's paragraphs across its shapes -- the deliberate TOC lossiness (the shape boundary the source format carries is the decomposition's to preserve, not the outline's).
    for (const shape of slide.children) {
      walk(shape.children);
    }
    return group;
  });
}

function spreadsheetOutline(sheets: readonly SheetGroupNode[]): OutlineNode[] {
  return sheets.map((sheet) => ({ text: sheet.node.name, level: 1, children: [...sheet.children] }));
}

function drawingOutline(pages: readonly DrawPageGroupNode[]): OutlineNode[] {
  return pages.map((page, index) => ({
    text: `Page ${String(index + 1)}`,
    level: 1,
    // Each shape group's children flatten to leaves (list-group anchors re-emerge as their anchor paragraphs in document order, pre-order), then the page's vector leaves follow -- the fixed shapes-then-vectors order the tree already carries.
    children: page.children.flatMap((child): OutlineLeaf[] =>
      isShapeGroupNode(child) ? flattenShapeChildren(child) : [child],
    ),
  }));
}

// A drawing shape's flow flattens to plain leaves under the page group: list-group anchors become their own paragraph leaves (pre-order) and nested structure does not survive -- a drawing outline is flat, matching the per-kind contract above.
function flattenShapeChildren(group: ShapeGroupNode): OutlineLeaf[] {
  return flattenListFlow(group.children);
}

function flattenListFlow(children: readonly ListChild[]): OutlineLeaf[] {
  const leaves: OutlineLeaf[] = [];
  for (const child of children) {
    if (isListGroupNode(child)) {
      leaves.push(child.node, ...flattenListFlow(child.children));
    } else {
      leaves.push(child);
    }
  }
  return leaves;
}

function formulaOutline(formula: ContentFormula): OutlineChild[] {
  return [
    {
      // presentation.latex is the equation's most readable linearisation and therefore the group's label; absence (an allowed state) means the empty string, and the ContentFormula leaf always carries the actual content whatever the label.
      text: formula.presentation?.latex ?? '',
      level: 1,
      children: [formula],
    },
  ];
}

// Opens a list-item group carrying `text` at `level` under the deepest open list group with a strictly shallower level (or directly under `scopeChildren` when none is open), popping equal-or-deeper groups closed -- the same stack semantics heading groups follow, on list.level's 0-based scale, so a level jump nests directly under the nearest shallower item with no synthetic intermediates.
function openListGroup(listStack: OutlineNode[], scopeChildren: OutlineChild[], text: string, level: number): void {
  for (let top = listStack.at(-1); top !== undefined && top.level >= level; top = listStack.at(-1)) {
    listStack.pop();
  }
  const node: OutlineNode = { text, level, children: [] };
  const parent = listStack.at(-1);
  (parent !== undefined ? parent.children : scopeChildren).push(node);
  listStack.push(node);
}

function paragraphText(paragraph: ContentParagraph): string {
  return paragraph.runs.map((run) => run.text).join('');
}
