import { describe, expect, it } from "vitest";
import {
  drawingMlFontSizeToPt,
  emuToPt,
  EMU_PER_POINT,
  halfPointsToPt,
  lineUnitsToMultiplier,
  ptToDrawingMlFontSize,
  ptToEmu,
  ptToHalfPoints,
  ptToTwips,
  twipsToPt,
} from "./units";

// Ported verbatim from documents.js's src/model/units.test.ts.
describe("units", () => {
  it("EMU_PER_POINT is 12700", () => {
    expect(EMU_PER_POINT).toBe(12_700);
  });

  it("emuToPt and ptToEmu are exact inverses at a representative value", () => {
    const pt = 72;
    expect(emuToPt(ptToEmu(pt))).toBe(pt);
    expect(ptToEmu(emuToPt(914_400))).toBe(914_400);
  });

  it("twipsToPt and ptToTwips are exact inverses at a representative value", () => {
    const pt = 612; // US Letter width
    expect(twipsToPt(ptToTwips(pt))).toBe(pt);
  });

  it("halfPointsToPt and ptToHalfPoints are exact inverses for a whole-point size", () => {
    const pt = 11;
    expect(halfPointsToPt(ptToHalfPoints(pt))).toBe(pt);
  });

  it("lineUnitsToMultiplier(240) is single spacing", () => {
    expect(lineUnitsToMultiplier(240)).toBe(1);
  });

  it("lineUnitsToMultiplier(360) is 1.5 spacing", () => {
    expect(lineUnitsToMultiplier(360)).toBe(1.5);
  });

  it("drawingMlFontSizeToPt and ptToDrawingMlFontSize are exact inverses, and distinct from the half-point scale", () => {
    const pt = 18;
    expect(drawingMlFontSizeToPt(ptToDrawingMlFontSize(pt))).toBe(pt);
    expect(ptToDrawingMlFontSize(pt)).toBe(1800); // hundredths of a point, not half-points (36)
  });
});
