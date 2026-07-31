import type { Package } from 'odf.js';
import type { ContentBlock, ContentParagraph, ContentTable } from 'document-content-model';
import type { ContentDocument } from '../../model/content';
import type { OdtBody } from './editor';
import { createOdt } from './editor';
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
    for (const block of section.blocks) {
      appendBlock(editor.body, block);
    }
  });
  return editor.toPackage();
}

// Exported so src/edit/odp/content.ts's own buildOdpPackage can reuse this exact resolve-alignment-then-append-styled-runs logic for a presentation shape's own paragraphs -- a draw:frame's draw:text-box holds the identical text:p/text:span content model office:text does, interned into the identical content.xml StyleRegistry (see src/edit/odt/props.ts), so there is no presentation-specific variant of this function to write.
export function populateParagraph(paragraph: OdtParagraph, block: ContentParagraph): void {
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
