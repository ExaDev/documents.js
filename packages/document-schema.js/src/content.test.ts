import { describe, expect, it } from 'vitest';
import { COLOR_BLACK } from './color';
import {
  type ContentBlock,
  ContentBlockSchema,
  CONTENT_FORMAT_VERSION,
  type ContentDocument,
  ContentDocumentSchema,
  type ContentEmbeddedObject,
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

function spreadsheetDocument(): ContentDocument {
  return {
    kind: 'spreadsheet',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: { title: 'Quarterly figures' },
    sheets: [
      {
        name: 'Sheet1',
        cells: [
          { row: 0, column: 0, value: { kind: 'string', value: 'Revenue' }, displayText: 'Revenue' },
          {
            row: 0,
            column: 1,
            value: { kind: 'currency', value: 125000, currency: 'USD' },
            formula: '=SUM(B2:B10)',
            displayText: '$125,000.00',
          },
          { row: 1, column: 1, value: { kind: 'percentage', value: 0.235 }, displayText: '23.5%' },
          { row: 2, column: 1, value: { kind: 'boolean', value: true }, displayText: 'TRUE' },
          { row: 3, column: 1, value: { kind: 'date', value: '2026-07-30' }, displayText: '30/07/2026' },
          { row: 4, column: 1, value: { kind: 'time', value: '13:30:00' }, displayText: '1:30 PM' },
          { row: 5, column: 1, value: { kind: 'error', value: '#DIV/0!' }, displayText: '#DIV/0!' },
          { row: 6, column: 1, value: { kind: 'empty' }, displayText: '', colSpan: 2 },
          {
            row: 7,
            column: 0,
            value: { kind: 'string', value: 'Mixed formatting' },
            displayText: 'Mixed formatting',
            runs: [{ text: 'Mixed ' }, { text: 'formatting', bold: true }],
          },
        ],
        columns: [
          { index: 0, widthPt: 120 },
          { index: 1, widthPt: 80, hidden: false },
        ],
        rows: [
          { index: 0, heightPt: 15 },
          { index: 1, heightPt: 15, hidden: true },
        ],
        images: [
          {
            kind: 'image',
            format: 'png',
            base64: 'AA==',
            widthPt: 40,
            heightPt: 40,
            anchorRow: 0,
            anchorColumn: 3,
            offsetXPt: 2,
            offsetYPt: 2,
          },
        ],
        printSettings: {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          printRange: { startRow: 0, startColumn: 0, endRow: 10, endColumn: 5 },
          scale: 100,
          fitToPages: { width: 1, height: 1 },
          repeatRows: { start: 0, end: 0 },
          repeatColumns: { start: 0, end: 0 },
          gridlines: true,
          headers: false,
          pageOrder: 'downThenOver',
          manualBreaks: { rows: [20], columns: [] },
        },
      },
    ],
  };
}

function drawingDocument(): ContentDocument {
  return {
    kind: 'drawing',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: { title: 'Org chart' },
    pages: [
      {
        size: { widthPt: 842, heightPt: 595 },
        shapes: [
          {
            frame: { xPt: 50, yPt: 50, widthPt: 200, heightPt: 60 },
            insetLeftPt: 3.6,
            insetTopPt: 3.6,
            insetRightPt: 3.6,
            insetBottomPt: 3.6,
            blocks: [paragraph],
          },
        ],
        vectors: [
          {
            kind: 'rect',
            frame: { xPt: 50, yPt: 50, widthPt: 200, heightPt: 60 },
            fill: { r: 0.9, g: 0.9, b: 1 },
            stroke: { color: COLOR_BLACK, widthPt: 1 },
          },
          {
            kind: 'ellipse',
            frame: { xPt: 300, yPt: 50, widthPt: 100, heightPt: 100 },
            fill: { r: 1, g: 1, b: 0.8 },
          },
          {
            kind: 'line',
            from: { xPt: 250, yPt: 80 },
            to: { xPt: 300, yPt: 100 },
            stroke: { color: COLOR_BLACK, widthPt: 2 },
          },
          {
            kind: 'path',
            frame: { xPt: 400, yPt: 200, widthPt: 100, heightPt: 100 },
            subpaths: [
              {
                start: { xPt: 0, yPt: 0 },
                segments: [
                  { kind: 'line', to: { xPt: 100, yPt: 0 } },
                  {
                    kind: 'cubic',
                    control1: { xPt: 100, yPt: 50 },
                    control2: { xPt: 50, yPt: 100 },
                    to: { xPt: 0, yPt: 100 },
                  },
                ],
                closed: true,
              },
            ],
            fill: { r: 0.2, g: 0.8, b: 0.2 },
            fillRule: 'nonzero',
            stroke: { color: COLOR_BLACK, widthPt: 0.5 },
          },
        ],
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

  it('deep-equals the original spreadsheet document after a JSON round trip', () => {
    const original = spreadsheetDocument();
    const parsed = ContentDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it('deep-equals the original drawing document after a JSON round trip', () => {
    const original = drawingDocument();
    const parsed = ContentDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it('rejects an unknown discriminant', () => {
    expect(ContentDocumentSchema.safeParse({ kind: 'bogus' }).success).toBe(false);
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

// Deliberately deep nesting for ContentEmbeddedObjectSchema's own recursive guard, mirroring the discipline already applied to ContentTable's three-level recursion test above: a formula embedded inside a drawing embedded inside a spreadsheet, three levels deep, exercising both anchoring mechanisms (ContentSheetSchema.embeddedObjects at level 1->2, and the ContentBlock 'embeddedObject' variant at level 2->3) in the same structure.
const formulaDocument: ContentDocument = {
  kind: 'wordprocessing',
  formatVersion: CONTENT_FORMAT_VERSION,
  metadata: { title: 'Formula' },
  sections: [
    {
      pageSize: { widthPt: 200, heightPt: 50 },
      margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
      blocks: [{ kind: 'paragraph', runs: [{ text: 'x^2 + y^2 = z^2' }] }],
    },
  ],
};

const formulaEmbeddedBlock: ContentBlock = {
  kind: 'embeddedObject',
  objectKind: 'formula',
  document: formulaDocument,
  frame: { xPt: 10, yPt: 10, widthPt: 80, heightPt: 20 },
};

const drawingWithFormula: ContentDocument = {
  kind: 'drawing',
  formatVersion: CONTENT_FORMAT_VERSION,
  metadata: {},
  pages: [
    {
      size: { widthPt: 400, heightPt: 300 },
      shapes: [
        {
          frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 40 },
          insetLeftPt: 0,
          insetTopPt: 0,
          insetRightPt: 0,
          insetBottomPt: 0,
          blocks: [formulaEmbeddedBlock],
        },
      ],
      vectors: [],
    },
  ],
};

const drawingEmbeddedObject: ContentEmbeddedObject = {
  objectKind: 'drawing',
  document: drawingWithFormula,
  frame: { xPt: 100, yPt: 100, widthPt: 200, heightPt: 150 },
};

const spreadsheetWithDrawing: ContentDocument = {
  kind: 'spreadsheet',
  formatVersion: CONTENT_FORMAT_VERSION,
  metadata: {},
  sheets: [
    {
      name: 'Sheet1',
      cells: [],
      columns: [],
      rows: [],
      images: [],
      printSettings: {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
        gridlines: true,
        headers: true,
        pageOrder: 'downThenOver',
      },
      embeddedObjects: [drawingEmbeddedObject],
    },
  ],
};

describe('ContentEmbeddedObjectSchema deep recursion', () => {
  it('accepts a formula embedded inside a drawing embedded inside a spreadsheet, three levels deep', () => {
    expect(isContentBlock(formulaEmbeddedBlock)).toBe(true);
    expect(ContentDocumentSchema.safeParse(spreadsheetWithDrawing).success).toBe(true);
  });

  it('genuinely walks every level, not just the outermost shell', () => {
    const parsed = ContentDocumentSchema.parse(spreadsheetWithDrawing);
    if (parsed.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet document');
    }
    const sheet = parsed.sheets[0];
    if (sheet === undefined) {
      throw new Error('expected a sheet');
    }
    const embeddedDrawing = sheet.embeddedObjects?.[0];
    if (embeddedDrawing?.document.kind !== 'drawing') {
      throw new Error('expected the level-2 embedded object to be a drawing document');
    }
    const page = embeddedDrawing.document.pages[0];
    if (page === undefined) {
      throw new Error('expected a drawing page');
    }
    const shape = page.shapes[0];
    if (shape === undefined) {
      throw new Error('expected a shape');
    }
    const embeddedFormulaBlock = shape.blocks[0];
    if (embeddedFormulaBlock?.kind !== 'embeddedObject') {
      throw new Error('expected the level-3 block to be an embedded object');
    }
    expect(embeddedFormulaBlock.objectKind).toBe('formula');
    if (embeddedFormulaBlock.document.kind !== 'wordprocessing') {
      throw new Error('expected the level-3 embedded document to be wordprocessing');
    }
    const formulaParagraph = embeddedFormulaBlock.document.sections[0]?.blocks[0];
    if (formulaParagraph?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(formulaParagraph.runs[0]?.text).toBe('x^2 + y^2 = z^2');
  });

  it('survives a JSON round trip at full depth', () => {
    const parsed = ContentDocumentSchema.parse(spreadsheetWithDrawing);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(spreadsheetWithDrawing);
  });

  it('rejects a malformed embedded object buried three levels deep, not just at the outermost shell', () => {
    const deeplyMalformed: unknown = {
      kind: 'spreadsheet',
      formatVersion: CONTENT_FORMAT_VERSION,
      metadata: {},
      sheets: [
        {
          name: 'Sheet1',
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
            gridlines: true,
            headers: true,
            pageOrder: 'downThenOver',
          },
          embeddedObjects: [
            {
              objectKind: 'drawing',
              frame: { xPt: 100, yPt: 100, widthPt: 200, heightPt: 150 },
              document: {
                kind: 'drawing',
                formatVersion: CONTENT_FORMAT_VERSION,
                metadata: {},
                pages: [
                  {
                    size: { widthPt: 400, heightPt: 300 },
                    vectors: [],
                    shapes: [
                      {
                        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 40 },
                        insetLeftPt: 0,
                        insetTopPt: 0,
                        insetRightPt: 0,
                        insetBottomPt: 0,
                        blocks: [
                          {
                            kind: 'embeddedObject',
                            objectKind: 'formula',
                            frame: { xPt: 10, yPt: 10, widthPt: 80, heightPt: 20 },
                            document: {
                              kind: 'wordprocessing',
                              formatVersion: CONTENT_FORMAT_VERSION,
                              metadata: {},
                              sections: [
                                {
                                  pageSize: { widthPt: 200, heightPt: 50 },
                                  margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
                                  // malformed: a run's text must be a string, not a number -- must still fail even though every ancestor around it is well-formed.
                                  blocks: [{ kind: 'paragraph', runs: [{ text: 1 }] }],
                                },
                              ],
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(ContentDocumentSchema.safeParse(deeplyMalformed).success).toBe(false);
  });
});
