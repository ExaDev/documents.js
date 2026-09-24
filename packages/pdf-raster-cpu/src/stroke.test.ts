import { describe, expect, it } from "vitest";
import {
  dashPolyline,
  strokeOutlinePolygons,
  takesMiterBranch,
  turnsOutwardPositive,
  withNegativeWinding,
} from "./stroke";
import type { FlattenedSubpath } from "./stroke";

// Direct unit tests for the stroke outline geometry, distinct from rasteriser.test.ts's pixel-level assertions: these pin the exact vertex coordinates strokeOutlinePolygons produces for its join and offset arithmetic, including several corner shapes (a right-angle miter, a sharp bevel, a straight run, a closed triangle's own closure) rasteriser.test.ts never constructs.

function subpath(
  points: readonly { readonly x: number; readonly y: number }[],
  closed: boolean,
): FlattenedSubpath {
  return { points, closed };
}

// These three functions each decide one join-wedge boundary from an already-reduced numeric input (a cross product, a miter denominator, a polygon) rather than from n1/n2 or a real corner, exactly so the boundary itself — not just a value near it — can be driven with a literal: a cross product from real unit-vector arithmetic gets arbitrarily close to 0 but next to never lands on it exactly, and a miter denominator landing on the sqrt-based ratio's own exact limit is analytically almost unreachable in double precision (see stroke.ts's own comment on takesMiterBranch).
describe("join-wedge boundary decisions", () => {
  it("names the wedge's outward side positive only when cross is strictly greater than zero", () => {
    const justBelowZero = -0.0001;
    const justAboveZero = 0.0001;
    expect(turnsOutwardPositive(0)).toBe(false);
    expect(turnsOutwardPositive(justBelowZero)).toBe(false);
    expect(turnsOutwardPositive(justAboveZero)).toBe(true);
  });

  it("takes the miter branch at exactly the reduced boundary denominator, and the bevel branch a single ULP short of it", () => {
    // DEFAULT_MITER_LIMIT is 10, so the reduced boundary denominator is 2 / 10**2 = 0.02 exactly (a double both sides of this comparison reach without rounding, unlike the un-reduced sqrt-based ratio).
    const reducedBoundary = 0.02;
    const justBelowBoundary = 0.019999999999999997;
    expect(takesMiterBranch(reducedBoundary)).toBe(true);
    expect(takesMiterBranch(justBelowBoundary)).toBe(false);
    // A zero or negative denominator (n1 and n2 at or past exact opposites) always falls back to a bevel.
    expect(takesMiterBranch(0)).toBe(false);
  });

  it("reverses a polygon whose own signed area is exactly zero, the same as a positive one", () => {
    // Three collinear points: shoelace area is exactly 0 in floating point (no rounding to cancel), the one wedge shape emitJoinWedge itself can never actually build (it always starts from a cross product already forced away from zero).
    const collinear = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(withNegativeWinding(collinear)).toEqual([...collinear].reverse());
    // A polygon already wound negative is returned as-is.
    const negative = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ];
    expect(withNegativeWinding(negative)).toEqual(negative);
  });
});

describe("strokeOutlinePolygons: offset quads", () => {
  it("offsets a straight run's quad by the half-width on both sides, perpendicular to the run", () => {
    const strokeWidth = 4;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          false,
        ),
      ],
      strokeWidth,
      undefined,
    );
    expect(polys).toEqual([
      [
        { x: 0, y: 2 },
        { x: 10, y: 2 },
        { x: 10, y: -2 },
        { x: 0, y: -2 },
      ],
    ]);
  });

  it("offsets a diagonal run's quad along its own perpendicular, not the axes", () => {
    // A 3-4-5 direction (0,0)-(6,8): both components of the unit perpendicular are nonzero, unlike the horizontal run above, so this is what actually distinguishes a sign or a multiply-vs-divide error in either offset component from one an axis-aligned run's own zero component would hide.
    const strokeWidth = 5;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 6, y: 8 },
          ],
          false,
        ),
      ],
      strokeWidth,
      undefined,
    );
    expect(polys).toEqual([
      [
        { x: -2, y: 1.5 },
        { x: 4, y: 9.5 },
        { x: 8, y: 6.5 },
        { x: 2, y: -1.5 },
      ],
    ]);
  });

  it("emits one quad per segment and no join wedge for a straight three-point run", () => {
    const strokeWidth = 4;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
          ],
          false,
        ),
      ],
      strokeWidth,
      undefined,
    );
    expect(polys).toEqual([
      [
        { x: 0, y: 2 },
        { x: 10, y: 2 },
        { x: 10, y: -2 },
        { x: 0, y: -2 },
      ],
      [
        { x: 10, y: 2 },
        { x: 20, y: 2 },
        { x: 20, y: -2 },
        { x: 10, y: -2 },
      ],
    ]);
  });
});

describe("strokeOutlinePolygons: joins", () => {
  it("miters a right-angle corner to the exact standard offset-line intersection", () => {
    const strokeWidth = 2;
    const expectedPolygonCount = 3;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 10, y: 10 },
            { x: 10, y: 60 },
            { x: 60, y: 60 },
          ],
          false,
        ),
      ],
      strokeWidth,
      undefined,
    );
    expect(polys).toHaveLength(expectedPolygonCount);
    // The two segment quads, then the miter wedge as the vertex-order-corrected quadrilateral [a1, miter, a2, vertex].
    expect(polys[2]).toEqual([
      { x: 9, y: 60 },
      { x: 9, y: 61 },
      { x: 10, y: 61 },
      { x: 10, y: 60 },
    ]);
  });

  it("miters a generic, non-axis-aligned corner to the exact computed intersection", () => {
    // before=(0,0), vertex=(10,4), after=(17,15): no component of either direction is zero, so this is the case that actually distinguishes a sign or a multiply-vs-divide error in the normal/offset arithmetic from one that an axis-aligned corner's own zero components can mask.
    const strokeWidth = 3;
    const expectedPolygonCount = 3;
    const wedgeVertexCount = 4;
    const precisionDigits = 5;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 10, y: 4 },
            { x: 17, y: 15 },
          ],
          false,
        ),
      ],
      strokeWidth,
      undefined,
    );
    expect(polys).toHaveLength(expectedPolygonCount);
    const wedge = polys[2];
    expect(wedge).toBeDefined();
    if (wedge === undefined) {
      throw new Error("fixture setup: wedge count already asserted above");
    }
    expect(wedge).toHaveLength(wedgeVertexCount);
    // The wedge is [a1, miter, a2, vertex] or its reverse, whichever carries the same winding orientation as the offset quads — this corner's own geometry picks the reversed order, [vertex, a2, miter, a1].
    const [vertex, a2, miter, a1] = wedge;
    expect(vertex).toEqual({ x: 10, y: 4 });
    const expectedA2X = 11.265492;
    const expectedA2Y = 3.194687;
    const expectedMiterX = 11.005946;
    const expectedMiterY = 2.786829;
    const expectedA1X = 10.557086;
    const expectedA1Y = 2.607285;
    expect(a2?.x).toBeCloseTo(expectedA2X, precisionDigits);
    expect(a2?.y).toBeCloseTo(expectedA2Y, precisionDigits);
    expect(miter?.x).toBeCloseTo(expectedMiterX, precisionDigits);
    expect(miter?.y).toBeCloseTo(expectedMiterY, precisionDigits);
    expect(a1?.x).toBeCloseTo(expectedA1X, precisionDigits);
    expect(a1?.y).toBeCloseTo(expectedA1Y, precisionDigits);
  });

  it("miters a generic corner turning the other way, exercising the wedge's own opposite-sign normal branch", () => {
    // before=(0,0), vertex=(10,4), after=(25,2): the same vertex as the left-turning corner above, but after sits on the other side of the d1-d2 line, giving a negative cross product (a right turn) and taking the opposite branch of the outward-normal choice — the one an axis-aligned right-angle corner's own zero y-component leaves untested.
    const strokeWidth = 3;
    const expectedPolygonCount = 3;
    const wedgeVertexCount = 4;
    const precisionDigits = 5;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 10, y: 4 },
            { x: 25, y: 2 },
          ],
          false,
        ),
      ],
      strokeWidth,
      undefined,
    );
    expect(polys).toHaveLength(expectedPolygonCount);
    const wedge = polys[2];
    expect(wedge).toBeDefined();
    if (wedge === undefined) {
      throw new Error("fixture setup: wedge count already asserted above");
    }
    expect(wedge).toHaveLength(wedgeVertexCount);
    // This corner's own geometry keeps the natural [a1, miter, a2, vertex] order, the mirror image of the left-turning corner's reversed one.
    const [a1, miter, a2, vertex] = wedge;
    expect(vertex).toEqual({ x: 10, y: 4 });
    const expectedA1X = 9.442914;
    const expectedA1Y = 5.392715;
    const expectedMiterX = 9.808235;
    const expectedMiterY = 5.538843;
    const expectedA2X = 10.198246;
    const expectedA2Y = 5.486842;
    expect(a1?.x).toBeCloseTo(expectedA1X, precisionDigits);
    expect(a1?.y).toBeCloseTo(expectedA1Y, precisionDigits);
    expect(miter?.x).toBeCloseTo(expectedMiterX, precisionDigits);
    expect(miter?.y).toBeCloseTo(expectedMiterY, precisionDigits);
    expect(a2?.x).toBeCloseTo(expectedA2X, precisionDigits);
    expect(a2?.y).toBeCloseTo(expectedA2Y, precisionDigits);
  });

  it("falls back to a bevel past the default miter limit, at a corner turning nearly all the way back on itself", () => {
    const turnAngleDegrees = 170;
    const degreesPerHalfTurn = 180;
    const theta = (turnAngleDegrees * Math.PI) / degreesPerHalfTurn;
    const segmentLength = 10;
    const strokeWidth = 4;
    const expectedPolygonCount = 3;
    const bevelWedgeVertexCount = 3;
    const p0 = { x: 0, y: 0 };
    const p1 = { x: segmentLength, y: 0 };
    const p2 = {
      x: p1.x + segmentLength * Math.cos(theta),
      y: p1.y + segmentLength * Math.sin(theta),
    };
    const polys = strokeOutlinePolygons(
      [subpath([p0, p1, p2], false)],
      strokeWidth,
      undefined,
    );
    expect(polys).toHaveLength(expectedPolygonCount);
    const wedge = polys[2];
    // A bevel wedge is the flat triangle [a1, vertex, a2] — three points, never four.
    expect(wedge).toHaveLength(bevelWedgeVertexCount);
  });

  it("still takes the miter branch right at the default miter limit, where the ratio's own sign convention matters", () => {
    // Constructed so the two directions' dot product is exactly -0.98, the mathematical solution of sqrt(2 + 2 * dot) / (1 + dot) = DEFAULT_MITER_LIMIT (a floating-point evaluation of it lands at 9.999999999999996, a hair under the limit rather than exactly on it, since -0.98 has no exact binary representation) — comfortably inside the miter branch under the real formula, but the mirror-image formula sqrt(2 - 2 * dot) / (1 + dot) evaluates to roughly 99.5 at this same dot, which would wrongly force a bevel instead.
    const before = { x: 0, y: 0 };
    const vertex = { x: 10, y: 0 };
    const after = { x: 0.2, y: 1.989974874213242 };
    const strokeWidth = 3;
    const wedgeVertexCount = 4;
    const polys = strokeOutlinePolygons(
      [subpath([before, vertex, after], false)],
      strokeWidth,
      undefined,
    );
    const wedge = polys[2];
    expect(wedge).toHaveLength(wedgeVertexCount);
  });

  it("emits no join wedge for a straight continuation, even one flattened from a curve into two nearly-collinear segments", () => {
    const strokeWidth = 4;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
          ],
          false,
        ),
      ],
      strokeWidth,
      undefined,
    );
    // Only the two segment quads — no third, wedge-shaped polygon.
    expect(polys).toHaveLength(2);
  });

  it("still emits a join wedge exactly at the straight-continuation tolerance boundary, not just strictly past it", () => {
    // d1 = (1, 0) exactly (a horizontal run of length 10, which normalises with no rounding at all); d2 normalises to exactly (1, 1e-12), since hypot(1, 1e-12) itself rounds to exactly 1 at double precision. The resulting cross product, d1.x * d2.y - d1.y * d2.x, reduces to exactly 1e-12 — the literal value the straight-continuation guard compares against with a strict `<`, so a value sitting exactly on that boundary must still be treated as a real (if vanishingly small) corner, not folded into "straight" the way a `<=` would.
    const strokeWidth = 3;
    const expectedPolygonCount = 3;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 11, y: 1e-12 },
          ],
          false,
        ),
      ],
      strokeWidth,
      undefined,
    );
    expect(polys).toHaveLength(expectedPolygonCount);
  });

  it("closes a triangle's own last corner back to its start point", () => {
    const strokeWidth = 2;
    // 3 offset quads (the closing edge back to the start is itself a segment) + 3 join wedges, one of them the closure join this subpath's own start vertex.
    const expectedPolygonCount = 6;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 8 },
          ],
          true,
        ),
      ],
      strokeWidth,
      undefined,
    );
    expect(polys).toHaveLength(expectedPolygonCount);
  });

  it("closes a two-point subpath as a safe no-op rather than a degenerate wedge", () => {
    // The piece walked is [P0, P1, P0] (closed, so the start point is appended again): two quads, one out and one back along the identical line. Both the interior-vertex join at P1 and the separate closure join at P0 see a direction and its own exact reverse — the cross-product-near-zero guard rejects each as a straight (fully reversed) continuation, so neither contributes a wedge. This is what the simplified closure check (no separate points.length >= 3 test) relies on for a subpath this short.
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 3, y: 5 },
            { x: 10, y: -2 },
          ],
          true,
        ),
      ],
      2,
      undefined,
    );
    // Two out-and-back quads, no wedges.
    expect(polys).toHaveLength(2);
  });

  it("closes a one-point subpath as a safe no-op", () => {
    // second (points[1]) is undefined for a single-point subpath, so the closure attempt's own undefined guard skips it before emitJoinWedge is ever called.
    const polys = strokeOutlinePolygons(
      [subpath([{ x: 4, y: 4 }], true)],
      2,
      undefined,
    );
    expect(polys).toEqual([]);
  });
});

// --- Dashing: dashPolyline is exercised only through strokeOutlinePolygons's own dashPx parameter (it is not itself exported), so each test drives a dash pattern over a plain horizontal centreline and reads the resulting quad count and endpoints back off the emitted polygons — each dash "on" piece becomes exactly one offset quad here, so a piece's own start/end x-coordinates are recoverable from its quad's own corners.

function dashedQuadSpans(
  polys: readonly (readonly { readonly x: number; readonly y: number }[])[],
): readonly (readonly [number, number])[] {
  return polys.map((quad) => {
    const p = quad[0];
    const q = quad[1];
    if (p === undefined || q === undefined) {
      throw new Error("fixture setup: every dash piece quad has 4 points");
    }
    return [p.x, q.x];
  });
}

describe("strokeOutlinePolygons: dashing", () => {
  it("paints nothing for an all-zero dash pattern", () => {
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
          ],
          false,
        ),
      ],
      2,
      [0, 0],
    );
    expect(polys).toEqual([]);
  });

  it("doubles an odd-length pattern into two full on/off entries rather than reusing it as a single ever-repeating one", () => {
    // A pattern of just [onLength] must behave as [onLength, onLength] (ISO 32000-1 8.4.3.6): on, off, on, off, all the same length. If the odd-length array were used unchanged, index % pattern.length would always land back on the same (even, "on") entry, and the whole line would paint as one continuous run instead of two pieces with a gap between.
    const onLength = 5;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
          ],
          false,
        ),
      ],
      2,
      [onLength],
    );
    expect(dashedQuadSpans(polys)).toEqual([
      [0, onLength],
      [onLength + onLength, onLength + onLength + onLength],
    ]);
  });

  it("skips a zero-length entry in the pattern rather than pausing on it", () => {
    // [firstOn, 0, secondOn, off]: on, an instantaneous (zero-length) off, on again, then a real off — the zero entry must be passed over in the same boundary transition as the on-run that precedes it, landing directly on the next real "on" length rather than getting stuck unable to advance.
    const firstOn = 5;
    const secondOn = 3;
    const off = 4;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
          ],
          false,
        ),
      ],
      2,
      [firstOn, 0, secondOn, off],
    );
    // The pattern's period is 4 entries [firstOn, 0, secondOn, off]; the third piece wraps back to index 0 and so uses firstOn again, not secondOn.

    const secondPieceEnd = firstOn + secondOn;
    const thirdPieceStart = secondPieceEnd + off;
    const thirdPieceEnd = thirdPieceStart + firstOn;

    const fourthPieceEnd = thirdPieceEnd + secondOn;
    expect(dashedQuadSpans(polys)).toEqual([
      [0, firstOn],
      [firstOn, secondPieceEnd],
      [thirdPieceStart, thirdPieceEnd],
      [thirdPieceEnd, fourthPieceEnd],
    ]);
  });

  it("dashes a closed subpath's own implicit closing edge too", () => {
    const onLength = 4;
    const offLength = 2;
    // Five on-pieces walk the triangle's three real edges plus its closing edge back to the start; two of those pieces straddle a vertex of the triangle itself, each contributing a join wedge alongside its own two segment quads, for seven polygons in total.
    const expectedPolygonCount = 7;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 8 },
          ],
          true,
        ),
      ],
      2,
      [onLength, offLength],
    );
    expect(polys).toHaveLength(expectedPolygonCount);
  });

  it("treats a repeated centreline point as contributing no length, without breaking the dash walk", () => {
    const onLength = 5;
    const offLength = 3;
    const withoutRepeat = dashedQuadSpans(
      strokeOutlinePolygons(
        [
          subpath(
            [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
            ],
            false,
          ),
        ],
        2,
        [onLength, offLength],
      ),
    );
    const withRepeat = dashedQuadSpans(
      strokeOutlinePolygons(
        [
          subpath(
            [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
              { x: 20, y: 0 },
            ],
            false,
          ),
        ],
        2,
        [onLength, offLength],
      ),
    );
    expect(withRepeat).toEqual(withoutRepeat);
  });

  it("discards a one-point dash piece rather than emitting a zero-length quad", () => {
    // A single-point subpath seeds an "on" run (current = [start]) that the main walk never advances, since there is no second point to form a segment from — the trailing piece this leaves behind has just the one seed point, which must be dropped rather than treated as a real piece.
    const dashLength = 10;
    const polys = strokeOutlinePolygons([subpath([{ x: 5, y: 5 }], false)], 2, [
      dashLength,
    ]);
    expect(polys).toEqual([]);
  });

  it("skips a zero-length first entry as a boundary transition, not as a spurious zero-duration on-phase", () => {
    // dashPolyline tested directly: a zero-length first entry must run through the same atBoundary transition as any other exhausted entry (landing on index 1, an off phase, then advancing past it to the real on-phase at index 2) — not be treated as a valid (if empty) on-phase seeded at the very start.
    const firstOn = 3;
    const off = 5;
    const secondOn = 2;
    const pieces = dashPolyline(
      subpath(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
        false,
      ),
      [0, firstOn, off, secondOn],
    );
    expect(pieces).toEqual([
      [
        { x: 3, y: 0 },
        { x: 8, y: 0 },
      ],
      [
        { x: 13, y: 0 },
        { x: 18, y: 0 },
      ],
    ]);
  });

  it("measures a diagonal segment's own length by both endpoints' own y, not one endpoint's alone", () => {
    // A 3-4-5 direction (1,2)-(7,10), length 10, with BOTH endpoints at a nonzero y: the dash pattern [onLength, offLength] must consume exactly onLength units along the diagonal for its first on-piece, landing at (3.4, 5.2). Using to.y + from.y in place of the true difference to.y - from.y would still cancel correctly when either endpoint sits on the x-axis (masking the bug), but here it inflates the segment's own measured length and misplaces every later boundary.
    const onLength = 4;
    const offLength = 3;
    const precisionDigits = 9;
    const pieces = dashPolyline(
      subpath(
        [
          { x: 1, y: 2 },
          { x: 7, y: 10 },
        ],
        false,
      ),
      [onLength, offLength],
    );
    const expectedPieceCount = 2;
    expect(pieces).toHaveLength(expectedPieceCount);
    const [first, second] = pieces;
    expect(first?.[0]).toEqual({ x: 1, y: 2 });
    const expectedFirstEndX = 3.4;
    const expectedFirstEndY = 5.2;
    const expectedSecondStartX = 5.2;
    const expectedSecondStartY = 7.6;
    const expectedSecondEndX = 7;
    const expectedSecondEndY = 10;
    expect(first?.[1]?.x).toBeCloseTo(expectedFirstEndX, precisionDigits);
    expect(first?.[1]?.y).toBeCloseTo(expectedFirstEndY, precisionDigits);
    expect(second?.[0]?.x).toBeCloseTo(expectedSecondStartX, precisionDigits);
    expect(second?.[0]?.y).toBeCloseTo(expectedSecondStartY, precisionDigits);
    expect(second?.[1]?.x).toBeCloseTo(expectedSecondEndX, precisionDigits);
    expect(second?.[1]?.y).toBeCloseTo(expectedSecondEndY, precisionDigits);
  });

  it("never accumulates points into a piece while off, even across several segments of an off phase that outlasts the centreline", () => {
    // [3, 20]: on for 3, then off for 20 — far longer than the remaining 9 units of this 3-segment, 12-unit centreline, so the walk ends mid-off-phase, having stepped through the boundary between every one of the three segments while off. Each of those steps must leave the accumulator empty rather than silently collecting points nobody asked for; if it didn't, the trailing "flush what's left" check would wrongly surface an off-phase run as a genuine second piece.
    const onLength = 3;
    const offLength = 20;
    const pieces = dashPolyline(
      subpath(
        [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 8, y: 0 },
          { x: 12, y: 0 },
        ],
        false,
      ),
      [onLength, offLength],
    );
    expect(pieces).toEqual([
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
      ],
    ]);
  });

  it("emits a piece's own trailing partial run when the centreline ends mid-dash", () => {
    // Centreline against an [onLength, offLength] pattern: on 0-8, off 8-12, on 12-20 — but the line ends six units into that final on-run, which must still surface as a (shorter) piece rather than being dropped for never reaching its own full on-length.
    const onLength = 8;
    const offLength = 4;
    const centrelineLength = 18;
    const polys = strokeOutlinePolygons(
      [
        subpath(
          [
            { x: 0, y: 0 },
            { x: centrelineLength, y: 0 },
          ],
          false,
        ),
      ],
      2,
      [onLength, offLength],
    );
    const secondPieceStart = onLength + offLength;
    expect(dashedQuadSpans(polys)).toEqual([
      [0, onLength],
      [secondPieceStart, centrelineLength],
    ]);
  });
});
