// The vector-primitive geometry readers, split from shapes.ts: one draw:rect/draw:ellipse/draw:line/draw:path/polygon/preset custom-shape element into the ContentVector shapes.ts's walkDrawPageContent collects. Fill and stroke come from fill-and-stroke.ts; frame geometry and style resolution reuse shapes.ts's own readers, so this module imports back from it (the cycle is safe: every use sits inside a hoisted function declaration).
//
import type {
  Box,
  ContentPathPoint,
  ContentShape,
  ContentSubpath,
  ContentVector,
} from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { attrValue, childrenWithTag, elementsWithTag } from "../../xml/query";
import { parseLinePoints } from "../shared/geometry";
import { odfResidue } from "../shared/constructs";
import { readOdfParagraph } from "../shared/paragraph";
import {
  buildOdfSubpaths,
  parseOdfPathData,
  parseOdfPointsList,
  parseOdfViewBox,
  rawSubpathFromPoints,
  type OdfViewBox,
} from "../shared/path";
import type {
  OdfShapeGeometry,
  OdfTransformFunction,
} from "../shared/transform";
import {
  applyOdfTransform,
  composeOdfGroupTransform,
  resolveOdfShapeGeometry,
} from "../shared/transform";
// Frame insets and the draw:name read live in shapes.ts; importing back from it is safe because every use sits inside a hoisted function declaration.
import { readDrawName, readFrameInsets } from "./shapes";
import { readOdfFillAndStroke } from "./fill-and-stroke";

// Resolves a vector primitive's own geometry — frame (svg:x/y/width/height) AND rotationDeg (draw:transform's rotate()+translate()) — reusing the EXACT SAME transform machinery (resolveOdfShapeGeometry, composeOdfGroupTransform) readDrawFrame above already uses for a draw:frame, composed with any enclosing draw:g's own transform. Nothing about ContentVectorSchema's own rect/ellipse/path variants makes this a smaller problem than the ContentShape case: each already carries a rotationDeg field of its own, so there is no separate rotation-resolution logic to write — this is a direct extension of what already resolves rotation correctly, not a reimplementation.
function resolveVectorGeometry(
  element: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
): OdfShapeGeometry | undefined {
  const geometry = resolveOdfShapeGeometry(element);
  if (geometry === undefined) {
    return undefined;
  }
  return composeOdfGroupTransform(groupFunctions, geometry);
}

export function readDrawRectVector(
  element: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
): ContentVector | undefined {
  const geometry = resolveVectorGeometry(element, groupFunctions);
  if (geometry === undefined) {
    return undefined;
  }
  const { fill, fillPattern, fillOpacity, stroke } = readOdfFillAndStroke(
    element,
    pkg,
  );
  return {
    kind: "rect",
    frame: geometry.frame,
    rotationDeg: geometry.rotationDeg,
    fill,
    ...(fillPattern === undefined ? {} : { fillPattern }),
    ...(fillOpacity === undefined ? {} : { fillOpacity }),
    stroke,
  };
}

// draw:ellipse and draw:circle share an identical attribute shape (svg:x/y/width/height) — confirmed against real LibreOffice output: an ellipse whose width and height happen to be EQUAL is written as draw:circle instead of draw:ellipse (a real, distinct ODF element the OASIS schema defines specifically for this case), with no attribute-shape difference otherwise. Both map to ContentVectorSchema's single 'ellipse' variant.
export function readDrawEllipseVector(
  element: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
): ContentVector | undefined {
  const geometry = resolveVectorGeometry(element, groupFunctions);
  if (geometry === undefined) {
    return undefined;
  }
  const { fill, fillPattern, fillOpacity, stroke } = readOdfFillAndStroke(
    element,
    pkg,
  );
  return {
    kind: "ellipse",
    frame: geometry.frame,
    rotationDeg: geometry.rotationDeg,
    fill,
    ...(fillPattern === undefined ? {} : { fillPattern }),
    ...(fillOpacity === undefined ? {} : { fillOpacity }),
    stroke,
  };
}

// draw:line carries no svg:x/y/width/height box at all — see geometry.ts's own parseLinePoints note. Its two endpoints are transformed through any enclosing draw:g's own function list directly (no center-pivot geometry needed the way a box has: applyOdfTransform maps each raw point through rotate()/translate() on its own, which is exactly right for a two-point line with no orientation ambiguity). ContentVectorSchema's 'line' variant requires a stroke (an invisible line has nothing to paint) — this reader returns undefined rather than fabricating a default stroke when the source line genuinely has none.
export function readDrawLineVector(
  element: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
): ContentVector | undefined {
  const raw = parseLinePoints(element);
  if (raw === undefined) {
    return undefined;
  }
  const from =
    groupFunctions.length === 0
      ? raw.from
      : applyOdfTransform(groupFunctions, raw.from);
  const to =
    groupFunctions.length === 0
      ? raw.to
      : applyOdfTransform(groupFunctions, raw.to);
  const { stroke } = readOdfFillAndStroke(element, pkg);
  if (stroke === undefined) {
    return undefined;
  }
  return { kind: "line", from, to, stroke };
}

// draw:path (svg:d, a real curve) and draw:polygon/draw:polyline (draw:points, straight lines only) are deliberately handled together: both express their raw geometry in the SAME svg:viewBox-scaled local coordinate system, and both produce ContentVectorSchema's single 'path' variant (which has no separate "polygon"/"polyline" kind) — see typed/shared/path.ts's own top-of-file note for the verified grammar difference between the two attributes themselves. Without a resolvable svg:viewBox there is no way to scale either grammar's raw numbers into the frame's own point space, so a missing/malformed viewBox is "no resolvable geometry" (undefined), exactly like a missing box elsewhere in this module.
export function readDrawPathVector(
  element: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
): ContentVector | undefined {
  const geometry = resolveVectorGeometry(element, groupFunctions);
  if (geometry === undefined) {
    return undefined;
  }
  const frame = geometry.frame;
  const viewBoxValue = attrValue(element, "svg:viewBox");
  const viewBox =
    viewBoxValue === undefined ? undefined : parseOdfViewBox(viewBoxValue);
  if (viewBox === undefined) {
    return undefined;
  }

  let rawSubpaths;
  if (element.tag === "draw:path") {
    const d = attrValue(element, "svg:d");
    rawSubpaths = d === undefined ? [] : parseOdfPathData(d);
  } else {
    const pointsValue = attrValue(element, "draw:points");
    const points =
      pointsValue === undefined ? [] : parseOdfPointsList(pointsValue);
    const subpath = rawSubpathFromPoints(
      points,
      element.tag === "draw:polygon",
    );
    rawSubpaths = subpath === undefined ? [] : [subpath];
  }
  if (rawSubpaths.length === 0) {
    return undefined;
  }

  const subpaths = buildOdfSubpaths(rawSubpaths, viewBox, frame);
  const { fill, fillPattern, fillOpacity, fillRule, stroke } =
    readOdfFillAndStroke(element, pkg);
  return {
    kind: "path",
    frame,
    rotationDeg: geometry.rotationDeg,
    subpaths,
    fill,
    ...(fillPattern === undefined ? {} : { fillPattern }),
    ...(fillOpacity === undefined ? {} : { fillOpacity }),
    fillRule,
    stroke,
  };
}

// A small, deliberately narrow subset of draw:custom-shape presets, identified by draw:enhanced-geometry's own draw:type attribute — verified against real LibreOffice 26.2 output for 'rectangle'/'round-rectangle'/'ellipse' (the same macro-built fixtures as typed/shared/path.ts's own top-of-file note; LibreOffice's "Basic Shapes" gallery rectangle/rounded rectangle/ellipse each round-trip with exactly these draw:type values) and against LibreOffice's own EnhancedCustomShapeTypeNames.cxx preset-name table (github.com/LibreOffice/core/blob/master/svx/source/customshapes/EnhancedCustomShapeTypeNames.cxx) for the remaining six, since the OASIS schema itself says draw:type is "rendering-engine dependent" and "shall not influence the geometry of the shape" (OASIS ODF 1.3 section 19.229.3/18.2 — draw:type's own defined values are exactly "non-primitive" or "a value of type string" with no fixed geometry-name enumeration at all); real geometry always lives in the shape's own draw:enhanced-path, which this reader still does not evaluate (see below).
//
// Their OWN draw:enhanced-path (a "M ?f7 0 X 0 ?f8 L ..." formula-driven mini-language with ?fN/$N expression references and ODF-specific commands like X/Y/U that are NOT part of plain SVG at all) is deliberately never parsed — evaluating draw:enhanced-geometry's formula language in full generality stays out of scope for this reader (a v1.5+ gap, tracked, not attempted here). Instead, each recognised preset maps to the CLOSEST ContentVector approximation this reader can build without that evaluator:
// - 'rectangle' -> the plain rect variant; 'ellipse' -> the plain ellipse variant.
// - 'round-rectangle' (ExaDev/documents.js#954's own named example) -> a REAL rounded-corner path when a corner radius can be derived from the shape's own draw:handle/draw:modifiers (readRoundRectangleRadiusPt below — the one genuinely resolvable number this reader reads out of enhanced-geometry without a general formula evaluator, since a handle's position/range is a small, fixed micro-grammar, not the open-ended path formula language); when no handle/modifier is present to derive one from, this still falls back to the plain rect variant exactly as before — there is no ODF-declared default radius to fabricate one from (see readRoundRectangleRadiusPt's own note).
// - 'diamond'/'isosceles-triangle'/'right-triangle'/'pentagon'/'hexagon'/'octagon' -> a fixed polygon inscribed in the shape's own frame (fixedPresetSubpath below) — these six have no adjustment handle in LibreOffice's own unadjusted gallery defaults, so a frame-derived idealised polygon is a stable, well-defined approximation of "a diamond"/"a hexagon"/etc, not a guess at any one producer's own stored coordinates. 'parallelogram' and 'trapezoid' are NOT included here: LibreOffice's own defaults for both DO carry an adjustable slant via exactly the same kind of handle round-rectangle uses, and approximating them without reading that handle would produce a wrong shape (a fixed default slant this reader invented) rather than a documented bound on a right one — left unresolved, deliberately, alongside the general enhanced-path formula language, rather than guessed.
const PENTAGON_SIDES = 5;
const HEXAGON_SIDES = 6;
const OCTAGON_SIDES = 8;
const REGULAR_POLYGON_SIDES: ReadonlyMap<string, number> = new Map([
  ["pentagon", PENTAGON_SIDES],
  ["hexagon", HEXAGON_SIDES],
  ["octagon", OCTAGON_SIDES],
]);
const FIXED_POLYGON_PRESETS: ReadonlySet<string> = new Set([
  "diamond",
  "isosceles-triangle",
  "right-triangle",
  ...REGULAR_POLYGON_SIDES.keys(),
]);
const RECOGNIZED_CUSTOM_SHAPE_PRESETS: ReadonlySet<string> = new Set([
  "rectangle",
  "round-rectangle",
  "ellipse",
  ...FIXED_POLYGON_PRESETS,
]);

function polygonSubpath(
  points: readonly ContentPathPoint[],
): ContentSubpath | undefined {
  const [start, ...rest] = points;
  if (start === undefined) {
    return undefined;
  }
  return {
    start,
    closed: true,
    segments: rest.map((to) => ({ kind: "line" as const, to })),
  };
}

// A regular N-gon inscribed in the shape's own frame, point-up, independently stretched on each axis to fill a non-square frame — the same box-fit convention every other approximated preset in this file already uses (round-rectangle, the fixed triangle/diamond presets alongside this one). A closest reasonable approximation for an unadjusted preset of this name, not a literal read of the file's own stored draw:enhanced-path geometry (see this section's own top-of-file note).
function regularPolygonSubpath(
  sides: number,
  frame: Readonly<Box>,
): ContentSubpath | undefined {
  const cx = frame.widthPt / 2;
  const cy = frame.heightPt / 2;
  const points: ContentPathPoint[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / sides;
    points.push({
      xPt: cx + cx * Math.cos(angle),
      yPt: cy + cy * Math.sin(angle),
    });
  }
  return polygonSubpath(points);
}

// The fixed-geometry preset subpaths — see this section's own top-of-file note for why these six specifically, and why 'parallelogram'/'trapezoid' are deliberately excluded from this table.
function fixedPresetSubpath(
  type: string,
  frame: Readonly<Box>,
): ContentSubpath | undefined {
  const w = frame.widthPt;
  const h = frame.heightPt;
  switch (type) {
    case "diamond":
      return polygonSubpath([
        { xPt: w / 2, yPt: 0 },
        { xPt: w, yPt: h / 2 },
        { xPt: w / 2, yPt: h },
        { xPt: 0, yPt: h / 2 },
      ]);
    case "isosceles-triangle":
      return polygonSubpath([
        { xPt: w / 2, yPt: 0 },
        { xPt: w, yPt: h },
        { xPt: 0, yPt: h },
      ]);
    case "right-triangle":
      return polygonSubpath([
        { xPt: 0, yPt: 0 },
        { xPt: 0, yPt: h },
        { xPt: w, yPt: h },
      ]);
    default: {
      const sides = REGULAR_POLYGON_SIDES.get(type);
      return sides === undefined
        ? undefined
        : regularPolygonSubpath(sides, frame);
    }
  }
}

// The standard cubic-Bezier approximation constant for a quarter circle (4/3 * (sqrt(2) - 1) = 0.55228474983...) — a universal mathematical constant independent of ODF, used below to build a rounded rectangle's four corner arcs.
const BEZIER_QUARTER_CIRCLE_KAPPA = 0.5522847498307936;

function roundedRectSubpath(
  frame: Readonly<Box>,
  radiusPt: number,
): ContentSubpath {
  const w = frame.widthPt;
  const h = frame.heightPt;

  const k = radiusPt * BEZIER_QUARTER_CIRCLE_KAPPA;
  return {
    start: { xPt: radiusPt, yPt: 0 },
    closed: true,
    segments: [
      { kind: "line", to: { xPt: w - radiusPt, yPt: 0 } },
      {
        kind: "cubic",
        control1: { xPt: w - radiusPt + k, yPt: 0 },
        control2: { xPt: w, yPt: radiusPt - k },
        to: { xPt: w, yPt: radiusPt },
      },
      { kind: "line", to: { xPt: w, yPt: h - radiusPt } },
      {
        kind: "cubic",
        control1: { xPt: w, yPt: h - radiusPt + k },
        control2: { xPt: w - radiusPt + k, yPt: h },
        to: { xPt: w - radiusPt, yPt: h },
      },
      { kind: "line", to: { xPt: radiusPt, yPt: h } },
      {
        kind: "cubic",
        control1: { xPt: radiusPt - k, yPt: h },
        control2: { xPt: 0, yPt: h - radiusPt + k },
        to: { xPt: 0, yPt: h - radiusPt },
      },
      { kind: "line", to: { xPt: 0, yPt: radiusPt } },
      {
        kind: "cubic",
        control1: { xPt: 0, yPt: radiusPt - k },
        control2: { xPt: radiusPt - k, yPt: 0 },
        to: { xPt: radiusPt, yPt: 0 },
      },
    ],
  };
}

// draw:handle-position/-range-x-minimum/-range-x-maximum's own shared micro-grammar (OASIS ODF 1.3 section 19.179/19.183): each value is a bare number OR "$N" indexing the shape's own draw:modifiers list (section 19.196) at position N. A THIRD form, "?formula-name" (referencing a <draw:equation>), is exactly the open-ended draw:enhanced-path formula language this file's own top-of-file note already puts out of scope — a handle whose position/range uses one resolves to undefined here rather than evaluating an arbitrary named formula.
function readOdfHandleValue(
  raw: string | undefined,
  modifiers: readonly number[],
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw.startsWith("$")) {
    const index = Number.parseInt(raw.slice(1), 10);
    const value = Number.isInteger(index) ? modifiers[index] : undefined;
    return value === undefined || !Number.isFinite(value) ? undefined : value;
  }
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : undefined;
}

// The real corner radius behind a "round-rectangle" preset (ExaDev/documents.js#954's own named example), read from the shape's own draw:enhanced-geometry: its first <draw:handle>'s draw:handle-position (indexing draw:modifiers via readOdfHandleValue above), clamped to that handle's own draw:handle-range-x-minimum/-maximum when present, then scaled from the shape's raw enhanced-geometry coordinate space into real points using the SAME svg:viewBox-derived horizontal scale factor typed/shared/path.ts's own scaleOdfRawPoint applies to path/polygon geometry (a handle's own position/range values live in the identical raw coordinate space draw:enhanced-path's own numbers do). Returns undefined when any of this is unresolvable — there is no ODF-declared "default" radius for an unadjusted round-rectangle to fall back to (an application's own gallery preset defaults are a producer convenience, not something the OASIS schema mandates a value for), so a round-rectangle with no resolvable handle degrades to the caller's own plain-rect fallback rather than a fabricated radius. The result is additionally clamped to half the shape's shorter side — not a guessed threshold, but the mathematical maximum a rectangle's own corner radius can be before adjacent corners overlap.
function readRoundRectangleRadiusPt(
  geometryElement: XmlElement,
  viewBox: OdfViewBox,
  frame: Readonly<Box>,
): number | undefined {
  if (viewBox.width <= 0) {
    return undefined;
  }
  const modifiersValue = attrValue(geometryElement, "draw:modifiers");
  const modifiers = (modifiersValue ?? "")
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map(Number);
  const handle = childrenWithTag(geometryElement, "draw:handle")[0];
  if (handle === undefined) {
    return undefined;
  }
  const positionValue = attrValue(handle, "draw:handle-position");
  const rawX = positionValue?.split(/\s+/)[0];
  const raw = readOdfHandleValue(rawX, modifiers);
  if (raw === undefined) {
    return undefined;
  }
  const min = readOdfHandleValue(
    attrValue(handle, "draw:handle-range-x-minimum"),
    modifiers,
  );
  const max = readOdfHandleValue(
    attrValue(handle, "draw:handle-range-x-maximum"),
    modifiers,
  );
  const clamped = Math.min(max ?? raw, Math.max(min ?? raw, raw));
  const radiusPt = clamped * (frame.widthPt / viewBox.width);
  if (radiusPt <= 0) {
    return undefined;
  }
  const maxRadiusPt = Math.min(frame.widthPt, frame.heightPt) / 2;
  return Math.min(radiusPt, maxRadiusPt);
}

export function readCustomShapeVector(
  element: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
): ContentVector | undefined {
  const geometryElement = childrenWithTag(element, "draw:enhanced-geometry")[0];
  const type =
    geometryElement === undefined
      ? undefined
      : attrValue(geometryElement, "draw:type");
  if (type === undefined || !RECOGNIZED_CUSTOM_SHAPE_PRESETS.has(type)) {
    return undefined;
  }
  const geometry = resolveVectorGeometry(element, groupFunctions);
  if (geometry === undefined) {
    return undefined;
  }
  const { fill, fillPattern, fillOpacity, stroke } = readOdfFillAndStroke(
    element,
    pkg,
  );
  const fillFields = {
    fill,
    ...(fillPattern === undefined ? {} : { fillPattern }),
    ...(fillOpacity === undefined ? {} : { fillOpacity }),
  };

  if (type === "ellipse") {
    return {
      kind: "ellipse",
      frame: geometry.frame,
      rotationDeg: geometry.rotationDeg,
      ...fillFields,
      stroke,
    };
  }

  if (type === "round-rectangle" && geometryElement !== undefined) {
    // svg:viewBox and draw:modifiers both live on <draw:enhanced-geometry> itself (OASIS ODF 1.3 section 10.6.2), NOT on the enclosing draw:custom-shape — unlike draw:path/draw:polygon/draw:polyline, where svg:viewBox sits on the geometry element itself directly.
    const viewBoxValue = attrValue(geometryElement, "svg:viewBox");
    const viewBox =
      viewBoxValue === undefined ? undefined : parseOdfViewBox(viewBoxValue);
    const radiusPt =
      viewBox === undefined
        ? undefined
        : readRoundRectangleRadiusPt(geometryElement, viewBox, geometry.frame);
    if (radiusPt !== undefined) {
      return {
        kind: "path",
        frame: geometry.frame,
        rotationDeg: geometry.rotationDeg,
        subpaths: [roundedRectSubpath(geometry.frame, radiusPt)],
        ...fillFields,
        stroke,
      };
    }
    // No resolvable handle/modifier — fall through to the plain-rect approximation below, exactly as before this preset's corner radius could be resolved.
  }

  if (FIXED_POLYGON_PRESETS.has(type)) {
    const subpath = fixedPresetSubpath(type, geometry.frame);
    if (subpath === undefined) {
      return undefined;
    }
    return {
      kind: "path",
      frame: geometry.frame,
      rotationDeg: geometry.rotationDeg,
      subpaths: [subpath],
      ...fillFields,
      stroke,
    };
  }

  return {
    kind: "rect",
    frame: geometry.frame,
    rotationDeg: geometry.rotationDeg,
    ...fillFields,
    stroke,
  };
}

// The fallback for an UNRECOGNISED draw:custom-shape preset (or one with no draw:enhanced-geometry/draw:type at all): produce text-only content — a plain ContentShape carrying whatever real text:p runs the shape has, read through the same readOdfParagraph call readDrawFrameContent's own draw:text-box case uses (though without its list-membership walk — an odg path, where a text:list's own text:p children are still FOUND by this deep search and read as plain paragraphs) — rather than a vector primitive this reader cannot correctly derive without evaluating draw:enhanced-path's own formula language (see RECOGNIZED_CUSTOM_SHAPE_PRESETS' own note). The whole draw:enhanced-geometry element quarantines in the salvaged shape's residue, so the preset definition survives beside its approximation and a same-format writer can restore it. A custom-shape's text:p children sit DIRECTLY under draw:custom-shape itself (confirmed against real LibreOffice output — unlike draw:frame's own draw:text-box wrapper), so elementsWithTag is used here as a deep search that also finds a text:list's own text:p children should a custom shape carry one, reading them as plain paragraphs. An unrecognised preset with NO real text content at all (every run empty, matching this reader's own hand-built fixtures, which never populate a placeholder shape's own text) has nothing worth preserving and is skipped entirely, residue with it (the row quarantines the geometry "beside whatever generic shape it degrades to" — no degraded shape, nothing to hang it on). The residue format is 'odg': this salvage path is reached only through walkDrawPageContent, the odg-facing walk.
export function readCustomShapeAsTextShape(
  element: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
): ContentShape | undefined {
  const paragraphs = elementsWithTag(element.children, "text:p").map((p) =>
    readOdfParagraph(p, pkg),
  );
  const hasText = paragraphs.some((paragraph) =>
    paragraph.runs.some((run) => run.text.length > 0),
  );
  if (!hasText) {
    return undefined;
  }
  const ownGeometry = resolveOdfShapeGeometry(element);
  if (ownGeometry === undefined) {
    return undefined;
  }
  const geometry = composeOdfGroupTransform(groupFunctions, ownGeometry);
  const enhancedGeometry = childrenWithTag(
    element,
    "draw:enhanced-geometry",
  )[0];
  return {
    name: readDrawName(element),
    frame: geometry.frame,
    rotationDeg: geometry.rotationDeg,
    ...readFrameInsets(element, pkg),
    blocks: paragraphs,
    ...(enhancedGeometry !== undefined
      ? { source: odfResidue("odg", enhancedGeometry) }
      : {}),
  };
}
