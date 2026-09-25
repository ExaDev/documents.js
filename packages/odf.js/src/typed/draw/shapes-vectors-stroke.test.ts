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
function contentPackageWithResources(
  automaticStyleChildren: readonly XmlElement[],
  namedResourceChildren: readonly XmlElement[],
): Package["parts"][string] {
  return {
    kind: "xml",
    nodes: [
      el("office:document-content", {}, [
        el("office:styles", {}, namedResourceChildren),
        el("office:automatic-styles", {}, automaticStyleChildren),
      ]),
    ],
  };
}

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

const POINTS_PER_INCH = 72;
const CM_PER_INCH = 2.54;
const CM_PRECISION_DIGITS = 6;
// Not specific to cm-conversion: the same numeric tolerance reused for floating-point rotation/geometry composition assertions elsewhere in this file.
const FLOAT_PRECISION_DIGITS = 6;

describe("readDrawPageContent: stroke opacity and the real dash run-length pattern (ExaDev/documents.js#954)", () => {
  it("reads svg:stroke-opacity (a bare [0,1] double) into the stroke's own opacity field", () => {
    const strokeOpacity = 0.25;
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
      "svg:stroke-opacity": `${strokeOpacity}`,
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
    expect(vector.stroke?.opacity).toBeCloseTo(
      strokeOpacity,
      FLOAT_PRECISION_DIGITS,
    );
  });

  it("also accepts svg:stroke-opacity as a percentage", () => {
    const strokeOpacityPercent = 80;
    const percentScale = 100;
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
      "svg:stroke-opacity": `${strokeOpacityPercent}%`,
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
    expect(vector.stroke?.opacity).toBeCloseTo(
      strokeOpacityPercent / percentScale,
      FLOAT_PRECISION_DIGITS,
    );
  });

  it("resolves a \"dash\"-mode stroke's own named <draw:stroke-dash> definition into a real dashPattern, alongside the existing style: 'dashed'", () => {
    const dash = el("draw:stroke-dash", {
      "draw:name": "dash1",
      "draw:style": "rect",
      "draw:dots1": "1",
      "draw:dots1-length": "3pt",
      "draw:dots2": "2",
      "draw:dots2-length": "1pt",
      "draw:distance": "2pt",
    });
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
      "draw:stroke": "dash",
      "draw:stroke-dash": "dash1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [dash]) },
    };
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
    expect(vector.stroke?.dashPattern).toEqual({
      dots1: 1,
      dots1LengthPt: 3,
      dots2: 2,
      dots2LengthPt: 1,
      distancePt: 2,
    });
  });

  it("resolves a single-length dash pattern (no draw:dots2) with dots2/dots2LengthPt genuinely absent, not zero", () => {
    const dash = el("draw:stroke-dash", {
      "draw:name": "dash1",
      "draw:style": "rect",
      "draw:dots1": "4",
      "draw:dots1-length": "150%", // percentage of svg:stroke-width
      "draw:distance": "1pt",
    });
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "2pt",
      "draw:stroke": "dash",
      "draw:stroke-dash": "dash1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [dash]) },
    };
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
    expect(vector.stroke?.dashPattern).toEqual({
      dots1: 4,
      dots1LengthPt: 3, // 150% of the 2pt stroke width
      distancePt: 1,
    });
    expect(vector.stroke?.dashPattern?.dots2).toBeUndefined();
  });

  it("a dashed stroke whose named dash definition cannot be resolved keeps style: 'dashed' alone, with no fabricated dashPattern", () => {
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
      "draw:stroke": "dash",
      "draw:stroke-dash": "does-not-exist",
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
    expect(vector.stroke?.dashPattern).toBeUndefined();
  });

  it("a resolved dash definition with a non-positive draw:dots1 leaves dashPattern undefined — dots1/dots1-length/distance are jointly required", () => {
    const dash = el("draw:stroke-dash", {
      "draw:name": "dash1",
      "draw:style": "rect",
      "draw:dots1": "0",
      "draw:dots1-length": "3pt",
      "draw:distance": "2pt",
    });
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
      "draw:stroke": "dash",
      "draw:stroke-dash": "dash1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [dash]) },
    };
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
    expect(vector.stroke?.dashPattern).toBeUndefined();
  });

  it("a resolved dash definition with a non-positive draw:dots1-length leaves dashPattern undefined", () => {
    const dash = el("draw:stroke-dash", {
      "draw:name": "dash1",
      "draw:style": "rect",
      "draw:dots1": "1",
      "draw:dots1-length": "0pt",
      "draw:distance": "2pt",
    });
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
      "draw:stroke": "dash",
      "draw:stroke-dash": "dash1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [dash]) },
    };
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
    expect(vector.stroke?.dashPattern).toBeUndefined();
  });

  it("a resolved dash definition with a negative draw:distance leaves dashPattern undefined — a zero distance is itself valid (dots touching)", () => {
    const dash = el("draw:stroke-dash", {
      "draw:name": "dash1",
      "draw:style": "rect",
      "draw:dots1": "1",
      "draw:dots1-length": "3pt",
      "draw:distance": "-1pt",
    });
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
      "draw:stroke": "dash",
      "draw:stroke-dash": "dash1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [dash]) },
    };
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
    expect(vector.stroke?.dashPattern).toBeUndefined();
  });

  it("a resolved dash definition whose draw:dots2 is present but non-positive keeps the single-length pattern, with dots2/dots2LengthPt genuinely absent (not present-but-undefined)", () => {
    const dash = el("draw:stroke-dash", {
      "draw:name": "dash1",
      "draw:style": "rect",
      "draw:dots1": "4",
      "draw:dots1-length": "3pt",
      "draw:distance": "1pt",
      "draw:dots2": "0",
      "draw:dots2-length": "5pt",
    });
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
      "draw:stroke": "dash",
      "draw:stroke-dash": "dash1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [dash]) },
    };
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
    expect(vector.stroke?.dashPattern).toStrictEqual({
      dots1: 4,
      dots1LengthPt: 3,
      distancePt: 1,
    });
  });
});

describe("readDrawPageContent: draw:line", () => {
  it("reads svg:x1/y1/x2/y2 into the line variant's from/to points, requiring a resolvable stroke", () => {
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#0000ff",
      "svg:stroke-width": "0.03cm",
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const x1Cm = 9;
    const y2Cm = 4;
    const line = el("draw:line", {
      "draw:style-name": "gr1",
      "svg:x1": `${x1Cm}cm`,
      "svg:y1": "1cm",
      "svg:x2": "13cm",
      "svg:y2": `${y2Cm}cm`,
    });
    const { vectors } = readDrawPageContent([line], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "line") {
      throw new Error("expected a line vector");
    }
    expect(vector.from.xPt).toBeCloseTo(
      x1Cm * (POINTS_PER_INCH / CM_PER_INCH),
      CM_PRECISION_DIGITS,
    );
    expect(vector.to.yPt).toBeCloseTo(
      y2Cm * (POINTS_PER_INCH / CM_PER_INCH),
      CM_PRECISION_DIGITS,
    );
    expect(vector.stroke.color).toEqual({ r: 0, g: 0, b: 1 });
  });

  it("drops a line with no resolvable stroke — an invisible line has nothing to paint, matching ContentVectorSchema requiring stroke on the line variant", () => {
    const line = el("draw:line", {
      "svg:x1": "0pt",
      "svg:y1": "0pt",
      "svg:x2": "10pt",
      "svg:y2": "10pt",
    });
    expect(readDrawPageContent([line], { parts: {} }).vectors).toEqual([]);
  });

  it("applies an enclosing group's own draw:transform to both endpoints directly (no box/pivot needed for a two-point line)", () => {
    const gr1 = graphicStyle("gr1", {
      "svg:stroke-color": "#000000",
      "svg:stroke-width": "1pt",
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const line = el("draw:line", {
      "draw:style-name": "gr1",
      "svg:x1": "0pt",
      "svg:y1": "0pt",
      "svg:x2": "10pt",
      "svg:y2": "0pt",
    });
    const group = el("draw:g", { "draw:transform": "translate(5pt 5pt)" }, [
      line,
    ]);
    const { vectors } = readDrawPageContent([group], pkg);
    const vector = vectors[0];
    if (vector?.kind !== "line") {
      throw new Error("expected a line vector");
    }
    expect(vector.from).toEqual({ xPt: 5, yPt: 5 });
    expect(vector.to).toEqual({ xPt: 15, yPt: 5 });
  });
});

describe("readDrawPageContent: draw:path (svg:d) and draw:polygon/draw:polyline (draw:points)", () => {
  it('parses a real LibreOffice-written closed curve svg:d ("M0 4000h3000c1000 0 1000-4000-1000-4000z") into one line segment then one cubic segment, closed', () => {
    const path = el("draw:path", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "100pt",
      "svg:height": "100pt",
      "svg:viewBox": "0 0 4000 4000",
      "svg:d": "M0 4000h3000c1000 0 1000-4000-1000-4000z",
    });
    const { vectors } = readDrawPageContent([path], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.subpaths).toHaveLength(1);
    const subpath = vector.subpaths[0];
    // viewBox 4000x4000 -> frame 100x100pt: scale factor 0.025 on both axes.
    expect(subpath?.start).toEqual({ xPt: 0, yPt: 100 });
    expect(subpath?.closed).toBe(true);
    expect(subpath?.segments).toEqual([
      { kind: "line", to: { xPt: 75, yPt: 100 } },
      {
        kind: "cubic",
        control1: { xPt: 100, yPt: 100 },
        control2: { xPt: 100, yPt: 0 },
        to: { xPt: 50, yPt: 0 },
      },
    ]);
  });

  it("the SAME geometry from an OPEN source shape omits the closing z — closed reads false", () => {
    const path = el("draw:path", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "100pt",
      "svg:height": "100pt",
      "svg:viewBox": "0 0 4000 4000",
      "svg:d": "M0 4000h3000c1000 0 1000-4000-1000-4000",
    });
    const { vectors } = readDrawPageContent([path], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.subpaths[0]?.closed).toBe(false);
  });

  it('parses a genuinely diagonal segment (svg:d "l" command, real LibreOffice output) as a line segment, not dropped or misread as horizontal/vertical', () => {
    const path = el("draw:path", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "48.37pt",
      "svg:height": "46.58pt",
      "svg:viewBox": "0 0 4837 4658",
      "svg:d": "M0 4658l3000-4500c1500-1000 3000 3000 500 4500z",
    });
    const { vectors } = readDrawPageContent([path], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    // viewBox 4837x4658 -> frame 48.37x46.58pt: scale factor exactly 0.01 on both axes.
    expect(vector.subpaths[0]?.segments[0]).toEqual({
      kind: "line",
      to: { xPt: 30, yPt: 1.58 },
    });
  });

  it('reads draw:polygon\'s own draw:points list (real LibreOffice output, comma/space-delimited "x,y" pairs — a completely different grammar from svg:d) into a single CLOSED straight-line-only subpath', () => {
    const polygon = el("draw:polygon", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "40pt",
      "svg:height": "30pt",
      "svg:viewBox": "0 0 4000 3000",
      "draw:points": "0,3000 2000,0 4000,3000 2000,1500",
    });
    const { vectors } = readDrawPageContent([polygon], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.subpaths[0]?.closed).toBe(true);
    expect(vector.subpaths[0]?.start).toEqual({ xPt: 0, yPt: 30 });
    expect(vector.subpaths[0]?.segments).toEqual([
      { kind: "line", to: { xPt: 20, yPt: 0 } },
      { kind: "line", to: { xPt: 40, yPt: 30 } },
      { kind: "line", to: { xPt: 20, yPt: 15 } },
    ]);
  });

  it("reads draw:polyline's own draw:points identically, but OPEN", () => {
    const polyline = el("draw:polyline", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "40pt",
      "svg:height": "30pt",
      "svg:viewBox": "0 0 4000 3000",
      "draw:points": "0,3000 2000,0",
    });
    const { vectors } = readDrawPageContent([polyline], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.subpaths[0]?.closed).toBe(false);
  });

  it("drops a path/polygon/polyline with no resolvable svg:viewBox — there is no way to scale the raw numbers into the frame's own point space", () => {
    const path = el("draw:path", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
      "svg:d": "M0 0L10 10z",
    });
    expect(readDrawPageContent([path], { parts: {} }).vectors).toEqual([]);
  });
});
