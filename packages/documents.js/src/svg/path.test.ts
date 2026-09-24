import { describe, expect, it } from "vitest";
import { parseSvgPathData } from "./path";

describe("parseSvgPathData", () => {
  it("parses absolute M/L into one open subpath of line segments", () => {
    const parsed = parseSvgPathData("M 10 20 L 30 40");
    expect(parsed).toEqual([
      {
        start: { x: 10, y: 20 },
        closed: false,
        segments: [{ kind: "line", to: { x: 30, y: 40 } }],
      },
    ]);
  });

  it("parses the relative lowercase forms against the running current point", () => {
    const parsed = parseSvgPathData("m 10 20 l 5 5 L 100 100");
    expect(parsed).toEqual([
      {
        start: { x: 10, y: 20 },
        closed: false,
        segments: [
          { kind: "line", to: { x: 15, y: 25 } },
          { kind: "line", to: { x: 100, y: 100 } },
        ],
      },
    ]);
  });

  it("parses H/V (and h/v) as lines that keep the other coordinate fixed", () => {
    const parsed = parseSvgPathData("M 10 20 H 30 V 5 h -5 v -3");
    expect(parsed).toEqual([
      {
        start: { x: 10, y: 20 },
        closed: false,
        segments: [
          { kind: "line", to: { x: 30, y: 20 } },
          { kind: "line", to: { x: 30, y: 5 } },
          { kind: "line", to: { x: 25, y: 5 } },
          { kind: "line", to: { x: 25, y: 2 } },
        ],
      },
    ]);
  });

  it("parses absolute C with its three points verbatim", () => {
    const parsed = parseSvgPathData("M 0 0 C 10 0 10 10 20 10");
    expect(parsed).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [
          {
            kind: "cubic",
            control1: { x: 10, y: 0 },
            control2: { x: 10, y: 10 },
            to: { x: 20, y: 10 },
          },
        ],
      },
    ]);
  });

  it("reflects S's first control through the current point exactly (the previous cubic's second control)", () => {
    // After C lands at (20,10) with second control (10,10), S\'s own first control must be the mirror image (30,10) — the author\'s intended smooth join, reproduced with no approximation.
    const parsed = parseSvgPathData("M 0 0 C 10 0 10 10 20 10 S 30 20 30 30");
    expect(parsed).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [
          {
            kind: "cubic",
            control1: { x: 10, y: 0 },
            control2: { x: 10, y: 10 },
            to: { x: 20, y: 10 },
          },
          {
            kind: "cubic",
            control1: { x: 30, y: 10 },
            control2: { x: 30, y: 20 },
            to: { x: 30, y: 30 },
          },
        ],
      },
    ]);
  });

  it("falls back to the current point as S's first control when no cubic precedes it", () => {
    // The spec\'s own rule: with no previous cubic\'s control to reflect, the reflected control is the current point itself.
    const parsed = parseSvgPathData("M 0 0 S 10 10 20 20");
    expect(parsed).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [
          {
            kind: "cubic",
            control1: { x: 0, y: 0 },
            control2: { x: 10, y: 10 },
            to: { x: 20, y: 20 },
          },
        ],
      },
    ]);
  });

  it("elevates Q to a cubic exactly, with both controls at the 2/3 marks toward the shared control", () => {
    // A quadratic is the degree-2 special case of a cubic: the elevated controls at from + 2/3*(control-from) and to + 2/3*(control-to) trace the identical curve at every parameter.
    const parsed = parseSvgPathData("M 0 0 Q 30 0 30 30");
    expect(parsed).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [
          {
            kind: "cubic",
            control1: { x: 20, y: 0 },
            control2: { x: 30, y: 10 },
            to: { x: 30, y: 30 },
          },
        ],
      },
    ]);
  });

  it("reflects T's control through the current point, then elevates the quadratic exactly", () => {
    // After Q (from (0,0), control (30,0), to (30,30)), T\'s control is the mirror of (30,0) through (30,30): (30,60). The elevated controls are then (30,50) and (40,60).
    const parsed = parseSvgPathData("M 0 0 Q 30 0 30 30 T 60 60");
    expect(parsed).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [
          {
            kind: "cubic",
            control1: { x: 20, y: 0 },
            control2: { x: 30, y: 10 },
            to: { x: 30, y: 30 },
          },
          {
            kind: "cubic",
            control1: { x: 30, y: 50 },
            control2: { x: 40, y: 60 },
            to: { x: 60, y: 60 },
          },
        ],
      },
    ]);
  });

  it("degenerates T to the current point as control when no quadratic precedes it, per the spec's own rule", () => {
    // With no previous quadratic control to reflect, the control is the current point (0,0) itself, and the same exact elevation applies — control2 sits 2/3 of the way back from the endpoint, expressed here as the identical arithmetic so the assertion is bit-exact.
    const parsed = parseSvgPathData("M 0 0 T 10 10");
    expect(parsed).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [
          {
            kind: "cubic",
            control1: { x: 0, y: 0 },
            control2: {
              x: 10 + (2 / 3) * (0 - 10),
              y: 10 + (2 / 3) * (0 - 10),
            },
            to: { x: 10, y: 10 },
          },
        ],
      },
    ]);
  });

  it("closes Z/z subpaths and opens a fresh one at the next moveto", () => {
    const parsed = parseSvgPathData("M 0 0 L 10 0 M 20 20 L 30 30 Z");
    expect(parsed).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [{ kind: "line", to: { x: 10, y: 0 } }],
      },
      {
        start: { x: 20, y: 20 },
        closed: true,
        segments: [{ kind: "line", to: { x: 30, y: 30 } }],
      },
    ]);
  });

  it("treats further coordinate groups after one M as lineto (implicit repetition)", () => {
    const parsed = parseSvgPathData("M 10 10 20 20 30 30");
    expect(parsed).toEqual([
      {
        start: { x: 10, y: 10 },
        closed: false,
        segments: [
          { kind: "line", to: { x: 20, y: 20 } },
          { kind: "line", to: { x: 30, y: 30 } },
        ],
      },
    ]);
  });

  it("reads arc flags as single characters even when fused with the surrounding numbers", () => {
    // "01100" must split into flag 0, flag 1, and the number 100 — the classic packed-flag form a number-based parser misreads. A half circle from (0,0) to (100,0), sweep 1.
    const parsed = parseSvgPathData("M 0 0 A 50 50 0 01100 0");
    expect(parsed).toBeDefined();
    const segments = parsed![0]!.segments;
    expect(segments.length).toBe(2);
    const last = segments[segments.length - 1]!;
    if (last.kind !== "cubic") {
      throw new Error("expected the arc to emit cubic segments");
    }
    expect(last.to.x).toBeCloseTo(100, 9);
    expect(last.to.y).toBeCloseTo(0, 9);
  });

  it("renders a zero-radius arc as a straight line to the endpoint, per the spec's own rule", () => {
    const parsed = parseSvgPathData("M 0 0 A 0 0 0 0 1 10 0");
    expect(parsed).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [{ kind: "line", to: { x: 10, y: 0 } }],
      },
    ]);
  });

  it("splits a 180-degree arc into two cubics whose segment boundaries sit on the true circle", () => {
    // From (0,0) to (100,0) with r=50 the chord is the diameter, so the centre is the midpoint (50,0) by symmetry and every segment boundary must sit exactly 50 from it (only the curve between boundaries is the bounded Bezier approximation).
    const parsed = parseSvgPathData("M 0 0 A 50 50 0 0 1 100 0");
    expect(parsed).toBeDefined();
    const segments = parsed![0]!.segments;
    expect(segments.length).toBe(2);
    for (const segment of segments) {
      if (segment.kind !== "cubic") {
        throw new Error("expected the arc to emit cubic segments");
      }
      expect(Math.hypot(segment.to.x - 50, segment.to.y)).toBeCloseTo(50, 6);
    }
  });

  it("splits a 270-degree sweep into three cubics, every boundary on the true circle", () => {
    // Clockwise on screen (sweep=1, y-down) from (50,0) through (0,50), (-50,0) to (0,-50) is the large 270-degree arc around the origin: exactly three at-most-90-degree segments, each boundary at distance 50 from the origin.
    const parsed = parseSvgPathData("M 50 0 A 50 50 0 1 1 0 -50");
    expect(parsed).toBeDefined();
    const segments = parsed![0]!.segments;
    expect(segments.length).toBe(3);
    for (const segment of segments) {
      if (segment.kind !== "cubic") {
        throw new Error("expected the arc to emit cubic segments");
      }
      expect(Math.hypot(segment.to.x, segment.to.y)).toBeCloseTo(50, 6);
    }
    const last = segments[segments.length - 1]!;
    if (last.kind !== "cubic") {
      throw new Error("expected the arc to emit cubic segments");
    }
    expect(last.to.x).toBeCloseTo(0, 9);
    expect(last.to.y).toBeCloseTo(-50, 9);
  });

  it("scales up radii too small to span the endpoints, exactly the factor that makes them span", () => {
    // rx=1 cannot reach (100,0) from (0,0); F.6.6\'s correction scales it to 50, so the recovered curve still lands on the endpoint.
    const parsed = parseSvgPathData("M 0 0 A 1 1 0 0 1 100 0");
    expect(parsed).toBeDefined();
    const segments = parsed![0]!.segments;
    const last = segments[segments.length - 1]!;
    if (last.kind !== "cubic") {
      throw new Error("expected the arc to emit cubic segments");
    }
    expect(last.to.x).toBeCloseTo(100, 9);
    expect(last.to.y).toBeCloseTo(0, 9);
  });

  it("drops subpaths that carry no segments (a bare moveto, or M immediately followed by Z)", () => {
    expect(parseSvgPathData("M 10 10")).toEqual([]);
    expect(parseSvgPathData("M 10 10 Z")).toEqual([]);
  });

  it("returns undefined for malformed data rather than a partial parse", () => {
    // A drawing command before the first moveto has no subpath to draw into; an unknown command letter and an argument-count shortfall have no meaning at all — none may half-parse.
    expect(parseSvgPathData("L 10 10")).toBeUndefined();
    expect(parseSvgPathData("M 0 0 X 10 10")).toBeUndefined();
    expect(parseSvgPathData("M 0 0 C 10 10 20")).toBeUndefined();
    expect(parseSvgPathData("M 10 10 Z 5 5")).toBeUndefined();
  });

  it('reads a sign as itself a separator, so "10-10" is two numbers', () => {
    const parsed = parseSvgPathData("M 10-10L20-20");
    expect(parsed).toEqual([
      {
        start: { x: 10, y: -10 },
        closed: false,
        segments: [{ kind: "line", to: { x: 20, y: -20 } }],
      },
    ]);
  });

  it("reads exponent-notation numbers", () => {
    const parsed = parseSvgPathData("M 1e1 2e1 L 1.5e1 .5e1");
    expect(parsed).toEqual([
      {
        start: { x: 10, y: 20 },
        closed: false,
        segments: [{ kind: "line", to: { x: 15, y: 5 } }],
      },
    ]);
  });
});

describe("parseSvgPathData: scanner discipline", () => {
  it("treats commas as separators exactly like whitespace", () => {
    const parsed = parseSvgPathData("M10,20L30,40");
    expect(parsed).toEqual([
      {
        start: { x: 10, y: 20 },
        closed: false,
        segments: [{ kind: "line", to: { x: 30, y: 40 } }],
      },
    ]);
  });

  it("accepts an explicit plus sign and a bare leading dot in numbers", () => {
    const parsed = parseSvgPathData("M +10 .5 L 5. 5");
    expect(parsed).toEqual([
      {
        start: { x: 10, y: 0.5 },
        closed: false,
        segments: [{ kind: "line", to: { x: 5, y: 5 } }],
      },
    ]);
  });

  it("returns an empty subpath list, not undefined, for whitespace-only or empty input", () => {
    expect(parseSvgPathData("   ")).toEqual([]);
    expect(parseSvgPathData("")).toEqual([]);
  });

  it("returns undefined when an argument is not a number at all, or runs out", () => {
    expect(parseSvgPathData("M x y")).toBeUndefined();
    expect(parseSvgPathData("M 10")).toBeUndefined();
  });
});

describe("parseSvgPathData: Z and the subpath cursor", () => {
  it("returns the cursor to the subpath start on Z, so a following relative moveto starts from there", () => {
    const parsed = parseSvgPathData("M 10 10 L 20 0 Z m 5 5 l 1 1");
    expect(parsed).toEqual([
      {
        start: { x: 10, y: 10 },
        closed: true,
        segments: [{ kind: "line", to: { x: 20, y: 0 } }],
      },
      {
        start: { x: 15, y: 15 },
        closed: false,
        segments: [{ kind: "line", to: { x: 16, y: 16 } }],
      },
    ]);
  });

  it("honours the lowercase z spelling exactly like Z", () => {
    expect(parseSvgPathData("M 0 0 L 10 0 z")).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: true,
        segments: [{ kind: "line", to: { x: 10, y: 0 } }],
      },
    ]);
  });

  it("clears the reflection anchors at each command boundary they do not belong to", () => {
    // S after a line (not a cubic) must take the current point as its first control; T after a line (not a quadratic) the same, degenerating to the straight-line elevation.
    const sAfterLine = parseSvgPathData("M 0 0 L 10 0 S 20 10 30 10");
    expect(sAfterLine?.[0]?.segments[1]).toEqual({
      kind: "cubic",
      control1: { x: 10, y: 0 },
      control2: { x: 20, y: 10 },
      to: { x: 30, y: 10 },
    });
    const tAfterLine = parseSvgPathData("M 0 0 L 10 0 T 30 0");
    // The degenerate control IS the current point (10,0); the elevation then places control2 at to + 2/3*(control - to).
    expect(tAfterLine?.[0]?.segments[1]).toEqual({
      kind: "cubic",
      control1: { x: 10, y: 0 },
      control2: { x: 30 + (2 / 3) * (10 - 30), y: 0 },
      to: { x: 30, y: 0 },
    });
  });

  it("reflects T's control through a preceding Q with a genuinely off-axis control point", () => {
    // Q control (10,20) reflected through the current point (20,0) is (30,-20) — a y-sign the reflection arithmetic must get right.
    const parsed = parseSvgPathData("M 0 0 Q 10 20 20 0 T 40 0");
    const tSegment = parsed?.[0]?.segments[1];
    if (tSegment?.kind !== "cubic") {
      throw new Error("expected a cubic segment");
    }
    // The elevated first control sits 2/3 of the way from (20,0) toward (30,-20).
    expect(tSegment.control1.x).toBeCloseTo(20 + (2 / 3) * 10, 9);
    expect(tSegment.control1.y).toBeCloseTo((2 / 3) * -20, 9);
  });
});

describe("parseSvgPathData: elliptical arcs", () => {
  it("emits the exact kappa quarter-circle controls for a 90-degree arc", () => {
    // From (50,0) to (0,50) around the origin, r=50, sweep 1: one segment, controls at start + kappa*(0,50) and end - kappa*(-50,0), kappa = 4/3*tan(pi/8) — the classical circular-arc Bezier controls, computed here independently of the parser.
    const kappa = (4 / 3) * Math.tan(Math.PI / 8);
    const parsed = parseSvgPathData("M 50 0 A 50 50 0 0 1 0 50");
    expect(parsed).toBeDefined();
    const segments = parsed![0]!.segments;
    expect(segments).toHaveLength(1);
    const segment = segments[0];
    if (segment?.kind !== "cubic") {
      throw new Error("expected a cubic segment");
    }
    expect(segment.control1.x).toBeCloseTo(50, 9);
    expect(segment.control1.y).toBeCloseTo(50 * kappa, 9);
    expect(segment.control2.x).toBeCloseTo(50 * kappa, 9);
    expect(segment.control2.y).toBeCloseTo(50, 9);
    expect(segment.to.x).toBeCloseTo(0, 9);
    expect(segment.to.y).toBeCloseTo(50, 9);
  });

  it("uses exactly one segment at 90 degrees and two just past it", () => {
    expect(
      parseSvgPathData("M 50 0 A 50 50 0 0 1 0 50")![0]!.segments,
    ).toHaveLength(1);
    // A chord subtending slightly more than 90 degrees on the same circle: endpoints (50,0) and (-1, sqrt(50^2 - 1)).
    const y = Math.sqrt(50 * 50 - 1);
    expect(
      parseSvgPathData(`M 50 0 A 50 50 0 0 1 -1 ${y}`)![0]!.segments,
    ).toHaveLength(2);
  });

  it("draws the sweep-1 half circle through (50,-50) and the sweep-0 twin through (50,50)", () => {
    // From (0,0) to (100,0) the centre is (50,0); theta1 = pi, so sweep 1 walks angles pi to 2pi (through (50,-50)) and sweep 0 walks pi down to 0 (through (50,50)) — the first segment boundary IS the halfway point.
    const sweep1 = parseSvgPathData("M 0 0 A 50 50 0 0 1 100 0")![0]!.segments;
    expect(sweep1).toHaveLength(2);
    expect(sweep1[0]?.kind).toBe("cubic");
    if (sweep1[0]?.kind !== "cubic") {
      throw new Error("expected a cubic segment");
    }
    expect(sweep1[0].to.x).toBeCloseTo(50, 6);
    expect(sweep1[0].to.y).toBeCloseTo(-50, 6);
    const sweep0 = parseSvgPathData("M 0 0 A 50 50 0 0 0 100 0")![0]!.segments;
    expect(sweep0).toHaveLength(2);
    if (sweep0[0]?.kind !== "cubic") {
      throw new Error("expected a cubic segment");
    }
    expect(sweep0[0].to.x).toBeCloseTo(50, 6);
    expect(sweep0[0].to.y).toBeCloseTo(50, 6);
  });

  it("applies the x-axis rotation: a 90-degree-rotated ellipse equals the same arc with its radii swapped, unrotated", () => {
    // Rotation by 90 degrees exchanges the ellipse's world semi-axes, so rx=50,ry=25,rotation=90 traces exactly the curve rx=25,ry=50,rotation=0 traces between the same endpoints.
    const rotated = parseSvgPathData("M 0 0 A 50 25 90 0 1 100 0");
    const swapped = parseSvgPathData("M 0 0 A 25 50 0 0 1 100 0");
    expect(rotated).toBeDefined();
    expect(swapped).toBeDefined();
    expect(rotated!.length).toBe(swapped!.length);
    // The two computations reach each coordinate through different rotation terms, so equality is asserted per coordinate at full float precision rather than by object identity.
    for (let i = 0; i < rotated!.length; i++) {
      const a = rotated![i]!;
      const b = swapped![i]!;
      expect(a.start.x).toBeCloseTo(b.start.x, 9);
      expect(a.start.y).toBeCloseTo(b.start.y, 9);
      expect(a.closed).toBe(b.closed);
      expect(a.segments.length).toBe(b.segments.length);
      for (let j = 0; j < a.segments.length; j++) {
        const segmentA = a.segments[j]!;
        const segmentB = b.segments[j]!;
        if (segmentA.kind !== "cubic" || segmentB.kind !== "cubic") {
          throw new Error("expected cubic segments");
        }
        expect(segmentA.control1.x).toBeCloseTo(segmentB.control1.x, 9);
        expect(segmentA.control1.y).toBeCloseTo(segmentB.control1.y, 9);
        expect(segmentA.control2.x).toBeCloseTo(segmentB.control2.x, 9);
        expect(segmentA.control2.y).toBeCloseTo(segmentB.control2.y, 9);
        expect(segmentA.to.x).toBeCloseTo(segmentB.to.x, 9);
        expect(segmentA.to.y).toBeCloseTo(segmentB.to.y, 9);
      }
    }
  });

  it("takes the absolute value of negative radii, per the spec's own rule", () => {
    expect(parseSvgPathData("M 0 0 A -50 -50 0 0 1 100 0")).toEqual(
      parseSvgPathData("M 0 0 A 50 50 0 0 1 100 0"),
    );
  });

  it("emits nothing at all for an arc whose endpoint coincides with the current point", () => {
    const parsed = parseSvgPathData("M 0 0 L 5 5 A 50 50 0 0 1 5 5");
    expect(parsed).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [{ kind: "line", to: { x: 5, y: 5 } }],
      },
    ]);
  });

  it("resolves relative arcs against the running current point, with fused flags", () => {
    const parsed = parseSvgPathData("M 0 0 a 50 50 0 0110 0");
    const last = parsed![0]!.segments.at(-1);
    if (last?.kind !== "cubic") {
      throw new Error("expected a cubic segment");
    }
    expect(last.to.x).toBeCloseTo(10, 9);
    expect(last.to.y).toBeCloseTo(0, 9);
  });

  it("returns undefined when a flag character is not 0 or 1, or an arc argument is missing", () => {
    expect(parseSvgPathData("M 0 0 A 50 50 0 2 1 100 0")).toBeUndefined();
    expect(parseSvgPathData("M 0 0 A 50 50 0 0 x 100 0")).toBeUndefined();
    expect(parseSvgPathData("M 0 0 A 50 50 0 0")).toBeUndefined();
  });

  it("returns undefined for an arc command before any moveto, exactly like every other drawing command", () => {
    expect(parseSvgPathData("A 50 50 0 0 1 100 0")).toBeUndefined();
  });
});

describe("parseSvgPathData: arc degenerate-radius and relative forms", () => {
  it("degrades to a line when only ONE radius is zero, on either axis", () => {
    const ryZero = parseSvgPathData("M 0 0 A 50 0 0 0 1 10 0");
    expect(ryZero).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [{ kind: "line", to: { x: 10, y: 0 } }],
      },
    ]);
    const rxZero = parseSvgPathData("M 0 0 A 0 50 0 0 1 10 0");
    expect(rxZero).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [{ kind: "line", to: { x: 10, y: 0 } }],
      },
    ]);
  });

  it("degrades to a line when only the y coordinate differs, too", () => {
    const parsed = parseSvgPathData("M 0 0 A 0 0 0 0 1 0 10");
    expect(parsed).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [{ kind: "line", to: { x: 0, y: 10 } }],
      },
    ]);
  });

  it("resolves BOTH relative-arc coordinates against the current point", () => {
    const parsed = parseSvgPathData("M 0 0 a 5 5 0 0 1 10 10");
    const last = parsed![0]!.segments.at(-1);
    if (last?.kind !== "cubic") {
      throw new Error("expected a cubic segment");
    }
    expect(last.to.x).toBeCloseTo(10, 6);
    expect(last.to.y).toBeCloseTo(10, 6);
  });
});

describe("parseSvgPathData: rotated and multi-segment arc geometry", () => {
  it("places a 90-degree-rotated ellipse's 60-degree arc at hand-computed controls", () => {
    // Rotation 90 puts rx=2 along world y and ry=1 along world x; the start (1,0) is the world-x semi-axis tip, so the centre is exactly the origin (the F.6.5 equations give cxp=-1, cyp=1/2, which rotates back to (0,0)), and the arc runs from theta=-90 to theta=-30 (one 60-degree segment, safely away from the 90-degree segment-count boundary). The tangents at those parameters are (0,2) and (-sqrt(3)/2, 1), so the controls are start + kappa*(0,2) and end - kappa*(-sqrt(3)/2, 1) with kappa = 4/3*tan(15 degrees).
    const kappa = (4 / 3) * Math.tan(Math.PI / 12);
    const root3 = Math.sqrt(3);
    const parsed = parseSvgPathData(
      "M 1 0 A 2 1 90 0 1 0.5 1.7320508075688772",
    );
    expect(parsed).toBeDefined();
    const segments = parsed![0]!.segments;
    expect(segments).toHaveLength(1);
    const segment = segments[0];
    if (segment?.kind !== "cubic") {
      throw new Error("expected a cubic segment");
    }
    expect(segment.control1.x).toBeCloseTo(1, 9);
    expect(segment.control1.y).toBeCloseTo(2 * kappa, 9);
    expect(segment.control2.x).toBeCloseTo(0.5 + (kappa * root3) / 2, 9);
    expect(segment.control2.y).toBeCloseTo(root3 - kappa, 9);
    expect(segment.to.x).toBeCloseTo(0.5, 9);
    expect(segment.to.y).toBeCloseTo(root3, 9);
  });

  it("places the SECOND segment of the sweep-1 half circle at its hand-computed controls", () => {
    // The half circle from (0,0) to (100,0) through (50,-50) splits at (50,-50); the second segment starts there with tangent (50,0) and ends at (100,0) with tangent (0,50), kappa = 4/3*tan(pi/8) for the 90-degree piece.
    const kappa = (4 / 3) * Math.tan(Math.PI / 8);
    const parsed = parseSvgPathData("M 0 0 A 50 50 0 0 1 100 0");
    const second = parsed![0]!.segments[1];
    if (second?.kind !== "cubic") {
      throw new Error("expected a cubic segment");
    }
    expect(second.control1.x).toBeCloseTo(50 + kappa * 50, 6);
    expect(second.control1.y).toBeCloseTo(-50, 6);
    expect(second.control2.x).toBeCloseTo(100, 6);
    expect(second.control2.y).toBeCloseTo(-kappa * 50, 6);
    expect(second.to.x).toBeCloseTo(100, 6);
    expect(second.to.y).toBeCloseTo(0, 6);
  });
});

describe("parseSvgPathData: vertical chords", () => {
  it("parses a genuine arc whose endpoints share only their x coordinate", () => {
    // A half circle on a vertical chord (from (0,0) to (0,10), r=5): only the COINCIDENT test reads both coordinates, so an endpoint pair differing in y alone must still draw the arc, never the degenerate nothing.
    const parsed = parseSvgPathData("M 0 0 A 5 5 0 0 1 0 10");
    expect(parsed).toBeDefined();
    const segments = parsed![0]!.segments;
    expect(segments).toHaveLength(2);
    const last = segments[segments.length - 1]!;
    if (last.kind !== "cubic") {
      throw new Error("expected a cubic segment");
    }
    expect(last.to.x).toBeCloseTo(0, 9);
    expect(last.to.y).toBeCloseTo(10, 9);
  });
});
