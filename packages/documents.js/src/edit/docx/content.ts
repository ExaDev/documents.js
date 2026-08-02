import type { ContentBlock, ContentDocument, ContentParagraph, ContentTable } from 'document-schema.js';
import type { Package } from 'ooxml.js';
import { base64ToBytes } from 'ooxml.js';
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
    appendBlocks(editor.body, section.blocks);
  });
  return editor.toPackage();
}

// ooxml.js's readDocx (real docx image reading, 2.6.1+) always represents an inline image as TWO adjacent ContentBlocks sourced from the one physical <w:p>: a paragraph block carrying that paragraph's own (possibly all-empty) text runs, immediately followed by an image block for the w:drawing found inside it -- there is no signal in ContentDocument distinguishing that pairing from a genuinely separate, intentionally-blank paragraph that happens to sit immediately before an unrelated image. Writing both blocks back as two independent paragraphs (the naive per-block loop) is round-trip-safe for the rare separate-blank-paragraph case but wrong for the overwhelmingly common inline-image case, inserting a spurious extra empty paragraph before every image on every docx round trip. isMergeableImageParagraph/appendBlocks instead special-case exactly the pattern readDocx always produces for a genuine inline image (a paragraph whose runs are all empty text, directly followed by an image block) and write it back as the single physical paragraph it came from, by populating the paragraph's own properties/runs and then calling insertImageAfter on that SAME paragraph rather than a fresh one -- consuming both ContentBlocks in one step. A paragraph with any non-empty run text is never merged, since ooxml.js's own reader only ever emits the image as a trailing sibling of an all-empty-runs paragraph (confirmed against real readDocx output: a drawing inside a paragraph that also carries real text produces the drawing's own empty-text run inline within that SAME paragraph block, never as a separate block at all -- see this repo's README Gotchas).
function isMergeableImageParagraph(block: ContentBlock): block is ContentParagraph {
  return block.kind === 'paragraph' && block.runs.every((run) => run.text === '');
}

function appendBlocks(body: DocxBody, blocks: readonly ContentBlock[]): void {
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    const next = blocks[index + 1];
    if (block !== undefined && isMergeableImageParagraph(block) && next?.kind === 'image') {
      // Only the paragraph's own properties are written here, never its runs -- every run.text in a mergeable paragraph is an empty placeholder for the drawing's own run position (see this function's own top comment), and writing it via populateParagraph would add a real, spurious empty-text run alongside the one insertImageAfter is about to add for the drawing itself, doubling up on the re-read.
      const paragraph = body.appendParagraph();
      paragraph.styleId = block.styleId;
      paragraph.alignment = block.alignment;
      paragraph.list = block.list;
      paragraph.insertImageAfter({ format: next.format, bytes: base64ToBytes(next.base64), widthPt: next.widthPt, heightPt: next.heightPt, altText: next.altText });
      index += 2;
      continue;
    }
    if (block !== undefined) {
      appendBlock(body, block);
    }
    index += 1;
  }
}

function populateParagraph(paragraph: DocxParagraph, block: ContentParagraph): void {
  paragraph.styleId = block.styleId;
  paragraph.alignment = block.alignment;
  paragraph.list = block.list;
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
  // block.kind === 'embeddedObject' (document-schema.js's forward-looking schema addition for an OLE-style nested document -- formula/wordprocessing/presentation/spreadsheet/drawing) falls through here unhandled: no reader this package depends on (ooxml.js's readDocx/readPptx, odf.js's readOdt/readOdp/readOds/readOdg) produces one yet, so there is nothing to round-trip today -- a documented, currently-unreachable gap, not a silent one.
}
