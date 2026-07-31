import { describe, expect, it } from 'vitest';
import { COLOR_BLACK } from './color';
import {
  type ContentBlock,
  ContentBlockSchema,
  CONTENT_FORMAT_VERSION,
  type ContentDocument,
  ContentDocumentSchema,
  ContentRunSchema,
  ContentShapeSchema,
  type ContentTable,
  isContentBlock,
} from './content';

const paragraph: ContentBlock = {
  kind: 'paragraph',
  runs: [
    { text: 'Hello ' },
    { text: 'world', bold: true, italic: true, color: { r: 0.2, g: 0.4, b: 0.6 } },
  ],
  styleId: 'Heading1',
  alignment: 'center',
  spacingBeforePt: 12,
  spacingAfterPt: 6,
};

const listParagraph: ContentBlock = {
  kind: 'paragraph',
  runs: [{ text: 'Item one' }],
  list: { numId: '1', level: 0 },
};

const image: ContentBlock = {
  kind: 'image',
  format: 'png',
  base64: 'AA==',
  widthPt: 100,
  heightPt: 50,
  altText: 'a placeholder image',
};

const pageBreak: ContentBlock = { kind: 'pageBreak' };

const table: ContentBlock = {
  kind: 'table',
  rows: [
    { cells: [{ blocks: [paragraph] }, { blocks: [image], colSpan: 2, background: COLOR_BLACK }] },
    { cells: [{ blocks: [pageBreak] }], heightPt: 20 },
  ],
  columnWidthsPt: [150, 150],
};

// Deliberately deep nesting: a table whose cell contains a table whose cell contains a table -- the highest-risk case for the hand-written recursive isContentBlock guard. Typed as ContentTable (not the broader ContentBlock union) at each level so the nested `.rows`/`.cells` access below needs no narrowing or assertion.
const level3Table: ContentTable = {
  kind: 'table',
  rows: [{ cells: [{ blocks: [paragraph] }] }],
  columnWidthsPt: [100],
};
const level2Table: ContentTable = {
  kind: 'table',
  rows: [{ cells: [{ blocks: [level3Table, paragraph] }] }],
  columnWidthsPt: [200],
};
const level1Table: ContentTable = {
  kind: 'table',
  rows: [{ cells: [{ blocks: [level2Table] }] }],
  columnWidthsPt: [300],
};

describe('isContentBlock', () => {
  it('accepts every block kind', () => {
    for (const block of [paragraph, listParagraph, image, pageBreak, table, level1Table]) {
      expect(isContentBlock(block)).toBe(true);
    }
  });

  it('accepts a table nested three levels deep inside table cells, and the guard genuinely walks every level', () => {
    expect(isContentBlock(level1Table)).toBe(true);
    // Confirm the full depth is really there and each level individually validates -- not just the outermost shell.
    const level2 = level1Table.rows[0]?.cells[0]?.blocks[0];
    if (level2?.kind !== 'table') {
      throw new Error('expected level2 to be a table');
    }
    expect(isContentBlock(level2)).toBe(true);
    const level3 = level2.rows[0]?.cells[0]?.blocks[0];
    if (level3?.kind !== 'table') {
      throw new Error('expected level3 to be a table');
    }
    expect(isContentBlock(level3)).toBe(true);
  });

  it('rejects a malformed block at every level', () => {
    expect(isContentBlock({ kind: 'paragraph', runs: 'not-an-array' })).toBe(false);
    expect(isContentBlock({ kind: 'image', format: 'gif', base64: 'AA==', widthPt: 1, heightPt: 1 })).toBe(
      false,
    );
    expect(isContentBlock({ kind: 'table', rows: [{ cells: [{ blocks: [{ kind: 'bogus' }] }] }] })).toBe(
      false,
    );
    // A malformed block buried three levels deep must still fail the guard, not be silently accepted.
    expect(
      isContentBlock({
        kind: 'table',
        rows: [
          {
            cells: [
              {
                blocks: [
                  {
                    kind: 'table',
                    rows: [{ cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 1 }] }] }] }],
                    columnWidthsPt: [10],
                  },
                ],
              },
            ],
          },
        ],
        columnWidthsPt: [20],
      }),
    ).toBe(false);
    expect(isContentBlock(null)).toBe(false);
    expect(isContentBlock('a string')).toBe(false);
    expect(isContentBlock(undefined)).toBe(false);
  });
});

function wordprocessingDocument(): ContentDocument {
  return {
    kind: 'wordprocessing',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: {
      title: 'Deep nesting test',
      author: 'documents.js',
      keywords: ['schema', 'content-model'],
      createdIso: '2026-07-30T00:00:00.000Z',
    },
    sections: [
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [paragraph, listParagraph, image, pageBreak, table, level1Table],
      },
    ],
  };
}

function presentationDocument(): ContentDocument {
  return {
    kind: 'presentation',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: { title: 'Deck' },
    slides: [
      {
        size: { widthPt: 960, heightPt: 540 },
        shapes: [
          {
            name: 'Title 1',
            frame: { xPt: 10, yPt: 10, widthPt: 400, heightPt: 100 },
            rotationDeg: 15,
            insetLeftPt: 7.2,
            insetTopPt: 3.6,
            insetRightPt: 7.2,
            insetBottomPt: 3.6,
            fontScale: 0.9,
            lineSpacingReduction: 0.1,
            blocks: [paragraph],
          },
          {
            frame: { xPt: 0, yPt: 150, widthPt: 300, heightPt: 200 },
            insetLeftPt: 0,
            insetTopPt: 0,
            insetRightPt: 0,
            insetBottomPt: 0,
            blocks: [table],
          },
        ],
        notes: 'Speaker notes for slide one.',
      },
    ],
  };
}

describe('sourcePath', () => {
  it('survives a JSON round trip when set on every block kind that carries it', () => {
    const runWithSourcePath: ContentBlock = {
      kind: 'paragraph',
      runs: [{ text: 'Traceable', sourcePath: 'sections[0].blocks[0].runs[0]' }],
      sourcePath: 'sections[0].blocks[0]',
    };
    const imageWithSourcePath: ContentBlock = {
      kind: 'image',
      format: 'png',
      base64: 'AA==',
      widthPt: 100,
      heightPt: 50,
      sourcePath: 'sections[0].blocks[1]',
    };
    const pageBreakWithSourcePath: ContentBlock = { kind: 'pageBreak', sourcePath: 'sections[0].blocks[2]' };
    const tableWithSourcePath: ContentTable = {
      kind: 'table',
      rows: [{ cells: [{ blocks: [paragraph] }] }],
      columnWidthsPt: [100],
      sourcePath: 'sections[0].blocks[3]',
    };

    for (const block of [runWithSourcePath, imageWithSourcePath, pageBreakWithSourcePath, tableWithSourcePath]) {
      expect(isContentBlock(block)).toBe(true);
      const parsed = ContentBlockSchema.parse(block);
      const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
      expect(ContentBlockSchema.parse(roundTripped)).toEqual(block);
    }

    const shapeWithSourcePath = ContentShapeSchema.parse({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
      blocks: [],
      sourcePath: 'slides[0].shapes[0]',
    });
    const shapeRoundTripped: unknown = JSON.parse(JSON.stringify(shapeWithSourcePath));
    expect(ContentShapeSchema.parse(shapeRoundTripped)).toEqual(shapeWithSourcePath);
  });

  it('parses correctly when sourcePath is omitted, matching every other optional field', () => {
    expect(ContentRunSchema.parse({ text: 'No path' })).toEqual({ text: 'No path' });
    expect(ContentBlockSchema.parse(paragraph)).toEqual(paragraph);
    expect(ContentBlockSchema.parse(pageBreak)).toEqual(pageBreak);
    expect(ContentBlockSchema.parse(table)).toEqual(table);
    const shapeWithoutSourcePath = ContentShapeSchema.parse({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
      blocks: [],
    });
    expect(shapeWithoutSourcePath.sourcePath).toBeUndefined();
  });
});

describe('ContentDocumentSchema round trips', () => {
  it('deep-equals the original wordprocessing document after a JSON round trip', () => {
    const original = wordprocessingDocument();
    const parsed = ContentDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it('deep-equals the original presentation document after a JSON round trip', () => {
    const original = presentationDocument();
    const parsed = ContentDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it('rejects an unknown discriminant', () => {
    expect(ContentDocumentSchema.safeParse({ kind: 'spreadsheet' }).success).toBe(false);
  });

  it('rejects a mismatched formatVersion', () => {
    expect(
      ContentDocumentSchema.safeParse({
        kind: 'wordprocessing',
        formatVersion: 999,
        metadata: {},
        sections: [],
      }).success,
    ).toBe(false);
  });
});
