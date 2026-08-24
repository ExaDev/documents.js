import { buildOdfSubpaths, parseOdfPathData, parseOdfViewBox } from "odf.js";
import { describe, expect, it } from "vitest";
import type { ContentSubpath } from "document-schema.js";
import {
  buildSvgPathData,
  buildSvgViewBox,
  formatPathNumber,
} from "./svg-path";

describe("formatPathNumber", () => {
  it("formats integers without a decimal point", () => {
    expect(formatPathNumber(0)).toBe("0");
    expect(formatPathNumber(100)).toBe("100");
    expect(formatPathNumber(-4000)).toBe("-4000");
  });

  it("strips trailing zeros but keeps genuine fractional digits", () => {
    expect(formatPathNumber(1000.5)).toBe("1000.5");
    expect(formatPathNumber(0.000001)).toBe("0.000001");
  });

  it("rounds away IEEE-754 noise", () => {
    expect(formatPathNumber(0.1 + 0.2)).toBe("0.3");
  });

  it('normalizes negative zero to a plain "0"', () => {
    expect(formatPathNumber(-0)).toBe("0");
    expect(formatPathNumber(-0.0000001)).toBe("0");
  });

  it("throws for a non-finite value rather than emitting NaN/Infinity into the XML", () => {
    expect(() => formatPathNumber(Number.NaN)).toThrow(/non-finite/);
    expect(() => formatPathNumber(Number.POSITIVE_INFINITY)).toThrow(
      /non-finite/,
    );
  });
});

describe("buildSvgViewBox", () => {
  it("anchors at the origin with the given width/height, in the exact number grammar parseOdfViewBox expects", () => {
    const value = buildSvgViewBox(120, 80.5);
    expect(value).toBe("0 0 120 80.5");
    expect(parseOdfViewBox(value)).toEqual({
      minX: 0,
      minY: 0,
      width: 120,
      height: 80.5,
    });
  });
});

describe("buildSvgPathData: cross-checked against odf.js's own real parser (parseOdfPathData)", () => {
  it("re-parses a single open straight-line subpath back to the exact same points", () => {
    const subpaths: ContentSubpath[] = [
      {
        start: { xPt: 0, yPt: 0 },
        closed: false,
        segments: [{ kind: "line", to: { xPt: 10, yPt: 20 } }],
      },
    ];
    const d = buildSvgPathData(subpaths);
    const [raw] = parseOdfPathData(d);
    expect(raw).toEqual({
      start: { x: 0, y: 0 },
      closed: false,
      segments: [{ kind: "line", to: { x: 10, y: 20 } }],
    });
  });

  it("re-parses a closed subpath mixing a line and a genuine cubic curve segment back exactly", () => {
    const subpaths: ContentSubpath[] = [
      {
        start: { xPt: 0, yPt: 80 },
        closed: true,
        segments: [
          { kind: "line", to: { xPt: 60, yPt: 80 } },
          {
            kind: "cubic",
            control1: { xPt: 80, yPt: 80 },
            control2: { xPt: 80, yPt: 0 },
            to: { xPt: 40, yPt: 0 },
          },
        ],
      },
    ];
    const d = buildSvgPathData(subpaths);
    const [raw] = parseOdfPathData(d);
    expect(raw).toEqual({
      start: { x: 0, y: 80 },
      closed: true,
      segments: [
        { kind: "line", to: { x: 60, y: 80 } },
        {
          kind: "cubic",
          control1: { x: 80, y: 80 },
          control2: { x: 80, y: 0 },
          to: { x: 40, y: 0 },
        },
      ],
    });
  });

  it("re-parses multiple subpaths (a real M starting each one, not an implicit lineto)", () => {
    const subpaths: ContentSubpath[] = [
      {
        start: { xPt: 0, yPt: 0 },
        closed: true,
        segments: [
          { kind: "line", to: { xPt: 10, yPt: 0 } },
          { kind: "line", to: { xPt: 10, yPt: 10 } },
        ],
      },
      {
        start: { xPt: 20, yPt: 20 },
        closed: false,
        segments: [{ kind: "line", to: { xPt: 30, yPt: 30 } }],
      },
    ];
    const raw = parseOdfPathData(buildSvgPathData(subpaths));
    expect(raw).toHaveLength(2);
    expect(raw[0]).toMatchObject({ start: { x: 0, y: 0 }, closed: true });
    expect(raw[1]).toMatchObject({ start: { x: 20, y: 20 }, closed: false });
  });

  it("re-parses negative and fractional coordinates correctly, including when a negative number immediately follows another number", () => {
    const subpaths: ContentSubpath[] = [
      {
        start: { xPt: -5.5, yPt: 0 },
        closed: false,
        segments: [{ kind: "line", to: { xPt: -10, yPt: -20.25 } }],
      },
    ];
    const raw = parseOdfPathData(buildSvgPathData(subpaths));
    expect(raw[0]?.start).toEqual({ x: -5.5, y: 0 });
    expect(raw[0]?.segments[0]).toEqual({
      kind: "line",
      to: { x: -10, y: -20.25 },
    });
  });

  it("end-to-end: writing viewBox+d then re-scaling through buildOdfSubpaths recovers the exact original ContentSubpath data (the full round trip a live-view path vector relies on)", () => {
    const frame = { xPt: 100, yPt: 50, widthPt: 90, heightPt: 60 };
    const subpaths: ContentSubpath[] = [
      {
        start: { xPt: 0, yPt: 60 },
        closed: true,
        segments: [
          { kind: "line", to: { xPt: 45, yPt: 60 } },
          {
            kind: "cubic",
            control1: { xPt: 90, yPt: 60 },
            control2: { xPt: 90, yPt: 0 },
            to: { xPt: 45, yPt: 0 },
          },
        ],
      },
    ];
    const d = buildSvgPathData(subpaths);
    const viewBoxValue = buildSvgViewBox(frame.widthPt, frame.heightPt);
    const viewBox = parseOdfViewBox(viewBoxValue);
    if (viewBox === undefined) {
      throw new Error("expected a parseable viewBox");
    }
    const recovered = buildOdfSubpaths(parseOdfPathData(d), viewBox, frame);
    expect(recovered).toEqual(subpaths);
  });
});
