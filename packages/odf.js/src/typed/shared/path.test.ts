import { describe, expect, it } from "vitest";
import type { ContentSubpath } from "document-schema.js";
import {
  buildOdfSubpaths,
  formatOdfPathData,
  formatOdfViewBox,
  parseOdfPathData,
  parseOdfPointsList,
  parseOdfViewBox,
  rawSubpathFromPoints,
  scaleOdfRawPoint,
} from "./path";

// Fixtures marked "real LibreOffice output" are the exact svg:d/draw:points/svg:viewBox strings captured from a genuine .odg file built via the LibreOffice UNO API (a StarBasic macro run headlessly, NOT hand-authored guesses) -- see this module's own top-of-file note for the full verification method and derivation.

describe("parseOdfViewBox", () => {
  it('parses "minX minY width height" (real LibreOffice output)', () => {
    expect(parseOdfViewBox("0 0 3657 4000")).toEqual({
      minX: 0,
      minY: 0,
      width: 3657,
      height: 4000,
    });
  });

  it("parses a viewBox with a negative min origin", () => {
    expect(parseOdfViewBox("-10 -20 100 200")).toEqual({
      minX: -10,
      minY: -20,
      width: 100,
      height: 200,
    });
  });

  it("returns undefined for a width or height of zero or negative -- meaningless to scale against", () => {
    expect(parseOdfViewBox("0 0 0 100")).toBeUndefined();
    expect(parseOdfViewBox("0 0 100 -5")).toBeUndefined();
  });

  it("returns undefined for a malformed value", () => {
    expect(parseOdfViewBox("not a viewbox")).toBeUndefined();
    expect(parseOdfViewBox("0 0 100")).toBeUndefined();
  });
});

describe("parseOdfPointsList", () => {
  it("parses a real LibreOffice draw:points value into ordered x/y pairs", () => {
    expect(parseOdfPointsList("0,3000 2000,0 4000,3000 2000,1500")).toEqual([
      { x: 0, y: 3000 },
      { x: 2000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 2000, y: 1500 },
    ]);
  });

  it("skips a malformed pair rather than aborting the whole list", () => {
    expect(parseOdfPointsList("0,0 garbage 10,10")).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("returns an empty array for an empty/whitespace-only value", () => {
    expect(parseOdfPointsList("")).toEqual([]);
    expect(parseOdfPointsList("   ")).toEqual([]);
  });
});

describe("rawSubpathFromPoints", () => {
  it("builds a subpath from a points list with the first point as start and the rest as line segments", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(rawSubpathFromPoints(points, true)).toEqual({
      start: { x: 0, y: 0 },
      segments: [
        { kind: "line", to: { x: 10, y: 0 } },
        { kind: "line", to: { x: 10, y: 10 } },
      ],
      closed: true,
    });
  });

  it("carries the closed flag through unchanged (draw:polygon -> true, draw:polyline -> false)", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(rawSubpathFromPoints(points, false)?.closed).toBe(false);
  });

  it("returns undefined for an empty points list", () => {
    expect(rawSubpathFromPoints([], true)).toBeUndefined();
  });
});

describe("parseOdfPathData", () => {
  it('parses the exact real LibreOffice CLOSED-curve svg:d ("M0 4000h3000c1000 0 1000-4000-1000-4000z") into one line segment then one cubic segment, closed', () => {
    const subpaths = parseOdfPathData(
      "M0 4000h3000c1000 0 1000-4000-1000-4000z",
    );
    expect(subpaths).toEqual([
      {
        start: { x: 0, y: 4000 },
        segments: [
          { kind: "line", to: { x: 3000, y: 4000 } },
          {
            kind: "cubic",
            control1: { x: 4000, y: 4000 },
            control2: { x: 4000, y: 0 },
            to: { x: 2000, y: 0 },
          },
        ],
        closed: true,
      },
    ]);
  });

  it('the SAME string with no trailing "z" (a real OPEN-shape export) reads closed: false', () => {
    const subpaths = parseOdfPathData(
      "M0 4000h3000c1000 0 1000-4000-1000-4000",
    );
    expect(subpaths[0]?.closed).toBe(false);
  });

  it('parses a real diagonal "l" (lowercase, relative lineto) segment, confirming L/l is genuinely used for non-axis-aligned segments, not just H/V shorthand', () => {
    const subpaths = parseOdfPathData(
      "M0 4658l3000-4500c1500-1000 3000 3000 500 4500z",
    );
    expect(subpaths[0]?.start).toEqual({ x: 0, y: 4658 });
    expect(subpaths[0]?.segments[0]).toEqual({
      kind: "line",
      to: { x: 3000, y: 158 },
    });
    expect(subpaths[0]?.segments[1]).toEqual({
      kind: "cubic",
      control1: { x: 4500, y: -842 },
      control2: { x: 6000, y: 3158 },
      to: { x: 3500, y: 4658 },
    });
  });

  it('parses an absolute "L" the same way as a relative "l", modulo the coordinate frame', () => {
    expect(parseOdfPathData("M10 10L20 30z")[0]?.segments).toEqual([
      { kind: "line", to: { x: 20, y: 30 } },
    ]);
  });

  it('parses an absolute "V" (vertical lineto, current x unchanged)', () => {
    expect(parseOdfPathData("M10 10V50")[0]?.segments).toEqual([
      { kind: "line", to: { x: 10, y: 50 } },
    ]);
  });

  it('parses a relative "v"', () => {
    expect(parseOdfPathData("M10 10v40")[0]?.segments).toEqual([
      { kind: "line", to: { x: 10, y: 50 } },
    ]);
  });

  it('handles implicit-repeat: multiple coordinate pairs after one "L" letter apply the SAME command repeatedly (standard SVG grammar)', () => {
    expect(parseOdfPathData("M0 0L10 0 10 10 0 10z")[0]?.segments).toEqual([
      { kind: "line", to: { x: 10, y: 0 } },
      { kind: "line", to: { x: 10, y: 10 } },
      { kind: "line", to: { x: 0, y: 10 } },
    ]);
  });

  it('a second coordinate pair immediately after "M" is treated as an implicit LINETO, per the SVG spec, not a second moveto', () => {
    const subpaths = parseOdfPathData("M0 0 10 10z");
    expect(subpaths).toHaveLength(1);
    expect(subpaths[0]?.start).toEqual({ x: 0, y: 0 });
    expect(subpaths[0]?.segments).toEqual([
      { kind: "line", to: { x: 10, y: 10 } },
    ]);
  });

  it('a repeated "M" command starts a genuinely NEW subpath', () => {
    const subpaths = parseOdfPathData("M0 0L10 10zM20 20L30 30z");
    expect(subpaths).toHaveLength(2);
    expect(subpaths[0]?.start).toEqual({ x: 0, y: 0 });
    expect(subpaths[1]?.start).toEqual({ x: 20, y: 20 });
  });

  it("recognises but silently skips an unsupported command (S/Q/T/A), keeping the token stream in sync for whatever comes after", () => {
    const subpaths = parseOdfPathData("M0 0Q5 5 10 10L20 20z");
    expect(subpaths[0]?.segments).toEqual([
      { kind: "line", to: { x: 20, y: 20 } },
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseOdfPathData("")).toEqual([]);
  });

  it("skips a bare number before any command letter has been seen, without throwing", () => {
    expect(parseOdfPathData("10 10 M0 0L5 5z")[0]?.start).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("scaleOdfRawPoint / buildOdfSubpaths", () => {
  const viewBox = { minX: 0, minY: 0, width: 100, height: 200 };
  const frame = { xPt: 10, yPt: 20, widthPt: 50, heightPt: 100 };

  it("scales a raw point into the LOCAL coordinate space (frame size only) -- does NOT add the frame's own page-space xPt/yPt offset", () => {
    expect(scaleOdfRawPoint({ x: 50, y: 100 }, viewBox, frame)).toEqual({
      xPt: 25,
      yPt: 50,
    });
  });

  it("subtracts a nonzero viewBox min origin before scaling", () => {
    const offsetViewBox = { minX: 10, minY: 20, width: 100, height: 200 };
    expect(scaleOdfRawPoint({ x: 60, y: 120 }, offsetViewBox, frame)).toEqual({
      xPt: 25,
      yPt: 50,
    });
  });

  it("buildOdfSubpaths scales every point of every segment, preserving segment kind and closed", () => {
    const raw = [
      {
        start: { x: 0, y: 0 },
        segments: [
          { kind: "line" as const, to: { x: 100, y: 200 } },
          {
            kind: "cubic" as const,
            control1: { x: 50, y: 50 },
            control2: { x: 50, y: 150 },
            to: { x: 100, y: 200 },
          },
        ],
        closed: true,
      },
    ];
    expect(buildOdfSubpaths(raw, viewBox, frame)).toEqual([
      {
        start: { xPt: 0, yPt: 0 },
        closed: true,
        segments: [
          { kind: "line", to: { xPt: 50, yPt: 100 } },
          {
            kind: "cubic",
            control1: { xPt: 25, yPt: 25 },
            control2: { xPt: 25, yPt: 75 },
            to: { xPt: 50, yPt: 100 },
          },
        ],
      },
    ]);
  });
});

// The write side, checked as a genuine inverse rather than against a hand-copied expected string: every round-trip case below serialises subpaths, parses the result back through parseOdfPathData, scales it through buildOdfSubpaths against the very viewBox formatOdfViewBox produced, and compares against what went in. A suite that only asserted the literal svg:d text would pass just as happily for a serializer whose grammar the parser cannot actually read.

describe("formatOdfViewBox", () => {
  it("states the frame's own extent, so the scale factor buildOdfSubpaths applies is exactly 1", () => {
    const frame = { xPt: 20, yPt: 30, widthPt: 144, heightPt: 72 };
    expect(formatOdfViewBox(frame)).toBe("0 0 144 72");
    expect(parseOdfViewBox(formatOdfViewBox(frame))).toEqual({
      minX: 0,
      minY: 0,
      width: 144,
      height: 72,
    });
  });

  // A fractional extent still has to match parseOdfViewBox's own four-number grammar, which has no exponent form at all -- the same hazard formatOdfLength's own expandExponential closes for lengths, reached here through formatOdfNumber.
  it("spells a very small extent in fixed-point decimal, never exponent notation", () => {
    const viewBox = formatOdfViewBox({
      xPt: 0,
      yPt: 0,
      widthPt: 1e-7,
      heightPt: 2.5,
    });
    expect(viewBox).toBe("0 0 0.0000001 2.5");
    expect(parseOdfViewBox(viewBox)).toEqual({
      minX: 0,
      minY: 0,
      width: 1e-7,
      height: 2.5,
    });
  });
});

describe("formatOdfPathData", () => {
  const frame = { xPt: 0, yPt: 0, widthPt: 200, heightPt: 100 };

  function reparse(subpaths: ContentSubpath[]): ContentSubpath[] {
    const viewBox = parseOdfViewBox(formatOdfViewBox(frame));
    if (viewBox === undefined) {
      throw new Error("expected the written viewBox to parse");
    }
    return buildOdfSubpaths(
      parseOdfPathData(formatOdfPathData(subpaths)),
      viewBox,
      frame,
    );
  }

  it("writes one absolute moveto per subpath, an explicit L per line segment, and Z only when closed", () => {
    expect(
      formatOdfPathData([
        {
          start: { xPt: 0, yPt: 0 },
          segments: [
            { kind: "line", to: { xPt: 100, yPt: 0 } },
            { kind: "line", to: { xPt: 100, yPt: 50 } },
          ],
          closed: true,
        },
        {
          start: { xPt: 10, yPt: 10 },
          segments: [{ kind: "line", to: { xPt: 20, yPt: 20 } }],
          closed: false,
        },
      ]),
    ).toBe("M 0,0 L 100,0 L 100,50 Z M 10,10 L 20,20");
  });

  it("writes a cubic as an absolute C with both control points before the endpoint", () => {
    expect(
      formatOdfPathData([
        {
          start: { xPt: 0, yPt: 80 },
          segments: [
            {
              kind: "cubic",
              control1: { xPt: 30, yPt: 0 },
              control2: { xPt: 70, yPt: 0 },
              to: { xPt: 100, yPt: 80 },
            },
          ],
          closed: false,
        },
      ]),
    ).toBe("M 0,80 C 30,0 70,0 100,80");
  });

  it("round-trips a closed and an open subpath mixing line and cubic segments", () => {
    const subpaths: ContentSubpath[] = [
      {
        start: { xPt: 0, yPt: 0 },
        segments: [
          { kind: "line", to: { xPt: 60, yPt: 0 } },
          {
            kind: "cubic",
            control1: { xPt: 80, yPt: 0 },
            control2: { xPt: 80, yPt: 40 },
            to: { xPt: 60, yPt: 40 },
          },
          { kind: "line", to: { xPt: 0, yPt: 40 } },
        ],
        closed: true,
      },
      {
        start: { xPt: 120, yPt: 10 },
        segments: [
          {
            kind: "cubic",
            control1: { xPt: 140, yPt: 90 },
            control2: { xPt: 180, yPt: -10 },
            to: { xPt: 200, yPt: 70 },
          },
        ],
        closed: false,
      },
    ];
    expect(reparse(subpaths)).toEqual(subpaths);
  });

  it("round-trips negative and fractional coordinates, whose signs are their own separators", () => {
    const subpaths: ContentSubpath[] = [
      {
        start: { xPt: -12.5, yPt: -0.25 },
        segments: [{ kind: "line", to: { xPt: 0.5, yPt: -30 } }],
        closed: false,
      },
    ];
    expect(formatOdfPathData(subpaths)).toBe("M -12.5,-0.25 L 0.5,-30");
    expect(reparse(subpaths)).toEqual(subpaths);
  });

  it("round-trips a subpath with no segments at all as a bare moveto", () => {
    const subpaths: ContentSubpath[] = [
      { start: { xPt: 5, yPt: 7 }, segments: [], closed: false },
    ];
    expect(formatOdfPathData(subpaths)).toBe("M 5,7");
    expect(reparse(subpaths)).toEqual(subpaths);
  });

  // The one case a caller must refuse rather than write: an empty subpath list writes an empty svg:d, which parses back to no subpaths at all, and typed/draw/shapes.ts's readDrawPathVector then drops the whole element. typed/draw/write-vectors.ts refuses it by name; this pins why it has to.
  it("writes an empty string for no subpaths, which parses back to nothing", () => {
    expect(formatOdfPathData([])).toBe("");
    expect(parseOdfPathData("")).toEqual([]);
  });

  // A coordinate small enough for JavaScript's own Number-to-string to switch to exponent notation is spelled in fixed-point decimal instead, for one spelling across svg:d and the svg:viewBox beside it (typed/shared/units.ts's formatOdfNumber).
  it("spells a very small coordinate in fixed-point decimal", () => {
    expect(
      formatOdfPathData([
        {
          start: { xPt: 7.105427357601002e-15, yPt: 0 },
          segments: [],
          closed: false,
        },
      ]),
    ).toBe("M 0.000000000000007105427357601002,0");
  });
});
