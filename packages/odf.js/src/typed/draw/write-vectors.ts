import type {
  Color,
  ContentStroke,
  ContentStrokeStyle,
  ContentVector,
} from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { formatOdfColor } from "../shared/color";
import { canonicalColor } from "../shared/canonicalise";
import { formatOdfLength } from "../shared/units";
import { formatOdfPathData, formatOdfViewBox } from "../shared/path";
import {
  frameGeometryAttrs,
  odfZIndexOf,
  type DrawShapeWriteState,
} from "./write-shapes";

// The write-side mirror of typed/draw/shapes.ts's own vector-primitive readers (readDrawRectVector, readDrawEllipseVector, readDrawLineVector, readDrawPathVector): one ContentVector -> the draw:rect / draw:ellipse / draw:line / draw:path element those functions read back. It sits beside write-shapes.ts rather than inside it for the reason that module's own writeDrawShapes note already states: a ContentShape carries no vector vocabulary at all, so a page's vectors are produced ALONGSIDE its frames, never through them -- and only ContentDrawPage has a `vectors` array to produce them from, so today's one caller is typed/odg/write.ts. The split follows the read side exactly, where walkDrawShapes (odp) and walkDrawPageContent (odg) live in one module precisely because they share the frame half and differ only in the vector half.
//
// EVERY ATTRIBUTE NAME BELOW IS THE READ SIDE'S OWN, not an SVG-informed guess: readOdfFillAndStroke (typed/draw/shapes.ts) reads draw:fill / draw:fill-color / svg:fill-rule / draw:stroke / svg:stroke-color / svg:stroke-width off a graphic-family style's style:graphic-properties, and that module's own top-of-file note records verifying each of them against real LibreOffice 26.2 .odg output. This module writes exactly those six and nothing else, so the pair is a genuine inverse rather than two independently plausible spellings that happen to agree on the common cases.
//
// WHY EVERY VECTOR CARRIES A draw:style-name, even one with neither fill nor stroke, unlike a frame's own insets (write-shapes.ts's shapeGraphicStyleName mints nothing when every inset is zero): ODF's "no direct formatting" rule means the ABSENCE of a fill declaration does not mean "no fill" to a real consumer -- it means "inherit", and a consumer's own default graphic style supplies one (LibreOffice's built-in "standard" graphic style fills with a solid colour, so a rect written with no draw:fill at all renders filled rather than empty). draw:fill="none" / draw:stroke="none" are the format's own way of saying no fill / no stroke, confirmed on the read side against a real rectangle whose UNO FillStyle/LineStyle were set to NONE, and are what this module writes whenever the ContentVector states neither. An all-zero inset is genuinely different: readFrameInsets defaults to zero when no style says otherwise, so nothing has to be written to mean it.
//
// WHAT THIS MODULE REFUSES rather than approximating, each by name (the same stance every writer in this package takes -- a document that silently lost content is worse than one this writer declined to produce):
// - a 'dotted' or 'double' stroke style. ODF's draw:stroke is enumerated to exactly none/solid/dash (confirmed against the OASIS schema, and recorded on the read side): there is no dotted value at the attribute level, and ODF's vector-stroke model has no double-line concept at all. Rounding either onto "solid" or "dash" would silently change what the document renders as.
// - a stroke whose widthPt is not positive. ContentStrokeSchema declares z.number().positive(), and the reader requires svg:stroke-width > 0 before it builds a stroke at all -- so a zero or negative width writes an attribute that reads back as no stroke whatsoever, which for a 'line' vector (whose stroke is required, an invisible line having nothing to paint) drops the whole element.
// - a 'path' with no subpaths, or whose frame has a non-positive width or height. Both are elements this package's own reader discards outright rather than reading back smaller: parseOdfPathData returns no subpaths for an empty svg:d and readDrawPathVector then returns undefined, and parseOdfViewBox rejects a zero or negative extent (its scale factor would be a division by zero), which does the same.

function unsupportedVector(what: string): Error {
  return new Error(
    `writeDrawVector: a vector carries ${what}, which ODF has no spelling for -- refusing rather than producing a document that silently lost it or renders differently. See ExaDev/documents.js for the tracked follow-up.`,
  );
}

// ContentStroke.style -> draw:stroke's own enumerated value. An absent style means 'solid' (ContentStrokeStyleSchema's own documented convention), which is exactly what the reader gives back for draw:stroke="solid" -- so the absence is canonicalised to the value rather than to a missing attribute, and normaliseOdgContent states that.
function odfStrokeMode(style: ContentStrokeStyle | undefined): string {
  if (style === undefined || style === "solid") {
    return "solid";
  }
  if (style === "dashed") {
    return "dash";
  }
  throw unsupportedVector(
    `a '${style}' stroke style (draw:stroke is enumerated to exactly none/solid/dash -- ODF's vector-stroke model has no dotted or double spelling)`,
  );
}

// The fill/stroke/fill-rule facts one vector states, in the shape readOdfFillAndStroke reads back. Kept as one value rather than three parameters so the style-minting call below cannot be given a partially-assembled paint bag.
interface VectorPaint {
  readonly fill: Color | undefined;
  readonly fillRule: "nonzero" | "evenodd" | undefined;
  readonly stroke: ContentStroke | undefined;
}

// One graphic-family automatic style carrying a vector's whole paint bag, interned through the same StyleRegistry seam write-shapes.ts's own shapeGraphicStyleName uses for a frame's insets (see typed/shared/table.ts's own note on that seam: styles/properties.ts deliberately models paragraph/run formatting only, so a graphic-property bag is supplied pre-built). Interning means a page of fifty identically-painted rectangles mints one style, not fifty.
function vectorGraphicStyleName(
  paint: VectorPaint,
  state: DrawShapeWriteState,
): string {
  const properties: Record<string, string> = {};
  if (paint.fill === undefined) {
    properties["draw:fill"] = "none";
  } else {
    properties["draw:fill"] = "solid";
    properties["draw:fill-color"] = formatOdfColor(paint.fill);
  }
  if (paint.fillRule !== undefined) {
    properties["svg:fill-rule"] = paint.fillRule;
  }
  if (paint.stroke === undefined) {
    properties["draw:stroke"] = "none";
  } else {
    if (!(paint.stroke.widthPt > 0)) {
      throw unsupportedVector(
        `a stroke of width ${paint.stroke.widthPt}pt (svg:stroke-width must be positive for a stroke to exist at all)`,
      );
    }
    properties["draw:stroke"] = odfStrokeMode(paint.stroke.style);
    properties["svg:stroke-color"] = formatOdfColor(paint.stroke.color);
    properties["svg:stroke-width"] = formatOdfLength(paint.stroke.widthPt);
  }
  return state.registry.intern({
    properties: {},
    family: "graphic",
    propertyElements: [el("style:graphic-properties", properties)],
  });
}

function zIndexAttrs(paintOrder: number | undefined): Record<string, string> {
  const zIndex = odfZIndexOf(paintOrder);
  return zIndex === undefined ? {} : { "draw:z-index": String(zIndex) };
}

// One ContentVector -> its own draw: element. Geometry for the three boxed variants goes through write-shapes.ts's own frameGeometryAttrs unchanged, because the reader resolves a draw:rect/draw:ellipse/draw:path through the very same resolveOdfShapeGeometry it resolves a draw:frame through (typed/draw/shapes.ts's resolveVectorGeometry) -- so their inverse is one function, not two that must be kept in step.
//
// A 'line' is the one variant with no box at all: ODF spells it as four endpoint coordinates (svg:x1/y1/x2/y2, read by typed/shared/geometry.ts's parseLinePoints), and ContentVectorSchema deliberately gives the line variant no rotationDeg field for the matching reason its own comment states -- a line's rotation is already fully expressed by where its two endpoints are.
//
// draw:ellipse is written for every 'ellipse' vector, including a circular one. Real LibreOffice writes draw:circle when width and height happen to be equal (a distinct element the OASIS schema defines for exactly that case, with an identical attribute shape); the reader maps both onto the one 'ellipse' variant, so writing the general spelling round-trips a circle correctly and spares this writer a special case that carries no information.
export function writeDrawVector(
  vector: ContentVector,
  state: DrawShapeWriteState,
): XmlElement {
  if (vector.kind === "line") {
    const styleName = vectorGraphicStyleName(
      { fill: undefined, fillRule: undefined, stroke: vector.stroke },
      state,
    );
    return el("draw:line", {
      ...zIndexAttrs(vector.paintOrder),
      "svg:x1": formatOdfLength(vector.from.xPt),
      "svg:y1": formatOdfLength(vector.from.yPt),
      "svg:x2": formatOdfLength(vector.to.xPt),
      "svg:y2": formatOdfLength(vector.to.yPt),
      "draw:style-name": encodeXmlText(styleName),
    });
  }

  if (vector.kind === "path") {
    if (vector.subpaths.length === 0) {
      throw unsupportedVector(
        "no subpaths at all (an empty svg:d reads back as an element with no resolvable geometry, so the whole vector would vanish)",
      );
    }
    if (!(vector.frame.widthPt > 0) || !(vector.frame.heightPt > 0)) {
      throw unsupportedVector(
        `a frame of ${vector.frame.widthPt}pt x ${vector.frame.heightPt}pt (a path's svg:viewBox states the extent its own coordinates are scaled against, which cannot be zero or negative)`,
      );
    }
    const styleName = vectorGraphicStyleName(
      {
        fill: vector.fill,
        fillRule: vector.fillRule,
        stroke: vector.stroke,
      },
      state,
    );
    return el("draw:path", {
      ...zIndexAttrs(vector.paintOrder),
      ...frameGeometryAttrs(vector.frame, vector.rotationDeg),
      "svg:viewBox": formatOdfViewBox(vector.frame),
      "svg:d": formatOdfPathData(vector.subpaths),
      "draw:style-name": encodeXmlText(styleName),
    });
  }

  const styleName = vectorGraphicStyleName(
    { fill: vector.fill, fillRule: undefined, stroke: vector.stroke },
    state,
  );
  return el(vector.kind === "rect" ? "draw:rect" : "draw:ellipse", {
    ...zIndexAttrs(vector.paintOrder),
    ...frameGeometryAttrs(vector.frame, vector.rotationDeg),
    "draw:style-name": encodeXmlText(styleName),
  });
}

// A whole page's own vector primitives, in array order -- the vector counterpart to write-shapes.ts's writeDrawShapes, and the second half of what typed/odg/write.ts places inside one draw:page.
export function writeDrawVectors(
  vectors: readonly ContentVector[],
  state: DrawShapeWriteState,
): XmlElement[] {
  return vectors.map((vector) => writeDrawVector(vector, state));
}

// --- the canonical form: what reading a written vector back produces -------------------------------------------------
//
// One ContentVector in the exact shape reading the written document back produces, stated here beside the writer whose output it describes for the same reason canonicalDrawShape sits beside writeDrawFrame.
//
// WHAT IT RESTATES rather than passing through:
// - a COLOUR is quantised to ODF's own six-hex-digit text:color datatype (typed/shared/canonicalise.ts's canonicalColor states that once for the whole package), so a fill or stroke colour component that is not a whole 1/255 step comes back rounded.
// - an ABSENT stroke style becomes 'solid'. ContentStrokeStyleSchema already documents absence to mean solid, and this writer spells that as draw:stroke="solid", which the reader reads back as an explicit style -- the same collapse typed/odt/write.ts's own canonical form already applies to a table cell's absent border style.
// - rotationDeg === 0 collapses to absent, exactly as it does for a shape: resolveOdfShapeGeometry's read side treats a net rotation of exactly zero as undefined, and frameGeometryAttrs writes no transform for it.
// - paintOrder is always present on the way back (walkDrawPageContent stamps every vector it reads), taking the caller-supplied documentIndex whenever ODF cannot spell the input's own value -- see canonicalDrawShape's own PAINT ORDER note, which states the identical rule for a shape, and typed/odg/write.ts for what a drawing page's own encounter indices actually are.
//
// THE THREE FIELDS IT DROPS, each named rather than left silent: `sourcePath` (a reader's own diagnostic path, which a writer has no document to have read from), `source` (quarantined residue, opaque text belonging to whichever format produced it -- re-emitting it into a different document would be actively wrong rather than merely incomplete), and `frames` (a layout pass's own rendered-position record, which a writer running before any layout pass has none of). The identical three every other canonical form in this package drops, for the identical reasons.
//
// NOTHING ELSE IS DROPPED: rect and ellipse declare frame/rotationDeg/fill/stroke/paintOrder and nothing more; line declares from/to/stroke/paintOrder; path adds subpaths and fillRule. Every one of them is carried above, which is why this list names three fields rather than the "and whatever else" a partial statement would need.
export function canonicalDrawVector(
  vector: ContentVector,
  documentIndex: number,
): ContentVector {
  const paintOrder = odfZIndexOf(vector.paintOrder) ?? documentIndex;
  if (vector.kind === "line") {
    return {
      kind: "line",
      from: vector.from,
      to: vector.to,
      stroke: canonicalStroke(vector.stroke),
      paintOrder,
    };
  }
  // rotationDeg === 0 collapses to absent, and an absent fill/stroke stays absent rather than becoming an explicit undefined -- both spelled as a conditional spread rather than a post-construction assignment so each variant is built as its own union member, with no widened intermediate for a later assignment to be checked against.
  const paint = {
    ...(vector.rotationDeg !== undefined && vector.rotationDeg !== 0
      ? { rotationDeg: vector.rotationDeg }
      : {}),
    ...(vector.fill !== undefined ? { fill: canonicalColor(vector.fill) } : {}),
    ...(vector.stroke !== undefined
      ? { stroke: canonicalStroke(vector.stroke) }
      : {}),
  };
  if (vector.kind === "path") {
    return {
      kind: "path",
      frame: vector.frame,
      subpaths: vector.subpaths.map((subpath) => ({
        start: subpath.start,
        segments: [...subpath.segments],
        closed: subpath.closed,
      })),
      ...(vector.fillRule !== undefined ? { fillRule: vector.fillRule } : {}),
      ...paint,
      paintOrder,
    };
  }
  return {
    kind: vector.kind,
    frame: vector.frame,
    ...paint,
    paintOrder,
  };
}

function canonicalStroke(stroke: ContentStroke): ContentStroke {
  return {
    color: canonicalColor(stroke.color),
    widthPt: stroke.widthPt,
    style: stroke.style ?? "solid",
  };
}
