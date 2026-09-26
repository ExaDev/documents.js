import { describe, expect, it } from "vitest";
import type { PdfDiagnostic, PdfDiagnosticSink } from "./diagnostics";
import type { FontMetricsPort, PdfObjectResolver } from "./interpret-types";
import { interpretContentStream } from "./interpret";
import type { PdfDict, PdfObject } from "./objects";
import { asDict, pdfDict } from "./objects";

function collectDiagnostics(): {
  sink: PdfDiagnosticSink;
  diagnostics: PdfDiagnostic[];
} {
  const diagnostics: PdfDiagnostic[] = [];
  return {
    sink: (d) => {
      diagnostics.push(d);
    },
    diagnostics,
  };
}

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function fixedWidthFontMetrics(
  widthPer1000 = 500,
  byteLengthConsumed = 1,
): FontMetricsPort {
  return {
    glyphAdvance: () => ({ widthPer1000, byteLengthConsumed }),
    isVertical: () => false,
  };
}

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined =>
    obj?.kind === "ref" ? objects.get(obj.num) : obj;
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined =>
    asDict(resolve(obj));
  return { resolve, resolveDict };
}

const EMPTY_RESOURCES = pdfDict({});

describe("interpretContentStream: ellipses", () => {
  // The exact four-quadrant Bezier construction content-write.ts's writeEllipse emits, spelled out here as literal operators so this detector is pinned against the pattern itself rather than only against that writer's current output: centre (40,40), rx 30, ry 20, kx 16.5685, ky 11.0457.
  const ELLIPSE_OPERATORS = [
    "70 40 m",
    "70 51.0457 56.5685 60 40 60 c",
    "23.4315 60 10 51.0457 10 40 c",
    "10 28.9543 23.4315 20 40 20 c",
    "56.5685 20 70 28.9543 70 40 c",
    "h",
  ].join(" ");

  it("recovers a filled ellipse from the four-quadrant Bezier construction", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes(`1 0 0 rg ${ELLIPSE_OPERATORS} f`),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "ellipse",
        xPt: 10,
        yPt: 20,
        widthPt: 60,
        heightPt: 40,
        fill: { r: 1, g: 0, b: 0 },
        stroke: undefined,
      },
    ]);
  });

  it("recovers an ellipse painted with both fill and stroke", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes(`1 0 0 rg 0 0 1 RG 2 w ${ELLIPSE_OPERATORS} B`),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "ellipse",
        xPt: 10,
        yPt: 20,
        widthPt: 60,
        heightPt: 40,
        fill: { r: 1, g: 0, b: 0 },
        stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 },
      },
    ]);
  });

  // Same four cardinal on-curve points, but the control points pulled well off the kappa ratio — a genuinely different curve, so it must stay a general path rather than being rounded off to the nearest ellipse.
  it("rejects a four-cubic path whose control points do not match the kappa ratio", () => {
    const { sink } = collectDiagnostics();
    const squarish = [
      "70 40 m",
      "70 60 60 60 40 60 c",
      "20 60 10 60 10 40 c",
      "10 20 20 20 40 20 c",
      "60 20 70 20 70 40 c",
      "h",
    ].join(" ");
    const items = interpretContentStream(
      textBytes(`1 0 0 rg ${squarish} f`),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]?.kind).toBe("path");
  });

  // Without `h` the subpath is open, and an open four-arc curve is not the closed shape a LayoutEllipse describes.
  it("rejects the same four arcs when the subpath is never closed", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes(`1 0 0 rg ${ELLIPSE_OPERATORS.replace(" h", "")} f`),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]?.kind).toBe("path");
  });
});

describe("interpretContentStream: lines", () => {
  it("recovers a single stroked segment as a line", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 1 RG 2 w 0 0 m 10 10 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "line",
        x1Pt: 0,
        y1Pt: 0,
        x2Pt: 10,
        y2Pt: 10,
        color: { r: 0, g: 0, b: 1 },
        widthPt: 2,
      },
    ]);
  });

  it("uses the PDF default line width of 1 when no w operator has set one", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 m 10 10 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "line",
        x1Pt: 0,
        y1Pt: 0,
        x2Pt: 10,
        y2Pt: 10,
        color: { r: 0, g: 0, b: 0 },
        widthPt: 1,
      },
    ]);
  });

  // A two-point path encloses no area, so a producer that filled one meant something other than a line — detectLine declines rather than guessing, and the fill survives on the general path.
  it("declines to call a filled two-point path a line", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 0 0 m 10 10 l f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]?.kind).toBe("path");
  });

  it("declines to call a two-segment stroked polyline a line", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 m 10 10 l 20 0 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]?.kind).toBe("path");
  });

  // The read-side half of content-write.ts's writeStrokeStyleState: a dash array with a nonzero on-length reads back as 'dashed', a zero on-length reads back as 'dotted' (see strokeStyleFromDashArray's own comment for why), and the PDF default of no dash array at all leaves style absent rather than reporting 'solid' as a value.
  it("recovers 'dashed' from a nonzero-on-length dash array", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("2 w [6 6] 0 d 0 0 m 10 10 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "line",
        x1Pt: 0,
        y1Pt: 0,
        x2Pt: 10,
        y2Pt: 10,
        color: { r: 0, g: 0, b: 0 },
        widthPt: 2,
        style: "dashed",
      },
    ]);
  });

  it("recovers 'dotted' from a zero-on-length dash array", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("2 w [0 4] 0 d 1 J 0 0 m 10 10 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "line",
        x1Pt: 0,
        y1Pt: 0,
        x2Pt: 10,
        y2Pt: 10,
        color: { r: 0, g: 0, b: 0 },
        widthPt: 2,
        style: "dotted",
      },
    ]);
  });

  it("leaves style absent once a dash array is reset back to empty", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("2 w [6 6] 0 d [] 0 d 0 0 m 10 10 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "line",
        x1Pt: 0,
        y1Pt: 0,
        x2Pt: 10,
        y2Pt: 10,
        color: { r: 0, g: 0, b: 0 },
        widthPt: 2,
      },
    ]);
  });
});

describe("interpretContentStream: general paths", () => {
  it("recovers an open multi-segment path with just a stroke, no fill", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 1 RG 2 w 0 0 m 10 10 l 20 0 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "path",
        subpaths: [
          {
            startXPt: 0,
            startYPt: 0,
            closed: false,
            segments: [
              { kind: "line", xPt: 10, yPt: 10 },
              { kind: "line", xPt: 20, yPt: 0 },
            ],
          },
        ],
        fillRule: "nonzero",
        fill: undefined,
        stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 },
      },
    ]);
  });

  it("recovers a closed path with both fill and stroke set", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 0 0 0 RG 3 w 0 0 m 10 0 l 10 10 l h B"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "path",
        subpaths: [
          {
            startXPt: 0,
            startYPt: 0,
            closed: true,
            segments: [
              { kind: "line", xPt: 10, yPt: 0 },
              { kind: "line", xPt: 10, yPt: 10 },
            ],
          },
        ],
        fillRule: "nonzero",
        fill: { r: 1, g: 0, b: 0 },
        stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 3 },
      },
    ]);
  });

  it("derives a v operator's implicit first control point from the current point", () => {
    const { sink } = collectDiagnostics();
    // v's only operands are control point 2 (20,10) and the endpoint (30,0); control point 1 must come out equal to the current point, (0,0).
    const items = interpretContentStream(
      textBytes("0 0 1 RG 0 0 m 20 10 30 0 v S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "path") {
      throw new Error("expected a path item");
    }
    expect(item.subpaths).toEqual([
      {
        startXPt: 0,
        startYPt: 0,
        closed: false,
        segments: [
          {
            kind: "cubic",
            c1xPt: 0,
            c1yPt: 0,
            c2xPt: 20,
            c2yPt: 10,
            xPt: 30,
            yPt: 0,
          },
        ],
      },
    ]);
  });

  it("derives a y operator's implicit second control point from the endpoint", () => {
    const { sink } = collectDiagnostics();
    // y's only operands are control point 1 (10,10) and the endpoint (30,0); control point 2 must come out equal to that same endpoint.
    const items = interpretContentStream(
      textBytes("0 0 1 RG 0 0 m 10 10 30 0 y S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "path") {
      throw new Error("expected a path item");
    }
    expect(item.subpaths).toEqual([
      {
        startXPt: 0,
        startYPt: 0,
        closed: false,
        segments: [
          {
            kind: "cubic",
            c1xPt: 10,
            c1yPt: 10,
            c2xPt: 30,
            c2yPt: 0,
            xPt: 30,
            yPt: 0,
          },
        ],
      },
    ]);
  });

  it('recovers multiple subpaths under an even-odd fill rule, the standard "hole" construction', () => {
    const { sink } = collectDiagnostics();
    const outer = "0 0 m 20 0 l 20 20 l 0 20 l h";
    const inner = "5 5 m 15 5 l 15 15 l 5 15 l h";
    const items = interpretContentStream(
      textBytes(`0 0 0 rg ${outer} ${inner} f*`),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "path") {
      throw new Error("expected a path item");
    }
    expect(item.subpaths).toHaveLength(2);
    expect(item.fillRule).toBe("evenodd");
    expect(item.fill).toEqual({ r: 0, g: 0, b: 0 });
    expect(item.stroke).toBeUndefined();
  });

  it("emits nothing for n, even when a real path was constructed, since a clip-only path has no ink", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 m 10 10 l 10 0 l h n"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([]);
  });

  it("uses the PDF default line width of 1 when no w operator has set one", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 m 10 10 l 20 0 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "path") {
      throw new Error("expected a path item");
    }
    expect(item.stroke).toEqual({ color: { r: 0, g: 0, b: 0 }, widthPt: 1 });
  });
});

describe("interpretContentStream: save/restore", () => {
  it("restores fill colour after Q", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg q 0 1 0 rg 0 0 1 1 re f Q 0 0 5 5 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ fill: { r: 0, g: 1, b: 0 } });
    expect(items[1]).toMatchObject({ fill: { r: 1, g: 0, b: 0 } });
  });
});
