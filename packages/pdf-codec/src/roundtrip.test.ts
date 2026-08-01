import { bytesToBase64 } from './util/base64';
import { describe, expect, it } from 'vitest';
import type { LayoutDocument, LayoutImageAsset, LayoutItem, LayoutPage, LayoutPath } from 'document-schema.js';
import { LAYOUT_FORMAT_VERSION, LayoutDocumentSchema } from 'document-schema.js';
import { encodePng } from './image/png-encode';
import { readPdf } from './read';
import { writePdf } from './write';

// write.test.ts and read.test.ts each test writePdf/readPdf in isolation -- the former against emitted content-stream bytes, the latter against PDFs hand-built independently in test-support/pdf.ts, deliberately never through writePdf itself (see that file's own top-of-file rationale). Neither proves the two halves agree with each other. This file is the one place that runs writePdf then readPdf back-to-back, proving LayoutDocument -- the structured, Zod-validated, plain-JSON pivot model both functions speak (see document-content-model's own layout.test.ts JSON.stringify/parse test) -- actually survives a real write/read cycle through this package's own codec, not just its own schema in isolation. Per the documented v1 scope, text/rect/path/image/link items are read back as such (line and ellipse are still write-only -- neither writeLine's straight segment nor writeEllipse's four fixed Bezier arcs is distinguishable, once written, from an equivalent general path built by hand, so recovering them as their own LayoutLine/LayoutEllipse kinds specifically would need shape-detection heuristics nothing has asked for yet; both read back as an ordinary LayoutPath instead), so this file covers those five kinds.

const HELVETICA = { family: 'Helvetica', weight: 'normal', style: 'normal' } as const;
const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };

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

  // The strongest possible check on the new general-path machinery: not interpret.ts in isolation (interpret.test.ts) and not writePath in isolation (write-path.test.ts), but the two run genuinely back to back through this package's own writePdf/readPdf codec -- proving the write and read halves of path recovery actually agree with each other, not just that each independently does something plausible.
  it('recovers a closed straight-line path with fill and stroke both set', () => {
    const path: LayoutPath = {
      kind: 'path',
      fill: RED,
      stroke: { color: BLACK, widthPt: 2 },
      subpaths: [{ startXPt: 20, startYPt: 20, closed: true, segments: [{ kind: 'line', xPt: 80, yPt: 20 }, { kind: 'line', xPt: 80, yPt: 60 }, { kind: 'line', xPt: 20, yPt: 60 }] }],
    };
    const doc = docWithItems([path]);

    const result = readPdf(writePdf(doc, { compress: false }));

    expect(result.pages[0]!.items).toEqual([path]);
  });

  it('recovers an open stroke-only path with a real cubic curve', () => {
    const path: LayoutPath = {
      kind: 'path',
      stroke: { color: BLUE, widthPt: 3 },
      subpaths: [{ startXPt: 0, startYPt: 0, closed: false, segments: [{ kind: 'cubic', c1xPt: 0, c1yPt: 40, c2xPt: 40, c2yPt: 40, xPt: 40, yPt: 0 }] }],
    };
    const doc = docWithItems([path]);

    const result = readPdf(writePdf(doc, { compress: false }));

    expect(result.pages[0]!.items).toEqual([path]);
  });

  it('recovers multiple subpaths under an even-odd fill rule -- the standard "hole" construction', () => {
    const path: LayoutPath = {
      kind: 'path',
      fill: BLACK,
      fillRule: 'evenodd',
      subpaths: [
        { startXPt: 0, startYPt: 0, closed: true, segments: [{ kind: 'line', xPt: 20, yPt: 0 }, { kind: 'line', xPt: 20, yPt: 20 }, { kind: 'line', xPt: 0, yPt: 20 }] },
        { startXPt: 5, startYPt: 5, closed: true, segments: [{ kind: 'line', xPt: 15, yPt: 5 }, { kind: 'line', xPt: 15, yPt: 15 }, { kind: 'line', xPt: 5, yPt: 15 }] },
      ],
    };
    const doc = docWithItems([path]);

    const result = readPdf(writePdf(doc, { compress: false }));

    expect(result.pages[0]!.items).toEqual([path]);
  });

  // page.notes carries pptx speaker notes through the PDF round trip (see layout/slides.ts and layout/reconstruct.ts) as a hidden /Subtype /Text annotation (write.ts's buildNotesAnnotDict) -- PDF has no native concept of presenter notes, so this is this package's own round-trip mechanism, confirmed here at the LayoutDocument level and separately confirmed against real Keynote (see editor.test.ts and this project's own manual verification).
  it('recovers page.notes from the hidden notes annotation, and omits it entirely when absent', () => {
    const withNotes = docWithPages([{ widthPt: 300, heightPt: 200, items: [], notes: 'Speaker notes for this page' }]);
    const resultWithNotes = readPdf(writePdf(withNotes, { compress: false }));
    expect(resultWithNotes.pages[0]!.notes).toBe('Speaker notes for this page');

    const withoutNotes = docWithItems([]);
    const resultWithoutNotes = readPdf(writePdf(withoutNotes, { compress: false }));
    expect(resultWithoutNotes.pages[0]!.notes).toBeUndefined();
  });

  it('never surfaces the hidden notes annotation as a visible LayoutItem', () => {
    const doc = docWithPages([{ widthPt: 300, heightPt: 200, items: [{ kind: 'text', text: 'Visible', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 12, color: BLACK }], notes: 'Hidden notes text' }]);

    const result = readPdf(writePdf(doc, { compress: false }));

    expect(result.pages[0]!.items).toHaveLength(1);
    expect(result.pages[0]!.items[0]).toMatchObject({ kind: 'text', text: 'Visible' });
  });
});
