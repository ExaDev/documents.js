import type { AffineMatrix } from "./transform";
import type {
  Box,
  Color,
  ContentStroke,
  ContentSubpath,
  ContentVector,
} from "document-schema.js";
import { KAPPA, resolveFillPaint } from "./read";
import type { PaintState, ReaderState } from "./read";
import type { ParsedPathPoint, ParsedPathSubpath } from "./path";
import { applyMatrix, meanScaleFactor } from "./transform";
import { parseSvgDashStyle } from "./paint";
import { parseSvgUserUnits } from "./units";
// The geometry half of SVG reading, split from read.ts: bounding boxes of point lists, axis-aligned and similarity-normalised frames, and the path-vector builders (path data, rounded rects, ellipses). read.ts keeps paint resolution, the element walk and the root reader.
// Stroke width resolves through the shared user-unit length parser (default 1, the attribute's own default), then scales by the CTM's mean column scale. A stroke whose scaled width is not positive is dropped rather than clamped — ContentStrokeSchema demands widthPt > 0, and a zero-width stroke paints nothing in a conforming renderer either.
export function resolveStroke(
  state: ReaderState,
  paint: PaintState,
  ctm: AffineMatrix,
): ContentStroke | undefined {
  const color = resolveFillPaint(state, paint.strokeSpec, false);
  if (color === undefined) {
    return undefined;
  }
  const strokeUserUnits = parseSvgUserUnits(paint.strokeWidthSpec) ?? 1;
  const widthPt = strokeUserUnits * meanScaleFactor(ctm);
  if (!(widthPt > 0)) {
    return undefined;
  }
  const style = parseSvgDashStyle(paint.dashSpec);
  return style === undefined ? { color, widthPt } : { color, widthPt, style };
}

export function resolvePaint(
  state: ReaderState,
  paint: PaintState,
  ctm: AffineMatrix,
): { readonly fill?: Color; readonly stroke?: ContentStroke } {
  return {
    fill: resolveFillPaint(state, paint.fillSpec, true),
    stroke: resolveStroke(state, paint, ctm),
  };
}

export function boxOfPoints(
  points: readonly { readonly x: number; readonly y: number }[],
): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY };
}

// The frame an axis-aligned CTM gives a box: the bounding box of the four transformed corners, which for a matrix with no rotation or shear terms (mirroring included) is exactly the transformed box.
export function axisAlignedFrame(
  ctm: AffineMatrix,
  x: number,
  y: number,
  width: number,
  height: number,
): Box {
  return boxOfPoints([
    applyMatrix(ctm, x, y),
    applyMatrix(ctm, x + width, y),
    applyMatrix(ctm, x + width, y + height),
    applyMatrix(ctm, x, y + height),
  ]);
}

// The frame a non-reflecting similarity CTM gives a box, per the module note's pre-rotation contract: the uniformly scaled box, positioned so its centre sits on the transformed centre — the renderer then rotates the frame's own points about that centre by rotationDeg and lands exactly on the transformed corners.
export function similarityFrame(
  ctm: AffineMatrix,
  x: number,
  y: number,
  width: number,
  height: number,
): Box {
  const centre = applyMatrix(ctm, x + width / 2, y + height / 2);
  const scale = Math.hypot(ctm.a, ctm.b);
  return {
    xPt: centre.x - (scale * width) / 2,
    yPt: centre.y - (scale * height) / 2,
    widthPt: scale * width,
    heightPt: scale * height,
  };
}

// The path pipeline every curve-carrying construction funnels into: transform each point of the already-parsed local-space subpaths through the CTM (an affine maps a cubic's controls exactly, so nothing is approximated here), take the tight bounding box of ALL points including cubic controls (the identical hull convention src/layout/drawing.ts's own vectorItemBounds documents — a cubic lies within the convex hull of its controls, so the frame contains the rendered curve), and rebase the points into the frame's own local space, which is the ContentVector path variant's own subpaths contract.
export function buildPathVector(
  state: ReaderState,
  subpaths: readonly ParsedPathSubpath[],
  ctm: AffineMatrix,
  paint: { readonly fill?: Color; readonly stroke?: ContentStroke },
  fillRule: "evenodd" | undefined,
): ContentVector | undefined {
  const placed: ParsedPathSubpath[] = subpaths.map((subpath) => ({
    start: applyMatrix(ctm, subpath.start.x, subpath.start.y),
    closed: subpath.closed,
    segments: subpath.segments.map((segment) =>
      segment.kind === "line"
        ? {
            kind: "line" as const,
            to: applyMatrix(ctm, segment.to.x, segment.to.y),
          }
        : {
            kind: "cubic" as const,
            control1: applyMatrix(ctm, segment.control1.x, segment.control1.y),
            control2: applyMatrix(ctm, segment.control2.x, segment.control2.y),
            to: applyMatrix(ctm, segment.to.x, segment.to.y),
          },
    ),
  }));
  const allPoints = placed.flatMap((subpath) => [
    subpath.start,
    ...subpath.segments.flatMap((segment): ParsedPathPoint[] =>
      segment.kind === "line"
        ? [segment.to]
        : [segment.control1, segment.control2, segment.to],
    ),
  ]);
  const frame = boxOfPoints(allPoints);
  if (frame.widthPt === 0 && frame.heightPt === 0) {
    return undefined;
  }
  const localSubpaths: ContentSubpath[] = placed.map((subpath) => ({
    start: {
      xPt: subpath.start.x - frame.xPt,
      yPt: subpath.start.y - frame.yPt,
    },
    closed: subpath.closed,
    segments: subpath.segments.map((segment) =>
      segment.kind === "line"
        ? {
            kind: "line" as const,
            to: {
              xPt: segment.to.x - frame.xPt,
              yPt: segment.to.y - frame.yPt,
            },
          }
        : {
            kind: "cubic" as const,
            control1: {
              xPt: segment.control1.x - frame.xPt,
              yPt: segment.control1.y - frame.yPt,
            },
            control2: {
              xPt: segment.control2.x - frame.xPt,
              yPt: segment.control2.y - frame.yPt,
            },
            to: {
              xPt: segment.to.x - frame.xPt,
              yPt: segment.to.y - frame.yPt,
            },
          },
    ),
  }));
  const sourceIndex = state.vectors.length;
  return {
    kind: "path",
    frame,
    subpaths: localSubpaths,
    ...(paint.fill !== undefined ? { fill: paint.fill } : {}),
    ...(fillRule !== undefined ? { fillRule } : {}),
    ...(paint.stroke !== undefined ? { stroke: paint.stroke } : {}),
    paintOrder: state.paintOrder++,
    sourcePath: `svg/vector[${sourceIndex}]`,
  };
}

// A rounded rect becomes a path the same way it renders: four straight edges and four kappa quarter-ellipse corners, walked clockwise in y-down space. rx/ry arrive already resolved (each defaulting to the other when one is absent) and are clamped against half the rect's own width/height per the attribute's own rule.
export function roundedRectSubpaths(
  x: number,
  y: number,
  width: number,
  height: number,
  rx: number,
  ry: number,
): ParsedPathSubpath[] {
  const radiusX = Math.min(rx, width / 2);
  const radiusY = Math.min(ry, height / 2);
  const kx = radiusX * KAPPA;
  const ky = radiusY * KAPPA;
  return [
    {
      start: { x: x + radiusX, y },
      closed: true,
      segments: [
        { kind: "line", to: { x: x + width - radiusX, y } },
        {
          kind: "cubic",
          control1: { x: x + width - radiusX + kx, y },
          control2: { x: x + width, y: y + radiusY - ky },
          to: { x: x + width, y: y + radiusY },
        },
        { kind: "line", to: { x: x + width, y: y + height - radiusY } },
        {
          kind: "cubic",
          control1: { x: x + width, y: y + height - radiusY + ky },
          control2: { x: x + width - radiusX + kx, y: y + height },
          to: { x: x + width - radiusX, y: y + height },
        },
        { kind: "line", to: { x: x + radiusX, y: y + height } },
        {
          kind: "cubic",
          control1: { x: x + radiusX - kx, y: y + height },
          control2: { x, y: y + height - radiusY + ky },
          to: { x, y: y + height - radiusY },
        },
        { kind: "line", to: { x, y: y + radiusY } },
        {
          kind: "cubic",
          control1: { x, y: y + radiusY - ky },
          control2: { x: x + radiusX - kx, y },
          to: { x: x + radiusX, y },
        },
      ],
    },
  ];
}

// An ellipse as its four kappa quarter-arc cubics, walked clockwise from the rightmost axis point in y-down space — the mirror image of src/layout/drawing.ts's own ellipseCubicPoints walk (counter-clockwise in PDF's y-up space; both trace the same curve).
export function ellipseSubpaths(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): ParsedPathSubpath[] {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    {
      start: { x: cx + rx, y: cy },
      closed: true,
      segments: [
        {
          kind: "cubic",
          control1: { x: cx + rx, y: cy + ky },
          control2: { x: cx + kx, y: cy + ry },
          to: { x: cx, y: cy + ry },
        },
        {
          kind: "cubic",
          control1: { x: cx - kx, y: cy + ry },
          control2: { x: cx - rx, y: cy + ky },
          to: { x: cx - rx, y: cy },
        },
        {
          kind: "cubic",
          control1: { x: cx - rx, y: cy - ky },
          control2: { x: cx - kx, y: cy - ry },
          to: { x: cx, y: cy - ry },
        },
        {
          kind: "cubic",
          control1: { x: cx + kx, y: cy - ry },
          control2: { x: cx + rx, y: cy - ky },
          to: { x: cx + rx, y: cy },
        },
      ],
    },
  ];
}
