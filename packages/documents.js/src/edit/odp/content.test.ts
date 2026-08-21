import { describe, expect, it } from 'vitest';

import type { ContentDocument, ContentVector } from 'document-schema.js';
import type { Package, XmlElement } from 'odf.js';
import { bytesToBase64, childrenWithTag, decodePackage, encodePackage, elementsWithTag, findChildElement, readDrawPageContent, rootElement } from 'odf.js';
import { readOdpContent } from '../../odf/odp/read';
import { rotationsOf, VECTOR_FIXTURE, vectorDrawingBlock, withoutRotation } from '../../test-support/vectors';
import { buildOdpPackage } from './content';
import { OdpEditor } from './editor';

function presentationDoc(slides: Extract<ContentDocument, { kind: 'presentation' }>['slides']): ContentDocument {
  return { kind: 'presentation', metadata: {}, slides };
}

function firstDrawPage(pkg: Package): XmlElement {
  const part = pkg.parts['content.xml'];
  const root = part?.kind === 'xml' ? rootElement(part.nodes) : undefined;
  const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
  const presentation = body === undefined ? undefined : findChildElement(body.children, 'office:presentation');
  const [page] = presentation === undefined ? [] : childrenWithTag(presentation, 'draw:page');
  if (page === undefined) {
    throw new Error('expected an office:presentation/draw:page element');
  }
  return page;
}

// A slide's vectors read back through odf.js's OWN readDrawPageContent -- the same reader readOdgContent uses for a real drawing page, and a genuinely independent oracle rather than an inverse written alongside this package's writer. readOdp itself cannot serve here: ContentSlide has a shapes array and no vectors array at all, which is exactly why buildOdpPackage writes vector primitives as page-level geometry rather than as shapes.
function readSlideVectors(pkg: Package): ContentVector[] {
  return readDrawPageContent(firstDrawPage(pkg).children, pkg).vectors;
}

const ZERO_INSETS = { insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 };

describe('buildOdpPackage', () => {
  it('throws for a wordprocessing ContentDocument', () => {
    expect(() => buildOdpPackage({ kind: 'wordprocessing', metadata: {}, sections: [] })).toThrow(/presentation/);
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

  // A shape text box is not office:text: draw:text-box's content model is (text:p | text:list)* with no text:h anywhere in it, so a paragraph carrying the canonical headingLevel stays the text:p populateParagraph has always written here -- its heading depth is dropped as a format-boundary loss on this target (the same class as odtToOdp's own heading-becomes-slide-boundary heuristic), never written as markup the model forbids and odf.js's own frame reader (typed/draw/shapes.ts) would silently skip.
  it('keeps a heading paragraph in a text box a text:p, since draw:text-box has no text:h', () => {
    const content = presentationDoc([
      {
        size: { widthPt: 960, heightPt: 540 },
        notes: '',
        shapes: [
          {
            frame: { xPt: 10, yPt: 10, widthPt: 400, heightPt: 100 },
            ...ZERO_INSETS,
            blocks: [{ kind: 'paragraph', styleId: 'Heading2', headingLevel: 2, runs: [{ text: 'Slide heading' }] }],
          },
        ],
      },
    ]);
    const pkg = buildOdpPackage(content);
    const part = pkg.parts['content.xml'];
    expect(elementsWithTag(part?.kind === 'xml' ? part.nodes : [], 'text:h')).toHaveLength(0);
    const editor = new OdpEditor(pkg);
    const [slide] = editor.slides();
    const [shape] = slide!.shapes();
    expect(shape?.text).toBe('Slide heading');
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

  it('writes a shape carrying a recovered drawing as real draw: vector primitives that survive a build-then-read round trip', () => {
    const size = { widthPt: 960, heightPt: 540 };
    const content = presentationDoc([
      { size, notes: '', shapes: [{ frame: { xPt: 0, yPt: 0, ...size }, ...ZERO_INSETS, blocks: [vectorDrawingBlock(size)] }] },
    ]);
    // Re-encoded and re-decoded, so what is read back has genuinely been through the zip/XML serialiser rather than being the same in-memory tree the writer produced.
    const pkg = decodePackage(encodePackage(buildOdpPackage(content)));
    const recovered = readSlideVectors(pkg);
    expect(withoutRotation(recovered)).toEqual(withoutRotation(VECTOR_FIXTURE));
    expect(rotationsOf(recovered)).toEqual([undefined, undefined, undefined, undefined, expect.closeTo(30, 4)]);
    // Each vector is page-level geometry on the draw:page itself, not a draw:frame -- and the containing ContentShape adds no empty text box of its own.
    expect(firstDrawPage(pkg).children.filter((child) => child.type === 'element').map((child) => child.tag)).toEqual([
      'draw:rect',
      'draw:ellipse',
      'draw:line',
      'draw:path',
      'draw:rect',
    ]);
  });

  it('recovers a written drawing block back out through readOdpContent, not just through odf.js\'s own readDrawPageContent', () => {
    const size = { widthPt: 960, heightPt: 540 };
    const content = presentationDoc([
      {
        size,
        notes: '',
        shapes: [
          { frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 50 }, ...ZERO_INSETS, blocks: [{ kind: 'paragraph', runs: [{ text: 'Before' }] }] },
          { frame: { xPt: 0, yPt: 0, ...size }, ...ZERO_INSETS, blocks: [vectorDrawingBlock(size)] },
          { frame: { xPt: 10, yPt: 480, widthPt: 200, heightPt: 50 }, ...ZERO_INSETS, blocks: [{ kind: 'paragraph', runs: [{ text: 'After' }] }] },
        ],
      },
    ]);
    const pkg = decodePackage(encodePackage(buildOdpPackage(content)));
    const roundTripped = readOdpContent(pkg);
    if (roundTripped.kind !== 'presentation') {
      throw new Error('expected a presentation ContentDocument');
    }
    const shapes = roundTripped.slides[0]!.shapes;
    expect(shapes.map((shape) => shape.blocks[0]?.kind)).toEqual(['paragraph', 'embeddedObject', 'paragraph']);
    const drawingBlock = shapes[1]?.blocks[0];
    if (drawingBlock?.kind !== 'embeddedObject' || drawingBlock.document.kind !== 'drawing') {
      throw new Error('expected a drawing-kind embeddedObject block');
    }
    expect(withoutRotation(drawingBlock.document.pages[0]?.vectors ?? [])).toEqual(withoutRotation(VECTOR_FIXTURE));
    expect(rotationsOf(drawingBlock.document.pages[0]?.vectors ?? [])).toEqual([undefined, undefined, undefined, undefined, expect.closeTo(30, 4)]);
  });

  it('translates a recovered drawing by its containing shape\'s own frame', () => {
    const size = { widthPt: 960, heightPt: 540 };
    const content = presentationDoc([
      { size, notes: '', shapes: [{ frame: { xPt: 100, yPt: 50, widthPt: 400, heightPt: 300 }, ...ZERO_INSETS, blocks: [vectorDrawingBlock({ widthPt: 400, heightPt: 300 })] }] },
    ]);
    const pkg = decodePackage(encodePackage(buildOdpPackage(content)));
    const [firstVector] = readSlideVectors(pkg);
    const [firstFixture] = VECTOR_FIXTURE;
    if (firstVector?.kind !== 'rect' || firstFixture?.kind !== 'rect') {
      throw new Error('expected the fixture to start with a rect');
    }
    expect(firstVector.frame.xPt).toBeCloseTo(firstFixture.frame.xPt + 100, 6);
    expect(firstVector.frame.yPt).toBeCloseTo(firstFixture.frame.yPt + 50, 6);
  });
});
