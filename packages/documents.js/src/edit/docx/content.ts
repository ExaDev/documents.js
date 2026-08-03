import type { ContentBlock, ContentDocument, ContentEmbeddedObjectBlock, ContentParagraph, ContentTable } from 'document-schema.js';
import type { Package } from 'ooxml.js';
import { formulaOfBlock, formulaPlaceholderText } from '../../model/formula';
import { base64ToBytes } from 'ooxml.js';
import { ptToTwips } from '../../model/units';
import type { DocxBody } from './editor';
import { createDocx } from './editor';
import type { DocxParagraph } from './paragraph';
import type { DocxTableCell } from './table';

// ContentDocument -> a fresh docx Package, built entirely through the same edit/docx/* live-view primitives a caller would use by hand -- the write-side counterpart to src/ooxml/docx/read.ts's readDocxContent. Used by the PDF->docx conversion path (src/layout/reconstruct.ts's output never contains a ContentTable, since PDF table reconstruction degrades to tab-separated text), but written to handle the full ContentBlock union for any other caller that wants a ContentDocument turned into real docx bytes.
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

function populateCellBlocks(cell: DocxTableCell, blocks: readonly ContentBlock[]): void {
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

// docx (unlike ODF -- see appendTable in src/edit/odt/content.ts) never writes a placeholder element for a column consumed by a horizontal merge, so ContentTable.rows[].cells has exactly one array entry per REAL w:tc the row will contain -- appendRow(row.cells.length) below builds precisely that many, rather than the fixed `columns` grid every row would otherwise get. A vertical merge (rowSpan), by contrast, still needs one real w:tc per covered row (Word has nowhere else to hang that row's own content), so those covered rows' own entries in `row.cells` (present as ordinary, usually-empty cells -- see ooxml.js's own readTable) are written as w:vMerge="continue" cells here rather than populated as fresh content. verticalMerges tracks, per grid column index (accounting for colSpan), how many further rows remain covered and what gridSpan the continuation cells in those rows should themselves carry, so a merge that is both column- and row-spanning covers the full rectangle, not just its own starting column.
function appendTable(body: DocxBody, block: ContentTable): void {
  const columns = block.columnWidthsPt.length;
  if (block.rows.length === 0 || columns === 0) {
    return;
  }
  const table = body.appendTable({ rows: 0, columns, columnWidthsTwips: block.columnWidthsPt.map(ptToTwips) });
  const verticalMerges = new Map<number, { rowsRemaining: number; gridSpan: number }>();
  block.rows.forEach((row) => {
    const tableRow = table.appendRow(row.cells.length);
    const domCells = tableRow.cells();
    let colIndex = 0;
    row.cells.forEach((cell, cellIndex) => {
      const tableCell = domCells[cellIndex];
      if (tableCell === undefined) {
        return;
      }
      const active = verticalMerges.get(colIndex);
      if (active !== undefined && active.rowsRemaining > 0) {
        if (active.gridSpan > 1) {
          tableCell.colSpan = active.gridSpan;
        }
        tableCell.verticalMerge = 'continue';
        verticalMerges.set(colIndex, { rowsRemaining: active.rowsRemaining - 1, gridSpan: active.gridSpan });
        colIndex += active.gridSpan;
        return;
      }
      const span = cell.colSpan ?? 1;
      if (span > 1) {
        tableCell.colSpan = span;
      }
      if (cell.rowSpan !== undefined && cell.rowSpan > 1) {
        tableCell.verticalMerge = 'restart';
        verticalMerges.set(colIndex, { rowsRemaining: cell.rowSpan - 1, gridSpan: span });
      }
      populateCellBlocks(tableCell, cell.blocks);
      colIndex += span;
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
  } else if (block.kind === 'embeddedObject') {
    appendEmbeddedObject(body, block);
  }
}

// An embedded formula becomes a paragraph carrying the formula's own plain-text stand-in -- its StarMath annotation, or the literal "[formula]". This is a genuine, honest degradation rather than a silent drop: OOXML's own math markup is OMML, a vocabulary this package does not write at all, so there is no way to carry the real MathML into a docx; writing nothing would make the formula vanish without trace, which is exactly the silent-loss failure mode this codebase's conventions rule out. Every OTHER embeddedObject objectKind (an OLE-style nested wordprocessing/presentation/spreadsheet/drawing document) is still unhandled: no reader this package depends on produces one, so there is nothing reachable to round-trip and nothing to degrade.
function appendEmbeddedObject(body: DocxBody, block: ContentEmbeddedObjectBlock): void {
  const formula = formulaOfBlock(block);
  if (formula === undefined) {
    return;
  }
  body.appendParagraph().appendRun({ text: formulaPlaceholderText(formula) });
}
