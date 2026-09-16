import type {
  MathAssembledGlyphs,
  MathGlyphRun,
  MathLayoutItem,
  MathStroke,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { shiftItems } from "./compose";

const BLACK = { r: 0, g: 0, b: 0 };

describe("shiftItems", () => {
  it("returns an equal result, in a new array, when dxPt and dyPt are both zero", () => {
    const glyphRun: MathGlyphRun = {
      kind: "glyphs",
      xPt: 1,
      yPt: 2,
      text: "x",
      sizePt: 12,
      color: BLACK,
    };
    const items: MathLayoutItem[] = [glyphRun];
    const shifted = shiftItems(items, 0, 0);
    expect(shifted).toEqual(items);
    expect(shifted).not.toBe(items);
  });

  it("shifts a flat glyph-run item by adding dxPt/dyPt, not subtracting", () => {
    const glyphRun: MathGlyphRun = {
      kind: "glyphs",
      xPt: 10,
      yPt: 20,
      text: "x",
      sizePt: 12,
      color: BLACK,
    };
    const [shifted] = shiftItems([glyphRun], 3, 5);
    expect(shifted).toMatchObject({ xPt: 13, yPt: 25 });
  });

  it("shifts every point of a stroke item by adding dxPt/dyPt, not subtracting", () => {
    const stroke: MathStroke = {
      kind: "stroke",
      points: [
        { xPt: 1, yPt: 2 },
        { xPt: 3, yPt: 4 },
      ],
      widthPt: 1,
      color: BLACK,
    };
    const [shifted] = shiftItems([stroke], 10, 100);
    if (shifted?.kind !== "stroke") {
      throw new Error("expected a stroke item");
    }
    expect(shifted.points).toEqual([
      { xPt: 11, yPt: 102 },
      { xPt: 13, yPt: 104 },
    ]);
  });

  it("shifts every placement of an assembled-glyphs item by adding dxPt/dyPt, not subtracting", () => {
    const assembled: MathAssembledGlyphs = {
      kind: "assembled-glyphs",
      placements: [
        { glyphId: 1, xPt: 1, yPt: 2 },
        { glyphId: 2, xPt: 3, yPt: 4 },
      ],
      text: "√",
      sizePt: 12,
      color: BLACK,
    };
    const [shifted] = shiftItems([assembled], 10, 100);
    if (shifted?.kind !== "assembled-glyphs") {
      throw new Error("expected an assembled-glyphs item");
    }
    expect(shifted.placements).toEqual([
      { glyphId: 1, xPt: 11, yPt: 102 },
      { glyphId: 2, xPt: 13, yPt: 104 },
    ]);
  });
});
