// The fill/stroke reading half of the vector-primitive family, split from shapes.ts: the ODF style vocabulary a draw shape paints with (flat colour, gradient/hatch/bitmap fills, stroke colour/width/dash, opacity, fill-rule), resolved through the graphic-family style cascade plus the named style-part lookups non-flat fills need. shapes.ts keeps the frame readers and the page walk; shape-vectors.ts keeps the geometry readers that consume this module.
//
import type {
  Color,
  ContentBitmapFill,
  ContentFillPattern,
  ContentGradientFill,
  ContentHatchFill,
  ContentStroke,
  ContentStrokeDash,
  ContentStrokeStyle,
} from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { attrValue, childrenWithTag } from "../../xml/query";
import { base64ToBytes } from "byte-codec";
import { sniffImageFormat } from "../../image/sniff";
import {
  findNamedStylePartElement,
  resolveStyleElementChain,
} from "../shared/cascade";
import { parseOdfColor } from "../shared/color";
import { parseOdfAngleDeg, parseOdfLength } from "../shared/units";

// ---------------------------------------------------------------------------------------------------------------
// Vector primitives (odg): draw:rect/draw:ellipse/draw:circle/draw:line/draw:path/draw:polygon/draw:polyline, plus a small recognised subset of draw:custom-shape presets — everything readDrawPageContent (shapes.ts) needs beyond odp's own draw:frame/draw:g that walkDrawShapes above already covers.
//
// FILL/STROKE reading (readOdfFillAndStroke) was verified against real LibreOffice 26.2 .odg output (same macro-built fixtures as typed/shared/path.ts's own top-of-file note): a shape's fill/stroke live on its OWN graphic-family automatic style, walked via the SAME resolveStyleElementChain root-first cascade shapes.ts's readFrameInsets already uses (a shape can inherit fill/stroke from its style:parent-style-name chain exactly as it can inherit padding). draw:fill-color / svg:stroke-color+svg:stroke-width being ABSENT means "no fill"/"no stroke" (confirmed: a plain draw:line's own automatic style carries svg:stroke-* but no draw:fill-color at all — lines have no area). An EXPLICIT draw:fill="none" / draw:stroke="none" was also confirmed (a rectangle with FillStyle/LineStyle set to NONE via the UNO API round-trips with literal draw:graphic-properties draw:fill="none" draw:stroke="none") and overrides any color/width also present in an earlier, less specific link of the cascade.
//
// FILL-RULE: svg:fill-rule is real, spec-defined ODF vocabulary (confirmed against the OASIS schema reference — style:graphic-properties carries it via the text:style-graphic-fill-properties-attlist attribute group, enumerated to exactly "nonzero"/"evenodd", the same two values ContentVectorSchema's own path-variant fillRule field models) — read directly here, the same one-to-one mapping shapes.ts already applies elsewhere (e.g. a custom-shape preset's own draw:type). Whether real LibreOffice output ever actually emits it (as opposed to always leaving self-intersecting paths on the nonzero default) was not re-verified against a live headless LibreOffice render for this change — the same headless-soffice-hang constraint documented in the sibling documents.js package's own README blocked that — but it is unambiguous, real, spec-valid vocabulary regardless of how often a given producer chooses to emit it, exactly like this file's own draw:z-index handling below.
//
// NON-FLAT FILLS (ExaDev/documents.js#954): draw:fill="gradient"/"bitmap"/"hatch" each name a real, separate style-part definition — a <draw:gradient>/<draw:fill-image>/<draw:hatch> element, referenced by draw:fill-gradient-name/draw:fill-image-name/draw:fill-hatch-name (OASIS ODF 1.3 sections 20.120/20.124/20.121) — rather than carrying the definition inline the way draw:fill-color does. These live as their own top-level children of office:styles (section 16.42, "usable within the following element: <office:styles>"), NOT nested inside the referencing style:style, so resolving one is a second, separate lookup (findNamedStylePartElement, typed/shared/cascade.ts) alongside the ordinary style cascade this function already walks. The resolved definition is carried losslessly on `fillPattern` (document-schema.js's ContentFillPatternSchema); `fill` keeps behaving exactly as it already did — the style's own direct draw:fill-color when present, and otherwise now a representative flat swatch this reader chooses (a gradient's draw:start-color, a hatch's own draw:color) rather than staying undefined, since a real colour is available and a flat approximation is strictly more useful than none for a consumer with no interest in `fillPattern`. A bitmap fill has no single representative colour to average without decoding pixels, so `fill` stays undefined there exactly as before.
//
// OPACITY (ExaDev/documents.js#954): draw:opacity (OASIS ODF 1.3 section 20.202, style:graphic-properties — zeroToHundredPercent, "sets the opacity for the fill area of a graphic object") and svg:stroke-opacity (section 20.409-ish, a double in [0,1] or a percent) are read into `fillOpacity`/ContentStrokeSchema's own `opacity`. Absent means fully opaque on both, matching Color's own plain-RGB shape (no alpha channel) — the same "absent is the common case, not a stored default" convention this schema already uses throughout.
//
// STROKE STYLE AND DASH PATTERN (ExaDev/documents.js#954): draw:stroke itself is enumerated to exactly "none"/"solid"/"dash" (confirmed against the OASIS schema reference) — there is no "dotted" or "double" value at the ODF attribute level at all. "dash" maps onto ContentStrokeStyleSchema's own 'dashed' member directly and unambiguously. A "dash"-mode stroke's own draw:stroke-dash (styleNameRef) names a <draw:stroke-dash> definition (section 16.42.9) carrying the real repeating run-length pattern — draw:dots1(-length)/draw:dots2(-length)/draw:distance — resolved here onto ContentStrokeSchema's own `dashPattern`; a dash whose named definition cannot be resolved keeps `style: "dashed"` alone, exactly as before this field existed, rather than fabricating one. "double" is not merely unread here: ODF's own vector-stroke model has no double-line rendering concept at all (unlike ContentBorderSchema's border context, where "double" is a genuine, distinct border style) — a real, permanent model boundary, not a gap this reader could close by reading a different attribute.
type OdfFillRule = "nonzero" | "evenodd";

// A plain ODF percentage ("50%") into a 0..1 unit fraction — shared by draw:opacity (always a percentage) and svg:stroke-opacity (a percentage OR a bare [0,1] double, see readOdfStrokeOpacityValue below).
const PERCENT_PATTERN = /^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/;
const PERCENT_SCALE = 100;
function parseOdfPercentUnit(value: string): number | undefined {
  const match = PERCENT_PATTERN.exec(value);
  if (match === null) {
    return undefined;
  }
  // match[1]'s own group has no `?` quantifier of its own (only the alternation inside it does), so it always matches once `match` itself is non-null — the same mandatory-group guarantee typed/shared/units.ts's parseOdfLength/parseOdfAngleDeg rely on for their own match[1]!.
  return Number(match[1]!) / PERCENT_SCALE;
}

// svg:stroke-opacity's own value grammar (OASIS ODF 1.3, style:graphic-properties): "a value of type double 18.2 in the range [0,1] or a value of type zeroToHundredPercent 18.3.41" — unlike draw:opacity, which is always a percentage.
function parseOdfStrokeOpacity(value: string): number | undefined {
  const percent = parseOdfPercentUnit(value);
  if (percent !== undefined) {
    return percent;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

// draw:dots1-length/draw:dots2-length/draw:distance on <draw:stroke-dash> (OASIS ODF 1.3 section 19.134.3/19.136/19.138): "may be an absolute length or a percentage value. Percentage values are relative to the width of the stroke as defined by the svg:stroke-width attribute" — so this needs the stroke's own already-resolved widthPt as context, unlike an ordinary parseOdfLength call.
function parseOdfDashLengthPt(
  value: string,
  strokeWidthPt: number,
): number | undefined {
  const percent = parseOdfPercentUnit(value);
  if (percent !== undefined) {
    return percent * strokeWidthPt;
  }
  return parseOdfLength(value);
}

const GRADIENT_STYLES: ReadonlySet<string> = new Set([
  "linear",
  "axial",
  "radial",
  "ellipsoid",
  "square",
  "rectangular",
]); // OASIS ODF 1.3 section 19.218.2 — the complete draw:style enumeration for <draw:gradient>.

function readOdfGradientFill(
  gradientElement: XmlElement,
): ContentGradientFill | undefined {
  const style = attrValue(gradientElement, "draw:style");
  if (style === undefined || !GRADIENT_STYLES.has(style)) {
    return undefined;
  }
  const startColorValue = attrValue(gradientElement, "draw:start-color");
  const endColorValue = attrValue(gradientElement, "draw:end-color");
  const startColor =
    startColorValue === undefined ? undefined : parseOdfColor(startColorValue);
  const endColor =
    endColorValue === undefined ? undefined : parseOdfColor(endColorValue);
  if (startColor === undefined || endColor === undefined) {
    return undefined;
  }
  const angleValue = attrValue(gradientElement, "draw:angle");
  const angleDeg =
    angleValue === undefined ? undefined : parseOdfAngleDeg(angleValue);
  return {
    kind: "gradient",
    style: style as ContentGradientFill["style"],
    startColor,
    endColor,
    ...(angleDeg !== undefined ? { angleDeg } : {}),
  };
}

const HATCH_STYLES: ReadonlySet<string> = new Set([
  "single",
  "double",
  "triple",
]); // OASIS ODF 1.3 section 19.218.3 — the complete draw:style enumeration for <draw:hatch>.

function readOdfHatchFill(
  hatchElement: XmlElement,
): ContentHatchFill | undefined {
  const style = attrValue(hatchElement, "draw:style");
  if (style === undefined || !HATCH_STYLES.has(style)) {
    return undefined;
  }
  const colorValue = attrValue(hatchElement, "draw:color");
  const color =
    colorValue === undefined ? undefined : parseOdfColor(colorValue);
  const distanceValue = attrValue(hatchElement, "draw:distance");
  const distancePt =
    distanceValue === undefined ? undefined : parseOdfLength(distanceValue);
  if (color === undefined || distancePt === undefined) {
    return undefined;
  }
  const rotationValue = attrValue(hatchElement, "draw:rotation");
  const rotationDeg =
    rotationValue === undefined ? undefined : parseOdfAngleDeg(rotationValue);
  return {
    kind: "hatch",
    style: style as ContentHatchFill["style"],
    color,
    distancePt,
    ...(rotationDeg !== undefined ? { rotationDeg } : {}),
  };
}

// <draw:fill-image> resolves exactly like draw:image (readDrawImageBlock above): xlink:href against a real package part, the .fodp/.fods-only inline office:binary-data form never reached by this reader operating on a decoded zip Package — see readDrawImageBlock's own top-of-file note.
function readOdfBitmapFill(
  fillImageElement: XmlElement,
  pkg: Package,
): ContentBitmapFill | undefined {
  const href = attrValue(fillImageElement, "xlink:href");
  const part = href === undefined ? undefined : pkg.parts[href];
  if (part?.kind !== "binary") {
    return undefined;
  }
  const bytes = base64ToBytes(part.base64);
  const format = sniffImageFormat(bytes);
  return format === undefined
    ? undefined
    : { kind: "bitmap", format, base64: part.base64 };
}

// Resolves a "dash"-mode stroke's own run-length pattern from its named <draw:stroke-dash> definition. dots1/draw:dots1-length/draw:distance are treated as jointly required (an unresolvable core pattern has nothing useful to carry); dots2/draw:dots2-length are genuinely optional together (a single-length dash/gap pattern with no alternating second length), resolved only when BOTH parse to a positive value — a source carrying only one of the pair is malformed for this purpose and degrades to the single-length pattern rather than a lopsided one.
function readOdfStrokeDash(
  dashElement: XmlElement,
  strokeWidthPt: number,
): ContentStrokeDash | undefined {
  const dots1Value = attrValue(dashElement, "draw:dots1");
  const dots1 =
    dots1Value === undefined ? undefined : Number.parseInt(dots1Value, 10);
  const dots1LengthValue = attrValue(dashElement, "draw:dots1-length");
  const dots1LengthPt =
    dots1LengthValue === undefined
      ? undefined
      : parseOdfDashLengthPt(dots1LengthValue, strokeWidthPt);
  const distanceValue = attrValue(dashElement, "draw:distance");
  const distancePt =
    distanceValue === undefined
      ? undefined
      : parseOdfDashLengthPt(distanceValue, strokeWidthPt);
  if (
    dots1 === undefined ||
    !Number.isInteger(dots1) ||
    dots1 <= 0 ||
    dots1LengthPt === undefined ||
    dots1LengthPt <= 0 ||
    distancePt === undefined ||
    distancePt < 0
  ) {
    return undefined;
  }
  const dash: ContentStrokeDash = { dots1, dots1LengthPt, distancePt };
  const dots2Value = attrValue(dashElement, "draw:dots2");
  const dots2 =
    dots2Value === undefined ? undefined : Number.parseInt(dots2Value, 10);
  const dots2LengthValue = attrValue(dashElement, "draw:dots2-length");
  const dots2LengthPt =
    dots2LengthValue === undefined
      ? undefined
      : parseOdfDashLengthPt(dots2LengthValue, strokeWidthPt);
  if (
    dots2 !== undefined &&
    Number.isInteger(dots2) &&
    dots2 > 0 &&
    dots2LengthPt !== undefined &&
    dots2LengthPt > 0
  ) {
    return { ...dash, dots2, dots2LengthPt };
  }
  return dash;
}

export function readOdfFillAndStroke(
  element: XmlElement,
  pkg: Package,
): {
  fill: Color | undefined;
  fillPattern: ContentFillPattern | undefined;
  fillOpacity: number | undefined;
  fillRule: OdfFillRule | undefined;
  stroke: ContentStroke | undefined;
} {
  const styleName = attrValue(element, "draw:style-name");
  const { elements } = resolveStyleElementChain(styleName, "graphic", pkg);
  let fill: Color | undefined;
  let fillPattern: ContentFillPattern | undefined;
  let fillOpacity: number | undefined;
  let fillRule: OdfFillRule | undefined;
  let stroke: ContentStroke | undefined;
  let strokeStyle: ContentStrokeStyle | undefined;
  let strokeOpacity: number | undefined;
  let strokeDash: ContentStrokeDash | undefined;
  for (const styleElement of elements) {
    const props = childrenWithTag(styleElement, "style:graphic-properties")[0];
    if (props === undefined) {
      continue;
    }
    const fillMode = attrValue(props, "draw:fill");
    if (fillMode === "none") {
      fill = undefined;
      fillPattern = undefined;
    } else {
      const fillColorValue = attrValue(props, "draw:fill-color");
      const parsedFill =
        fillColorValue === undefined
          ? undefined
          : parseOdfColor(fillColorValue);
      if (parsedFill !== undefined) {
        fill = parsedFill;
      }
      if (fillMode === "gradient") {
        const name = attrValue(props, "draw:fill-gradient-name");
        const gradientElement =
          name === undefined
            ? undefined
            : findNamedStylePartElement(pkg, "draw:gradient", name);
        const gradientFill =
          gradientElement === undefined
            ? undefined
            : readOdfGradientFill(gradientElement);
        if (gradientFill !== undefined) {
          fillPattern = gradientFill;
          if (parsedFill === undefined) {
            fill = gradientFill.startColor;
          }
        }
      } else if (fillMode === "hatch") {
        const name = attrValue(props, "draw:fill-hatch-name");
        const hatchElement =
          name === undefined
            ? undefined
            : findNamedStylePartElement(pkg, "draw:hatch", name);
        const hatchFill =
          hatchElement === undefined
            ? undefined
            : readOdfHatchFill(hatchElement);
        if (hatchFill !== undefined) {
          fillPattern = hatchFill;
          if (parsedFill === undefined) {
            fill = hatchFill.color;
          }
        }
      } else if (fillMode === "bitmap") {
        const name = attrValue(props, "draw:fill-image-name");
        const fillImageElement =
          name === undefined
            ? undefined
            : findNamedStylePartElement(pkg, "draw:fill-image", name);
        const bitmapFill =
          fillImageElement === undefined
            ? undefined
            : readOdfBitmapFill(fillImageElement, pkg);
        if (bitmapFill !== undefined) {
          fillPattern = bitmapFill;
        }
      }
    }
    const fillRuleValue = attrValue(props, "svg:fill-rule");
    if (fillRuleValue === "nonzero" || fillRuleValue === "evenodd") {
      fillRule = fillRuleValue;
    }
    const opacityValue = attrValue(props, "draw:opacity");
    if (opacityValue !== undefined) {
      const parsedOpacity = parseOdfPercentUnit(opacityValue);
      if (parsedOpacity !== undefined) {
        fillOpacity = parsedOpacity;
      }
    }
    const strokeMode = attrValue(props, "draw:stroke");
    if (strokeMode === "none") {
      stroke = undefined;
      strokeStyle = undefined;
      strokeDash = undefined;
    } else {
      if (strokeMode === "dash") {
        strokeStyle = "dashed";
      } else if (strokeMode === "solid") {
        strokeStyle = "solid";
        strokeDash = undefined; // a more specific link of the cascade going back to solid clears whatever dash pattern an earlier, less specific link set
      }
      const strokeColorValue = attrValue(props, "svg:stroke-color");
      const strokeWidthValue = attrValue(props, "svg:stroke-width");
      const strokeColor =
        strokeColorValue === undefined
          ? undefined
          : parseOdfColor(strokeColorValue);
      const strokeWidthPt =
        strokeWidthValue === undefined
          ? undefined
          : parseOdfLength(strokeWidthValue);
      if (
        strokeColor !== undefined &&
        strokeWidthPt !== undefined &&
        strokeWidthPt > 0
      ) {
        stroke = { color: strokeColor, widthPt: strokeWidthPt };
      }
      const strokeOpacityValue = attrValue(props, "svg:stroke-opacity");
      if (strokeOpacityValue !== undefined) {
        const parsedStrokeOpacity = parseOdfStrokeOpacity(strokeOpacityValue);
        if (parsedStrokeOpacity !== undefined) {
          strokeOpacity = parsedStrokeOpacity;
        }
      }
      if (
        strokeMode === "dash" &&
        strokeWidthPt !== undefined &&
        strokeWidthPt > 0
      ) {
        const dashName = attrValue(props, "draw:stroke-dash");
        const dashElement =
          dashName === undefined
            ? undefined
            : findNamedStylePartElement(pkg, "draw:stroke-dash", dashName);
        const dash =
          dashElement === undefined
            ? undefined
            : readOdfStrokeDash(dashElement, strokeWidthPt);
        if (dash !== undefined) {
          strokeDash = dash;
        }
      }
    }
  }
  return {
    fill,
    fillPattern,
    fillOpacity,
    fillRule,
    stroke:
      stroke === undefined
        ? undefined
        : {
            ...stroke,
            ...(strokeStyle === undefined ? {} : { style: strokeStyle }),
            ...(strokeOpacity === undefined ? {} : { opacity: strokeOpacity }),
            ...(strokeStyle === "dashed" && strokeDash !== undefined
              ? { dashPattern: strokeDash }
              : {}),
          },
  };
}
