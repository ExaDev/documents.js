import { describe, expect, it } from 'vitest';
import { COLOR_BLACK } from './color';
import { LAYOUT_FORMAT_VERSION, LayoutDocumentSchema, LayoutItemSchema } from './layout';
import { DEFAULT_LAYOUT_FONT } from './style';

const text = {
  kind: 'text',
  text: 'Hi',
  xPt: 72,
  yPt: 720,
  font: DEFAULT_LAYOUT_FONT,
  sizePt: 12,
  color: COLOR_BLACK,
};

describe('LayoutItemSchema', () => {
  it('accepts each item kind', () => {
    expect(LayoutItemSchema.parse(text)).toMatchObject(text);
    expect(
      LayoutItemSchema.parse({ kind: 'image', imageId: 'im1', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }),
    ).toBeDefined();
    expect(LayoutItemSchema.parse({ kind: 'rect', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 })).toBeDefined();
    expect(
      LayoutItemSchema.parse({
        kind: 'line',
        x1Pt: 0,
        y1Pt: 0,
        x2Pt: 10,
        y2Pt: 10,
        color: COLOR_BLACK,
        widthPt: 1,
      }),
    ).toBeDefined();
    expect(
      LayoutItemSchema.parse({ kind: 'ellipse', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }),
    ).toBeDefined();
    expect(
      LayoutItemSchema.parse({ kind: 'link', uri: 'https://example.com', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }),
    ).toBeDefined();
  });

  it('rejects an unknown kind', () => {
    expect(LayoutItemSchema.safeParse({ kind: 'circle', xPt: 0, yPt: 0 }).success).toBe(false);
  });
});

describe('LayoutDocumentSchema', () => {
  it('accepts a minimal one-page document with an empty image registry', () => {
    const doc = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 612, heightPt: 792, items: [text] }],
      images: {},
    };
    expect(LayoutDocumentSchema.parse(doc)).toEqual(doc);
  });

  it('round-trips through JSON.stringify/parse unchanged, proving the model is plain JSON', () => {
    const doc = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: { title: 'Test' },
      pages: [{ widthPt: 612, heightPt: 792, items: [text] }],
      images: {
        im1: { format: 'png', base64: 'AA==', widthPx: 10, heightPx: 10 },
      },
    };
    const parsed = LayoutDocumentSchema.parse(doc);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });

  it('rejects a mismatched formatVersion', () => {
    expect(
      LayoutDocumentSchema.safeParse({ formatVersion: 2, metadata: {}, pages: [], images: {} }).success,
    ).toBe(false);
  });
});
