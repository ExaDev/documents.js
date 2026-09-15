import { describe, expect, it } from "vitest";
import { decodeGlyphOutline } from "./glyf-contours";
import { parseGlyf } from "./glyf";
import type { CompositeComponent, GlyfTable } from "./glyf";
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

const FLAG_ON_CURVE = 0x01;
const FLAG_X_SHORT = 0x02;
const FLAG_Y_SHORT = 0x04;
const FLAG_REPEAT = 0x08;
const FLAG_X_SAME_OR_POSITIVE = 0x10;

function u16be(value: number): readonly [number, number] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function i16be(value: number): readonly [number, number] {
  return u16be(value < 0 ? value + 0x10000 : value);
}

// A minimal simple-glyph 'glyf' entry: the 10-byte header (only numberOfContours is ever read from it here; the declared bounding box is not), each contour's own end-point index, no instructions, then one flag byte and one long-form (2-byte, never short-vector, never repeated) coordinate pair per point. The uniform long-form encoding keeps every point's own byte length fixed and predictable, which is what lets the malformed-input fixtures below truncate a well-formed prefix at an exact, deliberate byte rather than needing to account for a variable-width encoding.
function simpleGlyphBytes(
  endPts: readonly number[],
  points: readonly { dx: number; dy: number; onCurve: boolean }[],
): Uint8Array<ArrayBuffer> {
  const header = [...i16be(endPts.length), 0, 0, 0, 0, 0, 0, 0, 0];
  const endPtBytes = endPts.flatMap((endPt) => u16be(endPt));
  const instructionLength = [0, 0];
  const flags = points.map((point) => (point.onCurve ? FLAG_ON_CURVE : 0));
  const xBytes = points.flatMap((point) => i16be(point.dx));
  const yBytes = points.flatMap((point) => i16be(point.dy));
  return new Uint8Array([
    ...header,
    ...endPtBytes,
    ...instructionLength,
    ...flags,
    ...xBytes,
    ...yBytes,
  ]);
}

// A GlyfTable double for exercising decodeGlyphOutline/decodeSimpleContours directly, entirely independent of any real font: `entries` supplies each simple glyph's own raw 'glyf' bytes (simpleGlyphBytes' output, or hand-truncated/corrupted for the malformed-input tests below), and `composites` supplies a composite glyph's own component records as plain objects, sidestepping the composite record's own byte format entirely -- decodeGlyphOutline reaches it only through this interface method, never by reading bytes itself.
function fakeGlyfTable(options: {
  readonly entries?: ReadonlyMap<number, Uint8Array<ArrayBuffer>>;
  readonly composites?: ReadonlyMap<
    number,
    readonly CompositeComponent[] | undefined
  >;
}): GlyfTable {
  const entries: ReadonlyMap<
    number,
    Uint8Array<ArrayBuffer>
  > = options.entries ?? new Map();
  const composites: ReadonlyMap<
    number,
    readonly CompositeComponent[] | undefined
  > = options.composites ?? new Map();
  return {
    numGlyphs: entries.size + composites.size,
    glyphBytes: (glyphId) => entries.get(glyphId),
    glyphHeader: (glyphId) => {
      if (composites.has(glyphId)) {
        return { numberOfContours: -1, xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
      }
      const bytes = entries.get(glyphId);
      if (bytes === undefined || bytes.length < 10) {
        return undefined;
      }
      return {
        numberOfContours: (bytes[0]! << 8) | bytes[1]!,
        xMin: 0,
        yMin: 0,
        xMax: 0,
        yMax: 0,
      };
    },
    compositeComponents: (glyphId) => composites.get(glyphId),
    glyphInkBounds: () => undefined, // decodeGlyphOutline never reads this
  };
}

// Every fixture below is hand-built specifically to reach a malformed-input or depth-limit path in decodeSimpleContours()/decodeOutline(): the vendored Carlito face above is a well-formed program from a real font toolchain, so none of these ever arise from walking it.
describe("decodeGlyphOutline's simple-glyph and composite decoding, driven by a fake GlyfTable", () => {
  it("decodes a hand-built multi-contour simple glyph, proving the end-point-to-contour assignment directly", () => {
    // Two contours: a 3-point triangle (points 0-2, endPt 2) and a 2-point line (points 3-4, endPt 4) -- exercises the pointIndex walk crossing a contour boundary, which every real-font test above only ever does incidentally.
    const bytes = simpleGlyphBytes(
      [2, 4],
      [
        { dx: 0, dy: 0, onCurve: true },
        { dx: 10, dy: 0, onCurve: true },
        { dx: 0, dy: 10, onCurve: true },
        { dx: 5, dy: 5, onCurve: true },
        { dx: 1, dy: 1, onCurve: false },
      ],
    );
    const glyf = fakeGlyfTable({ entries: new Map([[0, bytes]]) });
    const outline = decodeGlyphOutline(glyf, 0);
    expect(outline?.contours).toHaveLength(2);
    expect(outline?.contours[0]).toHaveLength(3);
    expect(outline?.contours[1]).toHaveLength(2);
    // x/y deltas accumulate across every point in the glyph, not per contour: (0,0) -> (10,0) -> (10,10) -> (15,15) -> (16,16).
    expect(outline?.contours[1]?.[1]).toEqual({
      x: 16,
      y: 16,
      onCurve: false,
    });
  });

  it("refuses a glyph truncated before its own end-point array", () => {
    const header = new Uint8Array([...i16be(1), 0, 0, 0, 0, 0, 0, 0, 0]); // declares 1 contour, then nothing
    const glyf = fakeGlyfTable({ entries: new Map([[0, header]]) });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("refuses end points that do not strictly increase", () => {
    const bytes = new Uint8Array([
      ...i16be(2),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // header: 2 contours
      ...u16be(5),
      ...u16be(3), // endPts [5, 3]: not strictly increasing
      0,
      0, // instructionLength
    ]);
    const glyf = fakeGlyfTable({ entries: new Map([[0, bytes]]) });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("refuses a glyph truncated before its own flags array", () => {
    const bytes = new Uint8Array([
      ...i16be(1),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // header: 1 contour
      ...u16be(0), // endPts [0]: one point
      0,
      0, // instructionLength, then nothing -- no flag byte follows
    ]);
    const glyf = fakeGlyfTable({ entries: new Map([[0, bytes]]) });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("refuses a repeat flag with no repeat-count byte following it", () => {
    const bytes = new Uint8Array([
      ...i16be(1),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...u16be(0),
      0,
      0,
      FLAG_ON_CURVE | FLAG_REPEAT, // then nothing -- no repeat-count byte
    ]);
    const glyf = fakeGlyfTable({ entries: new Map([[0, bytes]]) });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("refuses a repeat count that would push the flag array past its own point total", () => {
    const bytes = new Uint8Array([
      ...i16be(1),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...u16be(1), // endPts [1]: two points total
      0,
      0,
      FLAG_ON_CURVE | FLAG_REPEAT,
      5, // one flag already pushed, repeated 5 more times: 6 > 2 points
    ]);
    const glyf = fakeGlyfTable({ entries: new Map([[0, bytes]]) });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("refuses a short-vector X coordinate with no magnitude byte following it", () => {
    const bytes = new Uint8Array([
      ...i16be(1),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...u16be(0),
      0,
      0,
      FLAG_ON_CURVE | FLAG_X_SHORT, // then nothing -- no magnitude byte
    ]);
    const glyf = fakeGlyfTable({ entries: new Map([[0, bytes]]) });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("refuses a long-form X coordinate truncated before its own two bytes", () => {
    const bytes = new Uint8Array([
      ...i16be(1),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...u16be(0),
      0,
      0,
      FLAG_ON_CURVE, // neither X_SHORT nor X_SAME_OR_POSITIVE: needs a 2-byte delta that never comes
    ]);
    const glyf = fakeGlyfTable({ entries: new Map([[0, bytes]]) });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("refuses a short-vector Y coordinate with no magnitude byte following it", () => {
    const bytes = new Uint8Array([
      ...i16be(1),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...u16be(0),
      0,
      0,
      // X_SAME_OR_POSITIVE with X_SHORT unset consumes zero X bytes, reaching the Y decode with nothing left.
      FLAG_ON_CURVE | FLAG_X_SAME_OR_POSITIVE | FLAG_Y_SHORT,
    ]);
    const glyf = fakeGlyfTable({ entries: new Map([[0, bytes]]) });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("refuses a long-form Y coordinate truncated before its own two bytes", () => {
    const bytes = new Uint8Array([
      ...i16be(1),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...u16be(0),
      0,
      0,
      FLAG_ON_CURVE | FLAG_X_SAME_OR_POSITIVE, // X consumes zero bytes; Y needs a 2-byte delta that never comes
    ]);
    const glyf = fakeGlyfTable({ entries: new Map([[0, bytes]]) });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("applies the SCALED_COMPONENT_OFFSET transform to a component's own placement offset, not just its outline points", () => {
    // No real vendored composite in this suite's own fonts ever sets SCALED_COMPONENT_OFFSET (bit 11, 0x0800) without also setting UNSCALED_COMPONENT_OFFSET (bit 12, 0x1000) -- Microsoft's own OpenType toolchain never emits that combination, only Apple's does -- so this is the one placement path only a hand-built fixture can reach at all. Component 0's own base point (10, 20), the transform [a,b,c,d] = [2,3,5,7], and offset arguments (6, 8) are all pairwise distinct so that swapping any single +/-/*// in the placement arithmetic below changes the result: dx = a*6 + c*8 = 52, dy = b*6 + d*8 = 74, and the final point is the transformed base point plus that SCALED offset, not the raw (6, 8) UNSCALED_COMPONENT_OFFSET would have placed it at.
    const base = simpleGlyphBytes([0], [{ dx: 10, dy: 20, onCurve: true }]);
    const scaledOffsetComponent: CompositeComponent = {
      flags: 0x0800,
      glyphIndex: 0,
      argument1: 6,
      argument2: 8,
      argsAreXyValues: true,
      transform: [2, 3, 5, 7],
    };
    const glyf = fakeGlyfTable({
      entries: new Map([[0, base]]),
      composites: new Map([[1, [scaledOffsetComponent]]]),
    });
    const outline = decodeGlyphOutline(glyf, 1);
    expect(outline?.contours).toHaveLength(1);
    expect(outline?.contours[0]?.[0]).toEqual({
      x: 172, // 2*10 + 5*20 + (2*6 + 5*8)
      y: 244, // 3*10 + 7*20 + (3*6 + 7*8)
      onCurve: true,
    });
  });

  it("refuses a composite chain recursing past the spec's own nesting limit", () => {
    // Glyph 0 composites onto itself: every level is otherwise well-formed, so only the sheer recursion depth -- never a malformed record -- is what trips the limit.
    const selfComposite: CompositeComponent = {
      flags: 0,
      glyphIndex: 0,
      argument1: 0,
      argument2: 0,
      argsAreXyValues: true,
      transform: undefined,
    };
    const glyf = fakeGlyfTable({
      composites: new Map([[0, [selfComposite]]]),
    });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("refuses a composite whose own component list is unreadable", () => {
    // The glyph is declared composite (glyphHeader reports it), but compositeComponents itself reports a truncated/unreadable record list.
    const glyf = fakeGlyfTable({
      composites: new Map([[0, undefined]]),
    });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("refuses a component positioned by point matching rather than an x/y offset", () => {
    const pointMatched: CompositeComponent = {
      flags: 0,
      glyphIndex: 1,
      argument1: 0,
      argument2: 0,
      argsAreXyValues: false,
      transform: undefined,
    };
    const glyf = fakeGlyfTable({
      composites: new Map([[0, [pointMatched]]]),
    });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });

  it("propagates a nested component's own decode failure up through its parent composite", () => {
    const referencesUnreadable: CompositeComponent = {
      flags: 0,
      glyphIndex: 1, // glyph 1 exists in neither entries nor composites: unreadable
      argument1: 0,
      argument2: 0,
      argsAreXyValues: true,
      transform: undefined,
    };
    const glyf = fakeGlyfTable({
      composites: new Map([[0, [referencesUnreadable]]]),
    });
    expect(decodeGlyphOutline(glyf, 0)).toBeUndefined();
  });
});
