import { describe, expect, it } from "vitest";
import type { PdfDiagnostic, PdfDiagnosticSink } from "./diagnostics";
import type { FontMetricsPort, PdfObjectResolver } from "./interpret";
import { interpretContentStream } from "./interpret";
import type { PdfDict, PdfObject } from "./objects";
import {
  asDict,
  pdfArray,
  pdfDict,
  pdfName,
  pdfNum,
  pdfRef,
  pdfStream,
} from "./objects";

function collectDiagnostics(): {
  sink: PdfDiagnosticSink;
  diagnostics: PdfDiagnostic[];
} {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
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

function unresolvableFontMetrics(): FontMetricsPort {
  return { glyphAdvance: () => undefined, isVertical: () => false };
}

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined =>
    obj?.kind === "ref" ? objects.get(obj.num) : obj;
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined =>
    asDict(resolve(obj));
  return { resolve, resolveDict };
}

const EMPTY_RESOURCES = pdfDict({});

describe("interpretContentStream: text", () => {
  it("extracts a positioned text run with its font size and starting matrix", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 12 Tf 10 50 Td (Hi) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(1);
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.fontResourceName).toBe("F1");
    expect(item.sizePt).toBe(12);
    expect(item.startMatrix).toEqual([12, 0, 0, 12, 10, 50]);
    expect(Array.from(item.codes)).toEqual(Array.from(textBytes("Hi")));
  });

  it("uses the current fill colour (rg) for the text run", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg BT /F1 12 Tf 0 0 Td (X) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.color).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("advances the end matrix by the measured glyph widths, applying word spacing only to a single-byte space code", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td 2 Tw (A B) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    // Three glyphs at width 5 each (500/1000 * 10) plus Tw=2 applied once, to the space alone: 5 + (5+2) + 5 = 17.
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 17, 0]);
  });

  it("does not apply word spacing to a byte value 0x20 inside a multi-byte code", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td 2 Tw <004100200042> Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 2),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 15, 0]);
  });

  it("folds a TJ array's numeric kerning adjustments into one combined run", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) -100 (V)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(1);
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a single combined text item");
    }
    expect(Array.from(item.codes)).toEqual(Array.from(textBytes("AV")));
    // 'A' (5) + kerning adjustment (100/1000 * 10 = 1) + 'V' (5) = 11.
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 11, 0]);
  });

  it("applies a rotated CTM to the text rendering matrix", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 1 -1 0 0 0 cm BT /F1 10 Tf 0 0 Td (X) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.startMatrix).toEqual([0, 10, -10, 0, 0, 0]);
  });

  it("reports a diagnostic and falls back to a default width when the font cannot be resolved", () => {
    const { sink, diagnostics } = collectDiagnostics();
    interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td (A) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: unresolvableFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(diagnostics.some((d) => d.code === "pdf/font-not-resolved")).toBe(
      true,
    );
  });

  it("keeps the font selected by an earlier Tf across a new BT with no Tf of its own", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 12 Tf 0 0 Td (First) Tj ET BT 0 -20 Td (Second) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(2);
    const [first, second] = items;
    if (first?.kind !== "text" || second?.kind !== "text") {
      throw new Error("expected two text items");
    }
    expect(first.fontResourceName).toBe("F1");
    expect(second.fontResourceName).toBe("F1");
    expect(Array.from(second.codes)).toEqual(Array.from(textBytes("Second")));
  });

  it("still resets the text matrix and text line matrix to identity at BT, even though the font and other text state parameters persist", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      // Td moves the (persisted) text line matrix before the first ET; a fresh BT must not carry that translation into the second run, or "Second" would start at (0, 30) instead of (0, 0).
      textBytes("BT /F1 12 Tf 0 30 Td (First) Tj ET BT (Second) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [, second] = items;
    if (second?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(second.startMatrix).toEqual([12, 0, 0, 12, 0, 0]);
  });
});

// ISO 32000-1 Table 52 lists the text state parameters (font and size, character spacing, word spacing, horizontal scaling, leading, rise) among the device-independent graphics state parameters, so `q` saves them and `Q` restores them exactly as it does the CTM or the fill colour. Only the text matrix and text line matrix are excluded — those are text object state (9.4.1), reset by BT and untouched by q/Q.
describe("interpretContentStream: text state is graphics state", () => {
  it("restores the font a Q's matching q selected, so a Tf inside the pair does not leak past it", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes(
        "BT /F1 12 Tf (First) Tj ET q /F2 24 Tf Q BT 0 -20 Td (Second) Tj ET",
      ),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(2);
    const [first, second] = items;
    if (first?.kind !== "text" || second?.kind !== "text") {
      throw new Error("expected two text items");
    }
    expect(first.fontResourceName).toBe("F1");
    expect(first.sizePt).toBe(12);
    expect(second.fontResourceName).toBe("F1");
    expect(second.sizePt).toBe(12);
  });

  it("restores character spacing across a q/Q pair", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("/F1 10 Tf 0 Tc q 100 Tc Q BT 0 0 Td (AB) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    // Two glyphs at width 5 each (500/1000 * 10) with the restored Tc=0: 10, not the 210 a leaked Tc=100 would give.
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 10, 0]);
  });

  it("restores word spacing across a q/Q pair", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("/F1 10 Tf q 40 Tw Q BT 0 0 Td (A B) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 15, 0]);
  });

  it("restores horizontal scaling across a q/Q pair", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("/F1 10 Tf q 50 Tz Q BT 0 0 Td (A) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.startMatrix).toEqual([10, 0, 0, 10, 0, 0]);
  });

  it("restores leading across a q/Q pair, so T* advances by the outer TL", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("/F1 10 Tf 20 TL q 5 TL Q BT 0 0 Td (A) Tj T* (B) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [, second] = items;
    if (second?.kind !== "text") {
      throw new Error("expected a second text item");
    }
    expect(second.startMatrix).toEqual([10, 0, 0, 10, 0, -20]);
  });

  it("restores text rise across a q/Q pair", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("/F1 10 Tf q 5 Ts Q BT 0 0 Td (A) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.startMatrix).toEqual([10, 0, 0, 10, 0, 0]);
  });

  it("applies Ts as a rise on the text rendering matrix's own y translation", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("/F1 10 Tf 5 Ts BT 0 0 Td (A) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.startMatrix).toEqual([10, 0, 0, 10, 0, 5]);
  });

  it("keeps a text-state change made outside any q/Q pair, which no Q ever unwinds", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("q 1 0 0 1 0 0 cm Q /F2 24 Tf BT 0 0 Td (X) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.fontResourceName).toBe("F2");
    expect(item.sizePt).toBe(24);
  });

  it("leaves the text matrix untouched by Q, since Tm/Tlm are text object state rather than graphics state", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf q 0 0 Td Q 30 40 Td (X) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.startMatrix).toEqual([10, 0, 0, 10, 30, 40]);
  });
});

describe("interpretContentStream: axis-aligned rectangles", () => {
  it("recovers a rectangle painted under a non-rotated CTM", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 10 10 50 20 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "rect",
        xPt: 10,
        yPt: 10,
        widthPt: 50,
        heightPt: 20,
        fill: { r: 1, g: 0, b: 0 },
        stroke: undefined,
      },
    ]);
  });

  it("recovers a stroke-only rectangle, not just a filled one", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 1 RG 3 w 10 10 50 20 re S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "rect",
        xPt: 10,
        yPt: 10,
        widthPt: 50,
        heightPt: 20,
        fill: undefined,
        stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 3 },
      },
    ]);
  });

  it("recovers a rectangle painted with both fill and stroke by one B operator", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 0 0 1 RG 2 w 10 10 50 20 re B"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "rect",
        xPt: 10,
        yPt: 10,
        widthPt: 50,
        heightPt: 20,
        fill: { r: 1, g: 0, b: 0 },
        stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 },
      },
    ]);
  });

  // The same four corners a `re` would have produced, drawn by hand instead — a producer that constructs its rectangles corner by corner gets the same LayoutRect as one that uses the shape operator, because detection works on recovered geometry rather than on which operator built it.
  it("recovers a rectangle constructed corner by corner with m/l/l/l/h, not just one from a re operator", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 10 10 m 60 10 l 60 30 l 10 30 l h f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "rect",
        xPt: 10,
        yPt: 10,
        widthPt: 50,
        heightPt: 20,
        fill: { r: 1, g: 0, b: 0 },
        stroke: undefined,
      },
    ]);
  });

  // Same rectangle again, but with the closing edge drawn explicitly before `h` rather than left implicit — five points where the last repeats the first, which closedPolygonCorners collapses back to four.
  it("recovers a rectangle whose closing edge is drawn explicitly as well as closed", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 10 10 m 60 10 l 60 30 l 10 30 l 10 10 l h f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "rect",
        xPt: 10,
        yPt: 10,
        widthPt: 50,
        heightPt: 20,
        fill: { r: 1, g: 0, b: 0 },
        stroke: undefined,
      },
    ]);
  });

  // A 90-degree rotation maps an axis-aligned rectangle onto another axis-aligned rectangle, so the recovered corners still describe a real rect — with the CTM's own width/height swap applied.
  it("still recovers a rectangle under a 90-degree CTM rotation, with its sides swapped", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 1 -1 0 0 0 cm 10 10 50 20 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "rect",
        xPt: -30,
        yPt: 10,
        widthPt: 20,
        heightPt: 50,
        fill: { r: 0, g: 0, b: 0 },
        stroke: undefined,
      },
    ]);
  });

  // 30 degrees leaves no pair of edges axis-aligned, so there is no LayoutRect that could describe the result — the general path is the only honest recovery.
  it("falls through to a general path when the CTM rotation is not a multiple of 90 degrees", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0.866 0.5 -0.5 0.866 0 0 cm 0 0 10 10 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]?.kind).toBe("path");
  });

  it("leaves a rectangle mixed with another subpath as one general path, since no single rect describes both", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("10 10 50 20 re 0 0 m 1 1 l S f"),
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
            startXPt: 10,
            startYPt: 10,
            closed: true,
            segments: [
              { kind: "line", xPt: 60, yPt: 10 },
              { kind: "line", xPt: 60, yPt: 30 },
              { kind: "line", xPt: 10, yPt: 30 },
            ],
          },
          {
            startXPt: 0,
            startYPt: 0,
            closed: false,
            segments: [{ kind: "line", xPt: 1, yPt: 1 }],
          },
        ],
        fillRule: "nonzero",
        fill: undefined,
        stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
      },
    ]);
  });
});

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

describe("interpretContentStream: XObjects", () => {
  it("extracts an image placement from Do", () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([
      [
        10,
        pdfStream(
          pdfDict({
            Type: pdfName("XObject"),
            Subtype: pdfName("Image"),
            Width: pdfNum(2),
            Height: pdfNum(2),
          }),
          new Uint8Array([1, 2, 3]),
        ),
      ],
    ]);
    const resources = pdfDict({ XObject: pdfDict({ Im1: pdfRef(10, 0) }) });
    const items = interpretContentStream(
      textBytes("q 1 0 0 1 5 5 cm /Im1 Do Q"),
      resources,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(objects),
        sink,
      },
    );
    expect(items).toEqual([
      {
        kind: "image",
        resourceName: "Im1",
        resources,
        matrix: [1, 0, 0, 1, 5, 5],
      },
    ]);
  });

  it("recurses into a Form XObject, composing its own /Matrix into the CTM", () => {
    const { sink } = collectDiagnostics();
    const formDict = pdfDict({
      Type: pdfName("XObject"),
      Subtype: pdfName("Form"),
      Matrix: pdfArray([
        pdfNum(1),
        pdfNum(0),
        pdfNum(0),
        pdfNum(1),
        pdfNum(2),
        pdfNum(3),
      ]),
    });
    const objects = new Map<number, PdfObject>([
      [20, pdfStream(formDict, textBytes("1 0 0 rg 0 0 10 10 re f"))],
    ]);
    const resources = pdfDict({ XObject: pdfDict({ Fm1: pdfRef(20, 0) }) });
    const items = interpretContentStream(textBytes("/Fm1 Do"), resources, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(objects),
      sink,
    });
    expect(items).toEqual([
      {
        kind: "rect",
        xPt: 2,
        yPt: 3,
        widthPt: 10,
        heightPt: 10,
        fill: { r: 1, g: 0, b: 0 },
        stroke: undefined,
      },
    ]);
  });

  // ISO 32000-1 8.10.2: a form XObject's content stream executes in the graphics state in effect at the moment of Do, as if it were nested inline inside an implicit q/Q pair — so the text state travels inward, and the form's own changes to it do not travel back out.
  it("runs a Form XObject in the caller's text state, so a form with no Tf of its own draws in the inherited font", () => {
    const { sink } = collectDiagnostics();
    const formDict = pdfDict({
      Type: pdfName("XObject"),
      Subtype: pdfName("Form"),
    });
    const objects = new Map<number, PdfObject>([
      [30, pdfStream(formDict, textBytes("BT (FormText) Tj ET"))],
    ]);
    const resources = pdfDict({ XObject: pdfDict({ Fm2: pdfRef(30, 0) }) });
    const items = interpretContentStream(
      textBytes("BT /F1 12 Tf (Outer) Tj ET /Fm2 Do"),
      resources,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(objects),
        sink,
      },
    );
    expect(items).toHaveLength(2);
    const [outer, inner] = items;
    if (outer?.kind !== "text" || inner?.kind !== "text") {
      throw new Error("expected two text items");
    }
    expect(Array.from(outer.codes)).toEqual(Array.from(textBytes("Outer")));
    expect(Array.from(inner.codes)).toEqual(Array.from(textBytes("FormText")));
    expect(inner.fontResourceName).toBe("F1");
    expect(inner.sizePt).toBe(12);
  });

  it("does not let a Form XObject's own text-state changes survive back into the caller", () => {
    const { sink } = collectDiagnostics();
    const formDict = pdfDict({
      Type: pdfName("XObject"),
      Subtype: pdfName("Form"),
    });
    const objects = new Map<number, PdfObject>([
      [31, pdfStream(formDict, textBytes("BT /F2 24 Tf 8 Tc (Inner) Tj ET"))],
    ]);
    const resources = pdfDict({ XObject: pdfDict({ Fm3: pdfRef(31, 0) }) });
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf (Outer) Tj ET /Fm3 Do BT 0 0 Td (After) Tj ET"),
      resources,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(objects),
        sink,
      },
    );
    expect(items).toHaveLength(3);
    const [, inner, after] = items;
    if (inner?.kind !== "text" || after?.kind !== "text") {
      throw new Error("expected text items from the form and after it");
    }
    expect(inner.fontResourceName).toBe("F2");
    expect(after.fontResourceName).toBe("F1");
    expect(after.sizePt).toBe(10);
    // Five glyphs at width 5 each with the caller's own Tc=0, not the form's Tc=8.
    expect(after.endMatrix).toEqual([10, 0, 0, 10, 25, 0]);
  });

  it("stops a self-referential chain of forms at the recursion depth limit, with a diagnostic", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const selfResources = pdfDict({
      XObject: pdfDict({ SelfRef: pdfRef(40, 0) }),
    });
    const formDict = pdfDict({
      Type: pdfName("XObject"),
      Subtype: pdfName("Form"),
      Resources: selfResources,
    });
    const objects = new Map<number, PdfObject>([
      [40, pdfStream(formDict, textBytes("/SelfRef Do"))],
    ]);
    expect(() =>
      interpretContentStream(textBytes("/SelfRef Do"), selfResources, {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(objects),
        sink,
      }),
    ).not.toThrow();
    const recursionDiagnostic = diagnostics.find(
      (d) => d.code === "pdf/form-recursion-limit",
    );
    expect(recursionDiagnostic?.message).toBe(
      "form XObject recursion exceeded the depth limit; skipping further nesting",
    );
  });

  it("reports a diagnostic naming the resource when an XObject resource does not resolve", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const resources = pdfDict({ XObject: pdfDict({}) });
    interpretContentStream(textBytes("/Missing Do"), resources, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    const xobjectDiagnostic = diagnostics.find(
      (d) => d.code === "pdf/xobject-not-resolved",
    );
    expect(xobjectDiagnostic?.message).toBe(
      "XObject resource /Missing did not resolve to a stream",
    );
  });

  it("resolves a Form XObject's own /Resources dict, not the caller's, when the form declares one", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const formDict = pdfDict({
      Type: pdfName("XObject"),
      Subtype: pdfName("Form"),
      Resources: pdfDict({
        XObject: pdfDict({ InnerImg: pdfRef(51, 0) }),
      }),
    });
    const objects = new Map<number, PdfObject>([
      [50, pdfStream(formDict, textBytes("/InnerImg Do"))],
      [
        51,
        pdfStream(
          pdfDict({ Type: pdfName("XObject"), Subtype: pdfName("Image") }),
          new Uint8Array([1]),
        ),
      ],
    ]);
    // The outer resources dict deliberately has no /InnerImg entry, so resolving it can only succeed through the form's own /Resources.
    const outerResources = pdfDict({
      XObject: pdfDict({ Fm4: pdfRef(50, 0) }),
    });
    const items = interpretContentStream(textBytes("/Fm4 Do"), outerResources, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(objects),
      sink,
    });
    expect(diagnostics).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "image",
      resourceName: "InnerImg",
      matrix: [1, 0, 0, 1, 0, 0],
    });
  });

  it("falls back to the caller's resources when a Form XObject declares no /Resources of its own", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const formDict = pdfDict({
      Type: pdfName("XObject"),
      Subtype: pdfName("Form"),
    });
    const objects = new Map<number, PdfObject>([
      [52, pdfStream(formDict, textBytes("/OuterImg Do"))],
      [
        53,
        pdfStream(
          pdfDict({ Type: pdfName("XObject"), Subtype: pdfName("Image") }),
          new Uint8Array([1]),
        ),
      ],
    ]);
    const outerResources = pdfDict({
      XObject: pdfDict({ Fm5: pdfRef(52, 0), OuterImg: pdfRef(53, 0) }),
    });
    const items = interpretContentStream(textBytes("/Fm5 Do"), outerResources, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(objects),
      sink,
    });
    expect(diagnostics).toEqual([]);
    expect(items[0]).toMatchObject({ kind: "image", resourceName: "OuterImg" });
  });

  it("leaves an image with no /OC of its own carrying no layerName property at all", () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([
      [
        60,
        pdfStream(
          pdfDict({ Type: pdfName("XObject"), Subtype: pdfName("Image") }),
          new Uint8Array([1]),
        ),
      ],
    ]);
    const resources = pdfDict({ XObject: pdfDict({ Im2: pdfRef(60, 0) }) });
    const items = interpretContentStream(textBytes("/Im2 Do"), resources, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(objects),
      sink,
      layerNameOf: () => undefined,
    });
    expect(items[0]).not.toHaveProperty("layerName");
  });

  it("leaves a Form XObject's own seeded scope with neither layerName nor mcid when neither is in effect", () => {
    const { sink } = collectDiagnostics();
    const formDict = pdfDict({
      Type: pdfName("XObject"),
      Subtype: pdfName("Form"),
    });
    const objects = new Map<number, PdfObject>([
      [61, pdfStream(formDict, textBytes("1 0 0 rg 0 0 10 10 re f"))],
    ]);
    const resources = pdfDict({ XObject: pdfDict({ Fm6: pdfRef(61, 0) }) });
    const items = interpretContentStream(textBytes("/Fm6 Do"), resources, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(objects),
      sink,
    });
    expect(items[0]).not.toHaveProperty("layerName");
    expect(items[0]).not.toHaveProperty("mcid");
  });
});

describe("interpretContentStream: inline images", () => {
  it("extracts an inline image with the current CTM", () => {
    const { sink } = collectDiagnostics();
    const pixelData = new Uint8Array([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0,
    ]);
    const content = new Uint8Array([
      ...textBytes("q 1 0 0 1 5 5 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID "),
      ...pixelData,
      ...textBytes(" EI Q"),
    ]);
    const items = interpretContentStream(content, EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(items).toHaveLength(1);
    const [item] = items;
    if (item?.kind !== "inlineImage") {
      throw new Error("expected an inline image item");
    }
    expect(item.matrix).toEqual([1, 0, 0, 1, 5, 5]);
    expect(Array.from(item.data)).toEqual(Array.from(pixelData));
  });
});

// g/G/k/K set a fill/stroke colour directly in DeviceGray/DeviceCMYK; sc/scn/SC/SCN dispatch on operand count instead (genericColor), since the colour space they act in was set separately by a prior cs/CS this v1 heuristic never resolves.
describe("interpretContentStream: device colour operators", () => {
  it("sets the fill colour to DeviceGray via g", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0.25 g 10 10 50 20 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ fill: { r: 0.25, g: 0.25, b: 0.25 } });
  });

  it("sets the stroke colour to DeviceGray via G", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0.75 G 2 w 0 0 m 10 10 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ color: { r: 0.75, g: 0.75, b: 0.75 } });
  });

  it("sets the fill colour to DeviceCMYK via k", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 1 1 0 k 10 10 50 20 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    // c=0 m=1 y=1 k=0: r=(1-0)*(1-0)=1, g=(1-1)*(1-0)=0, b=(1-1)*(1-0)=0.
    expect(items[0]).toMatchObject({ fill: { r: 1, g: 0, b: 0 } });
  });

  it("sets the stroke colour to DeviceCMYK via K, with a nonzero black component darkening every channel", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 0 0.5 K 2 w 0 0 m 10 10 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    // c=m=y=0, k=0.5: every channel is (1-0)*(1-0.5) = 0.5, not the 1 a k-insensitive formula would give.
    expect(items[0]).toMatchObject({ color: { r: 0.5, g: 0.5, b: 0.5 } });
  });

  it("dispatches sc with one numeric operand to DeviceGray", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0.4 sc 10 10 50 20 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ fill: { r: 0.4, g: 0.4, b: 0.4 } });
  });

  it("dispatches scn with three numeric operands to DeviceRGB", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0.1 0.2 0.3 scn 10 10 50 20 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ fill: { r: 0.1, g: 0.2, b: 0.3 } });
  });

  it("dispatches SC with four numeric operands to DeviceCMYK", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 1 1 0 SC 2 w 0 0 m 10 10 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ color: { r: 1, g: 0, b: 0 } });
  });

  it("dispatches SCN with four numeric operands to DeviceCMYK for the stroke colour", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 0 1 SCN 2 w 0 0 m 10 10 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ color: { r: 0, g: 0, b: 0 } });
  });

  it("leaves the fill colour unchanged when scn's operand count matches no known colour space (a bare pattern name)", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg /P1 scn 10 10 50 20 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    // genericColor sees zero numeric operands (the pattern name is not one) and returns undefined, so the prior rg colour survives.
    expect(items[0]).toMatchObject({ fill: { r: 1, g: 0, b: 0 } });
  });

  it("leaves the fill colour unchanged when scn is given two numeric operands, which matches no known colour space", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 0.5 0.5 scn 10 10 50 20 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ fill: { r: 1, g: 0, b: 0 } });
  });
});

describe("interpretContentStream: marked content spans", () => {
  it("stamps a text item with the layer name a BDC's named property list resolves to", () => {
    const { sink } = collectDiagnostics();
    const resources = pdfDict({
      Properties: pdfDict({ MC1: pdfDict({ OC: pdfName("L1") }) }),
    });
    const items = interpretContentStream(
      textBytes("/OC /MC1 BDC BT /F1 10 Tf (A) Tj ET EMC"),
      resources,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
        layerNameOf: (obj) => (obj?.kind === "name" ? obj.name : undefined),
      },
    );
    expect(items[0]).toMatchObject({ layerName: "L1" });
  });

  it("stamps a text item with the layer name a BDC's inline dict resolves to", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("/OC << /OC /L2 >> BDC BT /F1 10 Tf (A) Tj ET EMC"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
        layerNameOf: (obj) => (obj?.kind === "name" ? obj.name : undefined),
      },
    );
    expect(items[0]).toMatchObject({ layerName: "L2" });
  });

  it("reads /ActualText, /Alt and /MCID from a BDC's inline property dict onto a text item", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes(
        "/Span << /ActualText (Replacement) /Alt (Alternate) /MCID 5 >> BDC BT /F1 10 Tf (A) Tj ET EMC",
      ),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({
      actualText: "Replacement",
      alt: "Alternate",
      mcid: 5,
    });
  });

  it("stamps a non-text item with the layer name and MCID in scope too, but never ActualText or Alt", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes(
        "/Span << /ActualText (Ignored) /MCID 2 >> BDC 1 0 0 rg 10 10 50 20 re f EMC",
      ),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    expect(item).toMatchObject({ mcid: 2 });
    expect(item).not.toHaveProperty("actualText");
  });

  it("lets an inner span without its own layer fall through to the enclosing span's layer", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes(
        "/OC << /OC /Outer >> BDC /Span << /MCID 1 >> BDC BT /F1 10 Tf (A) Tj ET EMC EMC",
      ),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
        layerNameOf: (obj) => (obj?.kind === "name" ? obj.name : undefined),
      },
    );
    expect(items[0]).toMatchObject({ layerName: "Outer", mcid: 1 });
  });

  it("stops applying a span's properties to items shown after its EMC", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes(
        "/Span << /MCID 3 >> BDC BT /F1 10 Tf (Inside) Tj ET EMC BT /F1 10 Tf (Outside) Tj ET",
      ),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ mcid: 3 });
    expect(items[1]).not.toHaveProperty("mcid");
  });

  it("treats a named property list that does not resolve as no properties at all, rather than throwing", () => {
    const { sink } = collectDiagnostics();
    expect(() =>
      interpretContentStream(
        textBytes("/OC /Missing BDC BT /F1 10 Tf (A) Tj ET EMC"),
        EMPTY_RESOURCES,
        {
          fontMetrics: fixedWidthFontMetrics(),
          resolver: makeResolver(new Map()),
          sink,
        },
      ),
    ).not.toThrow();
  });

  it("scopes a bare BMC span's properties (none) without throwing, and still lets a nested BDC's own properties apply", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BMC /Span << /MCID 9 >> BDC BT /F1 10 Tf (A) Tj ET EMC EMC"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ mcid: 9 });
  });

  it("stamps an Image XObject with the layer name its own /OC resolves to", () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([
      [
        10,
        pdfStream(
          pdfDict({
            Type: pdfName("XObject"),
            Subtype: pdfName("Image"),
            OC: pdfName("ImgLayer"),
          }),
          new Uint8Array([1]),
        ),
      ],
    ]);
    const resources = pdfDict({ XObject: pdfDict({ Im1: pdfRef(10, 0) }) });
    const items = interpretContentStream(textBytes("/Im1 Do"), resources, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(objects),
      sink,
      layerNameOf: (obj) => (obj?.kind === "name" ? obj.name : undefined),
    });
    expect(items[0]).toMatchObject({ layerName: "ImgLayer" });
  });

  it("seeds a Form XObject's own content with the outer span's MCID in scope at the moment of Do", () => {
    const { sink } = collectDiagnostics();
    const formDict = pdfDict({
      Type: pdfName("XObject"),
      Subtype: pdfName("Form"),
    });
    const objects = new Map<number, PdfObject>([
      [20, pdfStream(formDict, textBytes("BT /F1 10 Tf (FormText) Tj ET"))],
    ]);
    const resources = pdfDict({ XObject: pdfDict({ Fm1: pdfRef(20, 0) }) });
    const items = interpretContentStream(
      textBytes("/Span << /MCID 4 >> BDC /Fm1 Do EMC"),
      resources,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(objects),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ mcid: 4 });
  });

  it("does not seed a Form XObject with the outer MCID when the form declares its own /StructParents", () => {
    const { sink } = collectDiagnostics();
    const formDict = pdfDict({
      Type: pdfName("XObject"),
      Subtype: pdfName("Form"),
      StructParents: pdfNum(0),
    });
    const objects = new Map<number, PdfObject>([
      [21, pdfStream(formDict, textBytes("BT /F1 10 Tf (FormText) Tj ET"))],
    ]);
    const resources = pdfDict({ XObject: pdfDict({ Fm2: pdfRef(21, 0) }) });
    const items = interpretContentStream(
      textBytes("/Span << /MCID 4 >> BDC /Fm2 Do EMC"),
      resources,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(objects),
        sink,
      },
    );
    expect(items[0]).not.toHaveProperty("mcid");
  });

  it("includes an /MCID of exactly 0, the lowest valid value", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("/Span << /MCID 0 >> BDC BT /F1 10 Tf (A) Tj ET EMC"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ mcid: 0 });
  });

  it("excludes a negative /MCID as invalid, rather than stamping it", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("/Span << /MCID -1 >> BDC BT /F1 10 Tf (A) Tj ET EMC"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).not.toHaveProperty("mcid");
  });

  it("pops exactly the frame BMC pushed, so a scope closed after it correctly restores the enclosing span rather than over-popping it", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("/OC << /OC /Outer >> BDC BMC EMC BT /F1 10 Tf (A) Tj ET EMC"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
        layerNameOf: (obj) => (obj?.kind === "name" ? obj.name : undefined),
      },
    );
    // Had BMC failed to push its own frame, EMC would instead pop the outer BDC's frame, and the text below would show with no layer at all.
    expect(items[0]).toMatchObject({ layerName: "Outer" });
  });

  it("voids a BDC's own MCID when it is opened inside a recursed form's own content, rather than inheriting the caller's", () => {
    const { sink } = collectDiagnostics();
    const formDict = pdfDict({
      Type: pdfName("XObject"),
      Subtype: pdfName("Form"),
    });
    const objects = new Map<number, PdfObject>([
      [
        22,
        pdfStream(
          formDict,
          textBytes("/Span << /MCID 99 >> BDC BT /F1 10 Tf (Inner) Tj ET EMC"),
        ),
      ],
    ]);
    const resources = pdfDict({ XObject: pdfDict({ Fm3: pdfRef(22, 0) }) });
    const items = interpretContentStream(textBytes("/Fm3 Do"), resources, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(objects),
      sink,
    });
    // The form declares its own MCID 99 at depth 1, which is page-scoped to the FORM's own /StructParents key, not the outer page's parent tree, so it must not surface as if it were.
    expect(items[0]).not.toHaveProperty("mcid");
  });
});

describe("interpretContentStream: vertical writing mode", () => {
  function verticalFontMetrics(): FontMetricsPort {
    return {
      glyphAdvance: () => ({
        widthPer1000: 500,
        byteLengthConsumed: 1,
        vertical: {
          displacementPer1000: -1000,
          positionXPer1000: 50,
          positionYPer1000: 880,
        },
      }),
      isVertical: () => true,
    };
  }

  it("advances the end matrix along y rather than x for a vertically set font", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td (AB) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: verticalFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.vertical).toBe(true);
    // Two glyphs, each displacing -1000/1000 * 10 = -10pt along y: the run's y-advance (ignoring the position-vector shift both matrices share) is -20.
    expect(item.endMatrix[5] - item.startMatrix[5]).toBeCloseTo(-20);
    expect(item.endMatrix[4]).toBe(item.startMatrix[4]);
  });

  it("applies a TJ array's numeric adjustment along y, not x, for a vertically set font", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [(A) -200 (B)] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: verticalFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    // Extra y-only adjustment on top of the two glyph advances: -(-200/1000)*10 = 2, so total y-advance is -20 + 2 = -18, and x stays flat throughout.
    expect(item.endMatrix[5] - item.startMatrix[5]).toBeCloseTo(-18);
    expect(item.endMatrix[4]).toBe(item.startMatrix[4]);
  });

  it("shifts start and end matrices by the first glyph's own position vector for a vertical run", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td (A) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: verticalFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    // positionXPer1000/positionYPer1000 of 50/880 in glyph space, at font size 10, shift by -(50/1000*10)=-0.5 in x and -(880/1000*10)=-8.8 in y.
    expect(item.startMatrix[4]).toBeCloseTo(-0.5);
    expect(item.startMatrix[5]).toBeCloseTo(-8.8);
  });

  it("leaves start and end matrices unshifted when a vertical font's glyph carries no position vector", () => {
    const { sink } = collectDiagnostics();
    const noVectorMetrics: FontMetricsPort = {
      glyphAdvance: () => ({ widthPer1000: 500, byteLengthConsumed: 1 }),
      isVertical: () => true,
    };
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td (A) Tj ET"),
      EMPTY_RESOURCES,
      { fontMetrics: noVectorMetrics, resolver: makeResolver(new Map()), sink },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.startMatrix).toEqual([10, 0, 0, 10, 0, 0]);
  });
});

describe("interpretContentStream: text-showing operators and operand-array edge cases", () => {
  it("sets leading from TD's own operand, unlike Td which leaves leading untouched", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td (A) Tj 0 -15 TD (B) Tj T* (C) Tj ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [, , third] = items;
    if (third?.kind !== "text") {
      throw new Error("expected a third text item");
    }
    // TD moves like Td (its own tx/ty, here -15 in y) and additionally sets leading to -ty (15), so the T* that follows moves by that same 15 again: -15 + -15 = -30.
    expect(third.startMatrix).toEqual([10, 0, 0, 10, 0, -30]);
  });

  it("moves to the next line before showing text via the ' operator", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 20 TL 0 0 Td (First) '"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(1);
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    // ' is defined as T* followed by a show of its own single string operand: the leading-20 move lands the run at y=-20, not y=0.
    expect(Array.from(item.codes)).toEqual(Array.from(textBytes("First")));
    expect(item.startMatrix).toEqual([10, 0, 0, 10, 0, -20]);
  });

  it('sets word and character spacing, moves to the next line, and shows text via the " operator', () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes('BT /F1 10 Tf 20 TL 0 0 Td 3 1 (A B) "'),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "text") {
      throw new Error("expected a text item");
    }
    expect(item.startMatrix).toEqual([10, 0, 0, 10, 0, -20]);
    // Three glyphs at width 5 each plus Tc=1 twice (between A-space and space-B) and Tw=3 once (on the space): 5+1 + (5+1+3) + 5+1 = 21.
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 21, -20]);
  });

  it("pushes no item for a TJ array made only of numeric adjustments, with no string to show", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("BT /F1 10 Tf 0 0 Td [-100 -200] TJ ET"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(500, 1),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items).toHaveLength(0);
  });

  it("ignores an operator outside v1's extraction scope without throwing or emitting an item", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("/GS1 gs 10 10 50 20 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    // The unrecognised `gs` operator (ExtGState) is silently skipped; the rect that follows still extracts normally.
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("rect");
  });
});

describe("interpretContentStream: path-painting operator variants", () => {
  it("fills via F exactly as f does", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 10 10 50 20 re F"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({
      kind: "rect",
      fill: { r: 1, g: 0, b: 0 },
    });
  });

  it("reports the even-odd fill rule for f*, on a path too general to classify as a shape", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 0 0 m 10 0 l 5 10 l 0 5 l 10 5 l h f*"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ kind: "path", fillRule: "evenodd" });
  });

  it("closes the current subpath implicitly before stroking it via s, unlike S which leaves it open", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 1 RG 2 w 0 0 m 10 0 l 10 10 l s"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    // s implicitly closes with a fourth point back at (0,0), giving a closed 3-segment triangle that stays a general path (not 1 segment, so not a line) rather than the open polyline S would have left.
    expect(items[0]).toMatchObject({ kind: "path" });
    const item = items[0];
    if (item?.kind !== "path") {
      throw new Error("expected a path item");
    }
    expect(item.subpaths[0]?.closed).toBe(true);
  });

  it("fills and strokes a closed triangle via b, implicitly closing it first", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 0 0 1 RG 2 w 0 0 m 10 0 l 10 10 l b"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({
      kind: "path",
      fill: { r: 1, g: 0, b: 0 },
      stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 },
    });
  });

  it("fills and strokes with the even-odd rule via b*, implicitly closing it first", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 0 0 1 RG 2 w 0 0 m 10 0 l 10 10 l b*"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]).toMatchObject({ kind: "path", fillRule: "evenodd" });
    const item = items[0];
    if (item?.kind !== "path") {
      throw new Error("expected a path item");
    }
    expect(item.subpaths[0]?.closed).toBe(true);
  });

  it("clears all path state via n, with no item emitted and no stale subpath carried into what follows", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 m 10 10 l n 20 20 m 30 30 l S"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    // Had n failed to reset path state, the second m/l would join the first as a second subpath of one combined multi-subpath path rather than its own independent line.
    expect(items).toEqual([
      {
        kind: "line",
        x1Pt: 20,
        y1Pt: 20,
        x2Pt: 30,
        y2Pt: 30,
        color: { r: 0, g: 0, b: 0 },
        widthPt: 1,
      },
    ]);
  });

  it("finalizes a subpath already open from m before re starts its own, rather than merging them", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("0 0 m 10 10 l 20 20 30 40 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    const [item] = items;
    if (item?.kind !== "path") {
      throw new Error("expected a general path from two distinct subpaths");
    }
    expect(item.subpaths).toHaveLength(2);
  });
});

describe("interpretContentStream: shape detection boundary cases", () => {
  it("falls through to a general path when a closed subpath collapses to a single point", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 5 5 m h f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]?.kind).toBe("path");
  });

  it("rejects a degenerate zero-width rectangle, treating it as a general path instead", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 10 10 0 20 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]?.kind).toBe("path");
  });

  it("rejects a degenerate zero-height rectangle, treating it as a general path instead", () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(
      textBytes("1 0 0 rg 10 10 20 0 re f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]?.kind).toBe("path");
  });

  it("rejects a bowtie quadrilateral (crossed edges) even though its corners sit on the right extremes", () => {
    const { sink } = collectDiagnostics();
    // Corners at the four extremes of a 0..10 box, but traversed so the second and fourth edges cross the middle diagonally instead of running along one axis.
    const items = interpretContentStream(
      textBytes("1 0 0 rg 0 0 m 10 10 l 10 0 l 0 10 l h f"),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]?.kind).toBe("path");
  });

  it("rejects a four-cubic closed path whose bounding box is degenerately thin as an ellipse", () => {
    const { sink } = collectDiagnostics();
    // A "flattened" four-arc construction whose on-curve points collapse to a near-zero-height box.
    const flat = [
      "70 40 m",
      "70 40.001 56.5685 40 40 40 c",
      "23.4315 40 10 40.001 10 40 c",
      "10 39.999 23.4315 40 40 40 c",
      "56.5685 40 70 39.999 70 40 c",
      "h",
    ].join(" ");
    const items = interpretContentStream(
      textBytes(`1 0 0 rg ${flat} f`),
      EMPTY_RESOURCES,
      {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(new Map()),
        sink,
      },
    );
    expect(items[0]?.kind).toBe("path");
  });

  it("rejects a closed four-cubic path whose on-curve points do not sit at four distinct cardinal extremes", () => {
    const { sink } = collectDiagnostics();
    // Two on-curve points coincide at the same "right" extreme instead of visiting all four cardinal directions once each.
    const collapsed = [
      "70 40 m",
      "70 51.0457 70 51.0457 70 40 c",
      "23.4315 60 10 51.0457 10 40 c",
      "10 28.9543 23.4315 20 40 20 c",
      "56.5685 20 70 28.9543 70 40 c",
      "h",
    ].join(" ");
    const items = interpretContentStream(
      textBytes(`1 0 0 rg ${collapsed} f`),
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
