import type {
  Box,
  Color,
  ContentDocument,
  ContentDrawPage,
  ContentStroke,
  ContentSubpath,
  ContentVector,
} from "document-schema.js";

import type { SvgDiagnosticCode, SvgDiagnosticSink } from "./diagnostics";
import { parseSvgDashStyle, parseSvgPaint } from "./paint";
import { parseSvgPathData } from "./path";
import type {
  ParsedPathPoint,
  ParsedPathSegment,
  ParsedPathSubpath,
} from "./path";
import { parseSvgLengthPt, parseSvgUserUnits, parseSvgViewBox } from "./units";
import type { SvgViewBox } from "./units";
import {
  applyMatrix,
  composeMatrices,
  isAxisAligned,
  isNonReflectingSimilarity,
  meanScaleFactor,
  parseSvgTransform,
  similarityRotationDeg,
} from "./transform";
import type { AffineMatrix } from "./transform";
import { parseXml } from "odf.js";
import type { XmlElement, XmlNode } from "odf.js";
import { decodeEntities } from "ooxml.js";

// SVG text -> ContentDocument (the drawing variant): the fifth adapter family, sharing the drawing variant with odg. The walk maps the six vector shape primitives (rect/circle/ellipse/line/polyline/polygon/path) onto ContentVector, carrying group transforms and the root viewBox -> viewport map as one affine matrix every coordinate passes through, so SVG rides the existing drawing layout engine with zero new layout code. Scope is vector graphics only, and every limit is named through onSvgDiagnostic rather than silently dropped: text, images, use references, gradients, filters, CSS styling, and opacity are all out of scope (see src/svg/diagnostics.ts for the full vocabulary).
//
// COORDINATE CONVENTIONS: SVG user space is y-down/top-left-origin, which is exactly the convention ContentVector's own frames carry in the drawing variant's page model (src/layout/drawing.ts flips into PDF's bottom-left origin at the layout boundary, not here). Every parsed coordinate therefore stays in y-down page-point space end to end: user units flow through rootMap (the viewBox -> viewport scale) composed with each ancestor group's transform, and the resulting page-point values become the vector's frame / from / to directly. A length carrying an absolute unit (mm, pt, ...) on a geometry attribute resolves to user units against CSS px (1 user unit = 1px = 0.75pt exactly), matching SVG's own rule that absolute lengths convert into the initial user coordinate system before any viewBox scale applies.
//
// ROTATED RECT/ELLIPSE FRAMES: for a similarity CTM (uniform scale + rotation) the emitted frame is the SCALED PRE-ROTATION box centred on the transformed centre, with rotationDeg alongside -- the exact contract src/layout/drawing.ts implements, where a rotated vector renders by rotating the frame's own corners/curve points about the frame's own centre. A tight bbox of the rotated corners would instead be the wrong frame: the renderer would inscribe a shape in it and rotate that again, growing the shape.

// Named ReadSvgContentOptions rather than SvgReadOptions because convert.ts declares its own SvgReadOptions as the ergonomic intersection type the named svg-sourced conversions expose -- the identical split csv holds between ReadCsvContentOptions and CsvReadOptions, so the two layers never collide on this package's export surface.
export interface ReadSvgContentOptions {
  readonly onSvgDiagnostic?: SvgDiagnosticSink;
}

// A recognised svg byte stream whose root element is not <svg> -- a named class matching this package's convention for every other "recognised but unsupported" input, so a caller can branch on it with instanceof rather than string-matching a thrown Error's own message.
export class SvgMissingRootElementError extends Error {
  constructor() {
    super("svg text must contain an <svg> root element");
    this.name = "SvgMissingRootElementError";
  }
}

// The CSS default replaced-element size every browser assumes for an <svg> with no intrinsic size (CSS sizing level 3's default object size): 300x150 px, i.e. 225x112.5 pt at the exact 0.75 pt/px ratio. Assumed only when the root carries neither usable width/height nor a usable viewBox, and named through the svg/default-size-assumed diagnostic when it is.
const DEFAULT_WIDTH_PT = 300 * 0.75;
const DEFAULT_HEIGHT_PT = 150 * 0.75;

// The circle-to-cubic control-point ratio shared with src/layout/drawing.ts's own CIRCLE_CUBIC_RATIO: 4/3 * (sqrt(2) - 1), derived by forcing a cubic through a quarter arc's own 45-degree midpoint.
const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

// Namespace-agnostic by design: real-world SVG files mix prefixed and unprefixed names (svg:rect and rect), and the namespaces that matter here (SVG, xlink, dc metadata) carry no same-local-name collisions a walk keyed on local names could confuse.
function localName(tag: string): string {
  const colon = tag.indexOf(":");
  return colon === -1 ? tag : tag.slice(colon + 1);
}

function findAttribute(element: XmlElement, name: string): string | undefined {
  for (const attribute of element.attributes) {
    if (localName(attribute.name) === name) {
      return decodeEntities(attribute.value);
    }
  }
  return undefined;
}

function elementChildren(node: XmlNode): XmlElement[] {
  return node.type === "element"
    ? node.children.filter(
        (child): child is XmlElement => child.type === "element",
      )
    : [];
}

function textOf(element: XmlElement): string {
  let text = "";
  for (const child of element.children) {
    if (child.type === "text" || child.type === "cdata") {
      text += decodeEntities(child.value);
    }
  }
  return text;
}

// The inherited presentation-attribute state, walked as raw strings and resolved only at the shape that uses them -- so a diagnostic about an unresolvable value fires per painted element, not per declaration, and a value on a group that paints nothing directly diagnoses nothing.
interface PaintState {
  readonly fillSpec?: string;
  readonly strokeSpec?: string;
  readonly strokeWidthSpec?: string;
  readonly fillRuleSpec?: string;
  readonly dashSpec?: string;
}

function childPaintState(element: XmlElement, parent: PaintState): PaintState {
  return {
    fillSpec: findAttribute(element, "fill") ?? parent.fillSpec,
    strokeSpec: findAttribute(element, "stroke") ?? parent.strokeSpec,
    strokeWidthSpec:
      findAttribute(element, "stroke-width") ?? parent.strokeWidthSpec,
    fillRuleSpec: findAttribute(element, "fill-rule") ?? parent.fillRuleSpec,
    dashSpec: findAttribute(element, "stroke-dasharray") ?? parent.dashSpec,
  };
}

interface ReaderState {
  readonly sink?: SvgDiagnosticSink;
  vectors: ContentVector[];
  paintOrder: number;
}

function report(
  state: ReaderState,
  code: SvgDiagnosticCode,
  detail?: string,
): void {
  state.sink?.(detail === undefined ? { code } : { code, detail });
}

// One paint property resolved to the schema's vocabulary, with every degradation named. Defaults follow SVG's own: an absent fill paints black, an absent stroke paints nothing. 'none' unpaints; url(#...) is reported as the gradient limit and unpaints (rendering a guessed solid colour would misrepresent the document worse than leaving it unpainted); currentColor renders black -- the CSS 'color' property's own initial value -- under a paint-unsupported diagnostic; an unparseable value falls back to the property's own default under the same diagnostic rather than poisoning geometry with a half-parse.
function resolveFillPaint(
  state: ReaderState,
  spec: string | undefined,
  isFill: boolean,
): Color | undefined {
  if (spec === undefined) {
    return isFill ? { r: 0, g: 0, b: 0 } : undefined;
  }
  const paint = parseSvgPaint(spec);
  if (paint === undefined) {
    report(state, "svg/paint-unsupported", spec);
    return isFill ? { r: 0, g: 0, b: 0 } : undefined;
  }
  if (paint.kind === "none") {
    return undefined;
  }
  if (paint.kind === "url") {
    report(state, "svg/gradient-unsupported", `#${paint.fragment}`);
    return undefined;
  }
  if (paint.kind === "currentColor") {
    report(
      state,
      "svg/paint-unsupported",
      "currentColor renders as black: the CSS color property is out of scope",
    );
    return { r: 0, g: 0, b: 0 };
  }
  return paint.color;
}

// Stroke width resolves through the shared user-unit length parser (default 1, the attribute's own default), then scales by the CTM's mean column scale. A stroke whose scaled width is not positive is dropped rather than clamped -- ContentStrokeSchema demands widthPt > 0, and a zero-width stroke paints nothing in a conforming renderer either.
function resolveStroke(
  state: ReaderState,
  paint: PaintState,
  ctm: AffineMatrix,
): ContentStroke | undefined {
  const color = resolveFillPaint(state, paint.strokeSpec, false);
  if (color === undefined) {
    return undefined;
  }
  const userUnits = parseSvgUserUnits(paint.strokeWidthSpec) ?? 1;
  const widthPt = userUnits * meanScaleFactor(ctm);
  if (!(widthPt > 0)) {
    return undefined;
  }
  const style = parseSvgDashStyle(paint.dashSpec);
  return style === undefined ? { color, widthPt } : { color, widthPt, style };
}

function resolvePaint(
  state: ReaderState,
  paint: PaintState,
  ctm: AffineMatrix,
): { readonly fill?: Color; readonly stroke?: ContentStroke } {
  return {
    fill: resolveFillPaint(state, paint.fillSpec, true),
    stroke: resolveStroke(state, paint, ctm),
  };
}

function boxOfPoints(
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
function axisAlignedFrame(
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

// The frame a non-reflecting similarity CTM gives a box, per the module note's pre-rotation contract: the uniformly scaled box, positioned so its centre sits on the transformed centre -- the renderer then rotates the frame's own points about that centre by rotationDeg and lands exactly on the transformed corners.
function similarityFrame(
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

// The path pipeline every curve-carrying construction funnels into: transform each point of the already-parsed local-space subpaths through the CTM (an affine maps a cubic's controls exactly, so nothing is approximated here), take the tight bounding box of ALL points including cubic controls (the identical hull convention src/layout/drawing.ts's own vectorItemBounds documents -- a cubic lies within the convex hull of its controls, so the frame contains the rendered curve), and rebase the points into the frame's own local space, which is the ContentVector path variant's own subpaths contract.
function buildPathVector(
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
function roundedRectSubpaths(
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

// An ellipse as its four kappa quarter-arc cubics, walked clockwise from the rightmost axis point in y-down space -- the mirror image of src/layout/drawing.ts's own ellipseCubicPoints walk (counter-clockwise in PDF's y-up space; both trace the same curve).
function ellipseSubpaths(
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

// The element's geometry attributes in user units; SVG's own default for every one of them is 0 (x/y/cx/cy/x1..y2/rx/ry), so a missing attribute reads as the origin/default rather than a diagnostic.
function userUnits(element: XmlElement, attr: string): number {
  return parseSvgUserUnits(findAttribute(element, attr)) ?? 0;
}

function readShape(
  state: ReaderState,
  element: XmlElement,
  ctm: AffineMatrix,
  paint: PaintState,
): void {
  const name = localName(element.tag);
  const id = findAttribute(element, "id");
  const detail = id === undefined ? name : `${name}#${id}`;

  let fillRule: "evenodd" | undefined;
  const fillRuleSpec = paint.fillRuleSpec;
  if (fillRuleSpec !== undefined && fillRuleSpec !== "nonzero") {
    if (fillRuleSpec === "evenodd") {
      fillRule = "evenodd";
    } else {
      report(state, "svg/paint-unsupported", fillRuleSpec);
    }
  }

  const resolved = resolvePaint(state, paint, ctm);
  if (resolved.fill === undefined && resolved.stroke === undefined) {
    report(
      state,
      "svg/element-skipped",
      `${detail}: nothing painted (fill and stroke both absent or none)`,
    );
    return;
  }

  if (name === "rect") {
    const x = userUnits(element, "x");
    const y = userUnits(element, "y");
    const width = userUnits(element, "width");
    const height = userUnits(element, "height");
    if (width <= 0 || height <= 0) {
      report(state, "svg/element-skipped", `${detail}: zero or negative size`);
      return;
    }
    // Each corner radius defaults to the other when only one is present -- the attribute's own rule.
    const rxAttr = parseSvgUserUnits(findAttribute(element, "rx"));
    const ryAttr = parseSvgUserUnits(findAttribute(element, "ry"));
    const rx = rxAttr ?? ryAttr ?? 0;
    const ry = ryAttr ?? rxAttr ?? 0;
    if (rx > 0 || ry > 0) {
      // The schema's rect variant has no corner-radius field, so rounded corners are exactly representable only as a path -- constructed the same way the renderer itself draws them.
      const vector = buildPathVector(
        state,
        roundedRectSubpaths(x, y, width, height, rx, ry),
        ctm,
        resolved,
        fillRule,
      );
      if (vector !== undefined) {
        state.vectors.push(vector);
      }
      return;
    }
    const rotated = !isAxisAligned(ctm) && isNonReflectingSimilarity(ctm);
    const frame = rotated
      ? similarityFrame(ctm, x, y, width, height)
      : axisAlignedFrame(ctm, x, y, width, height);
    if (frame.widthPt <= 0 || frame.heightPt <= 0) {
      report(
        state,
        "svg/element-skipped",
        `${detail}: collapses to zero size under transform`,
      );
      return;
    }
    state.vectors.push({
      kind: "rect",
      frame,
      ...(rotated ? { rotationDeg: similarityRotationDeg(ctm) } : {}),
      ...(resolved.fill !== undefined ? { fill: resolved.fill } : {}),
      ...(resolved.stroke !== undefined ? { stroke: resolved.stroke } : {}),
      paintOrder: state.paintOrder++,
      sourcePath: `svg/vector[${state.vectors.length}]`,
    });
    return;
  }

  if (name === "circle" || name === "ellipse") {
    const cx = userUnits(element, "cx");
    const cy = userUnits(element, "cy");
    const rx =
      name === "circle" ? userUnits(element, "r") : userUnits(element, "rx");
    const ry =
      name === "circle" ? userUnits(element, "r") : userUnits(element, "ry");
    if (rx <= 0 || ry <= 0) {
      report(
        state,
        "svg/element-skipped",
        `${detail}: zero or negative radius`,
      );
      return;
    }
    if (!isAxisAligned(ctm) && !isNonReflectingSimilarity(ctm)) {
      // A shear or non-uniform-scale-plus-rotation matrix maps a circle to a genuinely skewed conic; only the path variant can express it, and the kappa cubics deform exactly the way the true ellipse does under the same affine.
      const vector = buildPathVector(
        state,
        ellipseSubpaths(cx, cy, rx, ry),
        ctm,
        resolved,
        fillRule,
      );
      if (vector !== undefined) {
        state.vectors.push(vector);
      }
      return;
    }
    const rotated = !isAxisAligned(ctm);
    const frame = rotated
      ? similarityFrame(ctm, cx - rx, cy - ry, rx * 2, ry * 2)
      : axisAlignedFrame(ctm, cx - rx, cy - ry, rx * 2, ry * 2);
    if (frame.widthPt <= 0 || frame.heightPt <= 0) {
      report(
        state,
        "svg/element-skipped",
        `${detail}: collapses to zero size under transform`,
      );
      return;
    }
    state.vectors.push({
      kind: "ellipse",
      frame,
      ...(rotated ? { rotationDeg: similarityRotationDeg(ctm) } : {}),
      ...(resolved.fill !== undefined ? { fill: resolved.fill } : {}),
      ...(resolved.stroke !== undefined ? { stroke: resolved.stroke } : {}),
      paintOrder: state.paintOrder++,
      sourcePath: `svg/vector[${state.vectors.length}]`,
    });
    return;
  }

  if (name === "line") {
    if (resolved.stroke === undefined) {
      report(
        state,
        "svg/element-skipped",
        `${detail}: a line paints only through its stroke, which is absent or none`,
      );
      return;
    }
    const from = applyMatrix(
      ctm,
      userUnits(element, "x1"),
      userUnits(element, "y1"),
    );
    const to = applyMatrix(
      ctm,
      userUnits(element, "x2"),
      userUnits(element, "y2"),
    );
    if (from.x === to.x && from.y === to.y) {
      report(state, "svg/element-skipped", `${detail}: zero-length line`);
      return;
    }
    state.vectors.push({
      kind: "line",
      from: { xPt: from.x, yPt: from.y },
      to: { xPt: to.x, yPt: to.y },
      stroke: resolved.stroke,
      paintOrder: state.paintOrder++,
      sourcePath: `svg/vector[${state.vectors.length}]`,
    });
    return;
  }

  if (name === "polyline" || name === "polygon") {
    const pointsRaw = findAttribute(element, "points");
    if (pointsRaw === undefined) {
      report(state, "svg/element-skipped", `${detail}: no points attribute`);
      return;
    }
    const numbers = pointsRaw
      .trim()
      .split(/[\s,]+/)
      .filter((part) => part !== "")
      .map(Number);
    if (
      numbers.length === 0 ||
      numbers.length % 2 !== 0 ||
      !numbers.every((value) => Number.isFinite(value))
    ) {
      report(
        state,
        "svg/element-unsupported",
        `${detail}: malformed points attribute`,
      );
      return;
    }
    if (numbers.length < 4) {
      report(state, "svg/element-skipped", `${detail}: fewer than two points`);
      return;
    }
    const segments: ParsedPathSegment[] = [];
    for (let i = 2; i < numbers.length; i += 2) {
      segments.push({
        kind: "line",
        to: { x: numbers[i]!, y: numbers[i + 1]! },
      });
    }
    const vector = buildPathVector(
      state,
      [
        {
          start: { x: numbers[0]!, y: numbers[1]! },
          closed: name === "polygon",
          segments,
        },
      ],
      ctm,
      resolved,
      fillRule,
    );
    if (vector === undefined) {
      report(state, "svg/element-skipped", `${detail}: all points coincide`);
    } else {
      state.vectors.push(vector);
    }
    return;
  }

  if (name === "path") {
    const d = findAttribute(element, "d");
    if (d === undefined || d.trim() === "") {
      report(state, "svg/element-skipped", `${detail}: no d attribute`);
      return;
    }
    const parsed = parseSvgPathData(d);
    if (parsed === undefined || parsed.length === 0) {
      report(
        state,
        "svg/element-unsupported",
        `${detail}: malformed or empty path data`,
      );
      return;
    }
    const vector = buildPathVector(state, parsed, ctm, resolved, fillRule);
    if (vector === undefined) {
      report(
        state,
        "svg/element-skipped",
        `${detail}: path collapses to a single point`,
      );
    } else {
      state.vectors.push(vector);
    }
    return;
  }
}

// Elements that never render directly -- definitions, references, and non-visual metadata -- walked past silently rather than diagnosed: they are supposed to produce nothing on the canvas, and a <defs> full of gradients is not a fidelity loss until something actually references one (which the url(#...) resolution then reports).
const NON_RENDERING_ELEMENTS = new Set([
  "defs",
  "title",
  "desc",
  "metadata",
  "linearGradient",
  "radialGradient",
  "pattern",
  "clipPath",
  "mask",
  "marker",
  "symbol",
  "script",
]);

function walkElement(
  state: ReaderState,
  element: XmlElement,
  ctm: AffineMatrix,
  paint: PaintState,
): void {
  const name = localName(element.tag);
  const id = findAttribute(element, "id");
  const detail = id === undefined ? name : `${name}#${id}`;

  if (findAttribute(element, "style") !== undefined) {
    report(state, "svg/css-style-ignored", detail);
  }
  for (const opacityAttr of ["opacity", "fill-opacity", "stroke-opacity"]) {
    const raw = findAttribute(element, opacityAttr);
    if (raw !== undefined) {
      const value = Number(raw);
      if (Number.isFinite(value) && value < 1) {
        report(
          state,
          "svg/opacity-ignored",
          `${detail}: ${opacityAttr}=${raw}`,
        );
      }
    }
  }

  if (name === "g" || name === "a") {
    const own = parseSvgTransform(findAttribute(element, "transform"));
    walkChildren(
      state,
      element,
      own === undefined ? ctm : composeMatrices(ctm, own),
      childPaintState(element, paint),
    );
    return;
  }
  if (NON_RENDERING_ELEMENTS.has(name)) {
    return;
  }
  if (name === "style") {
    report(state, "svg/css-style-ignored", detail);
    return;
  }
  if (
    name === "text" ||
    name === "tspan" ||
    name === "textPath" ||
    name === "tref"
  ) {
    report(state, "svg/text-unsupported", detail);
    return;
  }
  if (name === "image") {
    report(state, "svg/image-unsupported", detail);
    return;
  }
  if (name === "use") {
    report(state, "svg/use-unsupported", detail);
    return;
  }
  if (
    name === "rect" ||
    name === "circle" ||
    name === "ellipse" ||
    name === "line" ||
    name === "polyline" ||
    name === "polygon" ||
    name === "path"
  ) {
    // A shape element's own transform attribute composes after the ancestors' -- SVG applies transform to every element, not just groups, and the write side relies on this directly (rotationDeg is emitted as a transform on the shape element itself, so honouring it here is what makes a rotated rect survive its own round trip). The element's own presentation attributes merge over the inherited paint state the same way a group's do -- fill=/stroke= directly on a shape is the most common authoring pattern there is.
    const own = parseSvgTransform(findAttribute(element, "transform"));
    readShape(
      state,
      element,
      own === undefined ? ctm : composeMatrices(ctm, own),
      childPaintState(element, paint),
    );
    return;
  }
  report(state, "svg/element-unsupported", detail);
}

function walkChildren(
  state: ReaderState,
  element: XmlElement,
  ctm: AffineMatrix,
  paint: PaintState,
): void {
  for (const child of elementChildren(element)) {
    walkElement(state, child, ctm, paint);
  }
}

// The root viewport's geometry: page size (pt), the root affine every user-space coordinate flows through, and the root-level diagnostics the fallbacks owe. Width/height resolve as CSS lengths directly into pt; a viewBox present alongside scales user units onto that page, absent the initial 1 user unit = 1px = 0.75pt mapping holds. Only one dimension present discards both (CSS 2.1's intrinsic-sizing rule for the missing dimension has no page-model equivalent); a degenerate viewBox (zero width or height) is ignored entirely, as no scale it could define is meaningful.
function resolveRootGeometry(
  root: XmlElement,
  state: ReaderState,
): {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly map: AffineMatrix;
} {
  const attrWidth = parseSvgLengthPt(findAttribute(root, "width"));
  const attrHeight = parseSvgLengthPt(findAttribute(root, "height"));
  const parsedViewBox = parseSvgViewBox(findAttribute(root, "viewBox"));
  const viewBox: SvgViewBox | undefined =
    parsedViewBox !== undefined &&
    parsedViewBox.width > 0 &&
    parsedViewBox.height > 0
      ? parsedViewBox
      : undefined;

  let widthPt =
    attrWidth !== undefined && attrWidth > 0 ? attrWidth : undefined;
  let heightPt =
    attrHeight !== undefined && attrHeight > 0 ? attrHeight : undefined;
  if ((widthPt === undefined) !== (heightPt === undefined)) {
    widthPt = undefined;
    heightPt = undefined;
  }
  if (widthPt === undefined || heightPt === undefined) {
    if (viewBox !== undefined) {
      widthPt = viewBox.width;
      heightPt = viewBox.height;
    } else {
      widthPt = DEFAULT_WIDTH_PT;
      heightPt = DEFAULT_HEIGHT_PT;
      report(
        state,
        "svg/default-size-assumed",
        "neither width/height nor a usable viewBox was present; assuming the CSS default replaced-element size of 300x150 px",
      );
    }
  }

  if (viewBox === undefined) {
    return {
      widthPt,
      heightPt,
      map: { a: 0.75, b: 0, c: 0, d: 0.75, e: 0, f: 0 },
    };
  }
  const preserveAspectRatio =
    findAttribute(root, "preserveAspectRatio") ?? "xMidYMid meet";
  if (preserveAspectRatio.trim() !== "none") {
    const viewBoxAspect = viewBox.width / viewBox.height;
    const pageAspect = widthPt / heightPt;
    if (
      Math.abs(viewBoxAspect - pageAspect) >
      1e-6 * Math.max(viewBoxAspect, pageAspect)
    ) {
      report(
        state,
        "svg/preserve-aspect-ratio-stretched",
        `viewBox aspect ${viewBoxAspect.toFixed(4)} stretched onto page aspect ${pageAspect.toFixed(4)} under preserveAspectRatio="${preserveAspectRatio.trim()}" (letterboxing is out of scope)`,
      );
    }
  }
  const sx = widthPt / viewBox.width;
  const sy = heightPt / viewBox.height;
  return {
    widthPt,
    heightPt,
    map: {
      a: sx,
      b: 0,
      c: 0,
      d: sy,
      e: -viewBox.minX * sx,
      f: -viewBox.minY * sy,
    },
  };
}

export function readSvgContent(
  text: string,
  options?: ReadSvgContentOptions,
): ContentDocument {
  const nodes = parseXml(text);
  const root = nodes.find(
    (node): node is XmlElement =>
      node.type === "element" && localName(node.tag) === "svg",
  );
  if (root === undefined) {
    throw new SvgMissingRootElementError();
  }

  const state: ReaderState = {
    sink: options?.onSvgDiagnostic,
    vectors: [],
    paintOrder: 0,
  };
  const rootGeometry = resolveRootGeometry(root, state);

  // The root element's own <title> child is SVG's one genuinely representable metadata field -- it becomes the document's metadata.title, entity-decoded because odf.js's parseXml deliberately keeps the original encoding.
  const titleElement = elementChildren(root).find(
    (child) => localName(child.tag) === "title",
  );
  const title =
    titleElement === undefined ? undefined : textOf(titleElement).trim();
  const metadata = title === undefined || title === "" ? {} : { title };

  walkChildren(state, root, rootGeometry.map, childPaintState(root, {}));

  const page: ContentDrawPage = {
    size: { widthPt: rootGeometry.widthPt, heightPt: rootGeometry.heightPt },
    shapes: [],
    vectors: state.vectors,
  };
  return { kind: "drawing", metadata, pages: [page] };
}
