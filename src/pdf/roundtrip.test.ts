import { bytesToBase64 } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../image/png-encode';
import type { LayoutDocument, LayoutImageAsset, LayoutItem, LayoutPage } from '../model/layout';
import { LAYOUT_FORMAT_VERSION, LayoutDocumentSchema } from '../model/layout';
import { readPdf } from './read';
import { writePdf } from './write';

// write.test.ts and read.test.ts each test writePdf/readPdf in isolation -- the former against emitted content-stream bytes, the latter against PDFs hand-built independently in test-support/pdf.ts, deliberately never through writePdf itself (see that file's own top-of-file rationale). Neither proves the two halves agree with each other. This file is the one place that runs writePdf then readPdf back-to-back, proving LayoutDocument -- the structured, Zod-validated, plain-JSON pivot model both functions speak (see model/layout.test.ts's own JSON.stringify/parse test) -- actually survives a real write/read cycle through this package's own codec, not just its own schema in isolation. Per the documented v1 scope, only text/rect/image/link items are read back as such (line and ellipse are write-only -- general vector-path recovery is out of scope, see read.ts/interpret.ts's ExtractedItem union), so this file covers exactly those four kinds.

const HELVETICA = { family: 'Helvetica', weight: 'normal', style: 'normal' } as const;
const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 1, g: 0, b: 0 };

function docWithPages(pages: LayoutPage[], images: Record<string, LayoutImageAsset> = {}): LayoutDocument {
  return { formatVersion: LAYOUT_FORMAT_VERSION, metadata: {}, pages, images };
}

function docWithItems(items: LayoutItem[]): LayoutDocument {
  return docWithPages([{ widthPt: 300, heightPt: 200, items }]);
}

function tinyPngAsset(): LayoutImageAsset {
  const width = 2;
  const height = 2;
  // 4 solid-colour pixels, RGB, no alpha -- shape mirrors write.test.ts's own tinyPngAsset fixture.
  const data = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const bytes = encodePng({ width, height, channels: 3, data });
  return { format: 'png', base64: bytesToBase64(bytes), widthPx: width, heightPx: height };
}

describe('writePdf -> readPdf: structural round trip', () => {
  it('recovers page size, text content/position/size/colour, and an axis-aligned filled rect', () => {
    const doc = docWithItems([
      { kind: 'text', text: 'Round trip', xPt: 20, yPt: 150, font: HELVETICA, sizePt: 14, color: BLACK },
      { kind: 'rect', xPt: 10, yPt: 10, widthPt: 80, heightPt: 40, fill: RED },
    ]);

    const result = readPdf(writePdf(doc, { compress: false }));

    expect(result.pages).toHaveLength(1);
    const [page] = result.pages;
    expect(page).toMatchObject({ widthPt: 300, heightPt: 200 });

    const text = page!.items.find((i) => i.kind === 'text');
    if (text?.kind !== 'text') {
      throw new Error('expected a text item');
    }
    expect(text.text).toBe('Round trip');
    expect(text.color).toEqual(BLACK);
    expect(text.xPt).toBeCloseTo(20, 3);
    expect(text.yPt).toBeCloseTo(150, 3);
    expect(text.sizePt).toBeCloseTo(14, 3);

    const rect = page!.items.find((i) => i.kind === 'rect');
    expect(rect).toEqual({ kind: 'rect', xPt: 10, yPt: 10, widthPt: 80, heightPt: 40, fill: RED });
  });

  it('recovers an embedded PNG image at its written placement', () => {
    const asset = tinyPngAsset();
    const doc = docWithPages([{ widthPt: 300, heightPt: 200, items: [{ kind: 'image', imageId: 'logo', xPt: 30, yPt: 40, widthPt: 60, heightPt: 60 }] }], {
      logo: asset,
    });

    const result = readPdf(writePdf(doc, { compress: false }));

    const image = result.pages[0]!.items.find((i) => i.kind === 'image');
    if (image?.kind !== 'image') {
      throw new Error('expected an image item');
    }
    expect(image.xPt).toBeCloseTo(30, 3);
    expect(image.yPt).toBeCloseTo(40, 3);
    expect(image.widthPt).toBeCloseTo(60, 3);
    expect(image.heightPt).toBeCloseTo(60, 3);
    expect(result.images[image.imageId]).toMatchObject({ format: 'png', widthPx: asset.widthPx, heightPx: asset.heightPx });
  });

  it('recovers a link annotation URI and rectangle', () => {
    const doc = docWithItems([{ kind: 'link', uri: 'https://example.com/', xPt: 5, yPt: 6, widthPt: 40, heightPt: 12 }]);

    const result = readPdf(writePdf(doc, { compress: false }));

    expect(result.pages[0]!.items).toEqual([{ kind: 'link', uri: 'https://example.com/', xPt: 5, yPt: 6, widthPt: 40, heightPt: 12 }]);
  });

  it('produces a LayoutDocument that is itself valid, plain JSON, per LayoutDocumentSchema', () => {
    const doc = docWithItems([{ kind: 'text', text: 'Hi', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 12, color: BLACK }]);

    const result = readPdf(writePdf(doc, { compress: false }));

    const parsed = LayoutDocumentSchema.parse(result);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });

  it('round-trips through a Flate-compressed content stream too, not just the human-readable form', () => {
    const doc = docWithItems([{ kind: 'text', text: 'Compressed', xPt: 15, yPt: 100, font: HELVETICA, sizePt: 10, color: BLACK }]);

    const result = readPdf(writePdf(doc)); // default options: compress: true

    expect(result.pages[0]!.items).toMatchObject([{ kind: 'text', text: 'Compressed' }]);
  });
});
