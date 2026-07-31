import { describe, expect, it } from 'vitest';
import type { LayoutPath } from 'document-content-model';
import type { ContentWriteContext } from './content-write';
import { writeContentStream } from './content-write';
import type { TextMeasurer } from './measure';

// writePath's own dedicated test file, not folded into content-write.test.ts's shared describe blocks -- flagged as the single most error-prone piece of the odg slice (a hand-computed cubic-Bezier content stream is easy to get subtly wrong in a way byte-length or "contains" assertions wouldn't catch), so every case here asserts the FULL, EXACT emitted operator string against a hand-computed expected value, not just a shape/length check.

const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };
const BLACK = { r: 0, g: 0, b: 0 };

function fakeMeasurer(): TextMeasurer {
  return {
    widthOfTextAtSize: () => 0,
    lineHeightAtSize: (_font, sizePt) => sizePt * 1.2,
    ascenderAtSize: (_font, sizePt) => sizePt * 0.8,
    descenderAtSize: (_font, sizePt) => -sizePt * 0.2,
    underlineAtSize: (_font, sizePt) => ({ offsetPt: -sizePt * 0.1, thicknessPt: sizePt * 0.05 }),
    horizontalScaleFor: () => 1,
  };
}

function fakeContext(): ContentWriteContext {
  return {
    measurer: fakeMeasurer(),
    resolveFont: () => ({ resourceName: 'F1', standardName: 'Helvetica' }),
    resolveImage: () => ({ resourceName: 'Im1' }),
  };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe('writeContentStream: path -- triangle (closed, line segments only)', () => {
  // A triangle: (0,0) -> (10,0) -> (5,8), then the third side back to (0,0) drawn by 'h' (closed: true) -- exactly how a real reader represents a closed straight-line polygon (see odf.js's typed/shared/path.ts: rawSubpathFromPoints emits one 'line' segment per point after the first, then leaves closing to the subpath's own closed flag), not a redundant explicit segment back to the start point.
  const item: LayoutPath = {
    kind: 'path',
    fill: RED,
    subpaths: [
      {
        startXPt: 0,
        startYPt: 0,
        closed: true,
        segments: [
          { kind: 'line', xPt: 10, yPt: 0 },
          { kind: 'line', xPt: 5, yPt: 8 },
        ],
      },
    ],
  };

  it('emits rg, m, two l, h, f -- fill-only, nonzero (default) fill rule', () => {
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toBe('1 0 0 rg\n0 0 m\n10 0 l\n5 8 l\nh\nf\n');
  });

  it('emits f* instead of f when fillRule is evenodd', () => {
    const evenOdd: LayoutPath = { ...item, fillRule: 'evenodd' };
    const text = decode(writeContentStream([evenOdd], fakeContext()).bytes);
    expect(text).toBe('1 0 0 rg\n0 0 m\n10 0 l\n5 8 l\nh\nf*\n');
  });
});

describe('writeContentStream: path -- open cubic segment (stroke only)', () => {
  // A single open cubic: moveto (0,0), curveto control1=(0,10) control2=(10,10) endpoint=(10,0) -- an S-curve-ish arc with genuinely distinct, hand-picked control points (not a degenerate straight line or a symmetric shape that would mask a swapped-argument bug).
  const item: LayoutPath = {
    kind: 'path',
    stroke: { color: BLUE, widthPt: 2 },
    subpaths: [
      {
        startXPt: 0,
        startYPt: 0,
        closed: false,
        segments: [{ kind: 'cubic', c1xPt: 0, c1yPt: 10, c2xPt: 10, c2yPt: 10, xPt: 10, yPt: 0 }],
      },
    ],
  };

  it('emits RG, w, m, c (both control points then the endpoint, in that order), S -- no h, since the subpath is open', () => {
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toBe('0 0 1 RG\n2 w\n0 0 m\n0 10 10 10 10 0 c\nS\n');
  });
});

describe('writeContentStream: path -- fill and stroke together', () => {
  const item: LayoutPath = {
    kind: 'path',
    fill: RED,
    stroke: { color: BLACK, widthPt: 1 },
    subpaths: [{ startXPt: 0, startYPt: 0, closed: true, segments: [{ kind: 'line', xPt: 4, yPt: 0 }, { kind: 'line', xPt: 4, yPt: 4 }] }],
  };

  it('emits rg, RG, w, path data, h, B -- nonzero fill rule', () => {
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toBe('1 0 0 rg\n0 0 0 RG\n1 w\n0 0 m\n4 0 l\n4 4 l\nh\nB\n');
  });

  it('emits B* instead of B when fillRule is evenodd', () => {
    const evenOdd: LayoutPath = { ...item, fillRule: 'evenodd' };
    const text = decode(writeContentStream([evenOdd], fakeContext()).bytes);
    expect(text).toBe('1 0 0 rg\n0 0 0 RG\n1 w\n0 0 m\n4 0 l\n4 4 l\nh\nB*\n');
  });
});

describe('writeContentStream: path -- multiple subpaths', () => {
  // Two closed square subpaths sharing one fill/evenodd rule -- the standard "hole punched through a fill" construction (an outer square, an inner square wound the same way, evenodd paints only the region covered an odd number of times, i.e. the ring between them). Verifies both subpaths' full m/l.../h sequences are emitted back to back, with exactly one trailing paint operator for the whole path item, not one per subpath.
  const item: LayoutPath = {
    kind: 'path',
    fill: BLACK,
    fillRule: 'evenodd',
    subpaths: [
      { startXPt: 0, startYPt: 0, closed: true, segments: [{ kind: 'line', xPt: 20, yPt: 0 }, { kind: 'line', xPt: 20, yPt: 20 }, { kind: 'line', xPt: 0, yPt: 20 }] },
      { startXPt: 5, startYPt: 5, closed: true, segments: [{ kind: 'line', xPt: 15, yPt: 5 }, { kind: 'line', xPt: 15, yPt: 15 }, { kind: 'line', xPt: 5, yPt: 15 }] },
    ],
  };

  it('emits both subpaths\' m/l/h sequences before the single trailing f*', () => {
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toBe('0 0 0 rg\n0 0 m\n20 0 l\n20 20 l\n0 20 l\nh\n5 5 m\n15 5 l\n15 15 l\n5 15 l\nh\nf*\n');
  });
});

describe('writeContentStream: path -- neither fill nor stroke', () => {
  it('skips a path with neither fill nor stroke entirely, since it paints nothing, matching writeRect/writeEllipse', () => {
    const item: LayoutPath = {
      kind: 'path',
      subpaths: [{ startXPt: 0, startYPt: 0, closed: true, segments: [{ kind: 'line', xPt: 1, yPt: 1 }] }],
    };
    const bytes = writeContentStream([item], fakeContext()).bytes;
    expect(bytes).toHaveLength(0);
  });
});
