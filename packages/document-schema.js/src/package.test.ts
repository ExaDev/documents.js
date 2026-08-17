import { describe, expect, it } from 'vitest';
import { CONTENT_FORMAT_VERSION, type ContentDocument } from './content';
import { DOCUMENT_PACKAGE_FORMAT_VERSION, type DocumentPackage, DocumentPackageSchema } from './package';

function wordprocessingDocument(): ContentDocument {
  return {
    kind: 'wordprocessing',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: { title: 'Package round trip', author: 'document-content-model' },
    sections: [
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [
          {
            kind: 'paragraph',
            runs: [
              {
                text: 'Hello, package.',
                // A run rendered onto a single page -- the frame's own pageIndex matches DocumentPackage.pages' own array index below.
                frames: [{ pageIndex: 0, xPt: 72, yPt: 720, widthPt: 96, heightPt: 12 }],
              },
            ],
            frames: [{ pageIndex: 0, xPt: 72, yPt: 720, widthPt: 96, heightPt: 12 }],
          },
        ],
      },
    ],
  };
}

// A paragraph whose own rendered content is split across two pages -- the fusion design's whole reason for `frames` being an array rather than a single optional frame: one semantic node, two rendered positions, no duplication of the node itself.
function wordprocessingDocumentSpanningTwoPages(): ContentDocument {
  return {
    kind: 'wordprocessing',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: { title: 'Package round trip (paginated)' },
    sections: [
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [
          {
            kind: 'paragraph',
            runs: [{ text: 'A paragraph that wraps across a page boundary.' }],
            frames: [
              { pageIndex: 0, xPt: 72, yPt: 60, widthPt: 468, heightPt: 24 },
              { pageIndex: 1, xPt: 72, yPt: 720, widthPt: 200, heightPt: 12 },
            ],
          },
        ],
      },
    ],
  };
}

describe('DocumentPackageSchema round trips', () => {
  it('deep-equals the original package after a JSON round trip when pages/frames are present', () => {
    const original: DocumentPackage = {
      formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION,
      content: wordprocessingDocument(),
      pages: [{ widthPt: 612, heightPt: 792 }],
    };
    const parsed = DocumentPackageSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(DocumentPackageSchema.parse(roundTripped)).toEqual(original);
  });

  it('deep-equals the original package after a JSON round trip when pages/frames are absent (content-only)', () => {
    const original: DocumentPackage = {
      formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION,
      content: wordprocessingDocument(),
    };
    const parsed = DocumentPackageSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(DocumentPackageSchema.parse(roundTripped)).toEqual(original);
  });

  it('serializes with pages omitted entirely, not as null or an empty array', () => {
    const original: DocumentPackage = {
      formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION,
      content: wordprocessingDocument(),
    };
    const parsed = DocumentPackageSchema.parse(original);
    expect(parsed.pages).toBeUndefined();

    const serialized: unknown = JSON.parse(JSON.stringify(parsed));
    expect(serialized).not.toHaveProperty('pages');
  });

  it('rejects a mismatched formatVersion', () => {
    expect(DocumentPackageSchema.safeParse({ formatVersion: 1, content: wordprocessingDocument() }).success).toBe(
      false,
    );
  });

  it('accepts a single content node carrying more than one frame -- appearing on multiple pages without duplicating content', () => {
    const original: DocumentPackage = {
      formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION,
      content: wordprocessingDocumentSpanningTwoPages(),
      pages: [
        { widthPt: 612, heightPt: 792 },
        { widthPt: 612, heightPt: 792 },
      ],
    };
    const parsed = DocumentPackageSchema.parse(original);
    if (parsed.content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing document');
    }
    const paragraph = parsed.content.sections[0]?.blocks[0];
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(paragraph.frames).toHaveLength(2);
    expect(paragraph.frames?.[0]?.pageIndex).toBe(0);
    expect(paragraph.frames?.[1]?.pageIndex).toBe(1);

    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(DocumentPackageSchema.parse(roundTripped)).toEqual(original);
  });

  // ContentShapeSchema (unlike ContentParagraph, which is only ever reached inside a ContentBlockSchema z.custom() guard -- see content.ts's own top comment on that guard's deliberately minimal depth) is a real, directly-nested Zod schema on ContentSlideSchema.shapes, so a malformed field on it genuinely fails a full DocumentPackageSchema parse rather than only a standalone ContentShapeSchema.parse.
  it('rejects a frame with a negative or non-integer pageIndex', () => {
    const withBadFrame = {
      formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION,
      content: {
        kind: 'presentation',
        formatVersion: CONTENT_FORMAT_VERSION,
        metadata: {},
        slides: [
          {
            size: { widthPt: 960, heightPt: 540 },
            shapes: [
              {
                frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
                insetLeftPt: 0,
                insetTopPt: 0,
                insetRightPt: 0,
                insetBottomPt: 0,
                blocks: [],
                frames: [{ pageIndex: -1, xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }],
              },
            ],
            notes: '',
          },
        ],
      },
    };
    expect(DocumentPackageSchema.safeParse(withBadFrame).success).toBe(false);
  });
});
