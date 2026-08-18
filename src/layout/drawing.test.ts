import { describe, expect, it } from 'vitest';
import type { ContentDocument, ContentDrawPage, ContentRun, ContentShape, ContentVector } from 'document-schema.js';

import type { LayoutItem, LayoutPath, TextMeasurer } from 'pdf-codec';
import { convertDrawingToLayout } from './drawing';
import { reconstructDrawing } from './reconstruct';

const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };

// Mirrors src/layout/slides.test.ts's own fakeMeasurer convention exactly: every character is sizePt/10 pt wide, so text-shape wrap/position assertions can be exact.
function fakeMeasurer(): TextMeasurer {
  return {
    widthOfTextAtSize: (text, _font, sizePt) => Array.from(text).length * (sizePt / 10),
    lineHeightAtSize: (_font, sizePt) => sizePt * 1.2,
    ascenderAtSize: (_font, sizePt) => sizePt * 0.8,
    descenderAtSize: (_font, sizePt) => -sizePt * 0.2,
    underlineAtSize: (_font, sizePt) => ({ offsetPt: -sizePt * 0.1, thicknessPt: sizePt * 0.05 }),
    horizontalScaleFor: () => 1,
  };
}

function run(text: string, overrides: Partial<ContentRun> = {}): ContentRun {
  return { text, ...overrides };
}

function textShape(text: string, overrides: Partial<ContentShape> = {}): ContentShape {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [{ kind: 'paragraph', runs: [run(text)] }],
    ...overrides,
  };
}

function page(overrides: Partial<ContentDrawPage> = {}): ContentDrawPage {
  return { size: { widthPt: 400, heightPt: 300 }, shapes: [], vectors: [], ...overrides };
}

function drawingDoc(pages: ContentDrawPage[]): Extract<ContentDocument, { kind: 'drawing' }> {
  return { kind: 'drawing', metadata: {}, pages };
}

function convert(pages: ContentDrawPage[]) {
  return convertDrawingToLayout(drawingDoc(pages), { measurer: fakeMeasurer() }).document;
}

describe('convertDrawingToLayout: rect vector', () => {
  it('flips a rect vector\'s frame from top-left/y-down page space into bottom-left/y-up PDF space', () => {
    const vector: ContentVector = { kind: 'rect', frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 }, fill: RED };
    const layout = convert([page({ vectors: [vector] })]);
    expect(layout.pages[0]?.items).toEqual([{ kind: 'rect', xPt: 10, yPt: 300 - 20 - 40, widthPt: 30, heightPt: 40, fill: RED, stroke: undefined, sourcePath: undefined }]);
  });

  it('carries stroke and sourcePath straight through', () => {
    const vector: ContentVector = { kind: 'rect', frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, stroke: { color: BLACK, widthPt: 2 }, sourcePath: 'pages[0].vectors[0]' };
    const layout = convert([page({ vectors: [vector] })]);
    expect(layout.pages[0]?.items[0]).toMatchObject({ kind: 'rect', stroke: { color: BLACK, widthPt: 2 }, sourcePath: 'pages[0].vectors[0]' });
  });
});

describe('convertDrawingToLayout: ellipse vector', () => {
  it('flips an ellipse vector\'s frame the same way a rect\'s is flipped', () => {
    const vector: ContentVector = { kind: 'ellipse', frame: { xPt: 5, yPt: 5, widthPt: 50, heightPt: 20 }, fill: BLUE };
    const layout = convert([page({ vectors: [vector] })]);
    expect(layout.pages[0]?.items).toEqual([{ kind: 'ellipse', xPt: 5, yPt: 300 - 5 - 20, widthPt: 50, heightPt: 20, fill: BLUE, stroke: undefined, sourcePath: undefined }]);
  });
});

describe('convertDrawingToLayout: line vector', () => {
  it('flips both endpoints\' y independently, leaving x untouched', () => {
    const vector: ContentVector = { kind: 'line', from: { xPt: 0, yPt: 10 }, to: { xPt: 40, yPt: 60 }, stroke: { color: BLACK, widthPt: 3 } };
    const layout = convert([page({ vectors: [vector] })]);
    expect(layout.pages[0]?.items).toEqual([{ kind: 'line', x1Pt: 0, y1Pt: 300 - 10, x2Pt: 40, y2Pt: 300 - 60, color: BLACK, widthPt: 3, sourcePath: undefined }]);
  });
});

describe('convertDrawingToLayout: path vector', () => {
  // The path's own subpath/segment points are LOCAL to the vector's frame (top-left origin, y down, sized to frame.widthPt x frame.heightPt -- ContentVectorSchema's own 'path' variant contract): resolving to PDF-absolute space is frame.xPt/yPt + the local point, then a single flip of the whole page-space point.
  it('resolves a closed subpath\'s line segments through frame offset + page flip together', () => {
    const vector: ContentVector = {
      kind: 'path',
      frame: { xPt: 100, yPt: 50, widthPt: 40, heightPt: 40 },
      subpaths: [{ start: { xPt: 0, yPt: 0 }, closed: true, segments: [{ kind: 'line', to: { xPt: 40, yPt: 0 } }, { kind: 'line', to: { xPt: 20, yPt: 40 } }] }],
      fill: RED,
    };
    const layout = convert([page({ vectors: [vector] })]);
    const item = layout.pages[0]?.items[0];
    expect(item).toEqual({
      kind: 'path',
      subpaths: [
        {
          startXPt: 100 + 0,
          startYPt: 300 - 50 - 0,
          closed: true,
          segments: [
            { kind: 'line', xPt: 100 + 40, yPt: 300 - 50 - 0 },
            { kind: 'line', xPt: 100 + 20, yPt: 300 - 50 - 40 },
          ],
        },
      ],
      fill: RED,
      fillRule: undefined,
      stroke: undefined,
      sourcePath: undefined,
    });
  });

  it('resolves a cubic segment\'s two control points and endpoint identically to a line segment\'s single point', () => {
    const vector: ContentVector = {
      kind: 'path',
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      subpaths: [{ start: { xPt: 0, yPt: 0 }, closed: false, segments: [{ kind: 'cubic', control1: { xPt: 10, yPt: 20 }, control2: { xPt: 30, yPt: 40 }, to: { xPt: 50, yPt: 60 } }] }],
      fillRule: 'evenodd',
    };
    const layout = convert([page({ vectors: [vector] })]);
    const item = layout.pages[0]?.items[0];
    expect(item).toMatchObject({
      kind: 'path',
      fillRule: 'evenodd',
      subpaths: [
        {
          startXPt: 0,
          startYPt: 300,
          closed: false,
          segments: [{ kind: 'cubic', c1xPt: 10, c1yPt: 300 - 20, c2xPt: 30, c2yPt: 300 - 40, xPt: 50, yPt: 300 - 60 }],
        },
      ],
    });
  });

  it('resolves every subpath in a multi-subpath path', () => {
    const vector: ContentVector = {
      kind: 'path',
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      subpaths: [
        { start: { xPt: 0, yPt: 0 }, closed: true, segments: [{ kind: 'line', to: { xPt: 10, yPt: 0 } }] },
        { start: { xPt: 5, yPt: 5 }, closed: true, segments: [{ kind: 'line', to: { xPt: 8, yPt: 5 } }] },
      ],
    };
    const layout = convert([page({ vectors: [vector] })]);
    const item = layout.pages[0]?.items[0];
    if (item?.kind !== 'path') {
      throw new Error('expected a path item');
    }
    expect(item.subpaths).toHaveLength(2);
  });
});

describe('convertDrawingToLayout: paint order', () => {
  it('paints every vector before every shape, per the documented vectors-first convention', () => {
    const rectVector: ContentVector = { kind: 'rect', frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, fill: RED };
    const shape = textShape('Label');
    const layout = convert([page({ shapes: [shape], vectors: [rectVector] })]);
    expect(layout.pages[0]?.items.map((item) => item.kind)).toEqual(['rect', 'text']);
  });

  it('preserves each array\'s own internal document order (already paint-ordered by the reader)', () => {
    const back: ContentVector = { kind: 'rect', frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, fill: RED };
    const front: ContentVector = { kind: 'rect', frame: { xPt: 5, yPt: 5, widthPt: 10, heightPt: 10 }, fill: BLUE };
    const layout = convert([page({ vectors: [back, front] })]);
    const items = layout.pages[0]?.items ?? [];
    expect(items.map((item) => (item.kind === 'rect' ? item.fill : undefined))).toEqual([RED, BLUE]);
  });

  it('reuses convertShape verbatim for a ContentShape\'s text content, matching pptx/odp output', () => {
    const layout = convert([page({ shapes: [textShape('Drawing')] })]);
    const text = layout.pages[0]?.items.find((item) => item.kind === 'text');
    expect(text).toMatchObject({ kind: 'text', text: 'Drawing' });
  });
});

describe('convertDrawingToLayout: multiple pages', () => {
  it('produces one LayoutPage per ContentDrawPage, in order', () => {
    const layout = convert([page({ size: { widthPt: 200, heightPt: 100 } }), page({ size: { widthPt: 300, heightPt: 150 } })]);
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]).toMatchObject({ widthPt: 200, heightPt: 100 });
    expect(layout.pages[1]).toMatchObject({ widthPt: 300, heightPt: 150 });
  });
});

// Narrows a recovered LayoutItem to a LayoutPath, failing the test loudly rather than asserting the type -- this repo forbids type assertions anywhere, tests included.
function expectPath(item: LayoutItem | undefined): LayoutPath {
  if (item?.kind !== 'path') {
    throw new Error(`expected a LayoutPath item, got ${item?.kind ?? 'nothing'}`);
  }
  return item;
}

// --- Rotation: a rotated vector resolves into a LayoutPath, since LayoutRect/LayoutEllipse carry no rotation field ---

describe('convertDrawingToLayout: vector rotation', () => {
  // A 90-degree clockwise rotation of a square about its own centre lands every corner exactly on another corner's position, so the rotated result is checkable against exact coordinates rather than a tolerance on arbitrary trigonometry.
  it('turns a rotated rect into a closed four-point LayoutPath whose corners are genuinely rotated about the frame centre', () => {
    const vector: ContentVector = { kind: 'rect', frame: { xPt: 100, yPt: 100, widthPt: 40, heightPt: 20 }, rotationDeg: 90, fill: RED };
    const [item] = convert([page({ vectors: [vector] })]).pages[0]!.items;
    const [subpath] = expectPath(item).subpaths;
    expect(subpath?.closed).toBe(true);
    expect(subpath?.segments).toHaveLength(3); // start point + three line segments == four corners

    // Unrotated PDF-space box is (100, 300-100-20=180, 40, 20), centre (120, 190). Rotating its bottom-left corner (100, 180) 90 degrees clockwise on screen about that centre gives (110, 210).
    expect(subpath?.startXPt).toBeCloseTo(110, 6);
    expect(subpath?.startYPt).toBeCloseTo(210, 6);
    const corners = [{ x: subpath!.startXPt, y: subpath!.startYPt }, ...subpath!.segments.map((s) => ({ x: s.xPt, y: s.yPt }))];
    // Rotation preserves the centroid, and a 90-degree turn swaps the box's own extents.
    expect(corners.reduce((sum, c) => sum + c.x, 0) / 4).toBeCloseTo(120, 6);
    expect(corners.reduce((sum, c) => sum + c.y, 0) / 4).toBeCloseTo(190, 6);
    expect(Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x))).toBeCloseTo(20, 6);
    expect(Math.max(...corners.map((c) => c.y)) - Math.min(...corners.map((c) => c.y))).toBeCloseTo(40, 6);
  });

  it('keeps the plain LayoutRect fast path for an unrotated rect, and for an explicit rotationDeg of 0', () => {
    const unrotated: ContentVector = { kind: 'rect', frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, fill: RED };
    const zero: ContentVector = { kind: 'rect', frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, rotationDeg: 0, fill: RED };
    expect(convert([page({ vectors: [unrotated, zero] })]).pages[0]!.items.map((i) => i.kind)).toEqual(['rect', 'rect']);
  });

  it('turns a rotated ellipse into a LayoutPath of four cubics, still centred on its own frame centre', () => {
    const vector: ContentVector = { kind: 'ellipse', frame: { xPt: 100, yPt: 100, widthPt: 40, heightPt: 20 }, rotationDeg: 30, fill: BLUE };
    const [item] = convert([page({ vectors: [vector] })]).pages[0]!.items;
    const [subpath] = expectPath(item).subpaths;
    expect(subpath?.closed).toBe(true);
    expect(subpath?.segments).toHaveLength(4);
    expect(subpath?.segments.every((s) => s.kind === 'cubic')).toBe(true);

    // The four on-curve axis endpoints stay symmetric about the centre under any rotation, so their own mean is exactly the centre.
    const onCurve = subpath!.segments.map((s) => ({ x: s.xPt, y: s.yPt }));
    expect(onCurve.reduce((sum, p) => sum + p.x, 0) / 4).toBeCloseTo(120, 6);
    expect(onCurve.reduce((sum, p) => sum + p.y, 0) / 4).toBeCloseTo(190, 6);
    // A rotated ellipse's own major axis is still its unrotated one, just turned: the start point sits exactly rx from the centre.
    expect(Math.hypot(subpath!.startXPt - 120, subpath!.startYPt - 190)).toBeCloseTo(20, 6);
  });

  it('keeps the plain LayoutEllipse fast path for an unrotated ellipse', () => {
    const vector: ContentVector = { kind: 'ellipse', frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, fill: BLUE };
    expect(convert([page({ vectors: [vector] })]).pages[0]!.items.map((i) => i.kind)).toEqual(['ellipse']);
  });

  it('rotates a path vector\'s own points about its frame centre, still emitting one LayoutPath', () => {
    const subpaths = [{ start: { xPt: 0, yPt: 0 }, closed: true, segments: [{ kind: 'line' as const, to: { xPt: 40, yPt: 0 } }, { kind: 'line' as const, to: { xPt: 40, yPt: 20 } }] }];
    const plain: ContentVector = { kind: 'path', frame: { xPt: 100, yPt: 100, widthPt: 40, heightPt: 20 }, subpaths, fill: RED };
    const rotated: ContentVector = { ...plain, rotationDeg: 90 };
    const plainPath = expectPath(convert([page({ vectors: [plain] })]).pages[0]!.items[0]);
    const rotatedPath = expectPath(convert([page({ vectors: [rotated] })]).pages[0]!.items[0]);

    // The unrotated path's own start is at the frame's top-left in y-down space -> (100, 300-100=200) in PDF space. Rotating 90 degrees clockwise on screen is a 90-degree clockwise turn in PDF's y-up space too, i.e. (dx, dy) -> (dy, -dx) about the centre (120, 190): (-20, 10) -> (10, 20) -> (130, 210).
    expect(plainPath.subpaths[0]?.startXPt).toBeCloseTo(100, 6);
    expect(plainPath.subpaths[0]?.startYPt).toBeCloseTo(200, 6);
    expect(rotatedPath.subpaths[0]?.startXPt).toBeCloseTo(130, 6);
    expect(rotatedPath.subpaths[0]?.startYPt).toBeCloseTo(210, 6);
  });

  it('rotates a cubic segment\'s control points too, not only its endpoints', () => {
    const subpaths = [{ start: { xPt: 0, yPt: 0 }, closed: false, segments: [{ kind: 'cubic' as const, control1: { xPt: 10, yPt: 0 }, control2: { xPt: 30, yPt: 20 }, to: { xPt: 40, yPt: 20 } }] }];
    const rotated: ContentVector = { kind: 'path', frame: { xPt: 100, yPt: 100, widthPt: 40, heightPt: 20 }, rotationDeg: 90, subpaths, fill: RED };
    const path = expectPath(convert([page({ vectors: [rotated] })]).pages[0]!.items[0]);
    const [segment] = path.subpaths[0]!.segments;
    expect(segment?.kind).toBe('cubic');
    // control1 is at frame-local (10, 0) -> PDF (110, 200); rotated 90 degrees clockwise about (120, 190): (-10, 10) -> (10, 10) -> (130, 200).
    expect(segment).toMatchObject({ kind: 'cubic' });
    if (segment?.kind === 'cubic') {
      expect(segment.c1xPt).toBeCloseTo(130, 6);
      expect(segment.c1yPt).toBeCloseTo(200, 6);
    }
  });
});

// --- Paint order: the shared paintOrder field merges the page's two arrays back into one true order ---

describe('convertDrawingToLayout: shared paintOrder', () => {
  function rect(fill: { r: number; g: number; b: number }, paintOrder?: number): ContentVector {
    return { kind: 'rect', frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, fill, paintOrder };
  }

  it('interleaves shapes and vectors by paintOrder rather than painting every vector first', () => {
    const back = rect(RED, 0);
    const front = rect(BLUE, 2);
    const middle: ContentShape = { ...textShape('Between'), paintOrder: 1 };
    const layout = convert([page({ shapes: [middle], vectors: [back, front] })]);
    expect(layout.pages[0]?.items.map((item) => item.kind)).toEqual(['rect', 'text', 'rect']);
  });

  it('puts a shape genuinely behind a vector when its own paintOrder says so', () => {
    const behind: ContentShape = { ...textShape('Behind'), paintOrder: 0 };
    const over = rect(RED, 1);
    const layout = convert([page({ shapes: [behind], vectors: [over] })]);
    expect(layout.pages[0]?.items.map((item) => item.kind)).toEqual(['text', 'rect']);
  });

  it('falls back to the historical vectors-then-shapes order when any item on the page carries no paintOrder', () => {
    const stamped = rect(RED, 5);
    const unstamped: ContentShape = textShape('Unstamped'); // no paintOrder at all
    const layout = convert([page({ shapes: [unstamped], vectors: [stamped] })]);
    expect(layout.pages[0]?.items.map((item) => item.kind)).toEqual(['rect', 'text']);
  });

  it('keeps each array\'s own relative order for items sharing a paintOrder value', () => {
    const first = rect(RED, 3);
    const second = rect(BLUE, 3);
    const layout = convert([page({ vectors: [first, second] })]);
    const items = layout.pages[0]?.items ?? [];
    expect(items.map((item) => (item.kind === 'rect' ? item.fill : undefined))).toEqual([RED, BLUE]);
  });
});

// The full drawing round trip for paint order specifically: a genuinely interleaved page (vector, shape, vector) survives convertDrawingToLayout -> reconstructDrawing with its interleaving intact, which is only possible because both halves now speak through the shared paintOrder field. Before it existed, the layout pass flattened every page to vectors-then-shapes and the reconstruction bucketed it back the same way, so this exact ordering could not survive at all.
describe('convertDrawingToLayout -> reconstructDrawing: paint order survives the round trip', () => {
  it('preserves a genuinely interleaved vector/shape/vector stack rather than collapsing it to vectors-then-shapes', () => {
    const back: ContentVector = { kind: 'rect', frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 40 }, fill: RED, paintOrder: 0 };
    const middle: ContentShape = { ...textShape('Between'), paintOrder: 1 };
    const front: ContentVector = { kind: 'rect', frame: { xPt: 20, yPt: 20, widthPt: 40, heightPt: 40 }, fill: BLUE, paintOrder: 2 };
    const layout = convert([page({ shapes: [middle], vectors: [back, front] })]);

    const recovered = reconstructDrawing(layout);
    if (recovered.kind !== 'drawing') {
      throw new Error('expected a drawing ContentDocument');
    }
    const recoveredPage = recovered.pages[0]!;
    expect(recoveredPage.vectors.map((v) => v.paintOrder)).toEqual([0, 2]);
    expect(recoveredPage.shapes.map((s) => s.paintOrder)).toEqual([1]);

    // And laying the RECOVERED page out again reproduces the identical interleaving, rather than drifting back to vectors-then-shapes.
    const relaid = convertDrawingToLayout(recovered, { measurer: fakeMeasurer() }).document;
    expect(relaid.pages[0]?.items.map((item) => item.kind)).toEqual(['rect', 'text', 'rect']);
  });
});
