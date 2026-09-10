import { describe, expect, it } from "vitest";
import { decodeGlyphOutline } from "./glyf-contours";
import { parseGlyf } from "./glyf";
import { parseHead, parseMaxp } from "./font-tables";
import { parseSfnt } from "./sfnt";
import { buildCmapLookup } from "./cmap-table";
import { carlitoRegularBytes } from "./test-support/fonts";

// decodeGlyphOutline's differential oracle is the font's own declared per-glyph bounding box: for a simple glyph, glyf.ts's glyphInkBounds returns the header box the font itself states, while this module's decoded coordinates are walked out of the point arrays those two readings never share -- matching bounds therefore proves the flag/coordinate decoding end to end rather than comparing a parser against itself. For a composite, both walks resolve components, through different machinery (glyf.ts unions component boxes; this module places decoded component outlines), so agreement there pins the placement arithmetic (transform, offset, SCALED_COMPONENT_OFFSET precedence) against an independent implementation. The face under test is the real vendored Carlito regular -- genuine production outlines, quadratic-heavy, with composites for the accented repertoire.

function carlitoGlyf() {
  const sfnt = parseSfnt(carlitoRegularBytes());
  if (sfnt === undefined) {
    throw new Error("test setup: Carlito regular did not parse as an sfnt");
  }
  const head = parseHead(sfnt);
  const maxp = parseMaxp(sfnt);
  if (head === undefined || maxp === undefined) {
    throw new Error("test setup: Carlito regular has no readable head/maxp");
  }
  const glyf = parseGlyf(sfnt, {
    numGlyphs: maxp.numGlyphs,
    indexToLocFormat: head.indexToLocFormat,
  });
  if (glyf === undefined) {
    throw new Error("test setup: Carlito regular has no readable glyf/loca");
  }
  const cmap = buildCmapLookup(sfnt);
  if (cmap === undefined) {
    throw new Error("test setup: Carlito regular has no usable cmap");
  }
  return { glyf, cmap };
}

function decodedOutlineBounds(outline: {
  contours: readonly (readonly { x: number; y: number; onCurve: boolean }[])[];
}) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of outline.contours) {
    for (const point of contour) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

describe("decodeGlyphOutline", () => {
  it("decodes a simple glyph's contours to bounds matching the font's own declared ink box", () => {
    const { glyf, cmap } = carlitoGlyf();
    const gid = cmap("H".codePointAt(0)!);
    if (gid === undefined) {
      throw new Error("test setup: Carlito has no H glyph");
    }
    const outline = decodeGlyphOutline(glyf, gid);
    const declared = glyf.glyphInkBounds(gid);
    if (outline === undefined || declared === undefined) {
      throw new Error("H outline or declared bounds unreadable");
    }
    // 'H' is a simple single-contour glyph in Carlito (its crossbar creates no enclosed counter).
    expect(outline.contours.length).toBe(1);
    const bounds = decodedOutlineBounds(outline);
    expect(bounds.minX).toBeCloseTo(declared.xMin, 0);
    expect(bounds.minY).toBeCloseTo(declared.yMin, 0);
    expect(bounds.maxX).toBeCloseTo(declared.xMax, 0);
    expect(bounds.maxY).toBeCloseTo(declared.yMax, 0);
  });

  it("resolves a composite glyph's components to bounds matching the independent component-union walk", () => {
    const { glyf, cmap } = carlitoGlyf();
    // A-acute: a real composite (base A plus a combining acute mark placed with an xy offset), present in any production text face.
    const gid = cmap("Á".codePointAt(0)!);
    if (gid === undefined) {
      throw new Error("test setup: Carlito has no A-acute glyph");
    }
    const outline = decodeGlyphOutline(glyf, gid);
    const declared = glyf.glyphInkBounds(gid);
    if (outline === undefined || declared === undefined) {
      throw new Error("A-acute outline or declared bounds unreadable");
    }
    expect(glyf.compositeComponents(gid)).toBeDefined();
    const bounds = decodedOutlineBounds(outline);
    expect(bounds.minX).toBeCloseTo(declared.xMin, 0);
    expect(bounds.minY).toBeCloseTo(declared.yMin, 0);
    expect(bounds.maxX).toBeCloseTo(declared.xMax, 0);
    expect(bounds.maxY).toBeCloseTo(declared.yMax, 0);
  });

  it("returns no contours for a glyph that draws nothing (a space)", () => {
    const { glyf, cmap } = carlitoGlyf();
    const gid = cmap(" ".codePointAt(0)!);
    if (gid === undefined) {
      throw new Error("test setup: Carlito has no space glyph");
    }
    const outline = decodeGlyphOutline(glyf, gid);
    if (outline === undefined) {
      return; // an empty glyph legitimately has no outline object at all
    }
    expect(outline.contours).toHaveLength(0);
  });

  it("interleaves on- and off-curve points, marking both", () => {
    const { glyf, cmap } = carlitoGlyf();
    const gid = cmap("O".codePointAt(0)!);
    if (gid === undefined) {
      throw new Error("test setup: Carlito has no O glyph");
    }
    const outline = decodeGlyphOutline(glyf, gid);
    if (outline === undefined) {
      throw new Error("O outline unreadable");
    }
    // A rounded glyph carries off-curve quadratic control points by construction; a glyph with none would mean the flag decoding lost the on/off bit entirely.
    const onCurve = outline.contours
      .flat()
      .filter((point) => point.onCurve).length;
    const offCurve = outline.contours
      .flat()
      .filter((point) => !point.onCurve).length;
    expect(onCurve).toBeGreaterThan(0);
    expect(offCurve).toBeGreaterThan(0);
  });

  it("returns undefined for a glyph ID outside the font", () => {
    const { glyf } = carlitoGlyf();
    expect(decodeGlyphOutline(glyf, glyf.numGlyphs + 100)).toBeUndefined();
    expect(decodeGlyphOutline(glyf, -1)).toBeUndefined();
  });
});
