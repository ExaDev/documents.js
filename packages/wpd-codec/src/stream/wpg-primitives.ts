import type {
  Box,
  ContentStroke,
  ContentSubpath,
  ContentVector,
} from "document-schema.js";
import { uint16At } from "../bytes/view";
import {
  coordinateAt,
  fillOf,
  frameFromCorners,
  FLAG_CLOSE,
  FLAG_FILL,
  FLAG_FRAME,
  FLAG_PATH_WINDING,
  POINTS_PER_INCH,
  QUARTER_ELLIPSE_KAPPA,
  RECORD_ARC,
  RECORD_POLYLINE,
  RECORD_RECTANGLE,
  readCharacterization,
  strokeOf,
  xToPt,
  yToPt,
  type WpgGeometry,
  type WpgRenditionState,
} from "./wpg";

// The primitive records that decode to a ContentVector: Polyline, Rectangle, and Arc-as-full-ellipse. Returns undefined for any other type, for a record this reader must refuse (transformation flags, truncated data, a partial arc), leaving the caller to name it.
export function readPrimitiveVector(
  type: number,
  data: Uint8Array,
  geometry: WpgGeometry,
  state: WpgRenditionState,
): ContentVector | undefined {
  const characterization = readCharacterization(data, 0);
  if (characterization === undefined) {
    return undefined;
  }
  const { flags, geometryAt } = characterization;
  const stroke =
    (flags & FLAG_FRAME) !== 0 ? strokeOf(geometry, state) : undefined;
  switch (type) {
    case RECORD_POLYLINE:
      return readPolyline(data, geometry, flags, geometryAt, stroke, state);
    case RECORD_RECTANGLE:
      return readWpgRectangle(data, geometry, flags, geometryAt, stroke, state);
    case RECORD_ARC:
      return readWpgFullEllipse(
        data,
        geometry,
        flags,
        geometryAt,
        stroke,
        state,
      );
    default:
      return undefined;
  }
}

function readPolyline(
  data: Uint8Array,
  geometry: WpgGeometry,
  flags: number,
  geometryAt: number,
  stroke: ContentStroke | undefined,
  state: WpgRenditionState,
): ContentVector | undefined {
  // uint16At and coordinateAt are both built on byteAt, whose own bounds check throws rather than returning undefined — a count field or a point that runs past data's own end surfaces as one caught exception, not a separate manual "room for N more bytes" comparison at each read.
  const points: { xPt: number; yPt: number }[] = [];
  try {
    const count = uint16At(data, geometryAt);
    let at = geometryAt + 2;
    for (let index = 0; index < count; index += 1) {
      points.push({
        xPt: xToPt(geometry, coordinateAt(data, at, geometry.doublePrecision)),
        yPt: yToPt(
          geometry,
          coordinateAt(
            data,
            at + geometry.coordinateSize,
            geometry.doublePrecision,
          ),
        ),
      });
      at += geometry.coordinateSize * 2;
    }
  } catch {
    return undefined;
  }
  const firstPoint = points[0];
  if (firstPoint === undefined) {
    return undefined;
  }
  const secondPoint = points[1];
  const closed = (flags & FLAG_CLOSE) !== 0;
  const filled = (flags & FLAG_FILL) !== 0;

  // Two points, not closed, is the shared model's own line variant — the shape a plain stroke draws — when a stroke resolved for it (the variant carries a required stroke, and a hairline-framed line keeps its geometry as a path instead).
  if (
    points.length === 2 &&
    secondPoint !== undefined &&
    !closed &&
    stroke !== undefined
  ) {
    return {
      kind: "line",
      from: firstPoint,
      to: secondPoint,
      stroke,
    };
  }

  // A path's subpath points are local to its own frame (the shared path variant's contract), so the bounding box of the converted points becomes the frame and each point shifts by its origin.
  const frame = boundingFrame(points);
  const local = points.map((point) => ({
    xPt: point.xPt - frame.xPt,
    yPt: point.yPt - frame.yPt,
  }));
  const subpath: ContentSubpath = {
    start: {
      xPt: firstPoint.xPt - frame.xPt,
      yPt: firstPoint.yPt - frame.yPt,
    },
    segments: local
      .slice(1)
      .map((point) => ({ kind: "line" as const, to: point })),
    closed,
  };
  const fill = filled ? fillOf(state) : undefined;
  return {
    kind: "path",
    frame,
    subpaths: [subpath],
    ...(fill !== undefined
      ? {
          fill: fill.fill,
          ...(fill.fillOpacity < 1 ? { fillOpacity: fill.fillOpacity } : {}),
          ...((flags & FLAG_PATH_WINDING) !== 0
            ? { fillRule: "nonzero" as const }
            : {}),
        }
      : {}),
    ...(stroke !== undefined ? { stroke } : {}),
  };
}

function boundingFrame(points: readonly { xPt: number; yPt: number }[]): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.xPt);
    minY = Math.min(minY, point.yPt);
    maxX = Math.max(maxX, point.xPt);
    maxY = Math.max(maxY, point.yPt);
  }
  return { xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY };
}

// A WPG rectangle's own six consecutive coordinate fields: lower-left x/y, upper-right x/y, then the corner radii x/y.
const RECTANGLE_FIELD_COUNT = 6;
const RECTANGLE_YLL_FIELD = 1;
const RECTANGLE_XUR_FIELD = 2;
const RECTANGLE_YUR_FIELD = 3;
const RECTANGLE_RX_FIELD = 4;
const RECTANGLE_RY_FIELD = 5;

function readWpgRectangle(
  data: Uint8Array,
  geometry: WpgGeometry,
  flags: number,
  geometryAt: number,
  stroke: ContentStroke | undefined,
  state: WpgRenditionState,
): ContentVector | undefined {
  const coordinateSize = geometry.coordinateSize;
  if (geometryAt + coordinateSize * RECTANGLE_FIELD_COUNT > data.length) {
    return undefined;
  }
  const xll = coordinateAt(data, geometryAt, geometry.doublePrecision);
  const yll = coordinateAt(
    data,
    geometryAt + coordinateSize * RECTANGLE_YLL_FIELD,
    geometry.doublePrecision,
  );
  const xur = coordinateAt(
    data,
    geometryAt + coordinateSize * RECTANGLE_XUR_FIELD,
    geometry.doublePrecision,
  );
  const yur = coordinateAt(
    data,
    geometryAt + coordinateSize * RECTANGLE_YUR_FIELD,
    geometry.doublePrecision,
  );
  const rx = coordinateAt(
    data,
    geometryAt + coordinateSize * RECTANGLE_RX_FIELD,
    geometry.doublePrecision,
  );
  const ry = coordinateAt(
    data,
    geometryAt + coordinateSize * RECTANGLE_RY_FIELD,
    geometry.doublePrecision,
  );
  const frame = frameFromCorners(geometry, xll, yll, xur, yur);
  const filled = (flags & FLAG_FILL) !== 0;
  const fill = filled ? fillOf(state) : undefined;
  const fillFields =
    fill !== undefined
      ? {
          fill: fill.fill,
          ...(fill.fillOpacity < 1 ? { fillOpacity: fill.fillOpacity } : {}),
        }
      : {};

  // "If either the horizontal radius or the vertical radius is less than or equal to zero, then the corner is assumed to be square" — the plain rect the shared model carries directly.
  if (rx <= 0 || ry <= 0) {
    return {
      kind: "rect",
      frame,
      ...fillFields,
      ...(stroke !== undefined ? { stroke } : {}),
    };
  }

  // A genuinely rounded rectangle: the shared rect variant carries no corner radii, so the shape becomes a path whose corners are the quarter-ellipse cubics named at this module's head. The path starts at the nine o'clock position the specification itself defines for a rectangle's path, and the subpath points are local to the frame as the path variant's own contract states. A corner radius is a magnitude, not a position, so only the unit conversion applies — running one through yToPt would flip it against an extent height it never measured from — and each radius clamps to half its side so a radius larger than the rectangle itself still yields a path inside the frame, with the cubic control offsets derived from the clamped values to match.
  const cornerRxPt = Math.min(
    (rx / geometry.xPpi) * POINTS_PER_INCH,
    frame.widthPt / 2,
  );
  const cornerRyPt = Math.min(
    (ry / geometry.yPpi) * POINTS_PER_INCH,
    frame.heightPt / 2,
  );
  const kx = cornerRxPt * QUARTER_ELLIPSE_KAPPA;
  const ky = cornerRyPt * QUARTER_ELLIPSE_KAPPA;
  const width = frame.widthPt;
  const height = frame.heightPt;
  const left = { xPt: 0, yPt: height / 2 };
  return {
    kind: "path",
    frame,
    subpaths: [
      {
        start: left,
        closed: true,
        segments: [
          { kind: "line", to: { xPt: cornerRxPt, yPt: 0 } },
          {
            kind: "cubic",
            control1: { xPt: cornerRxPt - kx, yPt: 0 },
            control2: { xPt: width, yPt: cornerRyPt - ky },
            to: { xPt: width, yPt: cornerRyPt },
          },
          { kind: "line", to: { xPt: width, yPt: height - cornerRyPt } },
          {
            kind: "cubic",
            control1: { xPt: width, yPt: height - cornerRyPt + ky },
            control2: { xPt: width - cornerRxPt + kx, yPt: height },
            to: { xPt: width - cornerRxPt, yPt: height },
          },
          { kind: "line", to: { xPt: cornerRxPt, yPt: height } },
          {
            kind: "cubic",
            control1: { xPt: cornerRxPt - kx, yPt: height },
            control2: { xPt: 0, yPt: height - cornerRyPt + ky },
            to: { xPt: 0, yPt: height - cornerRyPt },
          },
          { kind: "line", to: { xPt: 0, yPt: cornerRyPt } },
          {
            kind: "cubic",
            control1: { xPt: 0, yPt: cornerRyPt - ky },
            control2: { xPt: cornerRxPt - kx, yPt: 0 },
            to: { xPt: cornerRxPt, yPt: 0 },
          },
          { kind: "line", to: left },
        ],
      },
    ],
    ...fillFields,
    ...(stroke !== undefined ? { stroke } : {}),
  };
}

// An Arc record's own eight consecutive coordinate fields: centre x/y, radius x/y, initial-endpoint x/y, terminal-endpoint x/y, followed by one rotation-angle byte.
const ARC_FIELD_COUNT = 8;
const ARC_CY_FIELD = 1;
const ARC_RX_FIELD = 2;
const ARC_RY_FIELD = 3;
const ARC_IX_FIELD = 4;
const ARC_IY_FIELD = 5;
const ARC_EX_FIELD = 6;
const ARC_EY_FIELD = 7;
const ARC_ROTATION_ANGLE_SIZE = 1;

// An Arc record whose initial and terminal endpoint offsets are identical: "Identical endpoint coordinates define a full ellipse or circle" — the only arc spelling this decoder lifts, since a partial elliptical arc has no exact segment shape in the shared path model (whose cubics would approximate, not carry, it). Any other arc is refused and named.
function readWpgFullEllipse(
  data: Uint8Array,
  geometry: WpgGeometry,
  flags: number,
  geometryAt: number,
  stroke: ContentStroke | undefined,
  state: WpgRenditionState,
): ContentVector | undefined {
  const coordinateSize = geometry.coordinateSize;
  if (
    geometryAt + coordinateSize * ARC_FIELD_COUNT + ARC_ROTATION_ANGLE_SIZE >
    data.length
  ) {
    return undefined;
  }
  const cx = coordinateAt(data, geometryAt, geometry.doublePrecision);
  const cy = coordinateAt(
    data,
    geometryAt + coordinateSize * ARC_CY_FIELD,
    geometry.doublePrecision,
  );
  const rx = coordinateAt(
    data,
    geometryAt + coordinateSize * ARC_RX_FIELD,
    geometry.doublePrecision,
  );
  const ry = coordinateAt(
    data,
    geometryAt + coordinateSize * ARC_RY_FIELD,
    geometry.doublePrecision,
  );
  const ix = coordinateAt(
    data,
    geometryAt + coordinateSize * ARC_IX_FIELD,
    geometry.doublePrecision,
  );
  const iy = coordinateAt(
    data,
    geometryAt + coordinateSize * ARC_IY_FIELD,
    geometry.doublePrecision,
  );
  const ex = coordinateAt(
    data,
    geometryAt + coordinateSize * ARC_EX_FIELD,
    geometry.doublePrecision,
  );
  const ey = coordinateAt(
    data,
    geometryAt + coordinateSize * ARC_EY_FIELD,
    geometry.doublePrecision,
  );
  if (ix !== ex || iy !== ey) {
    return undefined;
  }
  const frame = frameFromCorners(geometry, cx - rx, cy - ry, cx + rx, cy + ry);
  const filled = (flags & FLAG_FILL) !== 0;
  const fill = filled ? fillOf(state) : undefined;
  return {
    kind: "ellipse",
    frame,
    ...(fill !== undefined
      ? {
          fill: fill.fill,
          ...(fill.fillOpacity < 1 ? { fillOpacity: fill.fillOpacity } : {}),
        }
      : {}),
    ...(stroke !== undefined ? { stroke } : {}),
  };
}
