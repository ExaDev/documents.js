import type { ContentBlock, ContentDocument, ContentEmbeddedObjectBlock, ContentParagraph, ContentTable } from 'document-schema.js';
import type { Package } from 'odf.js';
import { formulaOfBlock, formulaPlaceholderText } from '../../model/formula';
import type { OdtBody } from './editor';
import { createOdt } from './editor';
import type { OdtList, OdtListItem } from './list';
import type { OdtParagraph } from './paragraph';
import type { OdtTable, OdtTableCell } from './table';

// ContentDocument -> a fresh odt Package, built entirely through the same edit/odt/* live-view primitives a caller would use by hand -- the odt-side counterpart to src/edit/docx/content.ts's buildDocxPackage, and the write-side counterpart to src/odf/odt/read.ts's readOdtContent. Used by the PDF->odt conversion path (src/layout/reconstruct.ts's output never contains a ContentTable, since PDF table reconstruction degrades to tab-separated text), but written to handle the full ContentBlock union any other caller's ContentDocument might carry, mirroring buildDocxPackage's own scope exactly.
//
// Image blocks are deliberately NOT written here, unlike buildDocxPackage's own 'image' case: odf.js's readOdt (src/typed/odt/read.ts, readBlocks) does not read draw:frame/draw:image back into a ContentParagraph or any ContentBlock at all -- it dispatches only on text:p/text:h/text:list/table:table/text:section, so a draw:frame this function wrote would be entirely invisible to this package's own reader. Writing one anyway would be dead, silently-unverifiable functionality, not a genuine round-trip capability -- a documented, tracked gap for whenever odf.js's own reader gains image support, not a silent one: a ContentDocument's image blocks are simply skipped, the rest of the document still builds.
export function buildOdtPackage(content: ContentDocument): Package {
  if (content.kind !== 'wordprocessing') {
    throw new Error('buildOdtPackage requires a wordprocessing ContentDocument');
  }
  const editor = createOdt();
  content.sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      // A section boundary becomes a page break -- distinct per-section page size/margins isn't modelled by this bridge yet, mirroring buildDocxPackage's own identical single-page-layout scope (createOdt()'s single scaffolded page-layout covers every caller this function currently has).
      editor.body.appendPageBreak();
    }
    appendBlocks(editor.body, section.blocks);
  });
  return editor.toPackage();
}

// Walks a flat block list, routing maximal consecutive runs of list-member paragraphs (block.list !== undefined, docx's own flat numId/level model -- see paragraph.ts's own DocxParagraph.list) through appendListRun instead of appendBlock, since ODF has no flat paragraph-level list property to set the way buildDocxPackage's own populateParagraph does (see that file's own paragraph.list assignment); a list only exists in ODF as a real text:list/text:list-item tree, so it has to be built as one. Every other block kind is unaffected and still goes through appendBlock one at a time.
function appendBlocks(body: OdtBody, blocks: readonly ContentBlock[]): void {
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block === undefined) {
      i++;
      continue;
    }
    if (block.kind === 'paragraph' && block.list !== undefined) {
      const run: ContentParagraph[] = [];
      while (i < blocks.length) {
        const candidate = blocks[i];
        if (candidate?.kind !== 'paragraph' || candidate.list === undefined) {
          break;
        }
        run.push(candidate);
        i++;
      }
      appendListRun(body, run);
      continue;
    }
    appendBlock(body, block);
    i++;
  }
}

// Builds a real nested text:list/text:list-item tree from a flat run of list-member paragraphs, the inverse of odf.js's own readOdt list-reading (src/typed/odt/read.ts's readListItems: each top-level text:list gets a synthetic numId, each level of text:list nesting increments ContentParagraph.list.level by one). A run of consecutive paragraphs sharing the same numId stays in one text:list; a numId change starts a brand-new top-level list, mirroring how a real docx numbering restart looks once flattened into ContentParagraph.list. Level changes within one numId walk a stack of open OdtList levels, descending one level at a time via the most recently added item's own addNestedList() -- ODF has no way to open a nested list except from inside an existing item, so a paragraph whose level jumps more than one deeper than the currently open list in a single step (skipping an intermediate level entirely, something no known real docx producer emits) lands one level shallower than declared rather than fabricating an empty intermediate item to descend through; ascending back towards the top level has no such constraint and always lands exactly on the declared level.
function appendListRun(body: OdtBody, paragraphs: readonly ContentParagraph[]): void {
  let stack: OdtList[] = [];
  let lastItem: OdtListItem | undefined;
  let activeNumId: string | undefined;

  for (const para of paragraphs) {
    const membership = para.list;
    if (membership === undefined) {
      continue; // unreachable given the caller's own filter -- narrows the type for the reads below.
    }
    if (activeNumId === undefined || membership.numId !== activeNumId) {
      stack = [body.appendList()];
      lastItem = undefined;
      activeNumId = membership.numId;
    }
    // The first item of a fresh list has no item to nest under yet, so it always starts at level 0 regardless of its own declared level -- matches the "cannot skip an intermediate level" bound this function's own top comment documents.
    const targetLevel = lastItem === undefined ? 0 : membership.level;
    while (stack.length - 1 < targetLevel && lastItem !== undefined) {
      stack.push(lastItem.addNestedList());
      lastItem = undefined;
    }
    while (stack.length - 1 > targetLevel) {
      stack.pop();
    }
    const currentList = stack[stack.length - 1];
    if (currentList === undefined) {
      continue; // unreachable: stack always holds at least one list once activeNumId is set.
    }
    const item = currentList.addItem();
    populateParagraph(item.appendParagraph(), para);
    lastItem = item;
  }
}

// Exported so src/edit/odp/content.ts's own buildOdpPackage can reuse this exact resolve-alignment-then-append-styled-runs logic for a presentation shape's own paragraphs -- a draw:frame's draw:text-box holds the identical text:p/text:span content model office:text does, interned into the identical content.xml StyleRegistry (see src/edit/odt/props.ts), so there is no presentation-specific variant of this function to write.
export function populateParagraph(paragraph: OdtParagraph, block: ContentParagraph): void {
  if (block.styleId !== undefined) {
    paragraph.styleId = block.styleId;
  }
  if (block.alignment !== undefined) {
    paragraph.alignment = block.alignment;
  }
  for (const run of block.runs) {
    if (run.text === '\t') {
      paragraph.appendTab();
      continue;
    }
    const odtRun = paragraph.appendRun({ text: run.text });
    if (run.bold === true) {
      odtRun.bold = true;
    }
    if (run.italic === true) {
      odtRun.italic = true;
    }
    if (run.underline === true) {
      odtRun.underline = true;
    }
    if (run.fontFamily !== undefined) {
      odtRun.fontFamily = run.fontFamily;
    }
    if (run.sizePt !== undefined) {
      odtRun.sizePt = run.sizePt;
    }
    if (run.color !== undefined) {
      odtRun.color = run.color;
    }
  }
}

function populateCellBlocks(cell: OdtTableCell, blocks: readonly ContentBlock[]): void {
  const [firstBlock, ...restBlocks] = blocks;
  const firstParagraph = cell.paragraphs()[0];
  if (firstBlock?.kind === 'paragraph' && firstParagraph !== undefined) {
    populateParagraph(firstParagraph, firstBlock);
  } else if (firstBlock !== undefined) {
    appendCellBlock(cell, firstBlock);
  }
  for (const remaining of restBlocks) {
    appendCellBlock(cell, remaining);
  }
}

// Unlike docx's gridSpan (see the identically-named function in src/edit/docx/content.ts), ODF needs a real table:covered-table-cell element for EVERY grid position a merge consumes, horizontal or vertical -- odf.js's own readTableRow pushes one `{ blocks: [] }` array entry per covered-table-cell it finds (see typed/shared/table.ts), so ContentTable.rows[].cells already has exactly one entry per grid column in every row, master cells and covered placeholders alike. This walks each row left to right, consuming those placeholder entries as it goes: horizontalCoverRemaining accounts for the REST OF THIS ROW'S OWN entries a colSpan>1 master cell just consumed, and verticalMerges (keyed by grid column index) accounts for a rowSpan>1 master's entries in EVERY row below it, across the full width of its own colSpan. Exported so src/edit/odp/content.ts's own buildOdpPackage can reuse this exact merge-aware population logic for a slide shape's own table:table content (a draw:frame's table:table is byte-for-byte the same content model a document-level one is -- see odf.js's own readDrawFrameContent) -- the table.ts primitives it walks (OdtTable.appendEmptyRow/OdtTableRow.appendCell/appendCoveredCell) are already format-neutral over WHERE the table:table element lives.
export function populateOdtTable(table: OdtTable, block: ContentTable): void {
  const verticalMerges = new Map<number, number>();
  block.rows.forEach((row) => {
    const tableRow = table.appendEmptyRow();
    let colIndex = 0;
    let horizontalCoverRemaining = 0;
    row.cells.forEach((cell) => {
      if (horizontalCoverRemaining > 0) {
        tableRow.appendCoveredCell();
        horizontalCoverRemaining -= 1;
        colIndex += 1;
        return;
      }
      const verticalRemaining = verticalMerges.get(colIndex);
      if (verticalRemaining !== undefined && verticalRemaining > 0) {
        tableRow.appendCoveredCell();
        verticalMerges.set(colIndex, verticalRemaining - 1);
        colIndex += 1;
        return;
      }
      const tableCell = tableRow.appendCell();
      const span = cell.colSpan ?? 1;
      if (span > 1) {
        tableCell.colSpan = span;
        horizontalCoverRemaining = span - 1;
      }
      if (cell.rowSpan !== undefined && cell.rowSpan > 1) {
        tableCell.rowSpan = cell.rowSpan;
        for (let c = 0; c < span; c++) {
          verticalMerges.set(colIndex + c, cell.rowSpan - 1);
        }
      }
      populateCellBlocks(tableCell, cell.blocks);
      colIndex += 1;
    });
  });
}

function appendTable(body: OdtBody, block: ContentTable): void {
  const columns = block.columnWidthsPt.length;
  if (block.rows.length === 0 || columns === 0) {
    return;
  }
  const table = body.appendTable({ rows: 0, columns, columnWidthsPt: block.columnWidthsPt });
  populateOdtTable(table, block);
}

function appendCellBlock(cell: OdtTableCell, block: ContentBlock): void {
  if (block.kind === 'paragraph') {
    populateParagraph(cell.appendParagraph(), block);
  }
  // Nested tables and images inside a table cell are out of scope for this bridge -- ContentBlock permits arbitrary nesting, but PDF-sourced content (the one caller today) never produces it, mirroring buildDocxPackage's own identical comment.
}

function appendBlock(body: OdtBody, block: ContentBlock): void {
  if (block.kind === 'paragraph') {
    populateParagraph(body.appendParagraph(), block);
  } else if (block.kind === 'pageBreak') {
    body.appendPageBreak();
  } else if (block.kind === 'table') {
    appendTable(body, block);
  } else if (block.kind === 'embeddedObject') {
    appendEmbeddedObject(body, block);
  }
  // block.kind === 'image' is intentionally unhandled -- see this file's own top-of-file comment.
}

// An embedded formula becomes a paragraph carrying its own plain-text stand-in, mirroring buildDocxPackage's identical appendEmbeddedObject (see that function for the full reasoning, including why a reachable 'drawing' objectKind is deliberately written as nothing here rather than degraded to a stand-in). Writing the real MathML back would mean writing a genuine embedded formula SUB-PACKAGE (a nested Object N/content.xml plus its own draw:frame/draw:object reference and manifest entries) -- a real feature, not a small extension of this block writer -- so the stand-in is the honest degradation until that exists, rather than the formula vanishing without trace.
function appendEmbeddedObject(body: OdtBody, block: ContentEmbeddedObjectBlock): void {
  const formula = formulaOfBlock(block);
  if (formula === undefined) {
    return;
  }
  populateParagraph(body.appendParagraph(), { kind: 'paragraph', runs: [{ text: formulaPlaceholderText(formula) }] });
}
