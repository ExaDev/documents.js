import type { Package } from 'ooxml.js';
import { base64ToBytes } from 'ooxml.js';
import type { ContentBlock, ContentParagraph, ContentTable } from 'document-content-model';
import type { ContentDocument } from '../../model/content';
import { ptToTwips } from '../../model/units';
import type { DocxBody } from './editor';
import { createDocx } from './editor';
import type { DocxParagraph } from './paragraph';
import type { DocxTableCell } from './table';

// ContentDocument -> a fresh docx Package, built entirely through the same edit/docx/* live-view primitives a caller would use by hand -- the write-side counterpart to src/ooxml/docx/read.ts's readDocxContent. Used by the PDF->docx conversion path (src/layout/reconstruct.ts's output never contains a ContentTable, since PDF table reconstruction degrades to tab-separated text), but written to handle the full ContentBlock union for any other caller that wants a ContentDocument turned into real docx bytes.
//
// Table cell colSpan/rowSpan are read from the content but not yet written: DocxTableCell (table.ts) has no gridSpan/vMerge setters yet, so a merged cell currently round-trips as an ordinary unmerged one -- a documented, bounded gap (cell text content is still correct) rather than a silent one, tracked for whenever a caller genuinely needs table-preserving round-trips.
export function buildDocxPackage(content: ContentDocument): Package {
  if (content.kind !== 'wordprocessing') {
    throw new Error('buildDocxPackage requires a wordprocessing ContentDocument');
  }
  const editor = createDocx();
  content.sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      // A section boundary becomes a page break -- distinct per-section page size/margins (w:sectPr per section) isn't modelled by this bridge yet, since createDocx()'s single scaffolded section covers every caller this function currently has.
      editor.body.appendPageBreak();
    }
    for (const block of section.blocks) {
      appendBlock(editor.body, block);
    }
  });
  return editor.toPackage();
}

function populateParagraph(paragraph: DocxParagraph, block: ContentParagraph): void {
  paragraph.styleId = block.styleId;
  paragraph.alignment = block.alignment;
  for (const run of block.runs) {
    if (run.text === '\t') {
      paragraph.appendTab();
      continue;
    }
    const docxRun = paragraph.appendRun({ text: run.text });
    if (run.bold === true) {
      docxRun.bold = true;
    }
    if (run.italic === true) {
      docxRun.italic = true;
    }
    if (run.underline === true) {
      docxRun.underline = true;
    }
    if (run.fontFamily !== undefined) {
      docxRun.fontFamily = run.fontFamily;
    }
    if (run.sizePt !== undefined) {
      docxRun.sizePt = run.sizePt;
    }
    if (run.color !== undefined) {
      docxRun.color = run.color;
    }
  }
}

function appendTable(body: DocxBody, block: ContentTable): void {
  const columns = block.columnWidthsPt.length;
  if (block.rows.length === 0 || columns === 0) {
    return;
  }
  const table = body.appendTable({ rows: block.rows.length, columns, columnWidthsTwips: block.columnWidthsPt.map(ptToTwips) });
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

function appendCellBlock(cell: DocxTableCell, block: ContentBlock): void {
  if (block.kind === 'paragraph') {
    populateParagraph(cell.appendParagraph(), block);
  }
  // Nested tables and images inside a table cell are out of scope for this bridge -- ContentBlock permits arbitrary nesting, but PDF-sourced content (the one caller today) never produces it.
}

function appendBlock(body: DocxBody, block: ContentBlock): void {
  if (block.kind === 'paragraph') {
    populateParagraph(body.appendParagraph(), block);
  } else if (block.kind === 'image') {
    const paragraph = body.appendParagraph();
    paragraph.insertImageAfter({ format: block.format, bytes: base64ToBytes(block.base64), widthPt: block.widthPt, heightPt: block.heightPt, altText: block.altText });
  } else if (block.kind === 'pageBreak') {
    body.appendPageBreak();
  } else if (block.kind === 'table') {
    appendTable(body, block);
  }
  // block.kind === 'embeddedObject' (document-content-model's forward-looking schema addition for an OLE-style nested document -- formula/wordprocessing/presentation/spreadsheet/drawing) falls through here unhandled: no reader this package depends on (ooxml.js's readDocx/readPptx, odf.js's readOdt/readOdp/readOds/readOdg) produces one yet, so there is nothing to round-trip today -- a documented, currently-unreachable gap, not a silent one.
}
