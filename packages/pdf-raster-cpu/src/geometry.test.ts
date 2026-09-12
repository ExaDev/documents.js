import { describe, expect, it } from "vitest";
import { flattenCubic } from "./geometry";

// Direct unit tests for the De Casteljau flattening itself, distinct from rasteriser.test.ts's pixel-level assertions: these pin the exact numeric arithmetic (the chord vector, the perpendicular-distance formula, the tolerance comparison, and the recursion depth cap) that the pixel tests only exercise indirectly through one curved fixture.

describe("flattenCubic", () => {
  it("terminates immediately for an exactly collinear cubic, returning just the endpoint", () => {
    // p0 and p1 are offset from the origin in both axes (never 0) so a sign error in the chord vector (d - a computed as d + a) is not accidentally masked by a zero coordinate. c1/c2 sit exactly on the p0-p1 line (at t = 1/3 and 2/3), so the perpendicular distance from each to the chord is exactly zero and the curve is recognised as flat on the first check.
    const p0 = { x: 5, y: 3 };
    const p1 = { x: 45, y: 23 };
    const c1 = { x: 5 + 40 / 3, y: 3 + 20 / 3 };
    const c2 = { x: 5 + 80 / 3, y: 3 + 40 / 3 };
    expect(flattenCubic(p0, c1, c2, p1)).toEqual([p1]);
  });

  it("falls back to a chord length of 1 rather than dividing by zero when the endpoints coincide", () => {
    // p0 === p1 makes the chord vector (0, 0); without the `|| 1` fallback, Math.hypot(0, 0) is 0 and the perpendicular-distance division produces NaN, which never satisfies the <= tolerance check and forces the recursion to run to the depth cap (many extra points) instead of recognising the zero-chord curve as flat in one step, regardless of how far the control points bulge out.
    const p = { x: 5, y: 5 };
    const c1 = { x: 50, y: 50 };
    const c2 = { x: -50, y: 50 };
    expect(flattenCubic(p, c1, c2, p)).toEqual([p]);
  });

  it("flattens a real curved quadrant to the exact reference polyline", () => {
    // The same ellipse-quadrant control points rasteriser.test.ts renders to pixels, but asserted here against the exact flattened points: this is what actually distinguishes a divide from a multiply (or a wrong sign inside the cross-product numerator) in the perpendicular-distance formula, which a purely collinear input cannot (its numerator is zero either way).
    const k = 0.5523;
    const cy = 40;
    const cx = 70;
    const rx = 30;
    const ry = 20;
    const p0 = { x: cx + rx, y: cy };
    const c1 = { x: cx + rx, y: cy + ry * k };
    const c2 = { x: cx + rx * k, y: cy + ry };
    const p1 = { x: cx, y: cy + ry };
    const points = flattenCubic(p0, c1, c2, p1);
    const expected = [
      { x: 99.96096548461915, y: 41.02922418212891 },
      { x: 99.84511840820312, y: 42.044934082031254 },
      { x: 99.65434347534179, y: 43.04587322998047 },
      { x: 99.390525390625, y: 44.030785156250005 },
      { x: 98.65129858398439, y: 45.94750146484375 },
      { x: 97.642515625, y: 47.785031249999996 },
      { x: 96.37925415039064, y: 49.53332275390625 },
      { x: 94.876591796875, y: 51.18232421875 },
      { x: 93.14960620117189, y: 52.721983886718746 },
      { x: 91.21337500000001, y: 54.14225 },
      { x: 89.08297583007814, y: 55.43307080078125 },
      { x: 86.77348632812502, y: 56.58439453125 },
      { x: 84.29998413085939, y: 57.58616943359375 },
      { x: 81.67754687500002, y: 58.42834375 },
      { x: 78.92125219726563, y: 59.10086572265625 },
      { x: 76.04617773437501, y: 59.59368359375 },
      { x: 73.06740112304688, y: 59.89674560546875 },
      { x: 70, y: 60 },
    ];
    expect(points.length).toBe(expected.length);
    for (let i = 0; i < points.length; i++) {
      const actual = points[i];
      const want = expected[i];
      if (actual === undefined || want === undefined) {
        throw new Error("fixture setup: point count already asserted equal");
      }
      expect(actual.x).toBeCloseTo(want.x, 9);
      expect(actual.y).toBeCloseTo(want.y, 9);
    }
  });

  it("treats a distance exactly at the tolerance as flat, and does not subdivide", () => {
    // chordY is 0 here (p0 and p1 share a y), which collapses the perpendicular-distance formula to plain |control.y|: both control points sit at exactly FLATTEN_TOLERANCE_PX, so this pins the <= boundary precisely -- a mutated < or > both reject the boundary case and force at least one extra subdivision.
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    const c1 = { x: 5, y: 0.05 };
    const c2 = { x: 5, y: 0.05 };
    expect(flattenCubic(p0, c1, c2, p1)).toEqual([p1]);
  });

  it("subdivides when only the larger of the two control-point distances exceeds tolerance", () => {
    // c1's distance (0.06) is above tolerance and c2's (0.02) is below it: the flatness check must take the max of the two, not the min, or this curve would be wrongly accepted as flat in one step.
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    const c1 = { x: 5, y: 0.06 };
    const c2 = { x: 5, y: 0.02 };
    const points = flattenCubic(p0, c1, c2, p1);
    expect(points.length).toBeGreaterThan(1);
  });

  it("caps recursion at the documented depth for a curve whose flatness never converges under floating-point precision", () => {
    // At this coordinate scale (~5.6e15) the double-precision ULP is itself larger than FLATTEN_TOLERANCE_PX, so the distance-to-chord measurement never settles below tolerance and only the depth cap terminates the recursion -- a curve that instead relied on the tolerance check alone at ordinary coordinate scales would never exercise this branch, or the depth+1 counter, at all. A mutated depth comparison (>, <, or a forced false) or a depth step of -1 instead of +1 removes the only termination condition this input can reach, and the recursion runs away until it exhausts the call stack.
    const base = 5623413251903491;
    const p0 = { x: base, y: base };
    const p1 = { x: base + 1, y: base };
    const c1 = { x: base + 0.3, y: base + 0.6 };
    const c2 = { x: base + 0.7, y: base - 0.4 };
    const points = flattenCubic(p0, c1, c2, p1);
    // Most branches of the subdivision still converge under tolerance within a few levels once they cover a small enough piece of the curve; only the handful straddling the precision-limited region recurse all the way to the cap. The exact count is this curve's own fixed point, verified once against a reference run of the same algorithm.
    expect(points.length).toBe(17);
  });

  it("caps recursion at the documented depth on the second half of a subdivided curve too", () => {
    // The same precision-limited curve as the previous test, walked in the opposite direction (endpoints and control points swapped): the two recursive calls the subdivision makes are not interchangeable -- each carries its own depth argument -- and the previous test's specific curve happens to only ever drive the FIRST of those two calls deep enough to need the cap. Reversing the curve moves the precision-limited region onto the SECOND call's own side of the split, so this is what actually exercises its depth bookkeeping independently of the first.
    const base = 5623413251903491;
    const p0 = { x: base + 1, y: base };
    const p1 = { x: base, y: base };
    const c1 = { x: base + 0.7, y: base - 0.4 };
    const c2 = { x: base + 0.3, y: base + 0.6 };
    const points = flattenCubic(p0, c1, c2, p1);
    expect(points.length).toBe(17);
  });
});
