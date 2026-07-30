import { describe, expect, it } from 'vitest';
import { STANDARD_METRICS } from '../pdf/afm-widths';
import type { LayoutDocument, LayoutImage, LayoutImageAsset, LayoutItem, LayoutPage, LayoutText } from '../model/layout';
import type { ContentParagraph, ContentShape } from '../model/content';
import { reconstructPresentation, reconstructWordprocessing } from './reconstruct';

function text(overrides: { text: string; xPt: number; yPt: number; widthPt: number; sizePt?: number; family?: string; bold?: boolean }): LayoutText {
  return {
    kind: 'text',
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: { family: overrides.family ?? 'Helvetica', weight: overrides.bold === true ? 'bold' : 'normal', style: 'normal' },
    sizePt: overrides.sizePt ?? 12,
    color: { r: 0, g: 0, b: 0 },
    widthPt: overrides.widthPt,
  };
}

function image(overrides: { imageId: string; xPt: number; yPt: number; widthPt: number; heightPt: number; rotationDeg?: number }): LayoutImage {
  return { kind: 'image', ...overrides };
}

function page(widthPt: number, heightPt: number, items: LayoutItem[]): LayoutPage {
  return { widthPt, heightPt, items };
}

function docFrom(pages: LayoutPage[], images: Record<string, LayoutImageAsset> = {}): LayoutDocument {
  return { formatVersion: 1, metadata: {}, pages, images };
}

function paragraphs(doc: ReturnType<typeof reconstructWordprocessing>): ContentParagraph[] {
  if (doc.kind !== 'wordprocessing') {
    throw new Error('expected a wordprocessing document');
  }
  return doc.sections.flatMap((s) => s.blocks.filter((b): b is ContentParagraph => b.kind === 'paragraph'));
}

describe('reconstructWordprocessing: paragraph clustering', () => {
  it('joins lines within the modal line spacing into one paragraph, separated by a single space', () => {
    const pg = page(612, 792, [
      text({ text: 'First line', xPt: 50, yPt: 700, widthPt: 60 }),
      text({ text: 'second line', xPt: 50, yPt: 688, widthPt: 66 }),
      text({ text: 'third line', xPt: 50, yPt: 676, widthPt: 60 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(1);
    expect(paras[0]!.runs.map((r) => r.text).join('')).toBe('First line second line third line');
  });

  it('starts a new paragraph when the vertical gap exceeds 1.25x the modal line spacing', () => {
    const pg = page(612, 792, [
      text({ text: 'First line', xPt: 50, yPt: 700, widthPt: 60 }),
      text({ text: 'second line', xPt: 50, yPt: 688, widthPt: 66 }),
      text({ text: 'third line', xPt: 50, yPt: 676, widthPt: 60 }),
      text({ text: 'New paragraph', xPt: 50, yPt: 640, widthPt: 80 }), // gap of 36 vs modal 12
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(2);
    expect(paras[1]!.runs[0]!.text).toContain('New paragraph');
  });

  it('starts a new paragraph on an indent change even when the vertical gap alone would not trigger one', () => {
    const pg = page(612, 792, [
      text({ text: 'Para A', xPt: 50, yPt: 700, widthPt: 40 }),
      text({ text: 'continues', xPt: 50, yPt: 690, widthPt: 50 }), // gap 10, matches modal
      text({ text: 'Indented', xPt: 100, yPt: 680, widthPt: 50 }), // gap 10 (same as modal), but indented 50pt (>1em)
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(2);
    expect(paras[1]!.runs[0]!.text).toContain('Indented');
  });
});

describe('reconstructWordprocessing: runs within a line', () => {
  it('inserts a tab run for a horizontal gap exceeding 2em', () => {
    const pg = page(612, 792, [text({ text: 'Left', xPt: 50, yPt: 700, widthPt: 20 }), text({ text: 'Right', xPt: 100, yPt: 700, widthPt: 20 })]); // gap = 100-70 = 30 > 2*12=24
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(['Left', '\t', 'Right']);
  });

  it('inserts a plain space, not a tab, for ordinary word spacing', () => {
    const pg = page(612, 792, [text({ text: 'Left', xPt: 50, yPt: 700, widthPt: 20 }), text({ text: 'Right', xPt: 75, yPt: 700, widthPt: 20 })]); // gap = 5, well under the 24pt tab threshold
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(['Left ', 'Right']);
  });

  it('does not insert anything for a directly-adjacent item with no real gap (e.g. a styling split mid-word)', () => {
    const pg = page(612, 792, [text({ text: 'un', xPt: 50, yPt: 700, widthPt: 20, bold: true }), text({ text: 'happy', xPt: 70, yPt: 700, widthPt: 40 })]); // gap = 0
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs.map((r) => r.text)).toEqual(['un', 'happy']);
  });

  it('carries font, size, weight, and colour through to the run', () => {
    const pg = page(612, 792, [text({ text: 'Bold text', xPt: 50, yPt: 700, widthPt: 60, sizePt: 24, bold: true, family: 'Times' })]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [para] = paragraphs(doc);
    expect(para!.runs[0]).toMatchObject({ text: 'Bold text', bold: true, fontFamily: 'Times', sizePt: 24 });
  });
});

describe('reconstructWordprocessing: images and page structure', () => {
  it('interleaves an image block by vertical position among paragraphs', () => {
    const pg = page(612, 792, [
      text({ text: 'Above', xPt: 50, yPt: 700, widthPt: 40 }),
      image({ imageId: 'img1', xPt: 50, yPt: 600, widthPt: 100, heightPt: 50 }),
      text({ text: 'Below', xPt: 50, yPt: 500, widthPt: 40 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg], { img1: { format: 'png', base64: 'AAAA', widthPx: 10, heightPx: 5 } }));
    if (doc.kind !== 'wordprocessing') {
      throw new Error('expected wordprocessing');
    }
    const kinds = doc.sections[0]!.blocks.map((b) => b.kind);
    expect(kinds).toEqual(['paragraph', 'image', 'paragraph']);
  });

  it('merges consecutive same-size pages into one section with a page break, and starts a new section for a differently-sized page', () => {
    const doc = reconstructWordprocessing(
      docFrom([
        page(612, 792, [text({ text: 'Page one', xPt: 50, yPt: 700, widthPt: 60 })]),
        page(612, 792, [text({ text: 'Page two', xPt: 50, yPt: 700, widthPt: 60 })]),
        page(300, 300, [text({ text: 'Page three', xPt: 50, yPt: 200, widthPt: 60 })]),
      ]),
    );
    if (doc.kind !== 'wordprocessing') {
      throw new Error('expected wordprocessing');
    }
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]!.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(doc.sections[0]!.blocks.map((b) => b.kind)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
    expect(doc.sections[1]!.pageSize).toEqual({ widthPt: 300, heightPt: 300 });
  });

  it('carries document metadata through unchanged', () => {
    const doc = reconstructWordprocessing({ formatVersion: 1, metadata: { title: 'My Doc', author: 'A. Writer' }, pages: [page(612, 792, [])], images: {} });
    expect(doc.metadata).toEqual({ title: 'My Doc', author: 'A. Writer' });
  });
});

function shapes(doc: ReturnType<typeof reconstructPresentation>): ContentShape[] {
  if (doc.kind !== 'presentation') {
    throw new Error('expected a presentation document');
  }
  return doc.slides.flatMap((s) => s.shapes);
}

describe('reconstructPresentation: block clustering', () => {
  it('merges left-aligned, similarly-sized, closely-spaced lines into one shape with separate paragraphs', () => {
    const pg = page(960, 540, [text({ text: 'Line one', xPt: 100, yPt: 400, widthPt: 60 }), text({ text: 'Line two', xPt: 100, yPt: 386, widthPt: 60 })]); // gap 14, well within 1.25x a 12pt line
    const doc = reconstructPresentation(docFrom([pg]));
    const shapeList = shapes(doc);
    expect(shapeList).toHaveLength(1);
    expect(shapeList[0]!.blocks).toHaveLength(2);
    expect(shapeList[0]!.blocks.map((b) => (b.kind === 'paragraph' ? b.runs[0]!.text : undefined))).toEqual(['Line one', 'Line two']);
  });

  it('keeps misaligned lines as separate shapes', () => {
    const pg = page(960, 540, [text({ text: 'Line one', xPt: 100, yPt: 400, widthPt: 60 }), text({ text: 'Line two', xPt: 300, yPt: 386, widthPt: 60 })]);
    const doc = reconstructPresentation(docFrom([pg]));
    expect(shapes(doc)).toHaveLength(2);
  });

  it('splits a single line into separate shapes across a large horizontal gap', () => {
    const pg = page(960, 540, [text({ text: 'Left', xPt: 50, yPt: 400, widthPt: 20 }), text({ text: 'Right', xPt: 100, yPt: 400, widthPt: 20 })]); // gap 30 > 2*12
    const doc = reconstructPresentation(docFrom([pg]));
    expect(shapes(doc)).toHaveLength(2);
  });

  it('computes the shape frame from real AFM ascent/descent, flipped into slide (top-left, y-down) space', () => {
    const metrics = STANDARD_METRICS.Helvetica;
    const sizePt = 12;
    const item = text({ text: 'X', xPt: 100, yPt: 400, widthPt: 50, sizePt });
    const doc = reconstructPresentation(docFrom([page(960, 540, [item])]));
    const [shape] = shapes(doc);
    const ascentPt = (metrics.ascender / 1000) * sizePt;
    const descentPt = (Math.abs(metrics.descender) / 1000) * sizePt;
    const expectedTopY = 540 - (400 + ascentPt);
    expect(shape!.frame.xPt).toBe(100);
    expect(shape!.frame.yPt).toBeCloseTo(expectedTopY, 6);
    expect(shape!.frame.heightPt).toBeCloseTo(ascentPt + descentPt, 6);
    expect(shape!.frame.widthPt).toBe(50);
  });

  it('zeroes every inset', () => {
    const doc = reconstructPresentation(docFrom([page(960, 540, [text({ text: 'X', xPt: 100, yPt: 400, widthPt: 20 })])]));
    const [shape] = shapes(doc);
    expect(shape).toMatchObject({ insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 });
  });
});

describe('reconstructPresentation: images', () => {
  it('places an image shape before text shapes in z-order', () => {
    const pg = page(960, 540, [text({ text: 'Text', xPt: 100, yPt: 400, widthPt: 40 }), image({ imageId: 'img1', xPt: 200, yPt: 200, widthPt: 80, heightPt: 60 })]);
    const doc = reconstructPresentation(docFrom([pg], { img1: { format: 'png', base64: 'AAAA', widthPx: 10, heightPx: 5 } }));
    const shapeList = shapes(doc);
    expect(shapeList).toHaveLength(2);
    expect(shapeList[0]!.blocks[0]).toMatchObject({ kind: 'image' });
    expect(shapeList[1]!.blocks[0]).toMatchObject({ kind: 'paragraph' });
  });

  it('negates rotation converting from LayoutImage\'s counter-clockwise convention to ContentShape\'s clockwise convention', () => {
    const pg = page(960, 540, [image({ imageId: 'img1', xPt: 100, yPt: 100, widthPt: 50, heightPt: 50, rotationDeg: 30 })]);
    const doc = reconstructPresentation(docFrom([pg], { img1: { format: 'png', base64: 'AAAA', widthPx: 10, heightPx: 5 } }));
    const [shape] = shapes(doc);
    expect(shape!.rotationDeg).toBe(-30);
  });

  it('skips an image item whose asset is missing from the document image map, without crashing', () => {
    const pg = page(960, 540, [image({ imageId: 'missing', xPt: 100, yPt: 100, widthPt: 50, heightPt: 50 })]);
    const doc = reconstructPresentation(docFrom([pg]));
    expect(shapes(doc)).toEqual([]);
  });
});

describe('reconstruct: empty input', () => {
  it('produces an empty section for a page with no items', () => {
    const doc = reconstructWordprocessing(docFrom([page(612, 792, [])]));
    if (doc.kind !== 'wordprocessing') {
      throw new Error('expected wordprocessing');
    }
    expect(doc.sections[0]!.blocks).toEqual([]);
  });

  it('produces an empty slide for a page with no items', () => {
    const doc = reconstructPresentation(docFrom([page(960, 540, [])]));
    if (doc.kind !== 'presentation') {
      throw new Error('expected presentation');
    }
    expect(doc.slides[0]!.shapes).toEqual([]);
  });
});

describe('reconstruct: cancellation', () => {
  it('reconstructWordprocessing throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => reconstructWordprocessing(docFrom([page(612, 792, [])]), { signal: controller.signal })).toThrow();
  });

  it('reconstructPresentation throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => reconstructPresentation(docFrom([page(960, 540, [])]), { signal: controller.signal })).toThrow();
  });
});
