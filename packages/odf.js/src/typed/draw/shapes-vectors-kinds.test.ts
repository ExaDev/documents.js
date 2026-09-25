import { describe, expect, it } from "vitest";
import type { ContentShape } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlNode } from "../../model/node";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { readDrawPageContent, walkDrawShapes } from "./shapes";

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

// Not specific to cm-conversion: the same numeric tolerance reused for floating-point rotation/geometry composition assertions elsewhere in this file.
const FLOAT_PRECISION_DIGITS = 6;

function vectorPackage(pkg: Package = { parts: {} }): Package {
  return pkg;
}

describe("readDrawPageContent: draw:custom-shape presets", () => {
  function customShape(
    name: string,
    type: string,
    extra: Readonly<Record<string, string>> = {},
  ): XmlElement {
    return el(
      "draw:custom-shape",
      {
        "draw:name": name,
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "50pt",
        "svg:height": "30pt",
        ...extra,
      },
      [
        el("draw:enhanced-geometry", {
          "svg:viewBox": "0 0 21600 21600",
          "draw:type": type,
        }),
      ],
    );
  }

  it('recognises the "rectangle" preset — maps to the rect variant using the shape\'s own frame, without evaluating draw:enhanced-path', () => {
    const { vectors } = readDrawPageContent(
      [customShape("CustomRect1", "rectangle")],
      { parts: {} },
    );
    expect(vectors[0]).toMatchObject({
      kind: "rect",
      frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 30 },
    });
  });

  it('recognises the "round-rectangle" preset — also approximates to the plain rect variant (no rounded-corner concept in ContentVectorSchema)', () => {
    const { vectors } = readDrawPageContent(
      [customShape("CustomRoundRect1", "round-rectangle")],
      { parts: {} },
    );
    expect(vectors[0]).toMatchObject({ kind: "rect" });
  });

  it('recognises the "ellipse" preset — maps to the ellipse variant', () => {
    const { vectors } = readDrawPageContent(
      [customShape("CustomEllipse1", "ellipse")],
      { parts: {} },
    );
    expect(vectors[0]).toMatchObject({ kind: "ellipse" });
  });

  it('an UNRECOGNISED preset (e.g. "smiley", real LibreOffice basic-shapes-gallery type name) with real text content salvages as a text-only ContentShape, not a vector', () => {
    const shape = el(
      "draw:custom-shape",
      {
        "draw:name": "CustomSmiley1",
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "50pt",
        "svg:height": "30pt",
      },
      [
        el("text:p", {}, [txt("Hello")]),
        el("draw:enhanced-geometry", {
          "svg:viewBox": "0 0 21600 21600",
          "draw:type": "smiley",
        }),
      ],
    );
    const { shapes, vectors } = readDrawPageContent([shape], { parts: {} });
    expect(vectors).toEqual([]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "Hello" }],
    });
  });

  // readCustomShapeAsTextShape's own draw:name read goes through readDrawName, not a bare attrValue — a second call site of the same fix draw:frame's own readDrawFrame already had (S3, ExaDev/documents.js#900), pinned here since mutating this call site back to attrValue left the whole odf.js suite green.
  it("decodes an unrecognised preset's own draw:name the same way draw:frame does", () => {
    const shape = el(
      "draw:custom-shape",
      {
        "draw:name": "Q&amp;A &lt;draft&gt;",
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "50pt",
        "svg:height": "30pt",
      },
      [
        el("text:p", {}, [txt("Hello")]),
        el("draw:enhanced-geometry", {
          "svg:viewBox": "0 0 21600 21600",
          "draw:type": "smiley",
        }),
      ],
    );
    const { shapes } = readDrawPageContent([shape], { parts: {} });
    expect(shapes[0]?.name).toBe("Q&A <draft>");
  });

  it("an unrecognised preset's whole draw:enhanced-geometry element quarantines in the salvaged text shape's residue, so the preset definition survives beside the approximation", () => {
    const shape = el(
      "draw:custom-shape",
      {
        "draw:name": "CustomSmiley1",
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "50pt",
        "svg:height": "30pt",
      },
      [
        el("text:p", {}, [txt("Hello")]),
        el("draw:enhanced-geometry", {
          "svg:viewBox": "0 0 21600 21600",
          "draw:type": "smiley",
          "draw:enhanced-path": "M 0 0 L 21600 0 21600 21600 0 21600 0 0 Z N",
        }),
      ],
    );
    const { shapes } = readDrawPageContent([shape], { parts: {} });
    expect(shapes[0]?.source?.format).toBe("odg");
    expect(shapes[0]?.source?.xml).toContain("<draw:enhanced-geometry");
    expect(shapes[0]?.source?.xml).toContain('draw:type="smiley"');
  });

  it("a recognised preset's vector carries no residue — the approximation replaces the enhanced-geometry wholesale", () => {
    const { vectors } = readDrawPageContent(
      [customShape("CustomRect1", "rectangle")],
      { parts: {} },
    );
    expect(vectors[0]?.source).toBeUndefined();
  });

  it("an unrecognised preset with NO real text content is skipped entirely — nothing worth preserving", () => {
    const { shapes, vectors } = readDrawPageContent(
      [customShape("CustomSmiley1", "smiley")],
      { parts: {} },
    );
    expect(shapes).toEqual([]);
    expect(vectors).toEqual([]);
  });

  it("a custom-shape with NO draw:enhanced-geometry at all is treated the same as an unrecognised preset", () => {
    const shape = el("draw:custom-shape", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "50pt",
      "svg:height": "30pt",
    });
    expect(readDrawPageContent([shape], { parts: {} }).vectors).toEqual([]);
  });

  // ExaDev/documents.js#954: 'round-rectangle' now builds a REAL rounded-corner path when the shape's own draw:handle/draw:modifiers resolve a corner radius, rather than always approximating to the plain rect variant.
  it('"round-rectangle" with a resolvable draw:handle/draw:modifiers corner radius builds a real rounded-corner path, not the plain rect approximation', () => {
    const widthPt = 50;
    const modifierValue = 3600;
    const viewBoxSize = 21600;
    const shape = el(
      "draw:custom-shape",
      {
        "draw:name": "CustomRoundRect1",
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": `${widthPt}pt`,
        "svg:height": "30pt",
      },
      [
        el(
          "draw:enhanced-geometry",
          {
            "svg:viewBox": `0 0 ${viewBoxSize} ${viewBoxSize}`,
            "draw:type": "round-rectangle",
            "draw:modifiers": `${modifierValue}`,
          },
          [
            el("draw:handle", {
              "draw:handle-position": "$0 0",
              "draw:handle-range-x-minimum": "0",
              "draw:handle-range-x-maximum": "10800",
            }),
          ],
        ),
      ],
    );
    const { vectors } = readDrawPageContent([shape], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    // modifierValue/viewBoxSize * widthPt = ~8.33pt radius.
    const expectedRadius = (modifierValue / viewBoxSize) * widthPt;
    expect(vector.subpaths).toHaveLength(1);
    const subpath = vector.subpaths[0];
    expect(subpath?.closed).toBe(true);
    expect(subpath?.start.xPt).toBeCloseTo(
      expectedRadius,
      FLOAT_PRECISION_DIGITS,
    );
    expect(subpath?.start.yPt).toBeCloseTo(0, FLOAT_PRECISION_DIGITS);
    // 4 straight edges + 4 corner arcs.
    const expectedSegmentCount = 8;
    expect(subpath?.segments).toHaveLength(expectedSegmentCount);
    expect(subpath?.segments.map((s) => s.kind)).toEqual([
      "line",
      "cubic",
      "line",
      "cubic",
      "line",
      "cubic",
      "line",
      "cubic",
    ]);
  });

  it('"round-rectangle" clamps a modifier value beyond half the shape\'s shorter side to the mathematical maximum a corner radius can be', () => {
    const heightPt = 30;
    const shape = el(
      "draw:custom-shape",
      {
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "50pt",
        "svg:height": `${heightPt}pt`,
      },
      [
        el(
          "draw:enhanced-geometry",
          {
            "svg:viewBox": "0 0 21600 21600",
            "draw:type": "round-rectangle",
            "draw:modifiers": "21600", // the whole viewBox width — wildly beyond any sane radius
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
    const subpath = vector.subpaths[0];
    // Clamped to half the shorter side.
    expect(subpath?.start.xPt).toBeCloseTo(
      heightPt / 2,
      FLOAT_PRECISION_DIGITS,
    );
  });

  const DIAMOND_VERTEX_COUNT = 4;
  const TRIANGLE_VERTEX_COUNT = 3;
  const PENTAGON_VERTEX_COUNT = 5;
  const HEXAGON_VERTEX_COUNT = 6;
  const OCTAGON_VERTEX_COUNT = 8;

  it.each([
    ["diamond", DIAMOND_VERTEX_COUNT],
    ["isosceles-triangle", TRIANGLE_VERTEX_COUNT],
    ["right-triangle", TRIANGLE_VERTEX_COUNT],
    ["pentagon", PENTAGON_VERTEX_COUNT],
    ["hexagon", HEXAGON_VERTEX_COUNT],
    ["octagon", OCTAGON_VERTEX_COUNT],
  ])(
    'recognises the "%s" preset — builds a closed, straight-line-only path with %i vertices inscribed in the shape\'s own frame',
    (type, vertexCount) => {
      const { vectors } = readDrawPageContent(
        [customShape(`Custom${type}`, type)],
        { parts: {} },
      );
      const vector = vectors[0];
      if (vector?.kind !== "path") {
        throw new Error(`expected a path vector for preset "${type}"`);
      }
      expect(vector.subpaths).toHaveLength(1);
      const subpath = vector.subpaths[0];
      expect(subpath?.closed).toBe(true);
      // One vertex is `start`, the rest are line segments — together they total the vertex count.
      expect((subpath?.segments.length ?? 0) + 1).toBe(vertexCount);
      expect(subpath?.segments.every((s) => s.kind === "line")).toBe(true);
    },
  );

  it("diamond's own four vertices sit at the midpoints of each frame edge", () => {
    const { vectors } = readDrawPageContent(
      [customShape("CustomDiamond1", "diamond")],
      { parts: {} },
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    const points = [
      vector.subpaths[0]?.start,
      ...(vector.subpaths[0]?.segments.map((s) =>
        s.kind === "line" ? s.to : undefined,
      ) ?? []),
    ];
    expect(points).toEqual([
      { xPt: 25, yPt: 0 },
      { xPt: 50, yPt: 15 },
      { xPt: 25, yPt: 30 },
      { xPt: 0, yPt: 15 },
    ]);
  });

  it("a fixed-polygon preset's vector carries no residue, same as rectangle/round-rectangle/ellipse — the approximation replaces the enhanced-geometry wholesale", () => {
    const { vectors } = readDrawPageContent(
      [customShape("CustomDiamond1", "diamond")],
      { parts: {} },
    );
    expect(vectors[0]?.source).toBeUndefined();
  });

  it("'parallelogram'/'trapezoid' stay unrecognised — deliberately excluded pending real slant-handle evaluation, per this file's own top-of-file note", () => {
    const shape = el(
      "draw:custom-shape",
      {
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "50pt",
        "svg:height": "30pt",
      },
      [
        el("text:p", {}, [txt("Hello")]),
        el("draw:enhanced-geometry", {
          "svg:viewBox": "0 0 21600 21600",
          "draw:type": "parallelogram",
        }),
      ],
    );
    const { shapes, vectors } = readDrawPageContent([shape], { parts: {} });
    expect(vectors).toEqual([]);
    expect(shapes).toHaveLength(1); // salvaged as a text shape, the same as any other unrecognised preset
  });
});

describe("readDrawPageContent: draw:z-index paint order", () => {
  it("sorts vectors by an EXPLICIT draw:z-index, overriding raw document order — a shape written FIRST in the XML but with the HIGHEST z-index paints LAST (on top)", () => {
    // Three rects, distinguished by fill colour (ContentVectorSchema's rect variant carries no name field). Document order: red, green, blue. z-index order: green(0) < blue(1) < red(2).
    const styles = [
      graphicStyle("red", { "draw:fill-color": "#ff0000" }),
      graphicStyle("green", { "draw:fill-color": "#00ff00" }),
      graphicStyle("blue", { "draw:fill-color": "#0000ff" }),
    ];
    const pkg: Package = { parts: { "content.xml": contentPackage(styles) } };
    const rectRedFirstInDocument = el("draw:rect", {
      "draw:style-name": "red",
      "draw:z-index": "2",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const rectGreenSecondInDocument = el("draw:rect", {
      "draw:style-name": "green",
      "draw:z-index": "0",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const rectBlueThirdInDocument = el("draw:rect", {
      "draw:style-name": "blue",
      "draw:z-index": "1",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const { vectors } = readDrawPageContent(
      [
        rectRedFirstInDocument,
        rectGreenSecondInDocument,
        rectBlueThirdInDocument,
      ],
      pkg,
    );
    // Sorted by z-index ascending (bottom to top): green(0), blue(1), red(2) — NOT document order (red, green, blue).
    expect(
      vectors.map((v) => (v.kind === "rect" ? v.fill : undefined)),
    ).toEqual([
      { r: 0, g: 1, b: 0 },
      { r: 0, g: 0, b: 1 },
      { r: 1, g: 0, b: 0 },
    ]);
  });

  it("falls back to document-encounter order when draw:z-index is absent — the REAL LibreOffice case (its own writer never emits draw:z-index; document order already IS paint order after any UI-side reordering)", () => {
    const rectA = el("draw:rect", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const ellipseB = el("draw:ellipse", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const { vectors } = readDrawPageContent([rectA, ellipseB], { parts: {} });
    expect(vectors.map((v) => v.kind)).toEqual(["rect", "ellipse"]);
  });

  it("keeps shapes and vectors as two independently paint-ordered arrays, threading ONE monotonic document-index counter across a mixed shapes+vectors+group walk", () => {
    const frame = el(
      "draw:frame",
      {
        "draw:name": "Frame1",
        "draw:z-index": "5",
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "10pt",
        "svg:height": "10pt",
      },
      [el("draw:text-box", {}, [el("text:p", {}, [txt("hi")])])],
    );
    const rect = el("draw:rect", {
      "draw:z-index": "0",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const group = el("draw:g", {}, [rect]);
    const { shapes, vectors } = readDrawPageContent([frame, group], {
      parts: {},
    });
    expect(shapes).toHaveLength(1);
    expect(vectors).toHaveLength(1);
  });
});

describe("readDrawPageContent: group flattening for vector primitives", () => {
  it("applies an enclosing draw:g's own translate to a rect's frame, exactly like it already does for draw:frame", () => {
    const originPt = 10;
    const translatePt = 5;
    const rect = el("draw:rect", {
      "svg:x": `${originPt}pt`,
      "svg:y": `${originPt}pt`,
      "svg:width": "20pt",
      "svg:height": "20pt",
    });
    const group = el(
      "draw:g",
      { "draw:transform": `translate(${translatePt}pt ${translatePt}pt)` },
      [rect],
    );
    const { vectors } = readDrawPageContent([group], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    expect(vector.frame.xPt).toBeCloseTo(
      originPt + translatePt,
      FLOAT_PRECISION_DIGITS,
    );
    expect(vector.frame.yPt).toBeCloseTo(
      originPt + translatePt,
      FLOAT_PRECISION_DIGITS,
    );
  });

  it("recurses through nested groups for vector primitives, mirroring walkDrawShapes' own innermost-first composition", () => {
    const rect = el("draw:rect", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const inner = el("draw:g", { "draw:transform": "translate(10pt 0pt)" }, [
      rect,
    ]);
    const outer = el("draw:g", { "draw:transform": "translate(0pt 10pt)" }, [
      inner,
    ]);
    const { vectors } = readDrawPageContent([outer], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    const expectedPt = 10;
    expect(vector.frame.xPt).toBeCloseTo(expectedPt, FLOAT_PRECISION_DIGITS);
    expect(vector.frame.yPt).toBeCloseTo(expectedPt, FLOAT_PRECISION_DIGITS);
  });
});

describe("readDrawPageContent: unhandled node kinds", () => {
  it("ignores a non-element node (text/comment) without error", () => {
    const nodes: XmlNode[] = [{ type: "text", value: "stray text" }];
    expect(readDrawPageContent(nodes, { parts: {} })).toEqual({
      shapes: [],
      vectors: [],
    });
  });

  it("ignores an element tag this reader has no vocabulary for (e.g. dr3d:scene, draw:connector) — skipped entirely, not an error", () => {
    const scene = el("dr3d:scene", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    expect(readDrawPageContent([scene], { parts: {} })).toEqual({
      shapes: [],
      vectors: [],
    });
  });

  it("produces an empty result for a genuinely empty page", () => {
    expect(readDrawPageContent([], vectorPackage())).toEqual({
      shapes: [],
      vectors: [],
    });
  });
});

describe("readDrawPageContent: vector rotation via draw:transform — reuses the SAME geometry machinery draw:frame already resolves rotation through", () => {
  const quarterTurnTransform =
    "rotate(1.5707963267948966) translate(100pt 100pt)";
  const expectedRotationDeg = -90;

  it("reads a rotated draw:rect's own rotationDeg, not just its unrotated frame", () => {
    const expectedXPt = 30;
    const expectedYPt = -30;
    const rect = el("draw:rect", {
      "svg:width": "200pt",
      "svg:height": "60pt",
      "draw:transform": quarterTurnTransform,
    });
    const { vectors } = readDrawPageContent([rect], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    expect(vector.frame.xPt).toBeCloseTo(expectedXPt, FLOAT_PRECISION_DIGITS);
    expect(vector.frame.yPt).toBeCloseTo(expectedYPt, FLOAT_PRECISION_DIGITS);
    expect(vector.rotationDeg).toBeCloseTo(
      expectedRotationDeg,
      FLOAT_PRECISION_DIGITS,
    );
  });

  it("reads a rotated draw:ellipse's own rotationDeg", () => {
    const ellipse = el("draw:ellipse", {
      "svg:width": "200pt",
      "svg:height": "60pt",
      "draw:transform": quarterTurnTransform,
    });
    const { vectors } = readDrawPageContent([ellipse], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "ellipse") {
      throw new Error("expected an ellipse vector");
    }
    expect(vector.rotationDeg).toBeCloseTo(
      expectedRotationDeg,
      FLOAT_PRECISION_DIGITS,
    );
  });

  it("reads a rotated draw:path's own rotationDeg alongside its normally-scaled subpaths", () => {
    const path = el("draw:path", {
      "svg:width": "100pt",
      "svg:height": "100pt",
      "svg:viewBox": "0 0 4000 4000",
      "svg:d": "M0 4000h3000c1000 0 1000-4000-1000-4000z",
      "draw:transform": quarterTurnTransform,
    });
    const { vectors } = readDrawPageContent([path], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.rotationDeg).toBeCloseTo(
      expectedRotationDeg,
      FLOAT_PRECISION_DIGITS,
    );
    expect(vector.subpaths).toHaveLength(1);
  });

  it("composes an enclosing draw:g's own rotation onto a vector primitive's rotationDeg, exactly like it already does for draw:frame", () => {
    const rect = el("draw:rect", {
      "svg:x": "50pt",
      "svg:y": "50pt",
      "svg:width": "80pt",
      "svg:height": "40pt",
    });
    const group = el("draw:g", { "draw:transform": quarterTurnTransform }, [
      rect,
    ]);
    const { vectors } = readDrawPageContent([group], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    expect(vector.rotationDeg).toBeCloseTo(
      expectedRotationDeg,
      FLOAT_PRECISION_DIGITS,
    );
  });

  it("leaves rotationDeg undefined for an unrotated vector, matching draw:frame's own convention", () => {
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
    expect(vector.rotationDeg).toBeUndefined();
  });
});

describe("readDrawPageContent / walkDrawShapes: paintOrder stamping", () => {
  it("stamps the resolved zIndex onto each ContentVector, in addition to using it to sort the vectors array", () => {
    const zIndexA = 5;
    const rectA = el("draw:rect", {
      "draw:z-index": `${zIndexA}`,
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const rectB = el("draw:rect", {
      "draw:z-index": "1",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const { vectors } = readDrawPageContent([rectA, rectB], { parts: {} });
    expect(vectors.map((v) => v.paintOrder)).toEqual([1, zIndexA]);
  });

  it("stamps a document-encounter fallback index (not just undefined) when draw:z-index is absent", () => {
    const rectA = el("draw:rect", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const rectB = el("draw:rect", {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const { vectors } = readDrawPageContent([rectA, rectB], { parts: {} });
    expect(vectors.map((v) => v.paintOrder)).toEqual([0, 1]);
  });

  it("stamps ONE shared monotonic paintOrder across shapes AND vectors, so cross-array relative paint order is recoverable by comparing the stamped values directly", () => {
    const frame = el(
      "draw:frame",
      {
        "draw:z-index": "0",
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "10pt",
        "svg:height": "10pt",
      },
      [el("draw:text-box", {}, [el("text:p", {}, [txt("hi")])])],
    );
    const rect = el("draw:rect", {
      "draw:z-index": "1",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const { shapes, vectors } = readDrawPageContent([frame, rect], {
      parts: {},
    });
    expect(shapes[0]?.paintOrder).toBe(0);
    expect(vectors[0]?.paintOrder).toBe(1);
  });

  it("walkDrawShapes (odp) stamps the identical paintOrder value onto each ContentShape it produces, without reordering its own output array", () => {
    const zIndexA = 5;
    const frameA = el("draw:frame", {
      "draw:name": "A",
      "draw:z-index": `${zIndexA}`,
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const frameB = el("draw:frame", {
      "draw:name": "B",
      "draw:z-index": "1",
      "svg:x": "20pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const out: ContentShape[] = [];
    walkDrawShapes([frameA, frameB], [], { parts: {} }, { shapes: out });
    // Document order is unchanged (A then B) — only the stamped value reflects the real z-index.
    expect(out.map((s) => s.name)).toEqual(["A", "B"]);
    expect(out.map((s) => s.paintOrder)).toEqual([zIndexA, 1]);
  });

  it("walkDrawShapes threads its own indexState across a recursive draw:g walk, keeping the document-encounter fallback monotonic", () => {
    const frameA = el("draw:frame", {
      "draw:name": "A",
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const frameB = el("draw:frame", {
      "draw:name": "B",
      "svg:x": "20pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    });
    const group = el("draw:g", {}, [frameB]);
    const out: ContentShape[] = [];
    walkDrawShapes([frameA, group], [], { parts: {} }, { shapes: out });
    expect(out.map((s) => s.paintOrder)).toEqual([0, 1]);
  });
});
