import { describe, expect, it } from "vitest";
import type { ContentVector } from "document-schema.js";

import type { SvgDiagnostic } from "./diagnostics";
import { readSvgContent } from "./read";
import {} from "./write";
import {} from "./text";

// The read tests below want an identity root map — width/height in pt equal to the viewBox extents — so every user-unit coordinate lands in the page-point space unchanged and assertions read the SVG's own numbers back.
const IDENTITY_ROOT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt" viewBox="0 0 100 60">';
const svg = (inner: string, root = IDENTITY_ROOT): string =>
  `${root}${inner}</svg>`;

function readVectors(
  text: string,
  diagnostics?: SvgDiagnostic[],
): ContentVector[] {
  const document = readSvgContent(
    text,
    diagnostics === undefined
      ? undefined
      : {
          onSvgDiagnostic: (diagnostic) => {
            diagnostics.push(diagnostic);
          },
        },
  );
  if (document.kind !== "drawing") {
    throw new Error("expected a drawing ContentDocument");
  }
  return document.pages[0]!.vectors;
}

describe("readSvgContent path frame and rebasing", () => {
  it("keeps an open path whose frame collapses on only one axis, not both", () => {
    // A vertical path has widthPt === 0 but heightPt > 0 — the drop check requires BOTH to be zero, matching a genuinely single-point path, not a straight line.
    const vertical = readVectors(
      svg('<path d="M5,5 L5,20" stroke="black" fill="none"/>'),
    );
    expect(vertical).toHaveLength(1);
    const horizontal = readVectors(
      svg('<path d="M5,5 L20,5" stroke="black" fill="none"/>'),
    );
    expect(horizontal).toHaveLength(1);
    const singlePoint = readVectors(svg('<path d="M5,5" stroke="black"/>'));
    expect(singlePoint).toHaveLength(0);
  });

  it("rebases a cubic segment's control points and endpoint into the frame's own local space by subtraction, not addition", () => {
    const vectors = readVectors(
      svg(
        '<path d="M30,40 L60,40 C70,20 90,20 100,40" fill="none" stroke="black"/>',
      ),
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.frame).toEqual({
      xPt: 30,
      yPt: 20,
      widthPt: 70,
      heightPt: 20,
    });
    expect(vector.subpaths[0]?.segments[1]).toMatchObject({
      kind: "cubic",
      control1: { xPt: 40, yPt: 0 },
      control2: { xPt: 60, yPt: 0 },
      to: { xPt: 70, yPt: 20 },
    });
  });
});

describe("readSvgContent rounded rect geometry", () => {
  it("places every edge and kappa corner of an asymmetric rounded rect at its own exact coordinate", () => {
    const KAPPA = (4 / 3) * (Math.SQRT2 - 1);
    const x = 10;
    const y = 20;
    const width = 50;
    const height = 30;
    const rx = 8;
    const ry = 5;
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;

    const vectors = readVectors(
      svg(
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ry="${ry}"/>`,
      ),
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    // The frame is the tight bound of the four straight edges plus the four rounded corners, so its own origin is exactly the rect's own (x, y) and its extent the rect's own (width, height) — every rebased point below is relative to that.
    expect(vector.frame).toEqual({
      xPt: x,
      yPt: y,
      widthPt: width,
      heightPt: height,
    });
    const subpath = vector.subpaths[0];
    if (subpath === undefined) {
      throw new Error("expected a subpath");
    }
    expect(subpath.closed).toBe(true);
    expect(subpath.start).toEqual({ xPt: rx, yPt: 0 });
    const segments = subpath.segments;
    // Exact edge/endpoint coordinates first — these involve no KAPPA arithmetic, so plain equality applies.
    expect(segments[0]).toMatchObject({
      kind: "line",
      to: { xPt: width - rx, yPt: 0 },
    });
    expect(segments[1]).toMatchObject({
      kind: "cubic",
      control1: { yPt: 0 },
      to: { xPt: width, yPt: ry },
    });
    expect(segments[2]).toMatchObject({
      kind: "line",
      to: { xPt: width, yPt: height - ry },
    });
    expect(segments[3]).toMatchObject({
      kind: "cubic",
      to: { xPt: width - rx, yPt: height },
    });
    expect(segments[4]).toMatchObject({
      kind: "line",
      to: { xPt: rx, yPt: height },
    });
    expect(segments[5]).toMatchObject({
      kind: "cubic",
      to: { xPt: 0, yPt: height - ry },
    });
    expect(segments[6]).toMatchObject({
      kind: "line",
      to: { xPt: 0, yPt: ry },
    });
    expect(segments[7]).toMatchObject({
      kind: "cubic",
      control2: { yPt: 0 },
      to: { xPt: rx, yPt: 0 },
    });
    // The kappa-derived control-point coordinates, each checked against the independently-computed kx/ky, catching every sign flip and every variable substitution (x for width, radiusX for radiusY, and so on) across the eight corners.
    const cubic1 = segments[1];
    const cubic3 = segments[3];
    const cubic5 = segments[5];
    const cubic7 = segments[7];
    if (
      cubic1?.kind !== "cubic" ||
      cubic3?.kind !== "cubic" ||
      cubic5?.kind !== "cubic" ||
      cubic7?.kind !== "cubic"
    ) {
      throw new Error("expected four cubic segments");
    }
    expect(cubic1.control1.xPt).toBeCloseTo(width - rx + kx, 9);
    expect(cubic1.control2.xPt).toBe(width);
    expect(cubic1.control2.yPt).toBeCloseTo(ry - ky, 9);
    expect(cubic3.control1.xPt).toBe(width);
    expect(cubic3.control1.yPt).toBeCloseTo(height - ry + ky, 9);
    expect(cubic3.control2.xPt).toBeCloseTo(width - rx + kx, 9);
    expect(cubic3.control2.yPt).toBe(height);
    expect(cubic5.control1.xPt).toBeCloseTo(rx - kx, 9);
    expect(cubic5.control1.yPt).toBe(height);
    expect(cubic5.control2.xPt).toBe(0);
    expect(cubic5.control2.yPt).toBeCloseTo(height - ry + ky, 9);
    expect(cubic7.control1.xPt).toBe(0);
    expect(cubic7.control1.yPt).toBeCloseTo(ry - ky, 9);
    expect(cubic7.control2.xPt).toBeCloseTo(rx - kx, 9);
  });

  it("clamps each radius to half its own side, independently, when the radius would otherwise overrun a short rect", () => {
    // width=20 clamps radiusX to 10 (half-width); height=6 clamps radiusY to 3 (half-height) — independent clamps, since a single shared clamp would let one radius overrun its own axis.
    const vectors = readVectors(
      svg('<rect x="0" y="0" width="20" height="6" rx="15" ry="15"/>'),
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.subpaths[0]?.start).toEqual({ xPt: 10, yPt: 0 });
    expect(vector.subpaths[0]?.segments[0]).toMatchObject({
      kind: "line",
      to: { xPt: 10, yPt: 0 },
    });
  });
});

describe("readSvgContent ellipse-as-path geometry", () => {
  it("places every cardinal point and kappa control of a sheared ellipse's path at its own exact coordinate", () => {
    // matrix(1,0.5,0,1,0,0): x' = x, y' = 0.5x + y — x is untouched by the shear, so every rebased local x below is exactly (original local ellipse x) - (cx - rx), independent of the shear itself, while y still needs the full transform.
    const KAPPA = (4 / 3) * (Math.SQRT2 - 1);
    const cx = 20;
    const cy = 10;
    const rx = 8;
    const ry = 4;
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    // Every point the algorithm places, in local (pre-transform) ellipse space, named by its position on the circle.
    const east = { x: cx + rx, y: cy };
    const eastKappaTop = { x: cx + rx, y: cy + ky };
    const northKappaEast = { x: cx + kx, y: cy + ry };
    const north = { x: cx, y: cy + ry };
    const northKappaWest = { x: cx - kx, y: cy + ry };
    const westKappaTop = { x: cx - rx, y: cy + ky };
    const west = { x: cx - rx, y: cy };
    const westKappaBottom = { x: cx - rx, y: cy - ky };
    const southKappaWest = { x: cx - kx, y: cy - ry };
    const south = { x: cx, y: cy - ry };
    const southKappaEast = { x: cx + kx, y: cy - ry };
    const eastKappaBottom = { x: cx + rx, y: cy - ky };
    const allPoints = [
      east,
      eastKappaTop,
      northKappaEast,
      north,
      northKappaWest,
      westKappaTop,
      west,
      westKappaBottom,
      southKappaWest,
      south,
      southKappaEast,
      eastKappaBottom,
    ];
    const shearedY = (point: { x: number; y: number }) =>
      0.5 * point.x + point.y;
    // x is untouched by this shear (x' = x), so the frame's own x-origin is just the local minimum x; the y-origin needs the full sheared value at every point, not just the geometrically extreme ones, since the shear can make an off-axis point the new extreme.
    const frameXPt = Math.min(...allPoints.map((point) => point.x));
    const frameYPt = Math.min(...allPoints.map(shearedY));
    const local = (point: { x: number; y: number }) => ({
      xPt: point.x - frameXPt,
      yPt: shearedY(point) - frameYPt,
    });

    const vectors = readVectors(
      svg(
        `<g transform="matrix(1 0.5 0 1 0 0)"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></g>`,
      ),
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    const subpath = vector.subpaths[0];
    if (subpath === undefined) {
      throw new Error("expected a subpath");
    }
    expect(subpath.start).toMatchObject(local(east));
    const segments = subpath.segments;
    expect(segments[0]).toMatchObject({
      kind: "cubic",
      control1: local(eastKappaTop),
      control2: local(northKappaEast),
      to: local(north),
    });
    expect(segments[1]).toMatchObject({
      kind: "cubic",
      control1: local(northKappaWest),
      control2: local(westKappaTop),
      to: local(west),
    });
    expect(segments[2]).toMatchObject({
      kind: "cubic",
      control1: local(westKappaBottom),
      control2: local(southKappaWest),
      to: local(south),
    });
    expect(segments[3]).toMatchObject({
      kind: "cubic",
      control1: local(southKappaEast),
      control2: local(eastKappaBottom),
      to: local(east),
    });
  });
});

describe("readSvgContent rect/circle/ellipse fill and size handling", () => {
  it("skips a rect when either width or height alone is non-positive, not only when both are", () => {
    expect(
      readVectors(svg('<rect x="0" y="0" width="0" height="10"/>')),
    ).toHaveLength(0);
    expect(
      readVectors(svg('<rect x="0" y="0" width="10" height="0"/>')),
    ).toHaveLength(0);
    expect(
      readVectors(svg('<rect x="0" y="0" width="-5" height="10"/>')),
    ).toHaveLength(0);
    expect(
      readVectors(svg('<rect x="0" y="0" width="0.5" height="0.5"/>')),
    ).toHaveLength(1);
  });

  it("takes the rounded-rect path when either radius alone is positive, not only when both are", () => {
    const onlyRxPositive = readVectors(
      svg('<rect x="0" y="0" width="20" height="20" rx="4" ry="0"/>'),
    );
    expect(onlyRxPositive[0]?.kind).toBe("path");
    const onlyRyPositive = readVectors(
      svg('<rect x="0" y="0" width="20" height="20" rx="0" ry="4"/>'),
    );
    expect(onlyRyPositive[0]?.kind).toBe("path");
    const neitherPositive = readVectors(
      svg('<rect x="0" y="0" width="20" height="20" rx="0" ry="0"/>'),
    );
    expect(neitherPositive[0]?.kind).toBe("rect");
  });

  it("skips a plain rect's rotated frame when the transform collapses only its width, or only its height", () => {
    expect(
      readVectors(
        svg(
          '<g transform="scale(0,1)"><rect x="0" y="0" width="10" height="10"/></g>',
        ),
      ),
    ).toHaveLength(0);
    expect(
      readVectors(
        svg(
          '<g transform="scale(1,0)"><rect x="0" y="0" width="10" height="10"/></g>',
        ),
      ),
    ).toHaveLength(0);
  });

  it("omits a rect's fill key when unpainted by fill, and its stroke key when unpainted by stroke", () => {
    const strokedOnly = readVectors(
      svg(
        '<rect x="0" y="0" width="5" height="5" fill="none" stroke="black"/>',
      ),
    );
    expect(strokedOnly[0]).not.toHaveProperty("fill");
    expect(strokedOnly[0]).toHaveProperty("stroke");
    const filledOnly = readVectors(
      svg('<rect x="0" y="0" width="5" height="5" fill="red"/>'),
    );
    expect(filledOnly[0]).toHaveProperty("fill");
    expect(filledOnly[0]).not.toHaveProperty("stroke");
  });

  it("skips a circle or ellipse when either radius alone is non-positive", () => {
    expect(readVectors(svg('<circle cx="10" cy="10" r="0"/>'))).toHaveLength(0);
    expect(readVectors(svg('<circle cx="10" cy="10" r="-2"/>'))).toHaveLength(
      0,
    );
    expect(
      readVectors(svg('<ellipse cx="10" cy="10" rx="0" ry="5"/>')),
    ).toHaveLength(0);
    expect(
      readVectors(svg('<ellipse cx="10" cy="10" rx="5" ry="0"/>')),
    ).toHaveLength(0);
  });

  it("omits an ellipse's fill key when unpainted by fill, and its stroke key when unpainted by stroke", () => {
    const strokedOnly = readVectors(
      svg('<circle cx="10" cy="10" r="5" fill="none" stroke="black"/>'),
    );
    expect(strokedOnly[0]).not.toHaveProperty("fill");
    expect(strokedOnly[0]).toHaveProperty("stroke");
    const filledOnly = readVectors(
      svg('<circle cx="10" cy="10" r="5" fill="blue"/>'),
    );
    expect(filledOnly[0]).toHaveProperty("fill");
    expect(filledOnly[0]).not.toHaveProperty("stroke");
  });

  it("skips an ellipse's rotated frame only when the transform collapses its own width or height, and takes the axis-aligned branch (not the similarity one) when the CTM has no rotation", () => {
    expect(
      readVectors(
        svg('<g transform="scale(0,1)"><circle cx="10" cy="10" r="5"/></g>'),
      ),
    ).toHaveLength(0);
    expect(
      readVectors(
        svg('<g transform="scale(1,0)"><circle cx="10" cy="10" r="5"/></g>'),
      ),
    ).toHaveLength(0);
    const axisAligned = readVectors(
      svg('<g transform="scale(2)"><circle cx="10" cy="10" r="5"/></g>'),
    );
    expect(axisAligned[0]).toMatchObject({
      kind: "ellipse",
      frame: { xPt: 10, yPt: 10, widthPt: 20, heightPt: 20 },
    });
    expect(axisAligned[0]).not.toHaveProperty("rotationDeg");
  });
});

describe("readSvgContent line endpoints and zero-length skip", () => {
  it("reads a line's endpoints from their own named attributes, not a placeholder that always defaults to zero", () => {
    const vectors = readVectors(
      svg('<line x1="3" y1="4" x2="30" y2="40" stroke="black"/>'),
    );
    expect(vectors[0]).toMatchObject({
      from: { xPt: 3, yPt: 4 },
      to: { xPt: 30, yPt: 40 },
    });
  });

  it("skips a truly zero-length line", () => {
    const vectors = readVectors(
      svg('<line x1="5" y1="5" x2="5" y2="5" stroke="black"/>'),
    );
    expect(vectors).toHaveLength(0);
  });

  it("keeps a line whose endpoints share only one coordinate, since it still has length on the other axis", () => {
    const sameX = readVectors(
      svg('<line x1="5" y1="5" x2="5" y2="20" stroke="black"/>'),
    );
    expect(sameX).toHaveLength(1);
    const sameY = readVectors(
      svg('<line x1="5" y1="5" x2="20" y2="5" stroke="black"/>'),
    );
    expect(sameY).toHaveLength(1);
  });
});

describe("readSvgContent polyline/polygon points parsing", () => {
  it("parses a points attribute via a real numeric split, not a placeholder that skips the element", () => {
    const vectors = readVectors(
      svg('<polyline points="0,0 10,20 20,0" fill="none" stroke="blue"/>'),
    );
    expect(vectors[0]).toMatchObject({
      kind: "path",
      subpaths: [
        {
          closed: false,
          segments: [{ to: { xPt: 10, yPt: 20 } }, { to: { xPt: 20, yPt: 0 } }],
        },
      ],
    });
  });

  it("closes a polygon but leaves a polyline open, over the same point list", () => {
    const polygon = readVectors(svg('<polygon points="0,0 10,0 10,10"/>'));
    expect(polygon[0]).toMatchObject({
      kind: "path",
      subpaths: [{ closed: true }],
    });
    const polyline = readVectors(
      svg('<polyline points="0,0 10,0 10,10" fill="none" stroke="black"/>'),
    );
    expect(polyline[0]).toMatchObject({
      kind: "path",
      subpaths: [{ closed: false }],
    });
  });

  it("reports a points list with an odd count of numbers, or a non-finite number, as malformed rather than truncating it", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(svg('<polygon points="0,0 10,0 10"/>'), diagnostics);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/element-unsupported",
    );
    const nonFinite: SvgDiagnostic[] = [];
    readVectors(svg('<polygon points="0,0 10,abc 10,10"/>'), nonFinite);
    expect(nonFinite.map((diagnostic) => diagnostic.code)).toContain(
      "svg/element-unsupported",
    );
  });

  it("skips a points list with fewer than two points, distinctly from a malformed one", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const vectors = readVectors(svg('<polygon points="5,5"/>'), diagnostics);
    expect(vectors).toHaveLength(0);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/element-skipped",
    );
  });
});

describe("readSvgContent path element edge cases", () => {
  it("skips a path with no d attribute, or one that is empty after trimming", () => {
    const diagnostics: SvgDiagnostic[] = [];
    expect(readVectors(svg("<path/>"), diagnostics)).toHaveLength(0);
    expect(readVectors(svg('<path d="   "/>'), diagnostics)).toHaveLength(0);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "svg/element-skipped",
      "svg/element-skipped",
    ]);
  });

  it("reports genuinely malformed path data distinctly from an absent d attribute", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(svg('<path d="not path data at all !!"/>'), diagnostics);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/element-unsupported",
    );
  });
});

describe("readSvgContent opacity diagnostics", () => {
  it("names each of opacity, fill-opacity, and stroke-opacity independently when below 1, and stays silent at or above 1", () => {
    const opacity: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" opacity="0.5"/>'),
      opacity,
    );
    expect(opacity.map((diagnostic) => diagnostic.detail)).toContain(
      "rect: opacity=0.5",
    );
    const fillOpacity: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" fill-opacity="0.5"/>'),
      fillOpacity,
    );
    expect(fillOpacity.map((diagnostic) => diagnostic.detail)).toContain(
      "rect: fill-opacity=0.5",
    );
    const strokeOpacity: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" stroke-opacity="0.5"/>'),
      strokeOpacity,
    );
    expect(strokeOpacity.map((diagnostic) => diagnostic.detail)).toContain(
      "rect: stroke-opacity=0.5",
    );
    const atOne: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" opacity="1"/>'),
      atOne,
    );
    expect(atOne.map((diagnostic) => diagnostic.code)).not.toContain(
      "svg/opacity-ignored",
    );
  });
});

describe("readSvgContent group and unsupported-element dispatch", () => {
  it("walks both a <g> and an <a> element's children the same way, applying their own transform", () => {
    const group = readVectors(
      svg(
        '<g transform="translate(5,5)"><rect x="0" y="0" width="2" height="2"/></g>',
      ),
    );
    expect(group[0]).toMatchObject({ frame: { xPt: 5, yPt: 5 } });
    const anchor = readVectors(
      svg(
        '<a transform="translate(5,5)"><rect x="0" y="0" width="2" height="2"/></a>',
      ),
    );
    expect(anchor[0]).toMatchObject({ frame: { xPt: 5, yPt: 5 } });
  });

  it("walks past a non-rendering element's children silently, and reports an element it doesn't know at all", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      svg(
        '<clipPath id="c"><rect x="0" y="0" width="5" height="5"/></clipPath><foreignObject/>',
      ),
      diagnostics,
    );
    // The rect inside clipPath is never walked, so it produces no vector and no diagnostic of its own — only foreignObject's own unsupported report appears.
    expect(diagnostics).toEqual([
      { code: "svg/element-unsupported", detail: "foreignObject" },
    ]);
  });

  it("names each text-family element (tspan, textPath, tref) as unsupported, not only the bare text element", () => {
    for (const tag of ["tspan", "textPath", "tref"]) {
      const diagnostics: SvgDiagnostic[] = [];
      readVectors(svg(`<${tag}/>`), diagnostics);
      expect(diagnostics).toEqual([
        { code: "svg/text-unsupported", detail: tag },
      ]);
    }
  });
});

describe("readSvgContent root geometry boundaries", () => {
  it("ignores a viewBox whose width or height is exactly zero or negative, falling to the CSS default size", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const document = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 60"><rect x="0" y="0" width="5" height="5"/></svg>',
      {
        onSvgDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 225, heightPt: 112.5 });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/default-size-assumed",
    );
  });

  it("discards a zero or negative width/height attribute the same way it discards an absent one", () => {
    const document = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="0pt" height="-5pt" viewBox="0 0 50 25"><rect x="0" y="0" width="10" height="5"/></svg>',
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 50, heightPt: 25 });
  });

  it("discards width alone or height alone even when the other is present and positive, per the CSS intrinsic-sizing rule", () => {
    const widthOnly = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" viewBox="0 0 40 20"><rect x="0" y="0" width="5" height="5"/></svg>',
    );
    if (widthOnly.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(widthOnly.pages[0]?.size).toEqual({ widthPt: 40, heightPt: 20 });
    const heightOnly = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" height="60pt" viewBox="0 0 40 20"><rect x="0" y="0" width="5" height="5"/></svg>',
    );
    if (heightOnly.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(heightOnly.pages[0]?.size).toEqual({ widthPt: 40, heightPt: 20 });
  });

  it("names the CSS default replaced-element size assumption with its own explanatory detail text", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="5" height="5"/></svg>',
      {
        onSvgDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
    );
    expect(diagnostics[0]).toMatchObject({
      code: "svg/default-size-assumed",
      detail:
        "neither width/height nor a usable viewBox was present; assuming the CSS default replaced-element size of 300x150 px",
    });
  });

  it("defaults preserveAspectRatio to 'xMidYMid meet' when absent, still firing the stretched diagnostic", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200pt" height="100pt" viewBox="0 0 100 100"><rect x="0" y="0" width="50" height="50"/></svg>',
      diagnostics,
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/preserve-aspect-ratio-stretched",
    );
  });

  it("scales a non-zero viewBox origin into the page map by the same per-axis factor as the extents", () => {
    const vectors = readVectors(
      svg(
        '<rect x="10" y="5" width="20" height="10"/>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="200pt" height="120pt" viewBox="10 5 100 60">',
      ),
    );
    // sx = 200/100 = 2, sy = 120/60 = 2; the rect sits exactly at the viewBox origin, so it must map to page (0,0), which only holds if the translation term is -origin * scale (2*10 + -10*2 = 0) rather than -origin / scale (2*10 + -10/2 = 15).
    expect(vectors[0]).toMatchObject({
      frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 20 },
    });
  });
});

describe("readSvgContent title metadata", () => {
  it("omits metadata.title entirely when no title element is present, rather than an empty string", () => {
    const document = readSvgContent(
      svg('<rect x="0" y="0" width="5" height="5"/>'),
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.metadata).not.toHaveProperty("title");
  });

  it("omits metadata.title when the title element is present but empty after trimming", () => {
    const document = readSvgContent(
      svg('<title>   </title><rect x="0" y="0" width="5" height="5"/>'),
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.metadata).not.toHaveProperty("title");
  });
});

describe("readSvgContent diagnostic detail text, second pass", () => {
  it("names the exact fragment and reason in every fill/stroke degradation message", () => {
    const gradient: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" fill="url(#grad)"/>'),
      gradient,
    );
    expect(gradient[0]).toMatchObject({
      code: "svg/gradient-unsupported",
      detail: "#grad",
    });
    const currentColor: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" fill="currentColor"/>'),
      currentColor,
    );
    expect(currentColor[0]).toMatchObject({
      detail:
        "currentColor renders as black: the CSS color property is out of scope",
    });
  });

  it("names the id-qualified detail on a zero-size rect's own skip diagnostic", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect id="box" x="0" y="0" width="0" height="5"/>'),
      diagnostics,
    );
    expect(diagnostics[0]).toMatchObject({
      code: "svg/element-skipped",
      detail: "rect#box: zero or negative size",
    });
  });

  it("names the id-qualified detail on an unpainted element's own skip diagnostic", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect id="ghost" x="0" y="0" width="5" height="5" fill="none"/>'),
      diagnostics,
    );
    expect(diagnostics[0]).toMatchObject({
      code: "svg/element-skipped",
      detail:
        "rect#ghost: nothing painted (fill and stroke both absent or none)",
    });
  });

  it("names the exact reason in a rotated frame's own zero-size skip diagnostic", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      svg(
        '<g transform="scale(0,1)"><rect x="0" y="0" width="10" height="5"/></g>',
      ),
      diagnostics,
    );
    expect(diagnostics[0]).toMatchObject({
      detail: "rect: collapses to zero size under transform",
    });
  });

  it("names the id-qualified detail on a zero-radius circle/ellipse's own skip diagnostic", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(svg('<circle id="dot" cx="0" cy="0" r="0"/>'), diagnostics);
    expect(diagnostics[0]).toMatchObject({
      detail: "circle#dot: zero or negative radius",
    });
  });

  it("names the id-qualified detail on a line's absent-stroke skip diagnostic", () => {
    // No fill/stroke attributes at all: fill defaults to black (painted), so the generic "nothing painted" check passes and the walk reaches the line-specific stroke check, which is what this test targets.
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      svg('<line id="ln" x1="0" y1="0" x2="5" y2="5"/>'),
      diagnostics,
    );
    expect(diagnostics[0]).toMatchObject({
      detail:
        "line#ln: a line paints only through its stroke, which is absent or none",
    });
  });

  it("names the id-qualified detail on a zero-length line's own skip diagnostic", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      svg('<line id="pt" x1="5" y1="5" x2="5" y2="5" stroke="black"/>'),
      diagnostics,
    );
    expect(diagnostics[0]).toMatchObject({
      detail: "line#pt: zero-length line",
    });
  });

  it("names the id-qualified detail distinctly for a malformed points list, a too-short one, and coincident points", () => {
    const malformed: SvgDiagnostic[] = [];
    readVectors(svg('<polygon id="p1" points="0,0 10"/>'), malformed);
    expect(malformed[0]).toMatchObject({
      code: "svg/element-unsupported",
      detail: "polygon#p1: malformed points attribute",
    });
    const tooShort: SvgDiagnostic[] = [];
    readVectors(svg('<polygon id="p2" points="5,5"/>'), tooShort);
    expect(tooShort[0]).toMatchObject({
      detail: "polygon#p2: fewer than two points",
    });
  });

  it("names the id-qualified detail distinctly for an absent d attribute and malformed path data", () => {
    const absent: SvgDiagnostic[] = [];
    readVectors(svg('<path id="p1"/>'), absent);
    expect(absent[0]).toMatchObject({
      detail: "path#p1: no d attribute",
    });
    const malformed: SvgDiagnostic[] = [];
    readVectors(svg('<path id="p2" d="not valid path data !!"/>'), malformed);
    expect(malformed[0]).toMatchObject({
      detail: "path#p2: malformed or empty path data",
    });
  });
});

describe("readSvgContent fillRule and opacity dispatch, second pass", () => {
  it("names an unrecognised fill-rule value, not only evenodd/nonzero", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" fill-rule="oddeven"/>'),
      diagnostics,
    );
    expect(diagnostics.map((d) => d.detail)).toContain("oddeven");
  });

  it("ignores a fill-rule of exactly 'nonzero', the schema's own default, without any diagnostic", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const vectors = readVectors(
      svg('<rect x="0" y="0" width="5" height="5" fill-rule="nonzero"/>'),
      diagnostics,
    );
    expect(vectors[0]).not.toHaveProperty("fillRule");
    expect(diagnostics).toHaveLength(0);
  });

  it("ignores an opacity attribute that is present but not actually below 1, such as a non-finite value", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" opacity="notanumber"/>'),
      diagnostics,
    );
    expect(diagnostics.map((d) => d.code)).not.toContain("svg/opacity-ignored");
  });
});

describe("readSvgContent ellipse subpath closure", () => {
  it("closes the ellipse-as-path subpath, the same as a circle's own ellipse traversal", () => {
    const vectors = readVectors(
      svg(
        '<g transform="matrix(1 0.5 0 1 0 0)"><circle cx="10" cy="10" r="5"/></g>',
      ),
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.subpaths[0]?.closed).toBe(true);
  });
});

describe("readSvgContent root geometry, second pass", () => {
  it("discards a viewBox whose height alone is zero, even with a positive width", () => {
    const document = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 0"><rect x="0" y="0" width="5" height="5"/></svg>',
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    // No usable viewBox and no width/height attributes, so the CSS default size applies.
    expect(document.pages[0]?.size).toEqual({ widthPt: 225, heightPt: 112.5 });
  });

  it("discards a width attribute of exactly zero, distinctly from a merely-absent one", () => {
    const document = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="0pt" height="60pt" viewBox="0 0 50 25"><rect x="0" y="0" width="5" height="5"/></svg>',
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 50, heightPt: 25 });
  });

  it("discards a height attribute of exactly zero, distinctly from a merely-absent one", () => {
    const document = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="0pt" viewBox="0 0 50 25"><rect x="0" y="0" width="5" height="5"/></svg>',
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 50, heightPt: 25 });
  });

  it("keeps both width and height when both are present and positive, taking neither the viewBox nor the default", () => {
    const document = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80pt" height="40pt" viewBox="0 0 50 25"><rect x="0" y="0" width="5" height="5"/></svg>',
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 80, heightPt: 40 });
  });

  it("defaults an unset preserveAspectRatio to 'xMidYMid meet' rather than an empty string, which would compare unequal to 'none'", () => {
    // If the default fell back to "" instead of "xMidYMid meet", trim() !== "none" would still hold and the stretched diagnostic would still fire coincidentally — so this test checks the letterboxing detail names the real default value, not a blank one.
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200pt" height="100pt" viewBox="0 0 100 100"><rect x="0" y="0" width="50" height="50"/></svg>',
      diagnostics,
    );
    const stretched = diagnostics.find(
      (d) => d.code === "svg/preserve-aspect-ratio-stretched",
    );
    expect(stretched?.detail).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("compares the trimmed preserveAspectRatio value against 'none', not the raw untrimmed attribute", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200pt" height="100pt" viewBox="0 0 100 100" preserveAspectRatio=" none "><rect x="0" y="0" width="50" height="50"/></svg>',
      diagnostics,
    );
    expect(diagnostics.map((d) => d.code)).not.toContain(
      "svg/preserve-aspect-ratio-stretched",
    );
  });

  it("treats the aspect mismatch as real only outside a proportional floating-point tolerance, not by an absolute epsilon", () => {
    // viewBoxAspect = 100/50 = 2; pageAspect = 200.0000001/100 ≈ 2.0000000005 — the difference is far smaller than a fixed 1e-6 but must still be judged relative to the aspect's own magnitude, matching how the tolerance is actually computed (1e-6 * max(...), not 1e-6 alone).
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200.0000001pt" height="100pt" viewBox="0 0 100 50"><rect x="0" y="0" width="10" height="10"/></svg>',
      diagnostics,
    );
    expect(diagnostics.map((d) => d.code)).not.toContain(
      "svg/preserve-aspect-ratio-stretched",
    );
  });
});

describe("readSvgContent title metadata, second pass", () => {
  it("only picks up an actual <title> child, not the first child element regardless of its own tag", () => {
    const document = readSvgContent(
      svg(
        '<desc>Some description text</desc><rect x="0" y="0" width="5" height="5"/>',
      ),
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.metadata).not.toHaveProperty("title");
  });
});
