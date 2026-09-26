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
