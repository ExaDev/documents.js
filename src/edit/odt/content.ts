import type { ContentBlock, ContentDocument, ContentParagraph, ContentTable } from 'document-schema.js';
import type { Package } from 'odf.js';
import type { OdtBody } from './editor';
import { createOdt } from './editor';
import type { OdtList, OdtListItem } from './list';
import type { OdtParagraph } from './paragraph';
import type { OdtTableCell } from './table';

// ContentDocument -> a fresh odt Package, built entirely through the same edit/odt/* live-view primitives a caller would use by hand -- the odt-side counterpart to src/edit/docx/content.ts's buildDocxPackage, and the write-side counterpart to src/odf/odt/read.ts's readOdtContent. Used by the PDF->odt conversion path (src/layout/reconstruct.ts's output never contains a ContentTable, since PDF table reconstruction degrades to tab-separated text), but written to handle the full ContentBlock union any other caller's ContentDocument might carry, mirroring buildDocxPackage's own scope exactly.
//
// Image blocks are deliberately NOT written here, unlike buildDocxPackage's own 'image' case: odf.js's readOdt (src/typed/odt/read.ts, readBlocks) does not read draw:frame/draw:image back into a ContentParagraph or any ContentBlock at all -- it dispatches only on text:p/text:h/text:list/table:table/text:section, so a draw:frame this function wrote would be entirely invisible to this package's own reader. Writing one anyway would be dead, silently-unverifiable functionality, not a genuine round-trip capability -- a documented, tracked gap for whenever odf.js's own reader gains image support, not a silent one: a ContentDocument's image blocks are simply skipped, the rest of the document still builds.
//
// Table cell colSpan/rowSpan are read from the content but not yet written, mirroring buildDocxPackage's own identical documented gap: OdtTableCell (table.ts) has no colSpan/rowSpan setters yet, so a merged cell currently round-trips as an ordinary unmerged one.
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

function appendTable(body: OdtBody, block: ContentTable): void {
  const columns = block.columnWidthsPt.length;
  if (block.rows.length === 0 || columns === 0) {
    return;
  }
  const table = body.appendTable({ rows: block.rows.length, columns, columnWidthsPt: block.columnWidthsPt });
  block.rows.forEach((row, rowIndex) => {
    const tableRow = table.rows()[rowIndex];
    if (tableRow === undefined) {
      return;
    }
    row.cells.forEach((cell, cellIndex) => {
      const tableCell = tableRow.cells()[cellIndex];
      if (tableCell === undefined) {
        return;
      }
      const [firstBlock, ...restBlocks] = cell.blocks;
      const firstParagraph = tableCell.paragraphs()[0];
      if (firstBlock?.kind === 'paragraph' && firstParagraph !== undefined) {
        populateParagraph(firstParagraph, firstBlock);
      } else if (firstBlock !== undefined) {
        appendCellBlock(tableCell, firstBlock);
      }
      for (const remaining of restBlocks) {
        appendCellBlock(tableCell, remaining);
      }
    });
  });
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
  }
  // block.kind === 'image' is intentionally unhandled -- see this file's own top-of-file comment. block.kind === 'embeddedObject' falls through here unhandled for the same reason buildDocxPackage's own does: no reader this package depends on produces one yet.
}
