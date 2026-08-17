import { describe, expect, it } from 'vitest';

import { CONTENT_FORMAT_VERSION, type ContentDocument } from 'documents.js';

import { contentSummary } from './contentCounts';

const MARGINS = { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 };
const PAGE_SIZE = { widthPt: 595, heightPt: 842 };

function wordprocessing(sections: number, blocksPerSection: number): ContentDocument {
  return {
    kind: 'wordprocessing',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: {},
    sections: Array.from({ length: sections }, () => ({
      pageSize: PAGE_SIZE,
      margins: MARGINS,
      blocks: Array.from({ length: blocksPerSection }, () => ({ kind: 'paragraph', runs: [{ text: 'x' }] })),
    })),
  };
}

function spreadsheet(sheets: number, cellsPerSheet: number): ContentDocument {
  return {
    kind: 'spreadsheet',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: {},
    sheets: Array.from({ length: sheets }, (_, i) => ({
      name: `Sheet${i}`,
      cells: Array.from({ length: cellsPerSheet }, (_, j) => ({
        row: j,
        column: 0,
        value: { kind: 'string', value: 'x' },
        displayText: 'x',
      })),
      columns: [],
      rows: [],
      images: [],
      printSettings: { pageSize: PAGE_SIZE, margins: MARGINS, gridlines: false, headers: false, pageOrder: 'downThenOver' },
    })),
  };
}

describe('contentSummary', () => {
  it('summarises a wordprocessing document with section and block counts', () => {
    expect(contentSummary(wordprocessing(3, 10))).toEqual(['3 sections', '30 blocks']);
  });

  it('uses the singular form for a count of one', () => {
    expect(contentSummary(wordprocessing(1, 1))).toEqual(['1 section', '1 block']);
  });

  it('counts blocks inside table cells, not just the table itself', () => {
    const doc: ContentDocument = {
      kind: 'wordprocessing',
      formatVersion: CONTENT_FORMAT_VERSION,
      metadata: {},
      sections: [
        {
          pageSize: PAGE_SIZE,
          margins: MARGINS,
          blocks: [
            { kind: 'paragraph', runs: [{ text: 'intro' }] },
            {
              kind: 'table',
              rows: [
                {
                  cells: [
                    { blocks: [{ kind: 'paragraph', runs: [{ text: 'a' }] }, { kind: 'paragraph', runs: [{ text: 'b' }] }] },
                    { blocks: [{ kind: 'paragraph', runs: [{ text: 'c' }] }] },
                  ],
                },
              ],
              columnWidthsPt: [100, 100],
            },
          ],
        },
      ],
    };
    // 1 intro paragraph + 1 table + 3 paragraphs inside cells = 5 blocks total (table counts as 1, plus its 3 nested).
    expect(contentSummary(doc)).toEqual(['1 section', '5 blocks']);
  });

  it('summarises a spreadsheet with sheet and cell counts', () => {
    expect(contentSummary(spreadsheet(2, 50))).toEqual(['2 sheets', '100 cells']);
  });

  it('summarises a formula document', () => {
    const doc = { kind: 'formula', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, formula: { mathml: [] } } as ContentDocument;
    expect(contentSummary(doc)).toEqual(['formula']);
  });
});
