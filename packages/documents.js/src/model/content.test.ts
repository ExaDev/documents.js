import type { ContentBlock } from 'document-content-model';
import { describe, expect, it } from 'vitest';
import { CONTENT_FORMAT_VERSION, ContentDocumentSchema } from './content';

// The full content vocabulary (ContentRun, ContentParagraph, ContentBlock, ContentTable, isContentBlock, etc.) now lives in document-content-model, with its own exhaustive coverage there -- these tests exercise only the envelope this file still defines: ContentDocumentSchema's own discriminated-union behaviour.

const paragraph: ContentBlock = { kind: 'paragraph', runs: [{ text: 'Hi' }] };
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
