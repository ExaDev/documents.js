import { describe, expect, it } from 'vitest';
import type { ContentBlock, ContentDrawPage, ContentParagraph, ContentShape, ContentSheet, ContentSheetCell, ContentSlide, ContentVector } from 'document-schema.js';
import { STANDARD_METRICS } from 'pdf-codec';
import { drawingOfBlock } from '../model/embedded-drawing';
import type { CellTypeInference } from './cell-typing';
import { reconstructDrawing, reconstructPresentation, reconstructSpreadsheet, reconstructWordprocessing } from './reconstruct';
import type { LayoutDocument, LayoutImage, LayoutImageAsset, LayoutItem, LayoutPage, LayoutText } from 'pdf-codec';

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

// The generic-path shape a stroke can still arrive in when it misses pdf-codec's own LayoutLine shape pattern (several segments in one subpath, or a subpath that is also filled), and the shape every stroke arrived in before that pattern existed. detectGridLattice accepts it alongside a genuine LayoutLine so a hand-built LayoutDocument, an older recorded one, and a freshly round-tripped one all detect identically -- which the "built from stroked LayoutPath items" test below is what actually pins.
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

  // ExaDev/documents.js#584: a heading sits tight above its body at ordinary line spacing, so the gap signal alone glues them into one paragraph -- the observed "**Part 1 Scope **This is body..." merge. A font-size discontinuity between adjacent lines is a third break signal, the same one the presentation direction's own clusterIntoBlocks already refuses to merge across (its fontSizesClose merge condition).
  it('starts a new paragraph at a font-size discontinuity even when the vertical gap alone would not trigger one', () => {
    const pg = page(612, 792, [
      text({ text: 'A Heading', xPt: 50, yPt: 700, widthPt: 80, sizePt: 22 }),
      text({ text: 'body one', xPt: 50, yPt: 688, widthPt: 50 }), // gap 12 = modal spacing, same margin -- only the size differs
      text({ text: 'body two', xPt: 50, yPt: 676, widthPt: 50 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(2);
    expect(paras[0]!.runs.map((r) => r.text).join('')).toBe('A Heading');
    expect(paras[1]!.runs.map((r) => r.text).join('')).toBe('body one body two');
  });

  it('still merges adjacent lines whose sizes differ only within the close tolerance (superscripts, rounding jitter)', () => {
    const pg = page(612, 792, [
      text({ text: 'Same para', xPt: 50, yPt: 700, widthPt: 60, sizePt: 12 }),
      text({ text: 'continues', xPt: 50, yPt: 688, widthPt: 50, sizePt: 12.5 }), // within fontSizesClose's 1pt tolerance
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(1);
  });
});

describe('reconstructWordprocessing: heading inference from font size', () => {
  // The layout engine's own heading render sizes (src/layout/shared.ts HEADING_STYLES: 28/22/18/14pt against a 12pt body) are what this inference must invert, so the fixture mirrors them: two distinct sizes above the body, ranked largest-first into Heading1 and Heading2 -- exactly what a markdownToPdf of '# Title / ## Section / body' draws.
  it('assigns Heading1/Heading2 by rank of distinct sizes above the modal body size', () => {
    const pg = page(612, 792, [
      text({ text: 'The Title', xPt: 50, yPt: 740, widthPt: 90, sizePt: 28 }),
      text({ text: 'body line one', xPt: 50, yPt: 700, widthPt: 80 }),
      text({ text: 'body line two', xPt: 50, yPt: 688, widthPt: 80 }),
      text({ text: 'body line three', xPt: 50, yPt: 676, widthPt: 80 }),
      text({ text: 'A Section', xPt: 50, yPt: 640, widthPt: 70, sizePt: 22 }),
      text({ text: 'more body', xPt: 50, yPt: 620, widthPt: 60 }),
      text({ text: 'even more body', xPt: 50, yPt: 608, widthPt: 70 }),
      text({ text: 'still body', xPt: 50, yPt: 596, widthPt: 60 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras.map((p) => p.styleId)).toEqual(['Heading1', undefined, 'Heading2', undefined]);
  });

  it('leaves body text at the modal size as an ordinary paragraph, however bold', () => {
    const pg = page(612, 792, [
      text({ text: 'Bold but body-sized', xPt: 50, yPt: 700, widthPt: 110, bold: true }),
      text({ text: 'plain body', xPt: 50, yPt: 688, widthPt: 60 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const paras = paragraphs(doc);
    expect(paras).toHaveLength(1);
    expect(paras[0]!.styleId).toBeUndefined();
    expect(paras[0]!.runs[0]!.bold).toBe(true);
  });

  it('drops run-level bold on an inferred heading -- the heading style carries the weight', () => {
    const pg = page(612, 792, [
      text({ text: 'The Title', xPt: 50, yPt: 740, widthPt: 90, sizePt: 28, bold: true }),
      text({ text: 'body line one', xPt: 50, yPt: 700, widthPt: 80 }),
      text({ text: 'body line two', xPt: 50, yPt: 688, widthPt: 80 }),
      text({ text: 'body line three', xPt: 50, yPt: 676, widthPt: 80 }),
    ]);
    const doc = reconstructWordprocessing(docFrom([pg]));
    const [heading] = paragraphs(doc);
    expect(heading!.styleId).toBe('Heading1');
    expect(heading!.runs.every((r) => r.bold !== true)).toBe(true);
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
    expect(pg!.vectors).toEqual([{ kind: 'rect', frame: { xPt: 20, yPt: 230, widthPt: 100, heightPt: 40 }, fill: RED, stroke: undefined, sourcePath: undefined, paintOrder: 0, frames: [{ pageIndex: 0, xPt: 20, yPt: 30, widthPt: 100, heightPt: 40 }] }]); // yPt = 300 - 30 - 40; the vector's own frames carry the exact PDF-space box it was recovered from
  });

  it('maps a LayoutEllipse to an ellipse ContentVector via the exact flipY inverse', () => {
    const item: LayoutItem = { kind: 'ellipse', xPt: 50, yPt: 60, widthPt: 80, heightPt: 20, stroke: { color: BLACK, widthPt: 1 } };
    const doc = reconstructDrawing(docFrom([page(400, 300, [item])]));
    const [pg] = drawPages(doc);
    expect(pg!.vectors).toEqual([{ kind: 'ellipse', frame: { xPt: 50, yPt: 220, widthPt: 80, heightPt: 20 }, fill: undefined, stroke: { color: BLACK, widthPt: 1 }, sourcePath: undefined, paintOrder: 0, frames: [{ pageIndex: 0, xPt: 50, yPt: 60, widthPt: 80, heightPt: 20 }] }]); // yPt = 300 - 60 - 20
  });

  it('maps a LayoutLine to a line ContentVector with a synthesized stroke object', () => {
    const item: LayoutItem = { kind: 'line', x1Pt: 10, y1Pt: 20, x2Pt: 90, y2Pt: 60, color: BLACK, widthPt: 2 };
    const doc = reconstructDrawing(docFrom([page(400, 300, [item])]));
    const [pg] = drawPages(doc);
    expect(pg!.vectors).toEqual([{ kind: 'line', from: { xPt: 10, yPt: 280 }, to: { xPt: 90, yPt: 240 }, stroke: { color: BLACK, widthPt: 2 }, sourcePath: undefined, paintOrder: 0, frames: [{ pageIndex: 0, xPt: 10, yPt: 20, widthPt: 80, heightPt: 40 }] }]); // yPt = 300 - y1Pt/y2Pt; the line's own frame is the bounding box of its two endpoints
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
        paintOrder: 0,
        frames: [{ pageIndex: 0, xPt: 50, yPt: 250, widthPt: 100, heightPt: 0 }],
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

  // A stroke that misses pdf-codec's own LayoutLine shape pattern still arrives as a generic single-segment stroked LayoutPath (see this file's own strokedLinePath doc comment above), and must detect identically to a genuine LayoutLine.
  it('detects a lattice built from single-segment stroked LayoutPath items, not only from genuine LayoutLine items', () => {
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

  it('re-types an unambiguously numeric cell while keeping its own rendered text verbatim', () => {
    const items: LayoutItem[] = [text({ text: '42.5', xPt: 50, yPt: 200, widthPt: 30 })];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.cells[0]!.value).toEqual({ kind: 'number', value: 42.5 });
    expect(sheet!.cells[0]!.displayText).toBe('42.5'); // the printed string is never replaced by the inferred value's own formatting
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

// --- Paint order: reconstructDrawPage stamps the walk position, so an interleaved page survives the round trip ---

describe('reconstructDrawing: shared paintOrder', () => {
  it('stamps a dense, monotonic paintOrder across BOTH arrays in the page\'s own recovered paint order', () => {
    const items: LayoutItem[] = [
      { kind: 'rect', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, fill: RED },
      text({ text: 'Middle', xPt: 5, yPt: 5, widthPt: 30 }),
      { kind: 'rect', xPt: 20, yPt: 0, widthPt: 10, heightPt: 10, fill: RED },
    ];
    const [pg] = drawPages(reconstructDrawing(docFrom([page(400, 300, items)])));
    expect(pg!.vectors.map((v) => v.paintOrder)).toEqual([0, 2]);
    expect(pg!.shapes.map((s) => s.paintOrder)).toEqual([1]);
  });

  it('skips no slot for a dropped link item, keeping the stamped values a dense run over what was actually recovered', () => {
    const items: LayoutItem[] = [
      { kind: 'rect', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, fill: RED },
      { kind: 'link', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, uri: 'https://example.invalid' },
      { kind: 'rect', xPt: 20, yPt: 0, widthPt: 10, heightPt: 10, fill: RED },
    ];
    const [pg] = drawPages(reconstructDrawing(docFrom([page(400, 300, items)])));
    expect(pg!.vectors.map((v) => v.paintOrder)).toEqual([0, 1]);
  });
});

// --- Vector recovery generalized into the wordprocessing/presentation directions -------------------------------

// Both directions carry recovered vectors in a ContentEmbeddedObjectBlock whose nested document is a real one-page drawing document -- the container ContentSection/ContentSlide lack a vectors array of their own. Reading one back out is the same narrowing in both, so both suites share this helper.
function drawingVectorsOf(block: ContentBlock | undefined): ContentVector[] {
  if (block?.kind !== 'embeddedObject') {
    throw new Error(`expected an embeddedObject block, got ${String(block?.kind)}`);
  }
  const document = drawingOfBlock(block);
  if (document === undefined) {
    throw new Error('expected the embedded document to be a drawing document');
  }
  return [...document.pages[0]!.vectors];
}

function blocksOf(doc: ReturnType<typeof reconstructWordprocessing>): ContentBlock[] {
  if (doc.kind !== 'wordprocessing') {
    throw new Error('expected a wordprocessing document');
  }
  return doc.sections.flatMap((s) => s.blocks);
}

function slidesOf(doc: ReturnType<typeof reconstructPresentation>): ContentSlide[] {
  if (doc.kind !== 'presentation') {
    throw new Error('expected a presentation document');
  }
  return [...doc.slides];
}

describe('reconstructWordprocessing: vector recovery', () => {
  it('recovers a page\'s rect/ellipse/line/path geometry as an embedded drawing block, using the same classification reconstructDrawing does', () => {
    const items: LayoutItem[] = [
      text({ text: 'Heading', xPt: 50, yPt: 700, widthPt: 60 }),
      { kind: 'rect', xPt: 50, yPt: 600, widthPt: 100, heightPt: 40, fill: RED },
      { kind: 'ellipse', xPt: 200, yPt: 600, widthPt: 60, heightPt: 30, stroke: { color: BLACK, widthPt: 1 } },
      line(50, 580, 300, 580),
    ];
    const blocks = blocksOf(reconstructWordprocessing(docFrom([page(612, 792, items)])));
    const embedded = blocks.find((b) => b.kind === 'embeddedObject');
    const vectors = drawingVectorsOf(embedded);
    expect(vectors.map((v) => v.kind)).toEqual(['rect', 'ellipse', 'line']);
    // The identical flipY inverse reconstructDrawing applies: yPt = 792 - 600 - 40.
    expect(vectors[0]).toMatchObject({ kind: 'rect', frame: { xPt: 50, yPt: 152, widthPt: 100, heightPt: 40 }, fill: RED, paintOrder: 0 });
    // The text is untouched by vector recovery -- it still clusters into its own paragraph.
    expect(blocks.filter((b) => b.kind === 'paragraph')).toHaveLength(1);
  });

  it('emits no embedded drawing block at all for a page carrying no vector geometry, leaving a text-only page exactly as it was', () => {
    const blocks = blocksOf(reconstructWordprocessing(docFrom([page(612, 792, [text({ text: 'Only text', xPt: 50, yPt: 700, widthPt: 60 })])])));
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph']);
  });

  // The recovered drawing sorts into the page's own block flow by its topmost vector, not pinned to the top or bottom -- so a rule drawn below a paragraph reads after it.
  it('positions the recovered drawing among the page\'s other blocks by its own topmost recovered edge', () => {
    const items: LayoutItem[] = [
      text({ text: 'Above the rule', xPt: 50, yPt: 700, widthPt: 80 }),
      line(50, 650, 300, 650),
      text({ text: 'Below the rule', xPt: 50, yPt: 600, widthPt: 80 }),
    ];
    const blocks = blocksOf(reconstructWordprocessing(docFrom([page(612, 792, items)])));
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'embeddedObject', 'paragraph']);
  });
});

describe('reconstructPresentation: vector recovery', () => {
  it('recovers a slide\'s vector geometry as a backmost shape wrapping an embedded drawing block', () => {
    const items: LayoutItem[] = [
      { kind: 'rect', xPt: 0, yPt: 0, widthPt: 960, heightPt: 540, fill: RED },
      text({ text: 'Title', xPt: 100, yPt: 400, widthPt: 60 }),
    ];
    const [slide] = slidesOf(reconstructPresentation(docFrom([page(960, 540, items)])));
    expect(slide!.shapes).toHaveLength(2);
    // Vectors paint behind everything else, matching drawing.ts's own documented fallback ordering.
    expect(drawingVectorsOf(slide!.shapes[0]!.blocks[0]).map((v) => v.kind)).toEqual(['rect']);
    expect(slide!.shapes[0]!.frame).toEqual({ xPt: 0, yPt: 0, widthPt: 960, heightPt: 540 });
    expect(slide!.shapes[1]!.blocks[0]).toMatchObject({ kind: 'paragraph' });
  });

  it('leaves a text-only slide with exactly the shapes it always had', () => {
    const [slide] = slidesOf(reconstructPresentation(docFrom([page(960, 540, [text({ text: 'Title', xPt: 100, yPt: 400, widthPt: 60 })])])));
    expect(slide!.shapes).toHaveLength(1);
    expect(slide!.shapes[0]!.blocks[0]).toMatchObject({ kind: 'paragraph' });
  });
});

// --- Table recovery, gated on a real drawn gridline lattice ---------------------------------------------------

// The same 3x3 boundary lattice the spreadsheet suite above uses, so the gate is demonstrably the identical detector rather than a second one with its own thresholds.
function latticeItems(): LayoutItem[] {
  return [line(0, 200, 300, 200), line(0, 150, 300, 150), line(0, 100, 300, 100), line(0, 100, 0, 200), line(120, 100, 120, 200), line(300, 100, 300, 200)];
}

describe('reconstructWordprocessing: gridline-gated table recovery', () => {
  it('synthesizes a real table from a drawn lattice, with genuinely measured column widths and row heights', () => {
    const items: LayoutItem[] = [
      ...latticeItems(),
      text({ text: 'Name', xPt: 10, yPt: 180, widthPt: 30 }),
      text({ text: 'Total', xPt: 130, yPt: 180, widthPt: 30 }),
      text({ text: 'Acme', xPt: 10, yPt: 130, widthPt: 30 }),
      text({ text: '10', xPt: 130, yPt: 130, widthPt: 15 }),
    ];
    const blocks = blocksOf(reconstructWordprocessing(docFrom([page(300, 300, items)])));
    const table = blocks.find((b) => b.kind === 'table');
    if (table?.kind !== 'table') {
      throw new Error('expected a recovered table block');
    }
    expect(table.columnWidthsPt).toEqual([120, 180]);
    expect(table.rows.map((r) => r.heightPt)).toEqual([50, 50]);
    expect(table.rows.map((r) => r.cells.map((c) => c.blocks.flatMap((b) => (b.kind === 'paragraph' ? b.runs.map((run) => run.text) : [])).join('')))).toEqual([
      ['Name', 'Total'],
      ['Acme', '10'],
    ]);
  });

  it('does not also emit the table\'s own text as loose paragraphs, nor its own gridlines as loose vectors', () => {
    const items: LayoutItem[] = [...latticeItems(), text({ text: 'Inside', xPt: 10, yPt: 180, widthPt: 30 })];
    const blocks = blocksOf(reconstructWordprocessing(docFrom([page(300, 300, items)])));
    expect(blocks.map((b) => b.kind)).toEqual(['table']);
  });

  it('recovers a vector drawn OUTSIDE the lattice while still excluding the lattice\'s own strokes', () => {
    const items: LayoutItem[] = [...latticeItems(), text({ text: 'Inside', xPt: 10, yPt: 180, widthPt: 30 }), { kind: 'ellipse', xPt: 20, yPt: 250, widthPt: 40, heightPt: 20, fill: RED }];
    const blocks = blocksOf(reconstructWordprocessing(docFrom([page(300, 300, items)])));
    const embedded = blocks.find((b) => b.kind === 'embeddedObject');
    expect(drawingVectorsOf(embedded).map((v) => v.kind)).toEqual(['ellipse']); // the six lattice lines are the table's structure, reported once
  });

  // The whole point of the gate: aligned columns of text with wide gaps are indistinguishable from a tabbed paragraph or a two-column layout, so they must never become a table.
  it('never invents a table from column-aligned text alone, with no lattice drawn', () => {
    const items: LayoutItem[] = [
      text({ text: 'Name', xPt: 50, yPt: 200, widthPt: 40 }),
      text({ text: 'Total', xPt: 200, yPt: 200, widthPt: 40 }),
      text({ text: 'Acme', xPt: 50, yPt: 180, widthPt: 40 }),
      text({ text: '10', xPt: 200, yPt: 180, widthPt: 15 }),
    ];
    const blocks = blocksOf(reconstructWordprocessing(docFrom([page(300, 300, items)])));
    expect(blocks.some((b) => b.kind === 'table')).toBe(false);
    expect(blocks.every((b) => b.kind === 'paragraph')).toBe(true);
  });

  it('rejects a lattice with no text inside it as decoration rather than recovering an empty table', () => {
    const items: LayoutItem[] = [...latticeItems(), text({ text: 'Caption below', xPt: 10, yPt: 40, widthPt: 60 })];
    const blocks = blocksOf(reconstructWordprocessing(docFrom([page(300, 300, items)])));
    expect(blocks.some((b) => b.kind === 'table')).toBe(false);
    // The strokes are still real geometry, so they come back as recovered vectors rather than vanishing.
    expect(drawingVectorsOf(blocks.find((b) => b.kind === 'embeddedObject'))).toHaveLength(6);
  });

  it('does not fire on too few parallel lines, exactly as the spreadsheet direction does not', () => {
    const items: LayoutItem[] = [line(0, 200, 300, 200), line(0, 100, 300, 100), line(0, 100, 0, 200), line(300, 100, 300, 200), text({ text: 'Solo', xPt: 10, yPt: 180, widthPt: 30 })];
    const blocks = blocksOf(reconstructWordprocessing(docFrom([page(300, 300, items)])));
    expect(blocks.some((b) => b.kind === 'table')).toBe(false);
  });

  // A table's borders in real output are drawn per cell edge, not as one line across the whole row (src/layout/shared.ts's own border emission) -- so the detector must union collinear touching segments before measuring a boundary's span, or a multi-column table never reaches the span-consistency bar.
  it('detects a lattice whose boundaries are drawn as per-cell segments rather than full-width lines', () => {
    const items: LayoutItem[] = [
      line(0, 200, 120, 200),
      line(120, 200, 300, 200),
      line(0, 150, 120, 150),
      line(120, 150, 300, 150),
      line(0, 100, 120, 100),
      line(120, 100, 300, 100),
      line(0, 100, 0, 200),
      line(120, 100, 120, 200),
      line(300, 100, 300, 200),
      text({ text: 'Cell', xPt: 10, yPt: 180, widthPt: 30 }),
    ];
    const blocks = blocksOf(reconstructWordprocessing(docFrom([page(300, 300, items)])));
    expect(blocks.some((b) => b.kind === 'table')).toBe(true);
  });
});

describe('reconstructPresentation: gridline-gated table recovery', () => {
  it('wraps a recovered table in a shape framed at the lattice\'s own bounds', () => {
    const items: LayoutItem[] = [...latticeItems(), text({ text: 'Inside', xPt: 10, yPt: 180, widthPt: 30 })];
    const [slide] = slidesOf(reconstructPresentation(docFrom([page(300, 300, items)])));
    const tableShape = slide!.shapes.find((s) => s.blocks[0]?.kind === 'table');
    expect(tableShape).toBeDefined();
    expect(tableShape!.frame).toEqual({ xPt: 0, yPt: 100, widthPt: 300, heightPt: 100 }); // flipY of x 0..300, y 100..200 on a 300pt-tall page
    expect(slide!.shapes.some((s) => s.blocks[0]?.kind === 'paragraph')).toBe(false); // the table's own text is not also a loose text shape
  });
});

// --- Heuristic cell re-typing, reported through the inference sink ---------------------------------------------

describe('reconstructSpreadsheet: heuristic cell re-typing', () => {
  function cellsFor(texts: readonly string[]): { cells: ContentSheetCell[]; inferences: CellTypeInference[] } {
    const items: LayoutItem[] = texts.map((value, i) => text({ text: value, xPt: 50, yPt: 200 - i * 20, widthPt: 40 }));
    const inferences: CellTypeInference[] = [];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]), { onCellTypeInference: (inference) => inferences.push(inference) });
    const [sheet] = sheets(doc);
    return { cells: sheet!.cells, inferences };
  }

  it('re-types confident cells and leaves ambiguous ones as strings, keeping every cell\'s own rendered text either way', () => {
    const { cells } = cellsFor(['42.5', 'TRUE', '2024-01-15', '007', 'Acme Ltd']);
    expect(cells.map((c) => c.value.kind)).toEqual(['number', 'boolean', 'date', 'string', 'string']);
    expect(cells.map((c) => c.displayText)).toEqual(['42.5', 'TRUE', '2024-01-15', '007', 'Acme Ltd']);
  });

  it('reports both outcomes through the sink, so a caller can tell a confident guess from a deliberate refusal', () => {
    const { inferences } = cellsFor(['42.5', '007', 'Acme Ltd']);
    expect(inferences).toEqual([
      { sheetIndex: 0, row: 0, column: 0, displayText: '42.5', outcome: 'retyped', value: { kind: 'number', value: 42.5 }, rule: 'plain-number' },
      { sheetIndex: 0, row: 1, column: 0, displayText: '007', outcome: 'declined', reason: 'leading-zero-digits' },
    ]); // 'Acme Ltd' was never number/date/boolean-shaped, so there was no inference to report at all
  });

  it('keeps the declined cell a plain string carrying the exact text it was declined on', () => {
    const { cells } = cellsFor(['1,234']);
    expect(cells[0]!.value).toEqual({ kind: 'string', value: '1,234' });
  });
});
