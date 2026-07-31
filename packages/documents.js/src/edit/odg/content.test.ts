import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from 'odf.js';
import type { ContentDocument } from '../../model/content';
import { buildOdgPackage } from './content';
import { OdgEditor } from './editor';

function drawingDoc(pages: Extract<ContentDocument, { kind: 'drawing' }>['pages']): ContentDocument {
  return { kind: 'drawing', formatVersion: 1, metadata: {}, pages };
}

const ZERO_INSETS = { insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 };
const RED = { r: 1, g: 0, b: 0 };
const BLACK = { r: 0, g: 0, b: 0 };

describe('buildOdgPackage', () => {
  it('throws for a presentation ContentDocument', () => {
    expect(() => buildOdgPackage({ kind: 'presentation', formatVersion: 1, metadata: {}, slides: [] })).toThrow(/drawing/);
  });

  it('sets the deck-wide page size from the first page', () => {
    const content = drawingDoc([{ size: { widthPt: 400, heightPt: 300 }, shapes: [], vectors: [] }]);
    const editor = new OdgEditor(buildOdgPackage(content));
    expect(editor.pageSize).toEqual({ widthPt: 400, heightPt: 300 });
  });

  it('builds one page per ContentDrawPage', () => {
    const content = drawingDoc([
      { size: { widthPt: 400, heightPt: 300 }, shapes: [], vectors: [] },
      { size: { widthPt: 400, heightPt: 300 }, shapes: [], vectors: [] },
    ]);
    const editor = new OdgEditor(buildOdgPackage(content));
    expect(editor.pages()).toHaveLength(2);
  });

  it('writes rect/ellipse/line/path vectors, vectors before shapes', () => {
    const content = drawingDoc([
      {
        size: { widthPt: 400, heightPt: 300 },
        vectors: [
          { kind: 'rect', frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 30 }, fill: RED },
          { kind: 'ellipse', frame: { xPt: 50, yPt: 0, widthPt: 40, heightPt: 30 }, stroke: { color: BLACK, widthPt: 1 } },
          { kind: 'line', from: { xPt: 0, yPt: 0 }, to: { xPt: 10, yPt: 10 }, stroke: { color: BLACK, widthPt: 2 } },
          {
            kind: 'path',
            frame: { xPt: 100, yPt: 100, widthPt: 60, heightPt: 60 },
            subpaths: [
              {
                start: { xPt: 0, yPt: 0 },
                closed: true,
                segments: [{ kind: 'cubic', control1: { xPt: 20, yPt: 0 }, control2: { xPt: 40, yPt: 60 }, to: { xPt: 60, yPt: 60 } }],
              },
            ],
            fill: RED,
          },
        ],
        shapes: [{ frame: { xPt: 0, yPt: 200, widthPt: 100, heightPt: 30 }, ...ZERO_INSETS, blocks: [{ kind: 'paragraph', runs: [{ text: 'Label' }] }] }],
      },
    ]);
    const pkg = buildOdgPackage(content);
    const editor = new OdgEditor(pkg);
    const [page] = editor.pages();
    expect(page?.shapes().map((s) => s.text)).toEqual(['Label']);
  });

  it('builds an image-only shape as a picture, not a text box', () => {
    const content = drawingDoc([
      {
        size: { widthPt: 400, heightPt: 300 },
        vectors: [],
        shapes: [{ frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 }, ...ZERO_INSETS, blocks: [{ kind: 'image', format: 'png', base64: bytesToBase64(new Uint8Array([1, 2, 3])), widthPt: 50, heightPt: 50 }] }],
      },
    ]);
    const pkg = buildOdgPackage(content);
    const mediaParts = Object.keys(pkg.parts).filter((p) => p.startsWith('Pictures/'));
    expect(mediaParts).toHaveLength(1);
  });

  it('carries a shape rotation through, reusing OdpShape\'s draw:transform machinery', () => {
    const content = drawingDoc([
      {
        size: { widthPt: 400, heightPt: 300 },
        vectors: [],
        shapes: [{ frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 }, rotationDeg: 20, ...ZERO_INSETS, blocks: [{ kind: 'paragraph', runs: [{ text: 'Rotated' }] }] }],
      },
    ]);
    const editor = new OdgEditor(buildOdgPackage(content));
    const [shape] = editor.pages()[0]!.shapes();
    expect(shape?.rotationDeg).toBeCloseTo(20, 6);
  });
});
