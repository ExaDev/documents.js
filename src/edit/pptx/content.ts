import type { ContentBlock, ContentDocument, ContentShape, ContentTable } from 'document-schema.js';
import type { Package } from 'ooxml.js';
import { base64ToBytes } from 'ooxml.js';
import type { DrawingParagraphInit } from './shape';
import { createPptx } from './editor';
import type { PptxSlide } from './slide';
import type { PptxTable, PptxTableCell } from './table';

// ContentDocument -> a fresh pptx Package, the write-side counterpart to src/ooxml/pptx/read.ts's readPptxContent. Used by the PDF->pptx conversion path.
//
// One remaining gap, bounded and tracked rather than silent: every slide shares one deck-wide size (p:sldSz is presentation-level, not per-slide) -- taken from the first slide, since PDF-reconstructed pages that come from a single source document invariably share one page size in practice.
export function buildPptxPackage(content: ContentDocument): Package {
  if (content.kind !== 'presentation') {
    throw new Error('buildPptxPackage requires a presentation ContentDocument');
  }
  const editor = createPptx();
  const firstSlide = content.slides[0];
  if (firstSlide !== undefined) {
    editor.slideSize = firstSlide.size;
  }
  for (const slide of content.slides) {
    const pptxSlide = editor.addSlide();
    for (const shape of slide.shapes) {
      appendShape(pptxSlide, shape);
    }
    if (slide.notes.length > 0) {
      pptxSlide.notes = slide.notes;
    }
  }
  return editor.toPackage();
}

function appendShape(slide: PptxSlide, shape: ContentShape): void {
  const [onlyBlock] = shape.blocks;
  if (shape.blocks.length === 1 && onlyBlock?.kind === 'image') {
    const imageShape = slide.addImage({ frame: shape.frame, format: onlyBlock.format, bytes: base64ToBytes(onlyBlock.base64), altText: onlyBlock.altText });
    if (shape.rotationDeg !== undefined) {
      imageShape.rotationDeg = shape.rotationDeg;
    }
    return;
  }
  if (shape.blocks.length === 1 && onlyBlock?.kind === 'table') {
    const table = slide.addTable({
      frame: shape.frame,
      rotationDeg: shape.rotationDeg,
      table: { rows: onlyBlock.rows.length, columns: onlyBlock.columnWidthsPt.length, columnWidthsPt: onlyBlock.columnWidthsPt },
    });
    populatePptxTable(table, onlyBlock);
    return;
  }
  const paragraphs: DrawingParagraphInit[] = [];
  for (const block of shape.blocks) {
    if (block.kind !== 'paragraph') {
      continue; // a nested table or image mixed alongside other blocks inside a single text shape is out of scope -- neither PDF-reconstructed shapes nor a real pptx/odp slide shape mix kinds this way (see reconstruct.ts and the odp<->pptx table-in-shape fixture in bridges.test.ts)
    }
    paragraphs.push({
      alignment: block.alignment,
      runs: block.runs.map((run) => ({ text: run.text, bold: run.bold, italic: run.italic, fontFamily: run.fontFamily, sizePt: run.sizePt, color: run.color })),
    });
  }
  const textBox = slide.addTextBox({ frame: shape.frame, text: '' });
  if (shape.rotationDeg !== undefined) {
    textBox.rotationDeg = shape.rotationDeg;
  }
  textBox.setParagraphs(paragraphs);
}

function populateCellParagraphs(cell: PptxTableCell, blocks: readonly ContentBlock[]): void {
  const paragraphs: DrawingParagraphInit[] = [];
  for (const block of blocks) {
    if (block.kind !== 'paragraph') {
      continue; // a nested table or image inside a table cell is out of scope, mirroring appendShape's own identical text-shape scope narrowing above
    }
    paragraphs.push({
      alignment: block.alignment,
      runs: block.runs.map((run) => ({ text: run.text, bold: run.bold, italic: run.italic, fontFamily: run.fontFamily, sizePt: run.sizePt, color: run.color })),
    });
  }
  cell.setParagraphs(paragraphs);
}

// Unlike docx's gridSpan-collapses-the-row model, ooxml.js's own readTable (typed/pptx/read.ts) always reads exactly `columns` cells per row regardless of merges -- a covered position is a real a:tc marked hMerge/vMerge="1" (see table.ts's own PptxTableCell), never an omitted or replaced element -- so ContentTable.rows[].cells already has one entry per grid column, in grid-column order, for a pptx-sourced table. That means colIndex === cellIndex directly, with no running-offset bookkeeping needed the way docx's own gridSpan-aware writer (src/edit/docx/content.ts) or ODF's own covered-table-cell writer (src/edit/odt/content.ts) each require.
function populatePptxTable(table: PptxTable, block: ContentTable): void {
  const verticalMerges = new Map<number, number>();
  block.rows.forEach((row, rowIndex) => {
    let horizontalCoverRemaining = 0;
    row.cells.forEach((cell, colIndex) => {
      const tableCell = table.cell(rowIndex, colIndex);
      const verticalRemaining = verticalMerges.get(colIndex);
      const isVerticallyCovered = verticalRemaining !== undefined && verticalRemaining > 0;
      const isHorizontallyCovered = horizontalCoverRemaining > 0;
      if (isVerticallyCovered || isHorizontallyCovered) {
        if (isHorizontallyCovered) {
          tableCell.horizontalMerge = true;
          horizontalCoverRemaining -= 1;
        }
        if (isVerticallyCovered && verticalRemaining !== undefined) {
          tableCell.verticalMerge = true;
          verticalMerges.set(colIndex, verticalRemaining - 1);
        }
        return;
      }
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
      populateCellParagraphs(tableCell, cell.blocks);
    });
  });
}
