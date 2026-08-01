import { describe, expect, it } from 'vitest';
import { COLOR_BLACK } from './color';
import { CONTENT_FORMAT_VERSION, type ContentDocument } from './content';
import { LAYOUT_FORMAT_VERSION, type LayoutDocument } from './layout';
import { DOCUMENT_PACKAGE_FORMAT_VERSION, type DocumentPackage, DocumentPackageSchema } from './package';
import { DEFAULT_LAYOUT_FONT } from './style';

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
            runs: [{ text: 'Hello, package.', sourcePath: 'sections[0].blocks[0].runs[0]' }],
            sourcePath: 'sections[0].blocks[0]',
          },
        ],
      },
    ],
  };
}

// Correlates with wordprocessingDocument() above via sourcePath -- the same 'sections[0].blocks[0].runs[0]' value, matching what a real read+layout pass would copy from content onto the laid-out item.
function layoutDocument(): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: { title: 'Package round trip', author: 'document-content-model' },
    pages: [
      {
        widthPt: 612,
        heightPt: 792,
        items: [
          {
            kind: 'text',
            text: 'Hello, package.',
            xPt: 72,
            yPt: 720,
            font: DEFAULT_LAYOUT_FONT,
            sizePt: 12,
            color: COLOR_BLACK,
            sourcePath: 'sections[0].blocks[0].runs[0]',
          },
        ],
      },
    ],
    images: {},
  };
}

describe('DocumentPackageSchema round trips', () => {
  it('deep-equals the original package after a JSON round trip when layout is present', () => {
    const original: DocumentPackage = {
      formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION,
      content: wordprocessingDocument(),
      layout: layoutDocument(),
    };
    const parsed = DocumentPackageSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(DocumentPackageSchema.parse(roundTripped)).toEqual(original);
  });

  it('deep-equals the original package after a JSON round trip when layout is absent', () => {
    const original: DocumentPackage = {
      formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION,
      content: wordprocessingDocument(),
    };
    const parsed = DocumentPackageSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(DocumentPackageSchema.parse(roundTripped)).toEqual(original);
  });

  it('serializes with layout omitted entirely, not as null or an empty object', () => {
    const original: DocumentPackage = {
      formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION,
      content: wordprocessingDocument(),
    };
    const parsed = DocumentPackageSchema.parse(original);
    expect(parsed.layout).toBeUndefined();

    const serialized: unknown = JSON.parse(JSON.stringify(parsed));
    expect(serialized).not.toHaveProperty('layout');
  });

  it('rejects a mismatched formatVersion', () => {
    expect(
      DocumentPackageSchema.safeParse({ formatVersion: 2, content: wordprocessingDocument() }).success,
    ).toBe(false);
  });
});
