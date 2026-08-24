import type {
  Box,
  Color,
  ContentPathPoint,
  ContentStroke,
  ContentSubpath,
  ContentVector,
} from "document-schema.js";
import { colorToRgbHex, rgbHexToColor } from "document-schema.js";
import type { XmlElement, XmlNode } from "ooxml.js";
import { attr, childrenWithTag } from "ooxml.js";
import { emuToPt, ptToEmu } from "../../model/units";
import { el } from "../../xml/fragment";

// The DrawingML vector-primitive vocabulary shared by docx and pptx -- the OOXML counterpart to src/edit/odg/vector.ts, and shared for exactly the same reason that module is shared across odt/odp/odg: a rect/ellipse/line/path is expressed identically in both formats. WordprocessingML and PresentationML differ only in the wrapper element the geometry hangs off (wps:wsp inside a w:drawing/wp:anchor for docx, p:sp on a slide's p:spTree for pptx); everything inside the shape-properties element -- a:xfrm, a:prstGeom/a:custGeom, a:solidFill, a:ln -- is one vocabulary, defined once here and used by both (src/edit/docx/vector.ts and src/edit/pptx/vector.ts).
//
// GEOMETRY CHOICES, and why each is exact rather than an approximation:
// - rect/ellipse map onto the "rect"/"ellipse" ECMA-376 preset geometries (20.1.9.18's ST_ShapeType), whose outlines are defined to fill the shape's own bounding box exactly -- so a preset plus the a:xfrm box reproduces the source frame with no shape-specific adjust values needed and an empty a:avLst.
// - line maps onto the "line" preset, which draws the bounding box's DIAGONAL. A ContentVector line carries two bare endpoints rather than a box, so the box is their min corner plus the absolute deltas, and a:xfrm/@flipH/@flipV pick which diagonal: without them, only the top-left-to-bottom-right direction is expressible.
// - path becomes a real a:custGeom, one a:path per ContentSubpath, with a:moveTo/a:lnTo/a:cubicBezTo/a:close mapping 1:1 onto the subpath's own start/line/cubic/closed vocabulary. a:path's own w/h coordinate space is set to the frame size in EMU and every point is written in EMU too, so the numbers written are the source numbers scaled by one constant with no path-relative rescaling arithmetic either way -- the same 1:1 trick src/edit/odg/svg-path.ts's buildSvgViewBox uses for svg:viewBox.
//
// ContentStroke.style ('solid'/'dashed'/'dotted'/'double') is not written. Nothing in this package produces one -- LayoutLine and LayoutPath both carry a stroke of colour and width only (document-schema.js's layout.ts), so no reconstruction path can populate it -- and a:prstDash has no 'double' member to map the fourth value onto regardless. A hand-built ContentVector setting it consequently paints solid; a real, bounded gap, matching the identical silence in src/edit/odg/style.ts's own ODF-side writer.

// a:srgbClr/@val is a six-digit RGB hex with no leading '#'. Uppercased to match what Word and PowerPoint themselves emit -- the attribute is case-insensitive, so this is purely so hand-inspected output looks like real producer output.
export function drawingMlColorHex(color: Color): string {
  return colorToRgbHex(color).toUpperCase();
}

function solidFillOrNone(fill: Color | undefined): XmlElement {
  return fill === undefined
    ? el("a:noFill")
    : el("a:solidFill", {}, [
        el("a:srgbClr", { val: drawingMlColorHex(fill) }),
      ]);
}

// a:ln/@w is a line width in EMU (ECMA-376 20.1.2.2.24's ST_LineWidth), the same unit a:off/a:ext use -- not the hundredths-of-a-point unit DrawingML uses for font sizes.
function outline(stroke: ContentStroke | undefined): XmlElement {
  if (stroke === undefined) {
    return el("a:ln", {}, [el("a:noFill")]);
  }
  return el("a:ln", { w: String(ptToEmu(stroke.widthPt)) }, [
    el("a:solidFill", {}, [
      el("a:srgbClr", { val: drawingMlColorHex(stroke.color) }),
    ]),
  ]);
}

interface VectorPlacement {
  readonly frame: Box;
  readonly flipH: boolean;
  readonly flipV: boolean;
}

// Where the shape's own a:xfrm box goes, and which way round its geometry runs inside it. Only 'line' can need a flip: it is the one variant carrying directional endpoints rather than an axis-aligned frame, and the "line" preset always runs top-left to bottom-right within its box unless told otherwise.
function placementOf(vector: ContentVector): VectorPlacement {
  if (vector.kind !== "line") {
    return { frame: vector.frame, flipH: false, flipV: false };
  }
  const { from, to } = vector;
  return {
    frame: {
      xPt: Math.min(from.xPt, to.xPt),
      yPt: Math.min(from.yPt, to.yPt),
      widthPt: Math.abs(to.xPt - from.xPt),
      heightPt: Math.abs(to.yPt - from.yPt),
    },
    flipH: to.xPt < from.xPt,
    flipV: to.yPt < from.yPt,
  };
}

// a:xfrm/@rot is in 60,000ths of a degree, clockwise -- the same unit and sign convention src/edit/pptx/shape.ts's own ROTATION_UNITS_PER_DEGREE documents for a shape's rotation, which ContentVector.rotationDeg shares.
const ROTATION_UNITS_PER_DEGREE = 60000;

function transform(
  placement: VectorPlacement,
  rotationDeg: number | undefined,
): XmlElement {
  const attrs: Record<string, string> = {};
  if (rotationDeg !== undefined && rotationDeg !== 0) {
    attrs.rot = String(Math.round(rotationDeg * ROTATION_UNITS_PER_DEGREE));
  }
  if (placement.flipH) {
    attrs.flipH = "1";
  }
  if (placement.flipV) {
    attrs.flipV = "1";
  }
  return el("a:xfrm", attrs, [
    el("a:off", {
      x: String(ptToEmu(placement.frame.xPt)),
      y: String(ptToEmu(placement.frame.yPt)),
    }),
    el("a:ext", {
      cx: String(ptToEmu(placement.frame.widthPt)),
      cy: String(ptToEmu(placement.frame.heightPt)),
    }),
  ]);
}

function pt(xPt: number, yPt: number): XmlElement {
  return el("a:pt", { x: String(ptToEmu(xPt)), y: String(ptToEmu(yPt)) });
}

// One a:path per subpath, in the frame's own EMU coordinate space (see this module's own top-of-file geometry note). a:path/@fill="none"/@stroke="false" are deliberately not written: the shape-level a:solidFill/a:ln already say what the whole geometry paints with, and a per-path override would be a second, conflicting statement of the same thing.
function customGeometry(
  frame: Box,
  subpaths: readonly ContentSubpath[],
): XmlElement {
  const paths = subpaths.map((subpath) => {
    const commands: XmlNode[] = [
      el("a:moveTo", {}, [pt(subpath.start.xPt, subpath.start.yPt)]),
    ];
    for (const segment of subpath.segments) {
      if (segment.kind === "line") {
        commands.push(el("a:lnTo", {}, [pt(segment.to.xPt, segment.to.yPt)]));
      } else {
        commands.push(
          el("a:cubicBezTo", {}, [
            pt(segment.control1.xPt, segment.control1.yPt),
            pt(segment.control2.xPt, segment.control2.yPt),
            pt(segment.to.xPt, segment.to.yPt),
          ]),
        );
      }
    }
    if (subpath.closed) {
      commands.push(el("a:close"));
    }
    return el(
      "a:path",
      { w: String(ptToEmu(frame.widthPt)), h: String(ptToEmu(frame.heightPt)) },
      commands,
    );
  });
  return el("a:custGeom", {}, [
    el("a:avLst"),
    el("a:gdLst"),
    el("a:ahLst"),
    el("a:cxnLst"),
    el("a:rect", { l: "0", t: "0", r: "r", b: "b" }),
    el("a:pathLst", {}, paths),
  ]);
}

const PRESET_BY_KIND: Readonly<Record<"rect" | "ellipse" | "line", string>> = {
  rect: "rect",
  ellipse: "ellipse",
  line: "line",
};

function geometry(vector: ContentVector): XmlElement {
  if (vector.kind === "path") {
    return customGeometry(vector.frame, vector.subpaths);
  }
  return el("a:prstGeom", { prst: PRESET_BY_KIND[vector.kind] }, [
    el("a:avLst"),
  ]);
}

// The children of a shape-properties element (pptx's p:spPr, docx's wps:spPr -- CT_ShapeProperties in both cases, so one child sequence serves both) expressing this vector's placement, outline geometry, fill and stroke, in ECMA-376's own required order: a:xfrm, then the geometry, then the fill, then a:ln.
export function buildVectorShapeProperties(vector: ContentVector): XmlNode[] {
  const placement = placementOf(vector);
  // A line paints purely through its outline -- ContentVectorSchema's 'line' variant carries no fill field at all, and a zero-height horizontal line has no interior to fill regardless.
  const fill = vector.kind === "line" ? undefined : vector.fill;
  const stroke = vector.stroke;
  const rotationDeg = vector.kind === "line" ? undefined : vector.rotationDeg;
  return [
    transform(placement, rotationDeg),
    geometry(vector),
    solidFillOrNone(fill),
    outline(stroke),
  ];
}

// The a:xfrm box this vector will occupy -- the same box buildVectorShapeProperties writes. Exported because both wrappers need it OUTSIDE the shape properties too: docx's wp:anchor repeats it as wp:extent plus a pair of wp:posOffset values, and both wrappers name their shape after it.
export function vectorPlacementBox(vector: ContentVector): Box {
  return placementOf(vector).frame;
}

// A human-readable shape name, matching the "TextBox N"/"Picture N" convention src/edit/pptx/shape.ts and src/edit/docx/image.ts already use for their own generated shapes.
export function vectorShapeName(vector: ContentVector, id: number): string {
  return `${vector.kind.charAt(0).toUpperCase()}${vector.kind.slice(1)} ${id}`;
}

// ---------------------------------------------------------------------------
// READER: the production, non-throwing inverse of buildVectorShapeProperties above -- promoted from what was originally a test-only oracle (src/test-support/drawingml-vector.ts, which now delegates to this function and throws only when it returns undefined, so there is exactly one real implementation of this reading logic rather than two that could drift). Used by src/ooxml/docx/vector.ts and src/ooxml/pptx/vector.ts to recover a vector-only w:drawing/p:sp back into a ContentVector when reading a real docx/pptx file, where an unrecognised shape must be left alone rather than abort the whole document read.
// ---------------------------------------------------------------------------

function requireChild(parent: XmlElement, tag: string): XmlElement {
  const [child] = childrenWithTag(parent, tag);
  if (child === undefined) {
    throw new Error(`expected a ${tag} child of ${parent.tag}`);
  }
  return child;
}

function requireAttrNumber(element: XmlElement, name: string): number {
  const value = attr(element, name);
  if (value === undefined) {
    throw new Error(`expected a ${name} attribute on ${element.tag}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${element.tag}/@${name} is not an integer: ${value}`);
  }
  return parsed;
}

function readSrgbColor(parent: XmlElement): Color {
  const value = attr(requireChild(parent, "a:srgbClr"), "val");
  if (value === undefined) {
    throw new Error("expected a val attribute on a:srgbClr");
  }
  return rgbHexToColor(value);
}

// a:noFill and a:solidFill are the only two buildVectorShapeProperties above ever writes, at shape level and inside a:ln alike.
function readFill(parent: XmlElement): Color | undefined {
  if (childrenWithTag(parent, "a:noFill").length > 0) {
    return undefined;
  }
  return readSrgbColor(requireChild(parent, "a:solidFill"));
}

function readOutline(spPr: XmlElement): ContentStroke | undefined {
  const ln = requireChild(spPr, "a:ln");
  const color = readFill(ln);
  if (color === undefined) {
    return undefined;
  }
  return { color, widthPt: emuToPt(requireAttrNumber(ln, "w")) };
}

interface ReadPlacement {
  readonly frame: Box;
  readonly rotationDeg: number | undefined;
  readonly flipH: boolean;
  readonly flipV: boolean;
}

function readPlacement(spPr: XmlElement): ReadPlacement {
  const xfrm = requireChild(spPr, "a:xfrm");
  const off = requireChild(xfrm, "a:off");
  const ext = requireChild(xfrm, "a:ext");
  const rot = attr(xfrm, "rot");
  return {
    frame: {
      xPt: emuToPt(requireAttrNumber(off, "x")),
      yPt: emuToPt(requireAttrNumber(off, "y")),
      widthPt: emuToPt(requireAttrNumber(ext, "cx")),
      heightPt: emuToPt(requireAttrNumber(ext, "cy")),
    },
    rotationDeg:
      rot === undefined
        ? undefined
        : Number.parseInt(rot, 10) / ROTATION_UNITS_PER_DEGREE,
    flipH: attr(xfrm, "flipH") === "1",
    flipV: attr(xfrm, "flipV") === "1",
  };
}

function readPoint(container: XmlElement, index: number): ContentPathPoint {
  const point = childrenWithTag(container, "a:pt")[index];
  if (point === undefined) {
    throw new Error(`expected an a:pt at index ${index} of ${container.tag}`);
  }
  return {
    xPt: emuToPt(requireAttrNumber(point, "x")),
    yPt: emuToPt(requireAttrNumber(point, "y")),
  };
}

function readSubpaths(custGeom: XmlElement): ContentSubpath[] {
  return childrenWithTag(requireChild(custGeom, "a:pathLst"), "a:path").map(
    (path) => {
      const segments: ContentSubpath["segments"] = [];
      let start: ContentPathPoint | undefined;
      let closed = false;
      for (const command of path.children) {
        if (command.type !== "element") {
          continue;
        }
        switch (command.tag) {
          case "a:moveTo":
            start = readPoint(command, 0);
            break;
          case "a:lnTo":
            segments.push({ kind: "line", to: readPoint(command, 0) });
            break;
          case "a:cubicBezTo":
            segments.push({
              kind: "cubic",
              control1: readPoint(command, 0),
              control2: readPoint(command, 1),
              to: readPoint(command, 2),
            });
            break;
          case "a:close":
            closed = true;
            break;
          default:
            throw new Error(`unrecognised a:path command: ${command.tag}`);
        }
      }
      if (start === undefined) {
        throw new Error("an a:path carried no a:moveTo");
      }
      return { start, segments, closed };
    },
  );
}

// A shape-properties element (pptx's p:spPr, docx's wps:spPr -- CT_ShapeProperties in both) back into its ContentVector, throwing for anything this vocabulary does not recognise. `frameOverride`, when supplied, replaces the frame this function would otherwise read from the shape's own a:xfrm -- needed for docx, where a page-anchored shape's true position lives on the wrapping wp:anchor's own wp:positionH/wp:positionV rather than on wps:spPr's a:xfrm (this package's own writer, src/edit/docx/vector.ts, happens to leave the two agreeing, but a real file is not obliged to, and the anchor is the authoritative one). rotationDeg/flipH/flipV still come from the shape's own a:xfrm regardless, since the anchor carries no rotation or direction of its own.
function readDrawingMlVectorOrThrow(
  spPr: XmlElement,
  frameOverride: Box | undefined,
): ContentVector {
  const rawPlacement = readPlacement(spPr);
  const placement =
    frameOverride === undefined
      ? rawPlacement
      : { ...rawPlacement, frame: frameOverride };
  const stroke = readOutline(spPr);
  const [custGeom] = childrenWithTag(spPr, "a:custGeom");
  if (custGeom !== undefined) {
    return {
      kind: "path",
      frame: placement.frame,
      rotationDeg: placement.rotationDeg,
      subpaths: readSubpaths(custGeom),
      fill: readFill(spPr),
      stroke,
    };
  }
  const preset = attr(requireChild(spPr, "a:prstGeom"), "prst");
  if (preset === "line") {
    if (stroke === undefined) {
      throw new Error(
        "a line preset with no outline: ContentVector's own line variant requires a stroke",
      );
    }
    const { xPt, yPt, widthPt, heightPt } = placement.frame;
    // The inverse of placementOf's own min-corner-plus-flips encoding above: each flip says the endpoint on that axis is the far edge rather than the near one.
    const from = {
      xPt: placement.flipH ? xPt + widthPt : xPt,
      yPt: placement.flipV ? yPt + heightPt : yPt,
    };
    const to = {
      xPt: placement.flipH ? xPt : xPt + widthPt,
      yPt: placement.flipV ? yPt : yPt + heightPt,
    };
    return { kind: "line", from, to, stroke };
  }
  if (preset === "rect" || preset === "ellipse") {
    return {
      kind: preset,
      frame: placement.frame,
      rotationDeg: placement.rotationDeg,
      fill: readFill(spPr),
      stroke,
    };
  }
  throw new Error(`unrecognised a:prstGeom preset: ${String(preset)}`);
}

// The non-throwing production entry point: undefined for anything this vocabulary does not recognise (a shape this package's own writer did not produce, or one missing a required child/attribute), rather than aborting the whole document read over one unrecognised shape -- see src/ooxml/docx/vector.ts and src/ooxml/pptx/vector.ts, whose own callers already tolerate "no vector recovered here" as an ordinary, silent outcome.
export function readDrawingMlVector(
  spPr: XmlElement,
  frameOverride?: Box,
): ContentVector | undefined {
  try {
    return readDrawingMlVectorOrThrow(spPr, frameOverride);
  } catch {
    return undefined;
  }
}
