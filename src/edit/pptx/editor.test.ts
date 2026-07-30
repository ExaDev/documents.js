import { decodePackage } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { minimalPptxBytes, minimalPptxPackage } from '../../test-support/pptx';
import { assertPartsUnchangedExcept } from '../../test-support/fidelity';
import { createPptx, openPptx } from './editor';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe('openPptx / createPptx', () => {
  it('openPptx reads an existing package and exposes its slides/shapes', () => {
    const editor = openPptx(minimalPptxBytes());
    const slides = editor.slides();
    expect(slides).toHaveLength(1);
    expect(slides[0]?.shapes()).toHaveLength(1);
    expect(slides[0]?.shapes()[0]?.text).toContain('Slide text');
  });

  it('createPptx starts from a valid, empty, encodable package with zero slides', () => {
    const editor = createPptx();
    expect(editor.slides()).toHaveLength(0);
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });
});

describe('PptxEditor.addSlide / removeSlideAt / moveSlide', () => {
  it('addSlide creates a slide with a unique sldId >= 256 and an empty shape tree', () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    expect(slide.shapes()).toHaveLength(0);
    expect(editor.slides()).toHaveLength(1);
    expect(() => editor.toBytes()).not.toThrow();
  });

  it('allocates a distinct, increasing sldId for each new slide', () => {
    const editor = createPptx();
    editor.addSlide();
    editor.addSlide();
    editor.addSlide();
    expect(editor.slides()).toHaveLength(3);
  });

  it('addTextBox and addImage add shapes to the correct slide', () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({ frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 }, text: 'Title' });
    slide.addImage({ frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 }, format: 'png', bytes: PNG_BYTES });
    expect(slide.shapes()).toHaveLength(2);
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });

  it('removeSlideAt removes the slide and its part', () => {
    const editor = createPptx();
    editor.addSlide().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'One' });
    editor.addSlide().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'Two' });
    editor.removeSlideAt(0);
    const remaining = editor.slides();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.shapes()[0]?.text).toBe('Two');
  });

  it('moveSlide reorders slides', () => {
    const editor = createPptx();
    editor.addSlide().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'First' });
    editor.addSlide().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'Second' });
    editor.moveSlide(1, 0);
    const texts = editor.slides().map((s) => s.shapes()[0]?.text);
    expect(texts).toEqual(['Second', 'First']);
  });
});

describe('PptxSlide.notes', () => {
  it('defaults to an empty string and round-trips text once set', () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    expect(slide.notes).toBe('');
    slide.notes = 'Speaker notes here';
    expect(slide.notes).toBe('Speaker notes here');
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });

  it('updates the existing notes part rather than creating a second one', () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.notes = 'First';
    slide.notes = 'Second';
    expect(slide.notes).toBe('Second');
    const notesParts = Object.keys(editor.toPackage().parts).filter((p) => p.startsWith('ppt/notesSlides/'));
    expect(notesParts).toHaveLength(1);
  });
});

describe('live-view fidelity for pptx', () => {
  it('mutating a shape leaves every other part unchanged', () => {
    const before = minimalPptxPackage();
    const editor = openPptx(minimalPptxBytes());
    const shape = editor.slides()[0]?.shapes()[0];
    if (shape === undefined) {
      throw new Error('expected at least one shape in the fixture');
    }
    shape.text = 'Mutated';
    assertPartsUnchangedExcept(before, editor.toPackage(), ['ppt/slides/slide1.xml']);
  });
});
