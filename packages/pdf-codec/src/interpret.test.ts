import { describe, expect, it } from "vitest";
import type { PdfDiagnostic, PdfDiagnosticSink } from "./diagnostics";
import type { FontMetricsPort, PdfObjectResolver } from "./interpret";
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
