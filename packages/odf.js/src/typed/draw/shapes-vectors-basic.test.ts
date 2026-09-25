import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
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

// Only the PNG magic-byte signature matters to sniffImageFormat — the rest is arbitrary filler, not a real encoded image, matching ooxml.js's own read.test.ts convention.
const PNG_SIGNATURE_BYTES: readonly number[] = Array.from(
  "\x89PNG\r\n\x1a\n",
  (c) => c.charCodeAt(0),
);

function tinyPngBase64(): string {
  return bytesToBase64(new Uint8Array([...PNG_SIGNATURE_BYTES, 0, 0, 0, 0]));
}

const POINTS_PER_INCH = 72;
const CM_PER_INCH = 2.54;
const CM_PRECISION_DIGITS = 6;
// Not specific to cm-conversion: the same numeric tolerance reused for floating-point rotation/geometry composition assertions elsewhere in this file.
const FLOAT_PRECISION_DIGITS = 6;

describe("readDrawPageContent: draw:rect / draw:ellipse / draw:circle", () => {
  it("reads a plain draw:rect into the rect variant, with fill+stroke from its own graphic-family style", () => {
    const widthCm = 5;
    const strokeWidthCm = 0.05;
    const gr1 = graphicStyle("gr1", {
      "draw:fill-color": "#ff0000",
      "svg:stroke-color": "#000000",
      "svg:stroke-width": `${strokeWidthCm}cm`,
    });
    const pkg: Package = { parts: { "content.xml": contentPackage([gr1]) } };
    const rect = el("draw:rect", {
      "draw:style-name": "gr1",
      "svg:x": "1cm",
      "svg:y": "1cm",
      "svg:width": `${widthCm}cm`,
      "svg:height": "3cm",
    });
    const { vectors } = readDrawPageContent([rect], pkg);
    expect(vectors).toHaveLength(1);
    const vector = vectors[0];
    if (vector?.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    expect(vector.frame.widthPt).toBeCloseTo(
      widthCm * (POINTS_PER_INCH / CM_PER_INCH),
      CM_PRECISION_DIGITS,
    );
    expect(vector.fill).toEqual({ r: 1, g: 0, b: 0 });
    expect(vector.stroke?.color).toEqual({ r: 0, g: 0, b: 0 });
    expect(vector.stroke?.widthPt).toBeCloseTo(
      strokeWidthCm * (POINTS_PER_INCH / CM_PER_INCH),
      CM_PRECISION_DIGITS,
    );
  });

  it("reads draw:ellipse and draw:circle into the SAME ellipse variant — real LibreOffice output writes draw:circle instead of draw:ellipse specifically when width equals height, with no other attribute-shape difference", () => {
    const ellipse = el("draw:ellipse", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "50pt",
      "svg:height": "30pt",
    });
    const circle = el("draw:circle", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "40pt",
      "svg:height": "40pt",
    });
    const { vectors } = readDrawPageContent([ellipse, circle], { parts: {} });
    expect(vectors.map((v) => v.kind)).toEqual(["ellipse", "ellipse"]);
  });

  it("reads no fill/no stroke when the style carries neither — a real draw:line's own automatic style has no draw:fill-color at all", () => {
    const rect = el("draw:rect", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const { vectors } = readDrawPageContent([rect], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    expect(vector.fill).toBeUndefined();
    expect(vector.stroke).toBeUndefined();
  });

  it('honours an explicit draw:fill="none"/draw:stroke="none" override — confirmed real LibreOffice output for a shape with FillStyle/LineStyle explicitly set to NONE', () => {
    const gr1 = graphicStyle("gr1", {
      "draw:fill": "none",
      "draw:stroke": "none",
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
    expect(vector.fill).toBeUndefined();
    expect(vector.stroke).toBeUndefined();
  });

  it("drops a rect/ellipse with no resolvable geometry at all rather than emitting a fabricated one", () => {
    expect(
      readDrawPageContent([el("draw:rect")], { parts: {} }).vectors,
    ).toEqual([]);
    expect(
      readDrawPageContent([el("draw:ellipse")], { parts: {} }).vectors,
    ).toEqual([]);
  });
});

describe("readDrawPageContent: non-flat fills (gradient/bitmap/hatch) and fill opacity (ExaDev/documents.js#954)", () => {
  it('resolves a "gradient" fill from its named <draw:gradient> definition, and uses its start colour as the flat fill swatch when the style carries no direct draw:fill-color of its own', () => {
    const gradient = el("draw:gradient", {
      "draw:name": "grad1",
      "draw:style": "linear",
      "draw:start-color": "#ff0000",
      "draw:end-color": "#0000ff",
      "draw:angle": "45",
    });
    const gr1 = graphicStyle("gr1", {
      "draw:fill": "gradient",
      "draw:fill-gradient-name": "grad1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [gradient]) },
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
    expect(vector.fill).toEqual({ r: 1, g: 0, b: 0 });
    expect(vector.fillPattern).toEqual({
      kind: "gradient",
      style: "linear",
      startColor: { r: 1, g: 0, b: 0 },
      endColor: { r: 0, g: 0, b: 1 },
      angleDeg: 45,
    });
  });

  it("a direct draw:fill-color alongside a \"gradient\" fill mode wins as the flat swatch over the gradient's own start colour — real LibreOffice output sometimes writes both, per this file's own top-of-file note", () => {
    const gradient = el("draw:gradient", {
      "draw:name": "grad1",
      "draw:style": "linear",
      "draw:start-color": "#ff0000",
      "draw:end-color": "#0000ff",
    });
    const gr1 = graphicStyle("gr1", {
      "draw:fill": "gradient",
      "draw:fill-color": "#00ff00",
      "draw:fill-gradient-name": "grad1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [gradient]) },
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
    expect(vector.fill).toEqual({ r: 0, g: 1, b: 0 });
    expect(vector.fillPattern?.kind).toBe("gradient");
  });

  it('resolves a "hatch" fill from its named <draw:hatch> definition, using its own colour as the flat fill swatch', () => {
    const RGB_CHANNEL_MAX = 255;
    const red = 0x12;
    const green = 0x34;
    const blue = 0x56;
    const distanceCm = 0.1;
    const rotationDeg = 90;
    const hatch = el("draw:hatch", {
      "draw:name": "hatch1",
      "draw:style": "triple",
      "draw:color": "#123456",
      "draw:distance": `${distanceCm}cm`,
      "draw:rotation": `${rotationDeg}`,
    });
    const gr1 = graphicStyle("gr1", {
      "draw:fill": "hatch",
      "draw:fill-hatch-name": "hatch1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [hatch]) },
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
    expect(vector.fillPattern).toEqual({
      kind: "hatch",
      style: "triple",
      color: {
        r: red / RGB_CHANNEL_MAX,
        g: green / RGB_CHANNEL_MAX,
        b: blue / RGB_CHANNEL_MAX,
      },
      distancePt: distanceCm * (POINTS_PER_INCH / CM_PER_INCH),
      rotationDeg,
    });
  });

  it('resolves a "bitmap" fill from its named <draw:fill-image> definition, referencing the package part by xlink:href exactly like draw:image', () => {
    const fillImage = el("draw:fill-image", {
      "draw:name": "img1",
      "xlink:href": "Pictures/fill.png",
    });
    const gr1 = graphicStyle("gr1", {
      "draw:fill": "bitmap",
      "draw:fill-image-name": "img1",
    });
    const pkg: Package = {
      parts: {
        "content.xml": contentPackageWithResources([gr1], [fillImage]),
        "Pictures/fill.png": { kind: "binary", base64: tinyPngBase64() },
      },
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
    expect(vector.fill).toBeUndefined(); // no single representative colour for a bitmap
    expect(vector.fillPattern).toEqual({
      kind: "bitmap",
      format: "png",
      base64: tinyPngBase64(),
    });
  });

  it("a gradient/hatch/bitmap fill whose named resource cannot be resolved (missing definition) leaves fillPattern undefined, matching this reader's existing degrade-gracefully convention", () => {
    const gr1 = graphicStyle("gr1", {
      "draw:fill": "gradient",
      "draw:fill-gradient-name": "does-not-exist",
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
    expect(vector.fillPattern).toBeUndefined();
    expect(vector.fill).toBeUndefined();
  });

  it("a resolved <draw:gradient> definition with a missing or unrecognised draw:style leaves fillPattern undefined, same as an unresolvable name", () => {
    const gradient = el("draw:gradient", {
      "draw:name": "grad1",
      "draw:style": "not-a-real-style",
      "draw:start-color": "#ff0000",
      "draw:end-color": "#0000ff",
    });
    const gr1 = graphicStyle("gr1", {
      "draw:fill": "gradient",
      "draw:fill-gradient-name": "grad1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [gradient]) },
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
    expect(vector.fillPattern).toBeUndefined();
  });

  it("a resolved <draw:hatch> definition with a missing or unrecognised draw:style leaves fillPattern undefined, same as an unresolvable name", () => {
    const hatch = el("draw:hatch", {
      "draw:name": "hatch1",
      "draw:style": "not-a-real-style",
      "draw:color": "#123456",
      "draw:distance": "0.1cm",
    });
    const gr1 = graphicStyle("gr1", {
      "draw:fill": "hatch",
      "draw:fill-hatch-name": "hatch1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [hatch]) },
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
    expect(vector.fillPattern).toBeUndefined();
  });

  it("omits angleDeg from the gradient fillPattern entirely (not a present-but-undefined key) when draw:angle is absent", () => {
    const gradient = el("draw:gradient", {
      "draw:name": "grad1",
      "draw:style": "linear",
      "draw:start-color": "#ff0000",
      "draw:end-color": "#0000ff",
    });
    const gr1 = graphicStyle("gr1", {
      "draw:fill": "gradient",
      "draw:fill-gradient-name": "grad1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [gradient]) },
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
    expect(vector.fillPattern).not.toHaveProperty("angleDeg");
  });

  it("omits rotationDeg from the hatch fillPattern entirely (not a present-but-undefined key) when draw:rotation is absent", () => {
    const hatch = el("draw:hatch", {
      "draw:name": "hatch1",
      "draw:style": "single",
      "draw:color": "#123456",
      "draw:distance": "0.1cm",
    });
    const gr1 = graphicStyle("gr1", {
      "draw:fill": "hatch",
      "draw:fill-hatch-name": "hatch1",
    });
    const pkg: Package = {
      parts: { "content.xml": contentPackageWithResources([gr1], [hatch]) },
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
    expect(vector.fillPattern).not.toHaveProperty("rotationDeg");
  });

  it("reads draw:opacity into fillOpacity as a 0..1 fraction", () => {
    const opacityPercent = 37;
    const percentScale = 100;
    const gr1 = graphicStyle("gr1", {
      "draw:fill-color": "#ff0000",
      "draw:opacity": `${opacityPercent}%`,
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
    expect(vector.fillOpacity).toBeCloseTo(
      opacityPercent / percentScale,
      FLOAT_PRECISION_DIGITS,
    );
  });

  it("leaves fillOpacity undefined (fully opaque) when draw:opacity is absent", () => {
    const gr1 = graphicStyle("gr1", { "draw:fill-color": "#ff0000" });
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
    expect(vector.fillOpacity).toBeUndefined();
  });
});
