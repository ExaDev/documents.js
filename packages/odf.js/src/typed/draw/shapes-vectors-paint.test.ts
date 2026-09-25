import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import { readDrawPageContent } from "./shapes";

function contentPackage(
  automaticStyleChildren: readonly XmlElement[] = [],
): Package["parts"][string] {
  return {
    kind: "xml",
    nodes: [
      el("office:document-content", {}, [
        el("office:automatic-styles", {}, automaticStyleChildren),
      ]),
    ],
  };
}

// Like contentPackage above, but ALSO populates content.xml's own office:styles container — the real placement of a named draw resource (<draw:gradient>/<draw:hatch>/<draw:fill-image>/<draw:stroke-dash>, OASIS ODF 1.3 section 16.42: "usable within the following element: <office:styles>"), a genuinely separate ODF vocabulary from style:style that a shape's own draw:fill-gradient-name/draw:fill-hatch-name/draw:fill-image-name/draw:stroke-dash attribute references by name rather than nests inside.

// Not specific to cm-conversion: the same numeric tolerance reused for floating-point rotation/geometry composition assertions elsewhere in this file.
const FLOAT_PRECISION_DIGITS = 6;

function graphicStyle(
  name: string,
  attrs: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, string>> = {},
): XmlElement {
  return el(
    "style:style",
    { "style:name": name, "style:family": "graphic", ...extra },
    [el("style:graphic-properties", attrs)],
  );
}

describe("readDrawPageContent: svg:fill-rule (path vectors only — rect/ellipse have no fillRule field at all)", () => {
  function pathWithProps(
    extra: Readonly<Record<string, string>> = {},
    styleAttrs: Readonly<Record<string, string>> = {},
  ): { path: XmlElement; pkg: Package } {
    const gr1 = graphicStyle("gr1", {
      "draw:fill-color": "#ff0000",
      ...styleAttrs,
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const path = el("draw:path", {
      "draw:style-name": "gr1",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "100pt",
      "svg:height": "100pt",
      "svg:viewBox": "0 0 4000 4000",
      "svg:d": "M0 4000h3000c1000 0 1000-4000-1000-4000z",
      ...extra,
    });
    return { path, pkg };
  }

  it('reads svg:fill-rule="evenodd" from the path\'s own graphic-family style', () => {
    const { path, pkg } = pathWithProps({}, { "svg:fill-rule": "evenodd" });
    const { vectors } = readDrawPageContent([path], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.fillRule).toBe("evenodd");
  });

  it('reads svg:fill-rule="nonzero" explicitly too, not just treating its absence as nonzero', () => {
    const { path, pkg } = pathWithProps({}, { "svg:fill-rule": "nonzero" });
    const { vectors } = readDrawPageContent([path], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.fillRule).toBe("nonzero");
  });

  it("leaves fillRule undefined when the style carries no svg:fill-rule at all — defaults to nonzero downstream, but is not fabricated here", () => {
    const { path, pkg } = pathWithProps();
    const { vectors } = readDrawPageContent([path], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.fillRule).toBeUndefined();
  });

  // A genuine two-subpath "letter O" shape: an outer square and an inner square "hole", both wound in the SAME rotational direction (right, down, left, up from each one's own top-left corner). This is the real-world case svg:fill-rule actually distinguishes — with two same-direction subpaths, 'nonzero' fills the inner square too (winding number 2 there, still != 0, so no hole at all), while 'evenodd' toggles at every boundary crossing and genuinely punches the hole (winding parity 0 inside the inner square). Both subpaths' own points are read back correctly regardless of fillRule — this test's real assertion is that reading the attribute itself survives the full readDrawPageContent path, not just a synthetic single-loop svg:d.
  it('reads svg:fill-rule="evenodd" from a real two-subpath donut/letter-O path with a hole', () => {
    const gr1 = graphicStyle("gr1", {
      "draw:fill-color": "#000000",
      "svg:fill-rule": "evenodd",
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const path = el("draw:path", {
      "draw:style-name": "gr1",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "100pt",
      "svg:height": "100pt",
      "svg:viewBox": "0 0 4000 4000",
      // Outer square (0,0)-(4000,4000), then inner square (1000,1000)-(3000,3000) — both traced right/down/left/up, i.e. the identical winding direction.
      "svg:d": "M0 0H4000V4000H0ZM1000 1000H3000V3000H1000Z",
    });
    const { vectors } = readDrawPageContent([path], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.fillRule).toBe("evenodd");
    expect(vector.subpaths).toHaveLength(2);
    expect(vector.subpaths[0]?.closed).toBe(true);
    expect(vector.subpaths[1]?.closed).toBe(true);
    // The inner subpath's own points survive intact (scaled from the shared 4000x4000 viewBox onto the 100pt x 100pt frame — 1000/4000 * 100 = 25, 3000/4000 * 100 = 75).
    expect(vector.subpaths[1]?.start).toEqual({ xPt: 25, yPt: 25 });
  });
});

describe("readDrawPageContent: stroke style (solid/dashed) from draw:stroke", () => {
  it('maps draw:stroke="dash" onto ContentStrokeSchema\'s own "dashed" member', () => {
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
      "draw:stroke": "dash",
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const rect = el("draw:rect", {
      "draw:style-name": "gr1",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const { vectors } = readDrawPageContent([rect], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    expect(vector.stroke?.style).toBe("dashed");
  });

  it('maps an explicit draw:stroke="solid" onto ContentStrokeSchema\'s own "solid" member', () => {
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
      "draw:stroke": "solid",
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const rect = el("draw:rect", {
      "draw:style-name": "gr1",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const { vectors } = readDrawPageContent([rect], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    expect(vector.stroke?.style).toBe("solid");
  });

  it("leaves style undefined when draw:stroke is absent — no fabricated default", () => {
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const rect = el("draw:rect", {
      "draw:style-name": "gr1",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const { vectors } = readDrawPageContent([rect], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    expect(vector.stroke?.style).toBeUndefined();
  });

  it("applies to draw:line strokes too, since readOdfFillAndStroke is shared — not just rect/ellipse/path", () => {
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
      "draw:stroke": "dash",
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const line = el("draw:line", {
      "draw:style-name": "gr1",
      "svg:x1": "0pt",
      "svg:y1": "0pt",
      "svg:x2": "10pt",
      "svg:y2": "10pt",
    });
    const { vectors } = readDrawPageContent([line], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "line") {
      throw new Error("expected a line vector");
    }
    expect(vector.stroke.style).toBe("dashed");
  });
});

describe("readDrawPageContent: fixed-preset and regular-polygon exact vertex coordinates", () => {
  function customShape(name: string, type: string): XmlElement {
    return el(
      "draw:custom-shape",
      {
        "draw:name": name,
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "50pt",
        "svg:height": "30pt",
      },
      [el("draw:enhanced-geometry", { "draw:type": type })],
    );
  }

  function pathVertices(type: string): { xPt: number; yPt: number }[] {
    const { vectors } = readDrawPageContent(
      [customShape(`Custom${type}`, type)],
      { parts: {} },
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error(`expected a path vector for preset "${type}"`);
    }
    const subpath = vector.subpaths[0];
    return [
      subpath!.start,
      ...subpath!.segments.map((s) =>
        s.kind === "line" ? s.to : { xPt: NaN, yPt: NaN },
      ),
    ];
  }

  it("isosceles-triangle's own three vertices: apex at top-centre, base spanning the full frame width at the bottom", () => {
    expect(pathVertices("isosceles-triangle")).toEqual([
      { xPt: 25, yPt: 0 },
      { xPt: 50, yPt: 30 },
      { xPt: 0, yPt: 30 },
    ]);
  });

  it("right-triangle's own three vertices: the right angle at the bottom-left corner", () => {
    expect(pathVertices("right-triangle")).toEqual([
      { xPt: 0, yPt: 0 },
      { xPt: 0, yPt: 30 },
      { xPt: 50, yPt: 30 },
    ]);
  });

  it("hexagon's own six vertices are evenly spaced around the frame's own centre, point-up", () => {
    const hexagonVertexCount = 6;
    const angularPrecisionDigits = 9;
    const vertices = pathVertices("hexagon");
    expect(vertices).toHaveLength(hexagonVertexCount);
    const cx = 25;
    const cy = 15;
    const expected = Array.from({ length: hexagonVertexCount }, (_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / hexagonVertexCount;
      return { xPt: cx + cx * Math.cos(angle), yPt: cy + cy * Math.sin(angle) };
    });
    vertices.forEach((v, i) => {
      expect(v.xPt).toBeCloseTo(expected[i]!.xPt, angularPrecisionDigits);
      expect(v.yPt).toBeCloseTo(expected[i]!.yPt, angularPrecisionDigits);
    });
    // The topmost vertex sits at dead centre horizontally, at the very top of the frame.
    expect(vertices[0]!.xPt).toBeCloseTo(cx, angularPrecisionDigits);
    expect(vertices[0]!.yPt).toBeCloseTo(0, angularPrecisionDigits);
    // The bottommost vertex (index 3, halfway round) sits at dead centre horizontally, at the very bottom.
    const bottommostVertexIndex = 3;
    expect(vertices[bottommostVertexIndex]!.xPt).toBeCloseTo(
      cx,
      angularPrecisionDigits,
    );
    expect(vertices[bottommostVertexIndex]!.yPt).toBeCloseTo(
      2 * cy,
      angularPrecisionDigits,
    );
  });

  it("round-rectangle's real rounded path carries every one of its 8 segments' own exact coordinates, not just the start point", () => {
    const modifierValue = 3600;
    const viewBoxSize = 21600;
    const w = 50;
    const h = 30;
    const shape = el(
      "draw:custom-shape",
      {
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": `${w}pt`,
        "svg:height": `${h}pt`,
      },
      [
        el(
          "draw:enhanced-geometry",
          {
            "svg:viewBox": `0 0 ${viewBoxSize} ${viewBoxSize}`,
            "draw:type": "round-rectangle",
            "draw:modifiers": `${modifierValue}`,
          },
          [el("draw:handle", { "draw:handle-position": "$0 0" })],
        ),
      ],
    );
    const { vectors } = readDrawPageContent([shape], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    const r = (modifierValue / viewBoxSize) * w; // ~8.333333pt
    // The standard cubic-bezier kappa constant for approximating a quarter circle: 4*(sqrt(2)-1)/3.
    const BEZIER_QUARTER_CIRCLE_KAPPA = 0.5522847498307936;
    const k = r * BEZIER_QUARTER_CIRCLE_KAPPA;
    const subpath = vector.subpaths[0]!;
    expect(subpath.start).toEqual({ xPt: r, yPt: 0 });
    expect(subpath.segments).toEqual([
      { kind: "line", to: { xPt: w - r, yPt: 0 } },
      {
        kind: "cubic",
        control1: { xPt: w - r + k, yPt: 0 },
        control2: { xPt: w, yPt: r - k },
        to: { xPt: w, yPt: r },
      },
      { kind: "line", to: { xPt: w, yPt: h - r } },
      {
        kind: "cubic",
        control1: { xPt: w, yPt: h - r + k },
        control2: { xPt: w - r + k, yPt: h },
        to: { xPt: w - r, yPt: h },
      },
      { kind: "line", to: { xPt: r, yPt: h } },
      {
        kind: "cubic",
        control1: { xPt: r - k, yPt: h },
        control2: { xPt: 0, yPt: h - r + k },
        to: { xPt: 0, yPt: h - r },
      },
      { kind: "line", to: { xPt: 0, yPt: r } },
      {
        kind: "cubic",
        control1: { xPt: 0, yPt: r - k },
        control2: { xPt: r - k, yPt: 0 },
        to: { xPt: r, yPt: 0 },
      },
    ]);
  });

  it("round-rectangle degrades to a plain rect when the shape's own svg:viewBox has a zero or negative width", () => {
    const shape = el(
      "draw:custom-shape",
      {
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "50pt",
        "svg:height": "30pt",
      },
      [
        el(
          "draw:enhanced-geometry",
          {
            "svg:viewBox": "0 0 0 21600",
            "draw:type": "round-rectangle",
            "draw:modifiers": "3600",
          },
          [el("draw:handle", { "draw:handle-position": "$0 0" })],
        ),
      ],
    );
    const { vectors } = readDrawPageContent([shape], { parts: {} });
    expect(vectors[0]?.kind).toBe("rect");
  });

  it("round-rectangle degrades to a plain rect when the resolved radius is zero or negative", () => {
    const shape = el(
      "draw:custom-shape",
      {
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "50pt",
        "svg:height": "30pt",
      },
      [
        el(
          "draw:enhanced-geometry",
          {
            "svg:viewBox": "0 0 21600 21600",
            "draw:type": "round-rectangle",
            "draw:modifiers": "0",
          },
          [el("draw:handle", { "draw:handle-position": "$0 0" })],
        ),
      ],
    );
    const { vectors } = readDrawPageContent([shape], { parts: {} });
    expect(vectors[0]?.kind).toBe("rect");
  });
});

describe("readDrawPageContent: fillPattern/fillOpacity carried through every vector kind, not only rect", () => {
  it("draw:ellipse carries fillOpacity through, the same as draw:rect", () => {
    const opacityPercent = 50;
    const percentScale = 100;
    const gr1 = graphicStyle("gr1", {
      "draw:fill-color": "#ff0000",
      "draw:opacity": `${opacityPercent}%`,
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const ellipse = el("draw:ellipse", {
      "draw:style-name": "gr1",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const { vectors } = readDrawPageContent([ellipse], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "ellipse") {
      throw new Error("expected an ellipse vector");
    }
    expect(vector.fillOpacity).toBeCloseTo(
      opacityPercent / percentScale,
      FLOAT_PRECISION_DIGITS,
    );
  });

  it("draw:path carries fillOpacity through, the same as draw:rect", () => {
    const opacityPercent = 50;
    const percentScale = 100;
    const gr1 = graphicStyle("gr1", {
      "draw:fill-color": "#ff0000",
      "draw:opacity": `${opacityPercent}%`,
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const path = el("draw:path", {
      "draw:style-name": "gr1",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
      "svg:viewBox": "0 0 100 100",
      "svg:d": "M0 0h100v100z",
    });
    const { vectors } = readDrawPageContent([path], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.fillOpacity).toBeCloseTo(
      opacityPercent / percentScale,
      FLOAT_PRECISION_DIGITS,
    );
  });

  it("a recognised custom-shape preset carries fillOpacity through, the same as a plain draw:rect", () => {
    const opacityPercent = 50;
    const percentScale = 100;
    const gr1 = graphicStyle("gr1", {
      "draw:fill-color": "#ff0000",
      "draw:opacity": `${opacityPercent}%`,
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const shape = el(
      "draw:custom-shape",
      {
        "draw:style-name": "gr1",
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "10pt",
        "svg:height": "10pt",
      },
      [el("draw:enhanced-geometry", { "draw:type": "ellipse" })],
    );
    const { vectors } = readDrawPageContent([shape], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "ellipse") {
      throw new Error("expected an ellipse vector");
    }
    expect(vector.fillOpacity).toBeCloseTo(
      opacityPercent / percentScale,
      FLOAT_PRECISION_DIGITS,
    );
  });
});
