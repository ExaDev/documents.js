import type { ContentDocument, ContentParagraph } from 'document-schema.js';
import type { OutlineChild, OutlineLeaf, OutlineNode } from './node';

type WordprocessingDocument = Extract<ContentDocument, { kind: 'wordprocessing' }>;
type PresentationDocument = Extract<ContentDocument, { kind: 'presentation' }>;
type SpreadsheetDocument = Extract<ContentDocument, { kind: 'spreadsheet' }>;
type DrawingDocument = Extract<ContentDocument, { kind: 'drawing' }>;
type FormulaDocument = Extract<ContentDocument, { kind: 'formula' }>;

// Builds a hierarchical outline over any ContentDocument, dispatching on doc.kind. Returns the root scope's children, OutlineChild[]: the root is not itself a node (no synthetic "document" root group), so a wordprocessing document's pre-heading content -- or a document with no grouping signal at all -- appears as leaves directly in the returned array alongside (or instead of) group nodes. The presentation/spreadsheet/drawing/formula kinds always yield pure group arrays, because every one of their roots is a group (Slide N / sheet name / Page N / the single formula node). Document order is preserved everywhere: a child always appears in the position its source block occupied.
//
// Per-kind shape (the contract, mirroring how Word's navigation pane and PowerPoint's outline view present structure):
// - wordprocessing: heading paragraphs open groups nested by headingLevel with stack semantics (a heading nests under the deepest open group with a strictly shallower level and pops equal-or-deeper groups closed -- an H4 after an H2 becomes its direct child with no synthetic intermediates, an H1 after an H3 pops to the root). headingLevel is the ONLY heading signal read; a Heading style without headingLevel does not group, because headingLevel is the canonical field this ecosystem's readers all populate. Inside a group, paragraphs carrying list membership nest further by list.level on the same stack semantics (level 0 items are the group's children, level 1 under the last level 0, a jump 0 -> 2 nests directly under the 0 with no synthetic level 1). Non-paragraph blocks (tables, images, page breaks, embedded objects) attach as leaves at the current depth without changing it; a plain paragraph -- no heading level, no list membership -- sits flat at its scope and closes the list nesting. A heading paragraph is represented by its group node (its text is the node's text) and is not duplicated as a leaf; likewise a list paragraph is its group node.
// - presentation: one group per slide labelled "Slide N" (1-based, matching the Markdown renderer's own per-slide heading convention), and the slide's paragraphs -- taken across its shapes in shape order -- nest under that group by list.level exactly as in wordprocessing, PowerPoint-outline-view semantics. headingLevel is deliberately not read here: slides have no heading hierarchy of their own, and list.level is the only depth signal slides actually carry. Non-paragraph blocks attach as leaves at the current depth without changing it; a slide paragraph with no list level sits flat under its group (and closes the list nesting), so a slide whose paragraphs carry no list levels at all is simply flat under its group.
// - spreadsheet: one group per sheet labelled with the sheet's own name; children are the sheet's images then its embedded objects. Cells are addressable data, not outline content -- they never appear.
// - drawing: one group per page labelled "Page N" (1-based, again matching the Markdown renderer); children are the page's shape blocks in shape order, then the page's vectors. Vectors carry no text but stay as leaves so structural diffing still sees them.
// - formula: a single group whose one leaf child is the ContentFormula itself -- a standalone equation has no hierarchy to build, but chunking consumers still get it as one retrievable unit. The group's label is the formula's LaTeX linearisation when present, else the empty string.
export function buildOutline(doc: ContentDocument): OutlineChild[] {
  switch (doc.kind) {
    case 'wordprocessing':
      return wordprocessingOutline(doc);
    case 'presentation':
      return presentationOutline(doc);
    case 'spreadsheet':
      return spreadsheetOutline(doc);
    case 'drawing':
      return drawingOutline(doc);
    case 'formula':
      return formulaOutline(doc);
  }
}

function wordprocessingOutline(doc: WordprocessingDocument): OutlineChild[] {
  const root: OutlineChild[] = [];
  // Heading groups currently open, deepest last. Each entry is the OutlineNode itself -- a node carries both its level and its children, so it is the scope. An empty stack means the root scope: content before any heading, and documents with no headings at all, attach directly to the root array.
  const headingStack: OutlineNode[] = [];
  // List-item groups currently open inside the innermost heading scope. Reset by every heading and by every plain paragraph: list nesting is a sub-structure of a heading group, never a bridge across groups or across intervening unlevelled paragraphs.
  const listStack: OutlineNode[] = [];
  // The scope children every non-heading attachment targets: the innermost open heading group's children, or the root array when no heading is open.
  const headingScope = (): OutlineChild[] => headingStack.at(-1)?.children ?? root;
  for (const section of doc.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        attachLeaf(listStack, headingScope(), block);
        continue;
      }
      const list = block.list;
      if (block.headingLevel !== undefined) {
        listStack.length = 0;
        const level = block.headingLevel;
        for (let top = headingStack.at(-1); top !== undefined && top.level >= level; top = headingStack.at(-1)) {
          headingStack.pop();
        }
        const node: OutlineNode = { text: paragraphText(block), level, children: [] };
        const parent = headingStack.at(-1);
        (parent !== undefined ? parent.children : root).push(node);
        headingStack.push(node);
      } else if (list !== undefined) {
        openListGroup(listStack, headingScope(), paragraphText(block), list.level);
      } else {
        // A paragraph with neither a heading level nor list membership sits flat at its scope (the open heading group, or the root) and closes any open list nesting: list items nest under the last list item, never across an intervening plain paragraph, which would otherwise leave a later deeper item traversing before an earlier sibling and break the document-order guarantee.
        listStack.length = 0;
        headingScope().push(block);
      }
    }
  }
  return root;
}

function presentationOutline(doc: PresentationDocument): OutlineNode[] {
  return doc.slides.map((slide, index) => {
    const group: OutlineNode = { text: `Slide ${String(index + 1)}`, level: 1, children: [] };
    const listStack: OutlineNode[] = [];
    for (const shape of slide.shapes) {
      for (const block of shape.blocks) {
        if (block.kind !== 'paragraph') {
          attachLeaf(listStack, group.children, block);
          continue;
        }
        const list = block.list;
        if (list !== undefined) {
          openListGroup(listStack, group.children, paragraphText(block), list.level);
        } else {
          // Same flat-and-close rule as wordprocessing's plain paragraphs: a slide paragraph with no list level sits directly under the slide group, and it closes any open list nesting so document order survives the flattening.
          listStack.length = 0;
          group.children.push(block);
        }
      }
    }
    return group;
  });
}

function spreadsheetOutline(doc: SpreadsheetDocument): OutlineNode[] {
  return doc.sheets.map((sheet) => ({
    text: sheet.name,
    level: 1,
    // embeddedObjects is optional on the schema (a sheet may legitimately carry none), so absence spreads as nothing -- modelled explicitly rather than defaulted, because "no embedded objects" is a real state, not a missing value.
    children: [...sheet.images, ...(sheet.embeddedObjects ?? [])],
  }));
}

function drawingOutline(doc: DrawingDocument): OutlineNode[] {
  return doc.pages.map((page, index) => ({
    text: `Page ${String(index + 1)}`,
    level: 1,
    // Shape blocks first in shape order, then vectors in array order -- the two live in sibling arrays with no cross-array ordering field, and this fixed order is deterministic and matches the schema's own declaration order.
    children: [...page.shapes.flatMap((shape) => shape.blocks), ...page.vectors],
  }));
}

function formulaOutline(doc: FormulaDocument): OutlineNode[] {
  return [
    {
      // presentation.latex is the equation's most readable linearisation and therefore the group's label; absence (an allowed state) means the empty string, and the ContentFormula leaf always carries the actual content whatever the label.
      text: doc.formula.presentation?.latex ?? '',
      level: 1,
      children: [doc.formula],
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

// Attaches a leaf payload at the current depth -- under the deepest open list group when one is open, else under the scope's own children -- without changing that depth.
function attachLeaf(listStack: OutlineNode[], scopeChildren: OutlineChild[], leaf: OutlineLeaf): void {
  const parent = listStack.at(-1);
  (parent !== undefined ? parent.children : scopeChildren).push(leaf);
}

function paragraphText(paragraph: ContentParagraph): string {
  return paragraph.runs.map((run) => run.text).join('');
}
