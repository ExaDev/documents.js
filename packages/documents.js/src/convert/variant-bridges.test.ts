import type { ContentDocument, ContentDrawPage, ContentParagraph, ContentShape, ContentSlide, ContentVector } from 'document-schema.js';

import { decodePackage as decodeOdfPackage } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { readOdgContent } from '../odf/odg/read';
import { readOdpContent } from '../odf/odp/read';
import { minimalOdgBytes } from '../test-support/odg';
import { minimalOdpBytes } from '../test-support/odp';
import { convertDocument, resolveCompositionPlan } from './composition';
import type { DocumentFormat } from './port';
import { drawingToPresentation, presentationToDrawing } from './variant-bridges';

// The dedicated suite for the drawing <-> presentation content-variant transform. ContentShape is the identical type in both ContentDrawPage.shapes and ContentSlide.shapes (the layout engines already share convertShape verbatim), so shapes move across directly; the lossy axes are the ones the target variant has no slot for -- a slide carries no vectors, a draw page carries no notes.

const PAGE_SIZE = { widthPt: 400, heightPt: 300 };

function textShape(text: string): ContentShape {
  return {
    frame: { xPt: 20, yPt: 20, widthPt: 200, heightPt: 40 },
    insetLeftPt: 9.14,
    insetTopPt: 4.57,
    insetRightPt: 9.14,
    insetBottomPt: 4.57,
    blocks: [{ kind: 'paragraph', runs: [{ text }] }],
  };
}

function rectVector(): ContentVector {
  return {
    kind: 'rect',
    frame: { xPt: 20, yPt: 120, widthPt: 120, heightPt: 80 },
    fill: { r: 1, g: 0, b: 0 },
  };
}

function minimalDrawingDoc(): Extract<ContentDocument, { kind: 'drawing' }> {
  const page: ContentDrawPage = { size: PAGE_SIZE, shapes: [textShape('Label')], vectors: [rectVector()] };
  return { kind: 'drawing', metadata: {}, pages: [page] };
}

function minimalPresentationDoc(): Extract<ContentDocument, { kind: 'presentation' }> {
  const slide: ContentSlide = { size: PAGE_SIZE, shapes: [textShape('Slide text')], notes: 'Speaker notes' };
  return { kind: 'presentation', metadata: {}, slides: [slide] };
}

describe('drawingToPresentation', () => {
  it('produces a presentation document with one slide per draw page', () => {
    const doc = drawingToPresentation(minimalDrawingDoc());
    expect(doc.kind).toBe('presentation');
    expect(doc.slides).toHaveLength(1);
  });

  it('carries each page\'s shape array through by reference (ContentShape is the identical type on both sides)', () => {
    const source = minimalDrawingDoc();
    const doc = drawingToPresentation(source);
    expect(doc.slides[0]!.shapes).toBe(source.pages[0]!.shapes);
    expect(doc.slides[0]!.shapes[0]).toBe(source.pages[0]!.shapes[0]);
  });

  it('carries the page size through unchanged', () => {
    const doc = drawingToPresentation(minimalDrawingDoc());
    expect(doc.slides[0]!.size).toEqual(PAGE_SIZE);
  });

  it('sets notes to an empty string on every slide (a slide\'s notes field is required)', () => {
    const doc = drawingToPresentation(minimalDrawingDoc());
    expect(doc.slides[0]!.notes).toBe('');
  });

  it('drops vectors (a ContentSlide has no vector slot)', () => {
    const doc = drawingToPresentation(minimalDrawingDoc());
    expect(doc.slides[0]).not.toHaveProperty('vectors');
  });
});

describe('presentationToDrawing', () => {
  it('produces a drawing document with one page per slide', () => {
    const doc = presentationToDrawing(minimalPresentationDoc());
    expect(doc.kind).toBe('drawing');
    expect(doc.pages).toHaveLength(1);
  });

  it('carries each slide\'s shape array through by reference', () => {
    const source = minimalPresentationDoc();
    const doc = presentationToDrawing(source);
    expect(doc.pages[0]!.shapes).toBe(source.slides[0]!.shapes);
    expect(doc.pages[0]!.shapes[0]).toBe(source.slides[0]!.shapes[0]);
  });

  it('carries the slide size through unchanged', () => {
    const doc = presentationToDrawing(minimalPresentationDoc());
    expect(doc.pages[0]!.size).toEqual(PAGE_SIZE);
  });

  it('emits an empty vectors array on every page (a slide carries no vector primitives)', () => {
    const doc = presentationToDrawing(minimalPresentationDoc());
    expect(doc.pages[0]!.vectors).toEqual([]);
  });

  it('drops speaker notes (a ContentDrawPage has no notes field)', () => {
    const doc = presentationToDrawing(minimalPresentationDoc());
    expect(doc.pages[0]).not.toHaveProperty('notes');
  });
});

describe('resolveCompositionPlan: drawing <-> presentation routes as a 1-hop cross-variant bridge', () => {
  // Before this transform was registered, odg <-> odp / odg <-> pptx routed through PDF at cost 6 (odg -> pdf -> odp). The registered drawing <-> presentation transform collapses every drawing-format <-> presentation-format pair to a cost-2 1-hop bridge, the same way wordprocessing <-> presentation already does for docx <-> pptx.
  const drawingPresentationPairs: [DocumentFormat, DocumentFormat][] = [
    ['odg', 'odp'], ['odp', 'odg'],
    ['odg', 'pptx'], ['pptx', 'odg'],
  ];

  for (const [source, target] of drawingPresentationPairs) {
    it(`${source} -> ${target} resolves as a single bridge hop (never through PDF)`, () => {
      const plan = resolveCompositionPlan(source, target);
      expect(plan).toBeDefined();
      expect(plan!.hops).toHaveLength(1);
      expect(plan!.hops[0]!.executor).toBe('bridge');
      expect(plan!.hops[0]!.from).toBe(source);
      expect(plan!.hops[0]!.to).toBe(target);
    });
  }
});

describe('convertDocument: drawing <-> presentation over real fixture bytes', () => {
  function isZip(bytes: Uint8Array<ArrayBuffer>): boolean {
    return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  }

  // Joins every paragraph run's text across a presentation or drawing document's shapes. Throws for the wrong kind so a test targeting the wrong variant fails loudly.
  function shapeRunText(doc: ContentDocument): string {
    const blocks = doc.kind === 'presentation'
      ? doc.slides.flatMap((slide) => slide.shapes).flatMap((shape) => shape.blocks)
      : doc.kind === 'drawing'
        ? doc.pages.flatMap((page) => page.shapes).flatMap((shape) => shape.blocks)
        : [];
    return blocks
      .filter((block): block is ContentParagraph => block.kind === 'paragraph')
      .flatMap((block) => block.runs.map((run) => run.text ?? ''))
      .join('');
  }

  it('odg -> odp produces a real odp whose slides carry the drawing\'s text-frame shape', () => {
    const bytes = convertDocument('odg', 'odp', minimalOdgBytes());
    expect(isZip(bytes)).toBe(true);
    const content = readOdpContent(decodeOdfPackage(bytes));
    if (content.kind !== 'presentation') {
      throw new Error(`expected a presentation ContentDocument, got ${content.kind}`);
    }
    expect(content.slides.length).toBeGreaterThanOrEqual(1);
    expect(shapeRunText(content)).toContain('Label');
  });

  it('odp -> odg produces a real odg whose pages carry the slide\'s text-frame shape', () => {
    const bytes = convertDocument('odp', 'odg', minimalOdpBytes());
    expect(isZip(bytes)).toBe(true);
    const content = readOdgContent(decodeOdfPackage(bytes));
    if (content.kind !== 'drawing') {
      throw new Error(`expected a drawing ContentDocument, got ${content.kind}`);
    }
    expect(content.pages.length).toBeGreaterThanOrEqual(1);
    expect(shapeRunText(content)).toContain('Hello from odp');
  });
});
