import type { ContentDocument, ContentStrokeStyle } from 'document-schema.js';

import { describe, expect, it } from 'vitest';
import { createDocx } from '../edit/docx/editor';
import { createOdt } from '../edit/odt/editor';
import { buildDocxPackage } from '../edit/docx/content';
import { decodePackage as decodeOdfPackage } from 'odf.js';
import { decodePackage as decodeOoxmlPackage } from 'ooxml.js';
import { readDocxContent } from '../ooxml/docx/read';
import { readOdtContent } from '../odf/odt/read';
import { docxToOdt, odtToDocx } from './convert';

type WordprocessingDocument = Extract<ContentDocument, { kind: 'wordprocessing' }>;

// Round-trip tests for the docx/odt paragraph-decoration (spacingBefore/spacingAfter/lineSpacing/indentLeft/indentFirstLine) and table-cell decoration (background, borders) fields both readers already populate but the writers used to drop -- the sibling suite to bridges.test.ts, kept in its own file to avoid contention there. The proven shape is the run.strike fix (commit 7fb6e32): a pivot field exists on ContentDocument, both readers populate it, but the editor had no setter and populateParagraph/appendTable never threaded it. Each field now survives docx -> odt -> docx and odt -> docx -> odt.

const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };
const BLACK = { r: 0, g: 0, b: 0 };

// Values chosen to survive the twips (pt * 20) and eighth-points (pt * 8) rounding the docx writers use, so a clean round trip is exact rather than a floating-point approximation.
const SPACING_BEFORE_PT = 6;
const SPACING_AFTER_PT = 10;
const LINE_SPACING = 1.5;
const INDENT_LEFT_PT = 18;
const INDENT_FIRST_LINE_PT = 12;
const BORDER_WIDTH_PT = 0.75;

function allFourEdges(style: ContentStrokeStyle) {
  return { top: { color: BLACK, widthPt: BORDER_WIDTH_PT, style }, right: { color: BLACK, widthPt: BORDER_WIDTH_PT, style }, bottom: { color: BLACK, widthPt: BORDER_WIDTH_PT, style }, left: { color: BLACK, widthPt: BORDER_WIDTH_PT, style } };
}

function docxContentOf(bytes: Uint8Array<ArrayBuffer>): WordprocessingDocument {
  const content = readDocxContent(decodeOoxmlPackage(bytes));
  if (content.kind !== 'wordprocessing') {
    throw new Error('expected a wordprocessing ContentDocument');
  }
  return content;
}

function odtContentOf(bytes: Uint8Array<ArrayBuffer>): WordprocessingDocument {
  const content = readOdtContent(decodeOdfPackage(bytes));
  if (content.kind !== 'wordprocessing') {
    throw new Error('expected a wordprocessing ContentDocument');
  }
  return content;
}

function firstParagraph(document: WordprocessingDocument) {
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.kind === 'paragraph') {
        return block;
      }
    }
  }
  throw new Error('no paragraph block found');
}

function firstTable(document: WordprocessingDocument) {
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.kind === 'table') {
        return block;
      }
    }
  }
  throw new Error('no table block found');
}

describe('docx/odt decoration bridge', () => {
  it('carries paragraph spacing/indent through docx -> odt -> docx', () => {
    const editor = createDocx();
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: 'decorated' });
    paragraph.spacingBeforePt = SPACING_BEFORE_PT;
    paragraph.spacingAfterPt = SPACING_AFTER_PT;
    paragraph.lineSpacing = LINE_SPACING;
    paragraph.indentLeftPt = INDENT_LEFT_PT;
    paragraph.indentFirstLinePt = INDENT_FIRST_LINE_PT;
    const docxBytes = editor.toBytes();

    const roundTripped = docxContentOf(odtToDocx(docxToOdt(docxBytes)));
    const paragraph2 = firstParagraph(roundTripped);

    expect(paragraph2.spacingBeforePt).toBeCloseTo(SPACING_BEFORE_PT);
    expect(paragraph2.spacingAfterPt).toBeCloseTo(SPACING_AFTER_PT);
    expect(paragraph2.lineSpacing).toBeCloseTo(LINE_SPACING);
    expect(paragraph2.indentLeftPt).toBeCloseTo(INDENT_LEFT_PT);
    expect(paragraph2.indentFirstLinePt).toBeCloseTo(INDENT_FIRST_LINE_PT);
  });

  it('carries paragraph spacing/indent through odt -> docx -> odt', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: 'decorated' });
    paragraph.spacingBeforePt = SPACING_BEFORE_PT;
    paragraph.spacingAfterPt = SPACING_AFTER_PT;
    paragraph.lineSpacing = LINE_SPACING;
    paragraph.indentLeftPt = INDENT_LEFT_PT;
    paragraph.indentFirstLinePt = INDENT_FIRST_LINE_PT;
    const odtBytes = editor.toBytes();

    const roundTripped = odtContentOf(docxToOdt(odtToDocx(odtBytes)));
    const paragraph2 = firstParagraph(roundTripped);

    expect(paragraph2.spacingBeforePt).toBeCloseTo(SPACING_BEFORE_PT);
    expect(paragraph2.spacingAfterPt).toBeCloseTo(SPACING_AFTER_PT);
    expect(paragraph2.lineSpacing).toBeCloseTo(LINE_SPACING);
    expect(paragraph2.indentLeftPt).toBeCloseTo(INDENT_LEFT_PT);
    expect(paragraph2.indentFirstLinePt).toBeCloseTo(INDENT_FIRST_LINE_PT);
  });

  it('carries cell background/borders through docx -> odt -> docx', () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    const cell = table.cell(0, 0);
    cell.appendParagraph().appendRun({ text: 'a' });
    cell.background = RED;
    cell.borders = allFourEdges('dashed');
    const docxBytes = editor.toBytes();

    const roundTripped = docxContentOf(odtToDocx(docxToOdt(docxBytes)));
    const table2 = firstTable(roundTripped);
    const cell2 = table2.rows[0]?.cells[0];

    expect(cell2).toBeDefined();
    expect(cell2?.background).toEqual(RED);
    const top = cell2?.borders?.top;
    expect(top).toBeDefined();
    expect(top?.style).toBe('dashed');
    expect(top?.color).toEqual(BLACK);
    expect(top?.widthPt).toBeCloseTo(BORDER_WIDTH_PT);
  });

  it('carries cell background/borders through odt -> docx -> odt', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    const cell = table.cell(0, 0);
    cell.appendParagraph().appendRun({ text: 'a' });
    cell.background = BLUE;
    cell.borders = allFourEdges('dotted');
    const odtBytes = editor.toBytes();

    const roundTripped = odtContentOf(docxToOdt(odtToDocx(odtBytes)));
    const table2 = firstTable(roundTripped);
    const cell2 = table2.rows[0]?.cells[0];

    expect(cell2).toBeDefined();
    expect(cell2?.background).toEqual(BLUE);
    const bottom = cell2?.borders?.bottom;
    expect(bottom).toBeDefined();
    expect(bottom?.style).toBe('dotted');
    expect(bottom?.color).toEqual(BLACK);
    expect(bottom?.widthPt).toBeCloseTo(BORDER_WIDTH_PT);
  });

  // Now genuinely round-trips both directions: ooxml.js 2.8.0's readDocx reads w:trHeight back into ContentTableRow.heightPt (a reader gap this session's own ooxml.js fix closed), so a docx built from a ContentDocument with row.heightPt set can be read straight back through readDocxContent, not merely inspected at the raw-XML level.
  it('writes row.heightPt as w:trHeight and reads it back via readDocxContent', () => {
    const document: ContentDocument = {
      kind: 'wordprocessing',
      metadata: {},
      sections: [{ pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks: [{ kind: 'table', rows: [{ cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'tall' }] }] }], heightPt: 28 }], columnWidthsPt: [468] }] }],
    };
    const pkg = buildDocxPackage(document);
    const roundTripped = readDocxContent(pkg);
    if (roundTripped.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing document');
    }
    const table = roundTripped.sections[0]?.blocks[0];
    const row = table?.kind === 'table' ? table.rows[0] : undefined;
    expect(row?.heightPt).toBeCloseTo(28, 5);
  });
});
