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
