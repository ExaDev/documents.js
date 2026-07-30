import { describe, expect, it } from 'vitest';
import {
  CONTENT_FORMAT_VERSION,
  type ContentBlock,
  ContentDocumentSchema,
  isContentBlock,
} from './content';

const paragraph: ContentBlock = { kind: 'paragraph', runs: [{ text: 'Hi' }] };
const image: ContentBlock = { kind: 'image', format: 'png', base64: 'AA==', widthPt: 10, heightPt: 10 };
const pageBreak: ContentBlock = { kind: 'pageBreak' };
const table: ContentBlock = {
  kind: 'table',
  rows: [{ cells: [{ blocks: [paragraph] }] }],
  columnWidthsPt: [100],
};
const nestedTable: ContentBlock = {
  kind: 'table',
  rows: [{ cells: [{ blocks: [table] }] }], // a table inside a table cell -- the recursive case
  columnWidthsPt: [200],
};

describe('isContentBlock', () => {
  it('accepts every block kind, including a table nested inside a table cell', () => {
    for (const block of [paragraph, image, pageBreak, table, nestedTable]) {
      expect(isContentBlock(block)).toBe(true);
    }
  });

  it('rejects a malformed block', () => {
    expect(isContentBlock({ kind: 'paragraph', runs: 'not-an-array' })).toBe(false);
    expect(isContentBlock({ kind: 'table', rows: [{ cells: [{ blocks: [{ kind: 'bogus' }] }] }] })).toBe(
      false,
    );
    expect(isContentBlock(null)).toBe(false);
    expect(isContentBlock('a string')).toBe(false);
  });
});

describe('ContentDocumentSchema', () => {
  it('accepts a minimal wordprocessing document with a nested table', () => {
    const doc = {
      kind: 'wordprocessing',
      formatVersion: CONTENT_FORMAT_VERSION,
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [paragraph, nestedTable],
        },
      ],
    };
    expect(ContentDocumentSchema.parse(doc)).toEqual(doc);
  });

  it('accepts a minimal presentation document', () => {
    const doc = {
      kind: 'presentation',
      formatVersion: CONTENT_FORMAT_VERSION,
      metadata: {},
      slides: [
        {
          size: { widthPt: 960, heightPt: 540 },
          shapes: [{ frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 }, insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0, blocks: [paragraph] }],
          notes: '',
        },
      ],
    };
    expect(ContentDocumentSchema.parse(doc)).toEqual(doc);
  });

  it('rejects an unknown discriminant', () => {
    expect(ContentDocumentSchema.safeParse({ kind: 'spreadsheet' }).success).toBe(false);
  });
});
