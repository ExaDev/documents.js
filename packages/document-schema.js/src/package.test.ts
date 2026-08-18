import { describe, expect, it } from 'vitest';
import { type DocumentPackage, DocumentPackageSchema } from './package';

const PAGE = { widthPt: 612, heightPt: 792 };
const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

// A wordprocessing package in the tree form: the root carries kind/metadata/pages, and one section group per section with the section's own blocks grouped inside it -- a heading group wrapping a leaf paragraph, plus the section's own trailing leaf.
function wordprocessingPackage(): DocumentPackage {
  return {
    kind: 'wordprocessing',
    metadata: { title: 'Package round trip', author: 'document-schema.js' },
    pages: [PAGE],
    children: [
      {
        node: { kind: 'section', pageSize: PAGE, margins: MARGINS },
        children: [
          {
            node: {
              kind: 'paragraph',
              headingLevel: 1,
              runs: [
                {
                  text: 'Hello, package.',
                  // A run rendered onto a single page -- the frame's own pageIndex matches the root pages array's own index.
                  frames: [{ pageIndex: 0, xPt: 72, yPt: 720, widthPt: 96, heightPt: 12 }],
                },
              ],
              frames: [{ pageIndex: 0, xPt: 72, yPt: 720, widthPt: 96, heightPt: 12 }],
            },
            children: [{ kind: 'paragraph', runs: [{ text: 'Body under the heading.' }] }],
          },
        ],
      },
    ],
  };
}

// A spreadsheet package whose sheet group carries its grid on the node and an anchored image child -- the other end of the per-kind children typing.
function spreadsheetPackage(): DocumentPackage {
  return {
    kind: 'spreadsheet',
    metadata: {},
    children: [
      {
        node: {
          kind: 'sheet',
          name: 'Sheet1',
          cells: [{ row: 0, column: 0, value: { kind: 'number', value: 1 }, displayText: '1' }],
          columns: [],
          rows: [],
          printSettings: {
            pageSize: PAGE,
            margins: MARGINS,
            gridlines: true,
            headers: true,
            pageOrder: 'downThenOver',
          },
        },
        children: [
          {
            kind: 'image',
            format: 'png',
            base64: 'aGk=',
            widthPt: 50,
            heightPt: 50,
            anchorRow: 0,
            anchorColumn: 0,
            offsetXPt: 0,
            offsetYPt: 0,
          },
        ],
      },
    ],
  };
}

// A formula package: the one kind whose single child is a leaf, not a group.
function formulaPackage(): DocumentPackage {
  return {
    kind: 'formula',
    metadata: {},
    children: [{ mathml: [{ type: 'element', tag: 'math', attributes: [], children: [] }] }],
  };
}

describe('DocumentPackageSchema round trips (tree form)', () => {
  it('deep-equals the original package after a JSON round trip when pages/frames are present', () => {
    const original = wordprocessingPackage();
    const parsed = DocumentPackageSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(DocumentPackageSchema.parse(roundTripped)).toEqual(original);
  });

  it('deep-equals a content-only package (no pages, no styles, no definitions) after a JSON round trip', () => {
    const original = wordprocessingPackage();
    delete original.pages;
    const parsed = DocumentPackageSchema.parse(original);
    expect(parsed.pages).toBeUndefined();
    const serialized: unknown = JSON.parse(JSON.stringify(parsed));
    expect(serialized).not.toHaveProperty('pages');
    expect(DocumentPackageSchema.parse(serialized)).toEqual(original);
  });

  it('round trips a spreadsheet package and a formula package', () => {
    for (const original of [spreadsheetPackage(), formulaPackage()]) {
      const parsed = DocumentPackageSchema.parse(original);
      const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
      expect(DocumentPackageSchema.parse(roundTripped)).toEqual(original);
    }
  });

  it('tolerates and strips an incoming $schema key, and accepts styles and definitions tables at the root', () => {
    const original = wordprocessingPackage();
    const withTables = {
      $schema: 'https://cdn.jsdelivr.net/npm/document-schema.js@4.0.0/schemas/document-package.schema.json',
      ...original,
      styles: { s1: { paragraph: { alignment: 'justify' }, run: { sizePt: 11 } } },
      definitions: { l1: { kind: 'link', url: 'https://example.com' } },
    };
    const parsed = DocumentPackageSchema.parse(withTables);
    expect(parsed.styles).toEqual({ s1: { paragraph: { alignment: 'justify' }, run: { sizePt: 11 } } });
    expect(parsed.definitions).toEqual({ l1: { kind: 'link', url: 'https://example.com' } });
    expect('$schema' in parsed).toBe(false);
  });

  it('rejects the retired 3.x flat shape -- a value with no children and no tree kind at the root', () => {
    const oldShape = {
      formatVersion: 2,
      content: { kind: 'wordprocessing', metadata: {}, sections: [{ pageSize: PAGE, margins: MARGINS, blocks: [] }] },
      pages: [PAGE],
    };
    expect(DocumentPackageSchema.safeParse(oldShape).success).toBe(false);
  });

  it('rejects a root child of the wrong group kind for the package kind', () => {
    const mixed = {
      kind: 'presentation',
      metadata: {},
      children: [{ node: { kind: 'section', pageSize: PAGE, margins: MARGINS }, children: [] }],
    };
    expect(DocumentPackageSchema.safeParse(mixed).success).toBe(false);
  });

  it('rejects a malformed leaf deep in the tree (a style entry carrying the banned frames key, and a non-group slide child)', () => {
    const withBannedStyle = {
      ...wordprocessingPackage(),
      styles: { s1: { frames: [] } },
    };
    expect(DocumentPackageSchema.safeParse(withBannedStyle).success).toBe(false);

    const slideWithStrayParagraph = {
      kind: 'presentation',
      metadata: {},
      children: [
        {
          node: { kind: 'slide', size: { widthPt: 960, heightPt: 540 }, notes: '' },
          children: [{ kind: 'paragraph', runs: [{ text: 'stray' }] }],
        },
      ],
    };
    expect(DocumentPackageSchema.safeParse(slideWithStrayParagraph).success).toBe(false);
  });

  it('keeps the document-level symbolTable on the package root, spliced from the same declaration the content arms use', () => {
    const original = wordprocessingPackage();
    const withSymbols = { ...original, symbolTable: { symbols: [], units: [] } };
    const parsed = DocumentPackageSchema.parse(withSymbols);
    expect(parsed.symbolTable).toEqual({ symbols: [], units: [] });
  });
});
