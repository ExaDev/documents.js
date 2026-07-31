import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from 'odf.js';
import type { ContentDocument } from '../../model/content';
import { buildOdpPackage } from './content';
import { OdpEditor } from './editor';

function presentationDoc(slides: Extract<ContentDocument, { kind: 'presentation' }>['slides']): ContentDocument {
  return { kind: 'presentation', formatVersion: 1, metadata: {}, slides };
}

const ZERO_INSETS = { insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 };

describe('buildOdpPackage', () => {
  it('throws for a wordprocessing ContentDocument', () => {
    expect(() => buildOdpPackage({ kind: 'wordprocessing', formatVersion: 1, metadata: {}, sections: [] })).toThrow(/presentation/);
  });

  it('sets the deck-wide slide size from the first slide', () => {
    const content = presentationDoc([{ size: { widthPt: 612, heightPt: 792 }, shapes: [], notes: '' }]);
    const editor = new OdpEditor(buildOdpPackage(content));
    expect(editor.slideSize).toEqual({ widthPt: 612, heightPt: 792 });
  });

  it('builds a text shape with multiple styled paragraphs, reusing odt paragraph/run machinery', () => {
    const content = presentationDoc([
      {
        size: { widthPt: 960, heightPt: 540 },
        notes: '',
        shapes: [
          {
            frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
            ...ZERO_INSETS,
            blocks: [
              { kind: 'paragraph', alignment: 'center', runs: [{ text: 'Title', bold: true, sizePt: 24 }] },
              { kind: 'paragraph', runs: [{ text: 'Body text', color: { r: 0, g: 0, b: 1 } }] },
            ],
          },
        ],
      },
    ]);
    const editor = new OdpEditor(buildOdpPackage(content));
    const [slide] = editor.slides();
    const [shape] = slide!.shapes();
    expect(shape?.frame).toEqual({ xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 });
    expect(shape?.text).toBe('Title\nBody text');
    const paragraphs = shape!.paragraphs();
    expect(paragraphs[0]?.alignment).toBe('center');
    const firstRun = paragraphs[0]?.runs()[0];
    expect(firstRun?.bold).toBe(true);
    expect(firstRun?.sizePt).toBe(24);
    const secondRun = paragraphs[1]?.runs()[0];
    expect(secondRun?.color).toEqual({ r: 0, g: 0, b: 1 });
  });

  it('writes a shape rotation back as a real draw:transform, unlike buildPptxPackage which has no rotation setter yet', () => {
    const content = presentationDoc([
      {
        size: { widthPt: 960, heightPt: 540 },
        notes: '',
        shapes: [{ frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 }, rotationDeg: 30, ...ZERO_INSETS, blocks: [{ kind: 'paragraph', runs: [{ text: 'Rotated' }] }] }],
      },
    ]);
    const editor = new OdpEditor(buildOdpPackage(content));
    const [shape] = editor.slides()[0]!.shapes();
    expect(shape?.rotationDeg).toBeCloseTo(30, 6);
    expect(shape?.frame?.xPt).toBeCloseTo(10, 6);
    expect(shape?.frame?.yPt).toBeCloseTo(10, 6);
  });

  it('builds an image-only shape as a picture, not a text box, and carries its rotation', () => {
    const content = presentationDoc([
      {
        size: { widthPt: 960, heightPt: 540 },
        notes: '',
        shapes: [{ frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 }, rotationDeg: 90, ...ZERO_INSETS, blocks: [{ kind: 'image', format: 'png', base64: bytesToBase64(new Uint8Array([1, 2, 3])), widthPt: 50, heightPt: 50 }] }],
      },
    ]);
    const pkg = buildOdpPackage(content);
    const mediaParts = Object.keys(pkg.parts).filter((p) => p.startsWith('Pictures/'));
    expect(mediaParts).toHaveLength(1);
    const editor = new OdpEditor(pkg);
    const [shape] = editor.slides()[0]!.shapes();
    expect(shape?.rotationDeg).toBeCloseTo(90, 6);
  });

  it('builds one slide per ContentSlide and carries notes through', () => {
    const content = presentationDoc([
      { size: { widthPt: 960, heightPt: 540 }, shapes: [], notes: 'First slide notes' },
      { size: { widthPt: 960, heightPt: 540 }, shapes: [], notes: '' },
    ]);
    const editor = new OdpEditor(buildOdpPackage(content));
    const slides = editor.slides();
    expect(slides).toHaveLength(2);
    expect(slides[0]!.notes).toBe('First slide notes');
    expect(slides[1]!.notes).toBe('');
  });
});
