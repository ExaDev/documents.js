import { describe, expect, it } from 'vitest';
import type { ContentDrawPage, ContentParagraph, ContentShape, ContentSheet, LayoutDocument, LayoutImage, LayoutImageAsset, LayoutItem, LayoutPage, LayoutText } from 'document-content-model';
import { STANDARD_METRICS } from '../pdf/afm-widths';
import { reconstructDrawing, reconstructPresentation, reconstructSpreadsheet, reconstructWordprocessing } from './reconstruct';

const RED = { r: 1, g: 0, b: 0 };
const BLACK = { r: 0, g: 0, b: 0 };

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

function line(x1Pt: number, y1Pt: number, x2Pt: number, y2Pt: number): LayoutItem {
  return { kind: 'line', x1Pt, y1Pt, x2Pt, y2Pt, color: BLACK, widthPt: 0.5 };
}

// The shape a REAL gridline actually takes after a genuine PDF round trip -- writeLine's own m/l/S sequence reads back through interpret.ts's general path tracking as a single-subpath, single-line-segment, stroke-only LayoutPath, never a LayoutLine (readPdf never reconstructs a 'line' kind item at all). Used by the "recovered as paths" test below to prove detectGridLattice accepts this shape too, not only the hand-built LayoutLine items the other tests use for brevity.
function strokedLinePath(x1Pt: number, y1Pt: number, x2Pt: number, y2Pt: number): LayoutItem {
  return { kind: 'path', subpaths: [{ startXPt: x1Pt, startYPt: y1Pt, closed: false, segments: [{ kind: 'line', xPt: x2Pt, yPt: y2Pt }] }], stroke: { color: BLACK, widthPt: 0.5 } };
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

function drawPages(doc: ReturnType<typeof reconstructDrawing>): ContentDrawPage[] {
  if (doc.kind !== 'drawing') {
    throw new Error('expected a drawing document');
  }
  return doc.pages;
}

describe('reconstructDrawing: vector mapping', () => {
  it('maps a LayoutRect to a rect ContentVector via the exact flipY inverse', () => {
    const item: LayoutItem = { kind: 'rect', xPt: 20, yPt: 30, widthPt: 100, heightPt: 40, fill: RED };
    const doc = reconstructDrawing(docFrom([page(400, 300, [item])]));
    const [pg] = drawPages(doc);
    expect(pg!.vectors).toEqual([{ kind: 'rect', frame: { xPt: 20, yPt: 230, widthPt: 100, heightPt: 40 }, fill: RED, stroke: undefined, sourcePath: undefined }]); // yPt = 300 - 30 - 40
  });

  it('maps a LayoutEllipse to an ellipse ContentVector via the exact flipY inverse', () => {
    const item: LayoutItem = { kind: 'ellipse', xPt: 50, yPt: 60, widthPt: 80, heightPt: 20, stroke: { color: BLACK, widthPt: 1 } };
    const doc = reconstructDrawing(docFrom([page(400, 300, [item])]));
    const [pg] = drawPages(doc);
    expect(pg!.vectors).toEqual([{ kind: 'ellipse', frame: { xPt: 50, yPt: 220, widthPt: 80, heightPt: 20 }, fill: undefined, stroke: { color: BLACK, widthPt: 1 }, sourcePath: undefined }]); // yPt = 300 - 60 - 20
  });

  it('maps a LayoutLine to a line ContentVector with a synthesized stroke object', () => {
    const item: LayoutItem = { kind: 'line', x1Pt: 10, y1Pt: 20, x2Pt: 90, y2Pt: 60, color: BLACK, widthPt: 2 };
    const doc = reconstructDrawing(docFrom([page(400, 300, [item])]));
    const [pg] = drawPages(doc);
    expect(pg!.vectors).toEqual([{ kind: 'line', from: { xPt: 10, yPt: 280 }, to: { xPt: 90, yPt: 240 }, stroke: { color: BLACK, widthPt: 2 }, sourcePath: undefined }]); // yPt = 300 - y1Pt/y2Pt
  });

  it('maps a LayoutPath to a path ContentVector with a tight bounding-box frame and localized subpath points', () => {
    const item: LayoutItem = {
      kind: 'path',
      subpaths: [{ startXPt: 50, startYPt: 250, closed: false, segments: [{ kind: 'line', xPt: 150, yPt: 250 }] }],
      fill: RED,
    };
    const doc = reconstructDrawing(docFrom([page(400, 300, [item])]));
    const [pg] = drawPages(doc);
    expect(pg!.vectors).toEqual([
      {
        kind: 'path',
        frame: { xPt: 50, yPt: 50, widthPt: 100, heightPt: 0 }, // bounding box of (50,250) and (150,250) in page-space y-down
        subpaths: [{ start: { xPt: 0, yPt: 0 }, closed: false, segments: [{ kind: 'line', to: { xPt: 100, yPt: 0 } }] }],
        fill: RED,
        fillRule: undefined,
        stroke: undefined,
        sourcePath: undefined,
      },
    ]);
  });

  // A cubic segment's control points are never on the curve itself, but the curve is guaranteed to lie within their convex hull -- so the reconstructed frame must include them, not just the segment's start/end points. Both endpoints here share yPt=0, so a bounding box computed from endpoints alone would collapse to zero height; the control points alone reach yPt=100, which is what this test actually proves is captured.
  it('includes cubic control points in the path bounding frame, not just segment endpoints', () => {
    const item: LayoutItem = {
      kind: 'path',
      subpaths: [{ startXPt: 0, startYPt: 0, closed: false, segments: [{ kind: 'cubic', c1xPt: 0, c1yPt: 100, c2xPt: 100, c2yPt: 100, xPt: 100, yPt: 0 }] }],
    };
    const doc = reconstructDrawing(docFrom([page(200, 100, [item])]));
    const [pg] = drawPages(doc);
    const vector = pg!.vectors[0];
    expect(vector).toMatchObject({ kind: 'path', frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 } });
    expect(vector).toMatchObject({ subpaths: [{ start: { xPt: 0, yPt: 100 }, segments: [{ kind: 'cubic', control1: { xPt: 0, yPt: 0 }, control2: { xPt: 100, yPt: 0 }, to: { xPt: 100, yPt: 100 } }] }] });
  });
});

describe('reconstructDrawing: shape mapping', () => {
  it('maps a LayoutText item to a single-run ContentShape, reusing the same real-AFM frame estimate reconstructPresentation uses', () => {
    const metrics = STANDARD_METRICS.Helvetica;
    const sizePt = 12;
    const item = text({ text: 'X', xPt: 100, yPt: 400, widthPt: 50, sizePt });
    const doc = reconstructDrawing(docFrom([page(960, 540, [item])]));
    const [pg] = drawPages(doc);
    const ascentPt = (metrics.ascender / 1000) * sizePt;
    const descentPt = (Math.abs(metrics.descender) / 1000) * sizePt;
    const expectedTopY = 540 - (400 + ascentPt);
    expect(pg!.shapes).toHaveLength(1);
    const [shape] = pg!.shapes;
    expect(shape!.frame.xPt).toBe(100);
    expect(shape!.frame.yPt).toBeCloseTo(expectedTopY, 6);
    expect(shape!.frame.heightPt).toBeCloseTo(ascentPt + descentPt, 6);
    expect(shape!.frame.widthPt).toBe(50);
    expect(shape).toMatchObject({ insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0, blocks: [{ kind: 'paragraph', runs: [{ text: 'X' }] }] });
  });

  // Unlike reconstructPresentation's own blockToShape (which can merge several LayoutText items into one shape and therefore drops rotation entirely, since no single rotation would be correct for a merged result), reconstructDrawing maps one LayoutText item to exactly one ContentShape, so there is no such ambiguity -- rotation carries straight across, negated, the same LayoutImage counter-clockwise -> ContentShape clockwise convention already established below.
  it("negates a LayoutText item's rotationDeg into ContentShape.rotationDeg, unlike reconstructPresentation's own blockToShape", () => {
    const item: LayoutText = { ...text({ text: 'R', xPt: 50, yPt: 50, widthPt: 20 }), rotationDeg: 30 };
    const doc = reconstructDrawing(docFrom([page(400, 300, [item])]));
    const [pg] = drawPages(doc);
    expect(pg!.shapes[0]!.rotationDeg).toBe(-30);
  });

  it('leaves ContentShape.rotationDeg undefined when the source LayoutText item carries no rotation', () => {
    const item = text({ text: 'Upright', xPt: 50, yPt: 50, widthPt: 40 });
    const doc = reconstructDrawing(docFrom([page(400, 300, [item])]));
    const [pg] = drawPages(doc);
    expect(pg!.shapes[0]!.rotationDeg).toBeUndefined();
  });

  it('maps a LayoutImage item to a ContentShape wrapping a ContentImageBlock, reusing imageToShape unmodified', () => {
    const item = image({ imageId: 'img1', xPt: 50, yPt: 50, widthPt: 80, heightPt: 60 });
    const doc = reconstructDrawing(docFrom([page(400, 300, [item])], { img1: { format: 'png', base64: 'AAAA', widthPx: 10, heightPx: 5 } }));
    const [pg] = drawPages(doc);
    expect(pg!.shapes).toHaveLength(1);
    expect(pg!.shapes[0]!.blocks[0]).toMatchObject({ kind: 'image', format: 'png', base64: 'AAAA' });
  });

  it('skips an image item whose asset is missing from the document image map, without crashing', () => {
    const item = image({ imageId: 'missing', xPt: 50, yPt: 50, widthPt: 80, heightPt: 60 });
    const doc = reconstructDrawing(docFrom([page(400, 300, [item])]));
    const [pg] = drawPages(doc);
    expect(pg!.shapes).toEqual([]);
  });
});

describe('reconstructDrawing: paint order and page structure', () => {
  it("buckets items into vectors/shapes, each array keeping its own items' relative document order", () => {
    const rectA: LayoutItem = { kind: 'rect', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 };
    const rectB: LayoutItem = { kind: 'rect', xPt: 20, yPt: 0, widthPt: 10, heightPt: 10 };
    const textItem = text({ text: 'Label', xPt: 0, yPt: 100, widthPt: 40 });
    const imageItem = image({ imageId: 'img1', xPt: 0, yPt: 50, widthPt: 20, heightPt: 20 });
    const doc = reconstructDrawing(docFrom([page(400, 300, [rectA, textItem, rectB, imageItem])], { img1: { format: 'png', base64: 'AAAA', widthPx: 10, heightPx: 5 } }));
    const [pg] = drawPages(doc);
    expect(pg!.vectors).toHaveLength(2); // rectA then rectB -- the interleaved text/image items are dropped from this array entirely
    expect(pg!.shapes.map((s) => s.blocks[0]!.kind)).toEqual(['paragraph', 'image']); // textItem then imageItem -- the interleaved rects are dropped from this array entirely
  });

  it('drops link items entirely, since a drawing page has no link-equivalent construct', () => {
    const linkItem: LayoutItem = { kind: 'link', uri: 'https://example.com', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 };
    const doc = reconstructDrawing(docFrom([page(400, 300, [linkItem])]));
    const [pg] = drawPages(doc);
    expect(pg!.vectors).toEqual([]);
    expect(pg!.shapes).toEqual([]);
  });

  it("uses each source page's own widthPt/heightPt directly as ContentDrawPage.size, one page per LayoutPage", () => {
    const doc = reconstructDrawing(docFrom([page(400, 300, []), page(200, 150, [])]));
    const pgs = drawPages(doc);
    expect(pgs.map((p) => p.size)).toEqual([
      { widthPt: 400, heightPt: 300 },
      { widthPt: 200, heightPt: 150 },
    ]);
  });

  it('carries document metadata through unchanged', () => {
    const doc = reconstructDrawing({ formatVersion: 1, metadata: { title: 'My Drawing' }, pages: [page(400, 300, [])], images: {} });
    expect(doc.metadata).toEqual({ title: 'My Drawing' });
  });
});

describe('reconstructDrawing: empty input and cancellation', () => {
  it('produces an empty page (no vectors, no shapes) for a page with no items', () => {
    const doc = reconstructDrawing(docFrom([page(400, 300, [])]));
    const [pg] = drawPages(doc);
    expect(pg!.vectors).toEqual([]);
    expect(pg!.shapes).toEqual([]);
  });

  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => reconstructDrawing(docFrom([page(400, 300, [])]), { signal: controller.signal })).toThrow();
  });
});

function sheets(doc: ReturnType<typeof reconstructSpreadsheet>): ContentSheet[] {
  if (doc.kind !== 'spreadsheet') {
    throw new Error('expected a spreadsheet document');
  }
  return doc.sheets;
}

// Groups a sheet's own sparse ContentSheetCell[] back into a dense 2D array of displayText, indexed [row][column] -- the natural shape to assert a whole recovered grid against in one expect(...).toEqual(...) call.
function grid(sheet: ContentSheet): string[][] {
  const byRow = new Map<number, string[]>();
  for (const cell of sheet.cells) {
    const row = byRow.get(cell.row) ?? [];
    row[cell.column] = cell.displayText;
    byRow.set(cell.row, row);
  }
  return [...byRow.keys()].sort((a, b) => a - b).map((r) => byRow.get(r)!);
}

describe('reconstructSpreadsheet: gridline lattice detection', () => {
  // Deliberately misaligns each row's own text x-position within its own column (row 0's items sit near the LEFT edge of each column band, row 1's sit near the RIGHT edge) -- text-position clustering alone (COLUMN_ALIGNMENT_TOLERANCE_PT=3) would never merge x=10 and x=90 into the same recovered column, so a correct grouping here is only possible because the drawn gridline lattice's own boundaries -- not text alignment -- decided the columns.
  it('uses a drawn gridline lattice directly as cell boundaries, not text-position clustering', () => {
    const items: LayoutItem[] = [
      // Row boundaries (top=200, middle=150, bottom=100) and column boundaries (left=0, middle=120, right=300).
      line(0, 200, 300, 200),
      line(0, 150, 300, 150),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(120, 100, 120, 200),
      line(300, 100, 300, 200),
      text({ text: 'R0C0', xPt: 10, yPt: 180, widthPt: 30 }),
      text({ text: 'R0C1', xPt: 200, yPt: 180, widthPt: 30 }),
      text({ text: 'R1C0', xPt: 90, yPt: 130, widthPt: 20 }),
      text({ text: 'R1C1', xPt: 130, yPt: 130, widthPt: 20 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.printSettings.gridlines).toBe(true);
    expect(sheet!.columns.map((c) => c.widthPt)).toEqual([120, 180]);
    expect(sheet!.rows.map((r) => r.heightPt)).toEqual([50, 50]);
    expect(grid(sheet!)).toEqual([
      ['R0C0', 'R0C1'],
      ['R1C0', 'R1C1'],
    ]);
  });

  it('drops an item sitting outside the detected lattice entirely, rather than misassigning it to the nearest cell (a header-gutter row/column label, a title above the sheet)', () => {
    const items: LayoutItem[] = [
      line(0, 200, 300, 200),
      line(0, 150, 300, 150),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(120, 100, 120, 200),
      line(300, 100, 300, 200),
      text({ text: 'Title above the grid', xPt: 0, yPt: 280, widthPt: 100 }), // well above the lattice's own top boundary (y=200)
      text({ text: 'R0C0', xPt: 10, yPt: 180, widthPt: 30 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.cells.map((c) => c.displayText)).toEqual(['R0C0']);
  });

  // The real shape a genuine PDF round trip produces: readPdf never reconstructs a LayoutLine, so a written gridline always comes back as a generic single-segment stroked LayoutPath (see this file's own strokedLinePath doc comment above).
  it('detects a lattice built from single-segment stroked LayoutPath items, the shape a real PDF round trip actually produces', () => {
    const items: LayoutItem[] = [
      strokedLinePath(0, 200, 300, 200),
      strokedLinePath(0, 150, 300, 150),
      strokedLinePath(0, 100, 300, 100),
      strokedLinePath(0, 100, 0, 200),
      strokedLinePath(120, 100, 120, 200),
      strokedLinePath(300, 100, 300, 200),
      text({ text: 'A', xPt: 10, yPt: 180, widthPt: 10 }),
      text({ text: 'B', xPt: 200, yPt: 180, widthPt: 10 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.printSettings.gridlines).toBe(true);
    expect(grid(sheet!)).toEqual([['A', 'B']]);
  });

  it('does not detect a lattice from too few parallel lines (a page border, not a printed grid)', () => {
    const items: LayoutItem[] = [
      line(0, 200, 300, 200),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(300, 100, 300, 200),
      text({ text: 'Solo', xPt: 10, yPt: 180, widthPt: 30 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.printSettings.gridlines).toBe(false);
  });
});

describe('reconstructSpreadsheet: text-position column clustering (no gridlines)', () => {
  it('clusters text into a grid via recurring x-position alignment across multiple lines when no gridline lattice is present', () => {
    const items: LayoutItem[] = [
      text({ text: 'Name', xPt: 50, yPt: 200, widthPt: 40 }),
      text({ text: 'Amount', xPt: 150, yPt: 200, widthPt: 50 }),
      text({ text: 'Acme', xPt: 50, yPt: 180, widthPt: 35 }),
      text({ text: '10', xPt: 150, yPt: 180, widthPt: 15 }),
      text({ text: 'Globex', xPt: 50, yPt: 160, widthPt: 45 }),
      text({ text: '20', xPt: 150, yPt: 160, widthPt: 15 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.printSettings.gridlines).toBe(false);
    expect(sheet!.columns).toHaveLength(2);
    expect(sheet!.rows).toHaveLength(3);
    expect(grid(sheet!)).toEqual([
      ['Name', 'Amount'],
      ['Acme', '10'],
      ['Globex', '20'],
    ]);
  });

  it('treats a one-off item at a stray x position as its own column when nothing else recurs there, rather than dropping it', () => {
    const items: LayoutItem[] = [text({ text: 'Solo', xPt: 75, yPt: 200, widthPt: 30 })];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(grid(sheet!)).toEqual([['Solo']]);
  });

  it('joins multiple text items assigned to the same recovered cell with a single space, matching this module\'s own word-gap convention', () => {
    const items: LayoutItem[] = [
      text({ text: 'Hello', xPt: 50, yPt: 200, widthPt: 30 }),
      text({ text: 'World', xPt: 85, yPt: 200, widthPt: 30 }), // gap = 85-(50+30) = 5, > MIN_WORD_GAP_PT -- same cell, space-joined
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.cells[0]!.displayText).toBe('Hello World');
  });

  it('every recovered cell is a bare string value, never re-parsed into a typed value', () => {
    const items: LayoutItem[] = [text({ text: '42.5', xPt: 50, yPt: 200, widthPt: 30 })];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.cells[0]!.value).toEqual({ kind: 'string', value: '42.5' });
  });
});

describe('reconstructSpreadsheet: page size, sheet naming, and metadata', () => {
  it('uses each source page\'s own widthPt/heightPt directly as printSettings.pageSize, one sheet per LayoutPage', () => {
    const doc = reconstructSpreadsheet(docFrom([page(400, 300, []), page(200, 150, [])]));
    const [sheetA, sheetB] = sheets(doc);
    expect(sheetA!.printSettings.pageSize).toEqual({ widthPt: 400, heightPt: 300 });
    expect(sheetB!.printSettings.pageSize).toEqual({ widthPt: 200, heightPt: 150 });
  });

  it('names each sheet Sheet<N> by page index, and carries document metadata through unchanged', () => {
    const doc = reconstructSpreadsheet({ formatVersion: 1, metadata: { title: 'My Sheet' }, pages: [page(400, 300, []), page(400, 300, [])], images: {} });
    expect(sheets(doc).map((s) => s.name)).toEqual(['Sheet1', 'Sheet2']);
    expect(doc.metadata).toEqual({ title: 'My Sheet' });
  });
});

describe('reconstructSpreadsheet: empty input and cancellation', () => {
  it('produces an empty sheet (no cells, columns, or rows) for a page with no items', () => {
    const doc = reconstructSpreadsheet(docFrom([page(400, 300, [])]));
    const [sheet] = sheets(doc);
    expect(sheet).toMatchObject({ cells: [], columns: [], rows: [] });
    expect(sheet!.printSettings.gridlines).toBe(false);
  });

  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => reconstructSpreadsheet(docFrom([page(400, 300, [])]), { signal: controller.signal })).toThrow();
  });
});
