import { describe, expect, it } from "vitest";
import type { ExtractedSubpath } from "./interpret-types";
import {
  closedPolygonCorners,
  detectRect,
  nearlyEqual,
  shapeTolerance,
} from "./interpret-shapes";

// The detection helpers pinned directly on their own boundaries, rather than only through interpreted content streams: each guard below fires at an exact tolerance equality or degenerate extent that no stream-level fixture steers, and the helpers are exported pure functions.
describe("shapeTolerance", () => {
  it("answers the absolute floor for an extent the relative term does not reach", () => {
    expect(shapeTolerance(0)).toBe(0.001);
  });

  it("answers the relative term once the extent outgrows the floor", () => {
    // 100pt * 1e-4 = 0.01pt, ten times the floor.
    expect(shapeTolerance(100)).toBe(0.01);
  });

  it("scales with the extent's own magnitude, negative extents included", () => {
    expect(shapeTolerance(-100)).toBe(0.01);
  });
});

describe("nearlyEqual", () => {
  it("accepts a difference exactly at the tolerance, not only below it", () => {
    // 0.75 - 0.5 = 0.25 exactly in binary floating point, so the comparison sits at the boundary rather than a hair past it through representation error.
    expect(nearlyEqual(0.5, 0.75, 0.25)).toBe(true);
  });

  it("rejects a difference just past the tolerance", () => {
    expect(nearlyEqual(0.5, 0.75 + 1e-9, 0.25)).toBe(false);
  });
});

describe("closedPolygonCorners", () => {
  it("refuses an open subpath outright", () => {
    const subpath: ExtractedSubpath = {
      startXPt: 0,
      startYPt: 0,
      closed: false,
      segments: [],
    };
    expect(closedPolygonCorners(subpath)).toBeUndefined();
  });

  it("refuses a subpath carrying any curve", () => {
    const subpath: ExtractedSubpath = {
      startXPt: 0,
      startYPt: 0,
      closed: true,
      segments: [
        {
          kind: "cubic",
          xPt: 10,
          yPt: 10,
          c1xPt: 3,
          c1yPt: 0,
          c2xPt: 7,
          c2yPt: 10,
        },
      ],
    };
    expect(closedPolygonCorners(subpath)).toBeUndefined();
  });

  it("drops a redundant explicit closing point that repeats the start", () => {
    const subpath: ExtractedSubpath = {
      startXPt: 0,
      startYPt: 0,
      closed: true,
      segments: [
        { kind: "line", xPt: 10, yPt: 0 },
        { kind: "line", xPt: 10, yPt: 5 },
        { kind: "line", xPt: 0, yPt: 0 },
      ],
    };
    const corners = closedPolygonCorners(subpath);
    expect(corners).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it("keeps every stated corner when the closing edge is left implicit", () => {
    const subpath: ExtractedSubpath = {
      startXPt: 0,
      startYPt: 0,
      closed: true,
      segments: [
        { kind: "line", xPt: 10, yPt: 0 },
        { kind: "line", xPt: 10, yPt: 5 },
      ],
    };
    expect(closedPolygonCorners(subpath)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });
});

describe("detectRect degenerate extents", () => {
  it("refuses a closed rectangle whose width sits exactly at its own tolerance", () => {
    // A width of exactly 0.001pt equals the absolute floor (the relative term cannot reach it at this size): a degenerate extent, which must stay a path rather than shrink into a rect with a zero side.
    const subpath: ExtractedSubpath = {
      startXPt: 0,
      startYPt: 0,
      closed: true,
      segments: [
        { kind: "line", xPt: 0.001, yPt: 0 },
        { kind: "line", xPt: 0.001, yPt: 10 },
        { kind: "line", xPt: 0, yPt: 10 },
        { kind: "line", xPt: 0, yPt: 0 },
      ],
    };
    expect(
      detectRect(subpath, { fill: undefined, stroke: undefined }),
    ).toBeUndefined();
  });

  it("refuses a closed rectangle of ordinary extent whose closing point repeats the start", () => {
    // The positive control for the case above: the same shape at a real width recovers a rect, proving the refusal above is the extent check's own, not a fixture accident.
    const subpath: ExtractedSubpath = {
      startXPt: 0,
      startYPt: 0,
      closed: true,
      segments: [
        { kind: "line", xPt: 20, yPt: 0 },
        { kind: "line", xPt: 20, yPt: 10 },
        { kind: "line", xPt: 0, yPt: 10 },
        { kind: "line", xPt: 0, yPt: 0 },
      ],
    };
    expect(
      detectRect(subpath, { fill: undefined, stroke: undefined }),
    ).toMatchObject({
      xPt: 0,
      yPt: 0,
      widthPt: 20,
    });
  });
});
