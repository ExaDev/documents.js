import type { GlyfTable } from "./glyf";
import { hasBytes, i16, u8, u16 } from "./sfnt";

// The 'glyf' point arrays glyf.ts deliberately leaves undecoded: the end-point/flag/coordinate lists of a simple glyph, plus composite resolution, decoded into on/off-curve contour points. glyf.ts's own header comment states why it stops at headers and component records -- subsetting copies glyph bytes verbatim and "nothing in this package rasterises an outline, so parsing coordinates would be building a consumer that does not exist". The raster port (src/raster.ts, ExaDev/documents.js#1198) is that consumer: filling a glyph means walking its contours, so this sibling module decodes them through GlyfTable's own public surface (glyphBytes/glyphHeader/compositeComponents) rather than widening glyf.ts itself, keeping byte-verbatim subsetting and outline decoding as two independently testable halves of the same table reader. Nothing here mutates or re-encodes; the output is pure geometry in the font's own design-unit space (y up, origin on the baseline), ready for whatever transform the caller composes onto it.

export interface GlyphContourPoint {
  readonly x: number;
  readonly y: number;
  // TrueType contours interleave on-curve points with off-curve quadratic control points (ISO/IEC 14496-22 clause 5.3.3.1); a run of consecutive off-curve points implies an on-curve point at each neighbouring pair's midpoint, which the contour-to-subpath walk in raster.ts materialises.
  readonly onCurve: boolean;
}

export interface GlyphOutline {
  readonly contours: readonly (readonly GlyphContourPoint[])[];
}

// Simple-glyph flag bits (clause 5.3.3.1): ON_CURVE_POINT, X_SHORT_VECTOR, Y_SHORT_VECTOR, REPEAT_FLAG, X_IS_SAME_OR_POSITIVE, Y_IS_SAME_OR_POSITIVE. The "same or positive" bit is overloaded by the short/long form: with a short vector it carries the sign (1 positive, 0 negative), with a long vector absent it means "delta is zero and no coordinate bytes follow".
const FLAG_ON_CURVE = 0x01;
const FLAG_X_SHORT = 0x02;
const FLAG_Y_SHORT = 0x04;
const FLAG_REPEAT = 0x08;
const FLAG_X_SAME_OR_POSITIVE = 0x10;
const FLAG_Y_SAME_OR_POSITIVE = 0x20;

// A composite may reference another composite, matching glyf.ts's own MAX_COMPOSITE_DEPTH: the format sets no nesting limit, so a cyclic component chain must terminate here rather than in the stack.
const MAX_COMPOSITE_DEPTH = 5;

// Decodes one simple glyph's contours from its own 'glyf' bytes (everything after the 10-byte header). Returns undefined rather than a partial outline: end-point indices must be strictly increasing and land inside the flag/coordinate arrays the glyph actually carries, and a glyph that violates either is malformed -- half a glyph rendered is worse than no glyph rendered plus the caller's diagnostic.
function decodeSimpleContours(
  glyph: Uint8Array<ArrayBuffer>,
): readonly (readonly GlyphContourPoint[])[] | undefined {
  // The header was already read by the caller (numberOfContours >= 0); re-reading it here would duplicate the bounds check glyphHeader already performed, but the contour count is needed to size the walk, and reading it from the same bytes keeps this function self-contained against the header it was handed.
  const numberOfContours = i16(glyph, 0);
  const endPtsOffset = 10;
  if (!hasBytes(glyph, endPtsOffset, numberOfContours * 2 + 2)) {
    return undefined;
  }
  const endPts: number[] = [];
  for (let i = 0; i < numberOfContours; i++) {
    endPts.push(u16(glyph, endPtsOffset + i * 2));
  }
  const numPoints = endPts.length > 0 ? endPts[endPts.length - 1]! + 1 : 0;
  // End points must strictly increase (each contour ends after the previous one starts); equal or decreasing values would make the point-to-contour assignment below ambiguous rather than merely unusual.
  for (let i = 1; i < endPts.length; i++) {
    if (endPts[i]! <= endPts[i - 1]!) {
      return undefined;
    }
  }
  let offset = endPtsOffset + numberOfContours * 2;
  const instructionLength = u16(glyph, offset);
  offset += 2 + instructionLength; // hinting bytecode: never interpreted, only skipped over
  if (!hasBytes(glyph, offset, numPoints)) {
    return undefined;
  }
  const flags: number[] = [];
  while (flags.length < numPoints) {
    const flag = u8(glyph, offset);
    flags.push(flag);
    offset += 1;
    if ((flag & FLAG_REPEAT) !== 0) {
      if (!hasBytes(glyph, offset, 1)) {
        return undefined;
      }
      const repeat = u8(glyph, offset);
      offset += 1;
      // A repeat count pushing past numPoints is malformed (the flag array is exactly numPoints long), and silently truncating it would desynchronise the coordinate arrays that follow.
      if (flags.length + repeat > numPoints) {
        return undefined;
      }
      for (let r = 0; r < repeat; r++) {
        flags.push(flag);
      }
    }
  }
  const xs: number[] = [];
  let x = 0;
  for (const flag of flags) {
    if ((flag & FLAG_X_SHORT) !== 0) {
      if (!hasBytes(glyph, offset, 1)) {
        return undefined;
      }
      const magnitude = u8(glyph, offset);
      offset += 1;
      x += (flag & FLAG_X_SAME_OR_POSITIVE) !== 0 ? magnitude : -magnitude;
    } else if ((flag & FLAG_X_SAME_OR_POSITIVE) === 0) {
      if (!hasBytes(glyph, offset, 2)) {
        return undefined;
      }
      x += i16(glyph, offset);
      offset += 2;
    }
    xs.push(x);
  }
  const ys: number[] = [];
  let y = 0;
  for (const flag of flags) {
    if ((flag & FLAG_Y_SHORT) !== 0) {
      if (!hasBytes(glyph, offset, 1)) {
        return undefined;
      }
      const magnitude = u8(glyph, offset);
      offset += 1;
      y += (flag & FLAG_Y_SAME_OR_POSITIVE) !== 0 ? magnitude : -magnitude;
    } else if ((flag & FLAG_Y_SAME_OR_POSITIVE) === 0) {
      if (!hasBytes(glyph, offset, 2)) {
        return undefined;
      }
      y += i16(glyph, offset);
      offset += 2;
    }
    ys.push(y);
  }
  const contours: (readonly GlyphContourPoint[])[] = [];
  let pointIndex = 0;
  for (const endPt of endPts) {
    const points: GlyphContourPoint[] = [];
    while (pointIndex <= endPt) {
      const flag = flags[pointIndex]!;
      points.push({
        x: xs[pointIndex]!,
        y: ys[pointIndex]!,
        onCurve: (flag & FLAG_ON_CURVE) !== 0,
      });
      pointIndex += 1;
    }
    contours.push(points);
  }
  return contours;
}

// A component's own contours, placed into its parent composite's design space. Mirrors glyf.ts's placeComponentBounds exactly in transform-and-offset semantics (the SCALED_COMPONENT_OFFSET / UNSCALED_COMPONENT_OFFSET precedence included) so a measured ink box and a decoded outline of the same composite can never disagree about where a component sits.
function placeComponentContours(
  contours: readonly (readonly GlyphContourPoint[])[],
  component: {
    readonly argument1: number;
    readonly argument2: number;
    readonly flags: number;
    readonly transform: readonly [number, number, number, number] | undefined;
  },
): readonly (readonly GlyphContourPoint[])[] {
  const [a, b, c, d] = component.transform ?? [1, 0, 0, 1];
  const scaledOffset =
    (component.flags & 0x0800) !== 0 && (component.flags & 0x1000) === 0;
  const dx = scaledOffset
    ? a * component.argument1 + c * component.argument2
    : component.argument1;
  const dy = scaledOffset
    ? b * component.argument1 + d * component.argument2
    : component.argument2;
  return contours.map((points) =>
    points.map((point) => ({
      x: a * point.x + c * point.y + dx,
      y: b * point.x + d * point.y + dy,
      onCurve: point.onCurve,
    })),
  );
}

// A glyph's full outline, composites resolved: a simple glyph's own contours, or every component's outline placed through its own transform, recursively. Undefined for anything the walk cannot resolve completely -- an unreadable glyph, a composite past the depth limit, or a component positioned by point matching (argument1/argument2 as point indices rather than x/y offsets), which needs exactly the coordinate arrays a byte-verbatim subsetter never decodes and half-placing would silently stack a mark on its base letter. The rule matches glyphInkBounds's own: undefined, never partial.
export function decodeGlyphOutline(
  glyf: GlyfTable,
  glyphId: number,
): GlyphOutline | undefined {
  return decodeOutline(glyf, glyphId, 0);
}

function decodeOutline(
  glyf: GlyfTable,
  glyphId: number,
  depth: number,
): GlyphOutline | undefined {
  const header = glyf.glyphHeader(glyphId);
  if (header === undefined) {
    return undefined; // an empty glyph (a space) or an unreadable one: no outline either way
  }
  if (header.numberOfContours >= 0) {
    const glyph = glyf.glyphBytes(glyphId)!; // glyphHeader returned a header, so glyphBytes returned the bytes it was read from
    const contours = decodeSimpleContours(glyph);
    return contours === undefined ? undefined : { contours };
  }
  if (depth >= MAX_COMPOSITE_DEPTH) {
    return undefined;
  }
  const components = glyf.compositeComponents(glyphId);
  if (components === undefined) {
    return undefined;
  }
  const contours: (readonly GlyphContourPoint[])[] = [];
  for (const component of components) {
    if (!component.argsAreXyValues) {
      return undefined; // point matching: see the module-level comment above
    }
    const componentOutline = decodeOutline(
      glyf,
      component.glyphIndex,
      depth + 1,
    );
    if (componentOutline === undefined) {
      return undefined;
    }
    contours.push(
      ...placeComponentContours(componentOutline.contours, component),
    );
  }
  return { contours };
}
