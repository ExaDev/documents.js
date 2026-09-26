import { describe, expect, it } from "vitest";
import type { ContentVector } from "document-schema.js";
import type { SvgDiagnostic } from "./diagnostics";
import { readSvgContent } from "./read";
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
