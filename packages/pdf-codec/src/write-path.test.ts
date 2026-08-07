import { describe, expect, it } from 'vitest';
import type { LayoutPath, TextMeasurer } from 'document-schema.js';
import type { ContentWriteContext } from './content-write';
import { writeContentStream } from './content-write';

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
    resolveFont: () => ({ kind: 'standard', resourceName: 'F1', standardName: 'Helvetica' }),
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

// The style field (document-schema.js 2.1) only reaches ink through the stroke, so every case below sets one. As everywhere else in this file, each expectation is the FULL emitted operator string: the dash array, its phase, the line cap, and -- for double -- the exact coordinates of BOTH offset copies.
describe('writeContentStream: path -- dashed and dotted stroke style', () => {
  // An open two-segment polyline at 2pt wide, so the derived lengths are clean multiples: 3x the stroke width is 6pt on and 6pt off, 2x is a 4pt dot gap.
  const polyline: LayoutPath = {
    kind: 'path',
    stroke: { color: BLACK, widthPt: 2 },
    subpaths: [{ startXPt: 0, startYPt: 0, closed: false, segments: [{ kind: 'line', xPt: 10, yPt: 0 }, { kind: 'line', xPt: 10, yPt: 10 }] }],
  };

  it('emits [6 6] 0 d before the subpath and resets to [] 0 d after the stroke operator', () => {
    const text = decode(writeContentStream([{ ...polyline, style: 'dashed' }], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n2 w\n[6 6] 0 d\n0 0 m\n10 0 l\n10 10 l\nS\n[] 0 d\n');
  });

  it('emits [0 4] 0 d and a 1 J round cap for dotted, resetting both after the stroke operator', () => {
    const text = decode(writeContentStream([{ ...polyline, style: 'dotted' }], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n2 w\n[0 4] 0 d\n1 J\n0 0 m\n10 0 l\n10 10 l\nS\n[] 0 d\n0 J\n');
  });

  it('keeps the dash pattern set across a filled-and-stroked path\'s single B operator, then resets it', () => {
    const filled: LayoutPath = { ...polyline, fill: RED, style: 'dashed' };
    const text = decode(writeContentStream([filled], fakeContext()).bytes);
    expect(text).toBe('1 0 0 rg\n0 0 0 RG\n2 w\n[6 6] 0 d\n0 0 m\n10 0 l\n10 10 l\nB\n[] 0 d\n');
  });

  // A fill has no on/off lengths to alternate, so there is nothing for a dash array to do to it -- emitting one would only leak a pattern into the rest of the stream for no visible effect here.
  it('emits no dash operators at all for a fill-only path, whatever its style says', () => {
    const fillOnly: LayoutPath = { kind: 'path', fill: RED, style: 'dashed', subpaths: [{ startXPt: 0, startYPt: 0, closed: true, segments: [{ kind: 'line', xPt: 10, yPt: 0 }, { kind: 'line', xPt: 5, yPt: 8 }] }] };
    const text = decode(writeContentStream([fillOnly], fakeContext()).bytes);
    expect(text).toBe('1 0 0 rg\n0 0 m\n10 0 l\n5 8 l\nh\nf\n');
  });
});

describe('writeContentStream: path -- double stroke style', () => {
  // 3pt splits into three 1pt bands (ink, gap, ink), so each rule is 1pt wide and offset 1pt either side.
  const STROKE_3PT = { color: BLACK, widthPt: 3 };

  it('draws a straight open path as two 1pt strokes offset 1pt either side', () => {
    const item: LayoutPath = { kind: 'path', stroke: STROKE_3PT, style: 'double', subpaths: [{ startXPt: 0, startYPt: 0, closed: false, segments: [{ kind: 'line', xPt: 10, yPt: 0 }] }] };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n1 w\n0 1 m\n10 1 l\nS\n0 -1 m\n10 -1 l\nS\n');
  });

  // The corner is the case a naive per-segment offset gets wrong: the shared vertex (10,0) has to move along the BISECTOR of the two edges' normals, not along either edge's own, or the two rules stop being parallel through the turn. The bisector of a right angle is 45 degrees, so that vertex moves by 1pt x (1/sqrt(2)) = 0.7071 on each axis, while the two open ends still move along their own single edge normal.
  it('offsets a right-angle corner along the bisector of its two adjacent edge normals', () => {
    const corner: LayoutPath = {
      kind: 'path',
      stroke: STROKE_3PT,
      style: 'double',
      subpaths: [{ startXPt: 0, startYPt: 0, closed: false, segments: [{ kind: 'line', xPt: 10, yPt: 0 }, { kind: 'line', xPt: 10, yPt: 10 }] }],
    };
    const text = decode(writeContentStream([corner], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n1 w\n0 1 m\n9.2929 0.7071 l\n9 10 l\nS\n0 -1 m\n10.7071 -0.7071 l\n11 10 l\nS\n');
  });

  // A closed subpath's implicit closing edge (drawn by 'h') is real ink, so its normal has to reach the two vertices it joins. If it did not, the start and end corners of this square would offset along one edge's normal instead of the bisector, and the inner rule would not close up as a square. Every corner here is a right angle, so every vertex moves 0.7071 on each axis -- inwards for the counter-clockwise winding, giving a smaller square inside a larger one.
  it("folds a closed subpath's implicit closing edge into the start vertex's own bisector", () => {
    const square: LayoutPath = {
      kind: 'path',
      stroke: STROKE_3PT,
      style: 'double',
      subpaths: [{ startXPt: 0, startYPt: 0, closed: true, segments: [{ kind: 'line', xPt: 10, yPt: 0 }, { kind: 'line', xPt: 10, yPt: 10 }, { kind: 'line', xPt: 0, yPt: 10 }] }],
    };
    const text = decode(writeContentStream([square], fakeContext()).bytes);
    expect(text).toBe(
      '0 0 0 RG\n1 w\n' +
        '0.7071 0.7071 m\n9.2929 0.7071 l\n9.2929 9.2929 l\n0.7071 9.2929 l\nh\nS\n' +
        '-0.7071 -0.7071 m\n10.7071 -0.7071 l\n10.7071 10.7071 l\n-0.7071 10.7071 l\nh\nS\n',
    );
  });

  // A cubic's control points have no vertex of their own to bisect at, so they ride their segment's own chord normal -- here the chord (0,0)->(10,0), whose normal is straight up, so both control points move by the full 1pt offset on y.
  it("offsets a cubic's control points along its own chord normal", () => {
    const curve: LayoutPath = {
      kind: 'path',
      stroke: STROKE_3PT,
      style: 'double',
      subpaths: [{ startXPt: 0, startYPt: 0, closed: false, segments: [{ kind: 'cubic', c1xPt: 0, c1yPt: 10, c2xPt: 10, c2yPt: 10, xPt: 10, yPt: 0 }] }],
    };
    const text = decode(writeContentStream([curve], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n1 w\n0 1 m\n0 11 10 11 10 1 c\nS\n0 -1 m\n0 9 10 9 10 -1 c\nS\n');
  });

  // Doubling describes the rule drawn along the path, not the region it encloses: the fill paints once from the original, un-offset geometry, before either rule.
  it('fills once from the original geometry, then strokes the two offset copies', () => {
    const filled: LayoutPath = {
      kind: 'path',
      fill: BLUE,
      stroke: STROKE_3PT,
      style: 'double',
      subpaths: [{ startXPt: 0, startYPt: 0, closed: true, segments: [{ kind: 'line', xPt: 10, yPt: 0 }, { kind: 'line', xPt: 10, yPt: 10 }, { kind: 'line', xPt: 0, yPt: 10 }] }],
    };
    const text = decode(writeContentStream([filled], fakeContext()).bytes);
    expect(text.startsWith('0 0 1 rg\n0 0 m\n10 0 l\n10 10 l\n0 10 l\nh\nf\n0 0 0 RG\n1 w\n')).toBe(true);
    expect((text.match(/\nS\n/g) ?? []).length).toBe(2);
    expect((text.match(/\nf\n/g) ?? []).length).toBe(1);
  });

  // Nothing in the double path leaves a dash pattern or cap set, so a later item in the same stream sees the untouched graphics-state defaults -- verified by the absence of any 'd' or 'J' operator rather than by an explicit reset, since none was ever needed.
  it('emits no dash or cap operators at all, so there is nothing to reset', () => {
    const item: LayoutPath = { kind: 'path', stroke: STROKE_3PT, style: 'double', subpaths: [{ startXPt: 0, startYPt: 0, closed: false, segments: [{ kind: 'line', xPt: 10, yPt: 0 }] }] };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).not.toContain(' d\n');
    expect(text).not.toContain(' J\n');
  });
});
