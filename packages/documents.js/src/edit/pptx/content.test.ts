import { describe, expect, it } from 'vitest';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import type { ContentDocument } from 'document-schema.js';
import { bytesToBase64 } from 'ooxml.js';
import { buildPptxPackage } from './content';
import { PptxEditor } from './editor';

function presentationDoc(slides: Extract<ContentDocument, { kind: 'presentation' }>['slides']): ContentDocument {
  return { kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, slides };
}

const ZERO_INSETS = { insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 };

describe('buildPptxPackage', () => {
  it('throws for a wordprocessing ContentDocument', () => {
    expect(() => buildPptxPackage({ kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, sections: [] })).toThrow(/presentation/);
  });

  it('sets the deck-wide slide size from the first slide', () => {
    const content = presentationDoc([{ size: { widthPt: 612, heightPt: 792 }, shapes: [], notes: '' }]);
    const editor = new PptxEditor(buildPptxPackage(content));
    expect(editor.slideSize).toEqual({ widthPt: 612, heightPt: 792 });
  });

  it('builds a text shape with multiple styled paragraphs', () => {
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
    const editor = new PptxEditor(buildPptxPackage(content));
    const [slide] = editor.slides();
    const [shape] = slide!.shapes();
    expect(shape?.frame).toEqual({ xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 });
    expect(shape?.text).toBe('TitleBody text');
  });

  it('builds an image-only shape as a picture, not a text box', () => {
    const content = presentationDoc([
      {
        size: { widthPt: 960, heightPt: 540 },
        notes: '',
        shapes: [{ frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 }, ...ZERO_INSETS, blocks: [{ kind: 'image', format: 'png', base64: bytesToBase64(new Uint8Array([1, 2, 3])), widthPt: 50, heightPt: 50 }] }],
      },
    ]);
    const pkg = buildPptxPackage(content);
    const mediaParts = Object.keys(pkg.parts).filter((p) => p.startsWith('ppt/media/'));
    expect(mediaParts).toHaveLength(1);
  });

  it('builds one slide per ContentSlide and carries notes through', () => {
    const content = presentationDoc([
      { size: { widthPt: 960, heightPt: 540 }, shapes: [], notes: 'First slide notes' },
      { size: { widthPt: 960, heightPt: 540 }, shapes: [], notes: '' },
    ]);
    const editor = new PptxEditor(buildPptxPackage(content));
    const slides = editor.slides();
    expect(slides).toHaveLength(2);
    expect(slides[0]!.notes).toBe('First slide notes');
    expect(slides[1]!.notes).toBe('');
  });
});
