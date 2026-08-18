import { describe, expect, it } from 'vitest';
import { COLOR_BLACK, DEFAULT_LAYOUT_FONT } from 'document-schema.js';
import {
  LAYOUT_FORMAT_VERSION,
  type LayoutDocument,
  LayoutDocumentSchema,
  type LayoutItem,
  LayoutItemSchema,
} from './layout';

const text: LayoutItem = {
  kind: 'text',
  text: 'Hello, layout.',
  xPt: 72,
  yPt: 720,
  font: DEFAULT_LAYOUT_FONT,
  sizePt: 12,
  color: COLOR_BLACK,
  widthPt: 90.5,
  rotationDeg: 0,
  underline: true,
};

const imageItem: LayoutItem = {
  kind: 'image',
  imageId: 'logo',
  xPt: 10,
  yPt: 700,
  widthPt: 50,
  heightPt: 25,
  rotationDeg: 5,
};

const rect: LayoutItem = {
  kind: 'rect',
  xPt: 0,
  yPt: 0,
  widthPt: 200,
  heightPt: 100,
  fill: { r: 0.9, g: 0.9, b: 0.9 },
  stroke: { color: COLOR_BLACK, widthPt: 1.5 },
};

const line: LayoutItem = {
  kind: 'line',
  x1Pt: 0,
  y1Pt: 0,
  x2Pt: 100,
  y2Pt: 100,
  color: COLOR_BLACK,
  widthPt: 2,
};

const ellipse: LayoutItem = {
  kind: 'ellipse',
  xPt: 20,
  yPt: 20,
  widthPt: 40,
  heightPt: 40,
  fill: { r: 0.1, g: 0.2, b: 0.3 },
};

const path: LayoutItem = {
  kind: 'path',
  subpaths: [
    {
      startXPt: 0,
      startYPt: 0,
      closed: true,
      segments: [
        { kind: 'line', xPt: 10, yPt: 0 },
        { kind: 'cubic', c1xPt: 15, c1yPt: 5, c2xPt: 15, c2yPt: 15, xPt: 10, yPt: 20 },
        { kind: 'line', xPt: 0, yPt: 20 },
      ],
    },
  ],
  fill: { r: 0.4, g: 0.5, b: 0.6 },
  fillRule: 'evenodd',
  stroke: { color: COLOR_BLACK, widthPt: 1 },
};

const link: LayoutItem = {
  kind: 'link',
  uri: 'https://example.com/',
  xPt: 5,
  yPt: 5,
  widthPt: 60,
  heightPt: 15,
};

describe('LayoutItemSchema', () => {
  it('accepts every item kind and preserves every field through a JSON round trip', () => {
    for (const item of [text, imageItem, rect, line, ellipse, path, link]) {
      const parsed = LayoutItemSchema.parse(item);
      const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
      expect(LayoutItemSchema.parse(roundTripped)).toEqual(item);
    }
  });

  it('rejects an unknown kind', () => {
    expect(LayoutItemSchema.safeParse({ kind: 'circle', xPt: 0, yPt: 0 }).success).toBe(false);
  });
});

describe('LayoutPathSchema', () => {
  it('accepts a minimal open subpath with no fill, stroke, or fillRule', () => {
    const minimal: LayoutItem = {
      kind: 'path',
      subpaths: [{ startXPt: 0, startYPt: 0, closed: false, segments: [{ kind: 'line', xPt: 10, yPt: 10 }] }],
    };
    expect(LayoutItemSchema.parse(minimal)).toEqual(minimal);
  });

  it('accepts a path with multiple subpaths, matching an evenodd hole punched through a fill', () => {
    const withHole: LayoutItem = {
      kind: 'path',
      subpaths: [
        { startXPt: 0, startYPt: 0, closed: true, segments: [{ kind: 'line', xPt: 20, yPt: 0 }, { kind: 'line', xPt: 20, yPt: 20 }, { kind: 'line', xPt: 0, yPt: 20 }] },
        { startXPt: 5, startYPt: 5, closed: true, segments: [{ kind: 'line', xPt: 15, yPt: 5 }, { kind: 'line', xPt: 15, yPt: 15 }, { kind: 'line', xPt: 5, yPt: 15 }] },
      ],
      fill: COLOR_BLACK,
      fillRule: 'evenodd',
    };
    expect(LayoutItemSchema.parse(withHole)).toEqual(withHole);
  });

  it('rejects a segment kind other than line/cubic', () => {
    const invalid = { kind: 'path', subpaths: [{ startXPt: 0, startYPt: 0, closed: false, segments: [{ kind: 'quadratic', xPt: 1, yPt: 1 }] }] };
    expect(LayoutItemSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('LayoutItemSchema sourcePath', () => {
  it('survives a JSON round trip when set on every item kind', () => {
    const itemsWithSourcePath: LayoutItem[] = [
      { ...text, sourcePath: 'sections[0].blocks[0].runs[0]' },
      { ...imageItem, sourcePath: 'sections[0].blocks[1]' },
      { ...rect, sourcePath: 'slides[0].shapes[0]' },
      { ...line, sourcePath: 'slides[0].shapes[1]' },
      { ...ellipse, sourcePath: 'slides[0].shapes[2]' },
      { ...path, sourcePath: 'pages[0].vectors[0]' },
      { ...link, sourcePath: 'sections[0].blocks[0].runs[1]' },
    ];
    for (const item of itemsWithSourcePath) {
      const parsed = LayoutItemSchema.parse(item);
      const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
      expect(LayoutItemSchema.parse(roundTripped)).toEqual(item);
    }
  });

  it('parses correctly when sourcePath is omitted, matching every other optional field', () => {
    for (const item of [text, imageItem, rect, line, ellipse, path, link]) {
      const parsed = LayoutItemSchema.parse(item);
      expect(parsed.sourcePath).toBeUndefined();
    }
  });
});

function layoutDocument(): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {
      title: 'Layout round trip',
      author: 'pdf-codec',
      subject: 'testing',
      keywords: ['layout', 'pdf'],
      creator: 'pdf-codec tests',
      producer: 'pdf-codec tests', // producer is normally PDF-only; exercised here as a plain optional field
      createdIso: '2026-07-30T00:00:00.000Z',
      modifiedIso: '2026-07-30T01:00:00.000Z',
    },
    pages: [
      {
        widthPt: 612,
        heightPt: 792,
        items: [text, imageItem, rect, line, ellipse, path, link],
        notes: 'Speaker notes carried as a hidden annotation.',
      },
      {
        widthPt: 612,
        heightPt: 792,
        items: [text],
        // deliberately no `notes` field, exercising the page-without-notes case
      },
    ],
    images: {
      logo: { format: 'png', base64: 'AA==', widthPx: 32, heightPx: 32 },
      photo: { format: 'jpeg', base64: '/9k=', widthPx: 1024, heightPx: 768 },
    },
  };
}

describe('LayoutDocumentSchema round trips', () => {
  it('deep-equals the original document after a JSON round trip, covering a page with notes and a page without', () => {
    const original = layoutDocument();
    const parsed = LayoutDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(LayoutDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it('accepts a minimal document with an empty page and empty image registry', () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 612, heightPt: 792, items: [] }],
      images: {},
    };
    expect(LayoutDocumentSchema.parse(doc)).toEqual(doc);
  });

  it('rejects a mismatched formatVersion', () => {
    expect(
      LayoutDocumentSchema.safeParse({ formatVersion: 2, metadata: {}, pages: [], images: {} }).success,
    ).toBe(false);
  });
});
