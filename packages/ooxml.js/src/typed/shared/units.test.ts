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
    const EMU_PER_POINT_EXPECTED = 12_700;
    expect(EMU_PER_POINT).toBe(EMU_PER_POINT_EXPECTED);
  });

  it("emuToPt and ptToEmu are exact inverses at a representative value", () => {
    const pt = 72;
    expect(emuToPt(ptToEmu(pt))).toBe(pt);
    // One inch in EMU: EMU_PER_POINT * POINTS_PER_INCH.
    const ONE_INCH_IN_EMU = 914_400;
    expect(ptToEmu(emuToPt(ONE_INCH_IN_EMU))).toBe(ONE_INCH_IN_EMU);
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
    // WordprocessingML's own line-spacing unit: 240 units per line, so 240 itself is a 1x (single-spacing) multiplier.
    const SINGLE_SPACING_LINE_UNITS = 240;
    expect(lineUnitsToMultiplier(SINGLE_SPACING_LINE_UNITS)).toBe(1);
  });

  it("lineUnitsToMultiplier(360) is 1.5 spacing", () => {
    const ONE_AND_A_HALF_SPACING_LINE_UNITS = 360;
    const ONE_AND_A_HALF_SPACING_MULTIPLIER = 1.5;
    expect(lineUnitsToMultiplier(ONE_AND_A_HALF_SPACING_LINE_UNITS)).toBe(
      ONE_AND_A_HALF_SPACING_MULTIPLIER,
    );
  });

  it("drawingMlFontSizeToPt and ptToDrawingMlFontSize are exact inverses, and distinct from the half-point scale", () => {
    const pt = 18;
    expect(drawingMlFontSizeToPt(ptToDrawingMlFontSize(pt))).toBe(pt);
    // hundredths of a point (18pt * 100), not half-points (which would be 36).
    const EXPECTED_HUNDREDTHS_OF_A_POINT = 1800;
    expect(ptToDrawingMlFontSize(pt)).toBe(EXPECTED_HUNDREDTHS_OF_A_POINT);
  });
});
