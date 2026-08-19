import { decodePackage, readOdpContent } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { assertAutomaticStylesOnlyAppended } from '../../test-support/odf-style-fidelity';
import { minimalOdpBytes, minimalOdpPackage } from '../../test-support/odp';
import { createOdp, openOdp } from './editor';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe('openOdp / createOdp', () => {
  it('openOdp reads an existing package and exposes its slides/shapes', () => {
    const editor = openOdp(minimalOdpBytes());
    const slides = editor.slides();
    expect(slides).toHaveLength(2);
    // Only the Title frame is a DIRECT child of draw:page -- shapes() (like pptx's own PptxSlide.shapes()) does not flatten a draw:g group's own children into the slide's flat shape list; that flattening is odf.js's own readOdpContent/walkDrawShapes concern (the ContentDocument-reading path), not this live-view editor's.
    expect(slides[0]?.shapes().map((s) => s.name)).toEqual(['Title']);
  });

  it('createOdp starts from a valid, empty, encodable package with zero slides', () => {
    const editor = createOdp();
    expect(editor.slides()).toHaveLength(0);
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });
});

describe('OdpEditor.addSlide / removeSlideAt / moveSlide', () => {
  it('addSlide appends a slide referencing the shared master page, with an empty shape list', () => {
    const editor = createOdp();
    const slide = editor.addSlide();
    expect(slide.shapes()).toHaveLength(0);
    expect(editor.slides()).toHaveLength(1);
    expect(() => editor.toBytes()).not.toThrow();
  });

  it('slides are ordered by document position, matching odf.js\'s own draw:page order (no id indirection to resolve)', () => {
    const editor = createOdp();
    editor.addSlide().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'First' });
    editor.addSlide().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'Second' });
    editor.addSlide().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'Third' });
    expect(editor.slides().map((s) => s.shapes()[0]?.text)).toEqual(['First', 'Second', 'Third']);
  });

  it('addTextBox and addImage add shapes to the correct slide', () => {
    const editor = createOdp();
    const slide = editor.addSlide();
    slide.addTextBox({ frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 }, text: 'Title' });
    slide.addImage({ frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 }, format: 'png', bytes: PNG_BYTES });
    expect(slide.shapes()).toHaveLength(2);
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });

  it('removeSlideAt removes the slide', () => {
    const editor = createOdp();
    editor.addSlide().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'One' });
    editor.addSlide().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'Two' });
    editor.removeSlideAt(0);
    const remaining = editor.slides();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.shapes()[0]?.text).toBe('Two');
  });

  it('moveSlide reorders slides', () => {
    const editor = createOdp();
    editor.addSlide().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'First' });
    editor.addSlide().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'Second' });
    editor.moveSlide(1, 0);
    const texts = editor.slides().map((s) => s.shapes()[0]?.text);
    expect(texts).toEqual(['Second', 'First']);
  });
});

describe('OdpSlide.notes', () => {
  it('defaults to an empty string and round-trips text once set', () => {
    const editor = createOdp();
    const slide = editor.addSlide();
    expect(slide.notes).toBe('');
    slide.notes = 'Speaker notes here';
    expect(slide.notes).toBe('Speaker notes here');
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });

  it('writes multi-line notes as one text:p per line, matching odf.js\'s own readOdpContent (which joins them back with a newline)', () => {
    const editor = createOdp();
    const slide = editor.addSlide();
    slide.notes = 'First line\nSecond line';
    expect(slide.notes).toBe('First line\nSecond line');
    const { slides } = readOdpContent(editor.toPackage());
    expect(slides[0]?.notes).toBe('First line\nSecond line');
  });

  it('updates the existing notes part rather than creating a second one', () => {
    const editor = createOdp();
    const slide = editor.addSlide();
    slide.notes = 'First';
    slide.notes = 'Second';
    expect(slide.notes).toBe('Second');
  });
});

describe('OdpEditor.slideSize', () => {
  it('defaults to the standard 16:9 widescreen size', () => {
    const editor = createOdp();
    expect(editor.slideSize).toEqual({ widthPt: 960, heightPt: 540 });
  });

  it('can be set and read back', () => {
    const editor = createOdp();
    editor.slideSize = { widthPt: 612, heightPt: 792 };
    expect(editor.slideSize).toEqual({ widthPt: 612, heightPt: 792 });
  });
});

describe('live-view fidelity for odp', () => {
  it('styling a newly appended run leaves every existing automatic style entry untouched', () => {
    const before = minimalOdpPackage();
    const editor = openOdp(minimalOdpBytes());
    const shape = editor
      .slides()[0]
      ?.shapes()
      .find((s) => s.name === 'Title');
    if (shape === undefined) {
      throw new Error('expected the fixture to have a shape named Title');
    }
    const paragraph = shape.paragraphs()[0];
    if (paragraph === undefined) {
      throw new Error('expected the Title shape to have at least one paragraph');
    }
    const run = paragraph.appendRun({ text: ' (edited)' });
    run.bold = true;

    const after = editor.toPackage();
    expect(after.parts['content.xml']).not.toEqual(before.parts['content.xml']);
    assertAutomaticStylesOnlyAppended(before, after);
  });
});

describe('full editor round trip: build a presentation from scratch, save, reread via odf.js\'s own readOdpContent', () => {
  it('a new slide, a styled multi-paragraph text box, an image, a rotated shape, and speaker notes all survive, as read by odf.js itself', () => {
    const editor = createOdp();
    const slide = editor.addSlide();

    const textShape = slide.addTextBox({ frame: { xPt: 20, yPt: 20, widthPt: 400, heightPt: 100 }, text: '' });
    textShape.paragraphs()[0]?.remove();
    const titleParagraph = textShape.appendParagraph({ alignment: 'center' });
    const titleRun = titleParagraph.appendRun({ text: 'Freshly built title' });
    titleRun.bold = true;
    titleRun.color = { r: 1, g: 0, b: 0 };
    const bodyParagraph = textShape.appendParagraph();
    bodyParagraph.appendRun({ text: 'Body paragraph', italic: true });

    const imageShape = slide.addImage({ frame: { xPt: 20, yPt: 200, widthPt: 60, heightPt: 60 }, format: 'png', bytes: PNG_BYTES });
    expect(imageShape.frame).toEqual({ xPt: 20, yPt: 200, widthPt: 60, heightPt: 60 });

    const rotatedShape = slide.addTextBox({ frame: { xPt: 300, yPt: 300, widthPt: 100, heightPt: 40 }, text: 'Rotated' });
    rotatedShape.rotationDeg = 45;

    slide.notes = 'These are the freshly written speaker notes.';

    const bytes = editor.toBytes();

    // Reread via THIS package's own live-view editor first (proves the write round-trips through documents.js itself)...
    const reopened = openOdp(bytes);
    const reopenedSlide = reopened.slides()[0];
    if (reopenedSlide === undefined) {
      throw new Error('expected the reopened package to have a slide');
    }
    expect(reopenedSlide.notes).toBe('These are the freshly written speaker notes.');
    const reopenedShapes = reopenedSlide.shapes();
    expect(reopenedShapes.map((s) => s.text)).toContain('Freshly built title\nBody paragraph');
    const reopenedRotated = reopenedShapes.find((s) => s.text === 'Rotated');
    expect(reopenedRotated?.rotationDeg).toBeCloseTo(45, 6);

    // ...then, independently, via odf.js's own readOdpContent -- the actual downstream reader this package's ContentDocument pipeline depends on, proving the written package is genuinely valid ODF, not merely self-consistent with this package's own reader.
    const { slides } = readOdpContent(decodePackage(bytes));
    expect(slides).toHaveLength(1);
    const [readSlide] = slides;
    expect(readSlide?.notes).toBe('These are the freshly written speaker notes.');
    const titleShape = readSlide?.shapes.find((s) => s.blocks.some((b) => b.kind === 'paragraph' && b.runs.some((r) => r.text.includes('Freshly built title'))));
    expect(titleShape).toBeDefined();
    const titleBlock = titleShape?.blocks.find((b) => b.kind === 'paragraph' && b.runs.some((r) => r.text.includes('Freshly built title')));
    if (titleBlock?.kind !== 'paragraph') {
      throw new Error('expected a paragraph block carrying the title text');
    }
    expect(titleBlock.alignment).toBe('center');
    const titleReadRun = titleBlock.runs.find((r) => r.text.includes('Freshly built title'));
    expect(titleReadRun?.bold).toBe(true);
    expect(titleReadRun?.color).toEqual({ r: 1, g: 0, b: 0 });

    const readRotated = readSlide?.shapes.find((s) => s.rotationDeg !== undefined);
    expect(readRotated?.rotationDeg).toBeCloseTo(45, 6);

    const readImage = readSlide?.shapes.find((s) => s.blocks.some((b) => b.kind === 'image'));
    expect(readImage).toBeDefined();
  });
});
