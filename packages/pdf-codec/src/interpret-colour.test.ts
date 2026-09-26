import { describe, expect, it } from "vitest";
import type { PdfDiagnostic, PdfDiagnosticSink } from "./diagnostics";
import type { FontMetricsPort, PdfObjectResolver } from "./interpret";
import { interpretContentStream } from "./interpret";
import type { PdfDict, PdfObject } from "./objects";
import { asDict, pdfDict, pdfName, pdfNum, pdfRef, pdfStream } from "./objects";

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
