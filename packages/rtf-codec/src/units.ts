// RTF's own measurement units and the conversions to the points every ContentDocument field is stated in.
//
// The specification's "Units" table gives the full set -- points, half-points, twips, Word device-independent units, EMUs, and pixels -- and names twips as "the most commonly used units in RTF". Only the three this codec actually reads or writes are here; a conversion is added when a control word needing it is, rather than the table being transcribed wholesale for completeness.

export const TWIPS_PER_POINT = 20;
export const HALF_POINTS_PER_POINT = 2;

// The pixel row of the spec's own units table: "Pixels -- typically 96/inch". Used only for \picwN/\pichN, which state a bitmap's size in pixels when no \picwgoalN/\pichgoalN twip size accompanies it; "typically" is the spec's own word, so this is the documented convention rather than an exact conversion, and a picture carrying a goal size never reaches it.
const PIXELS_PER_INCH = 96;
const POINTS_PER_INCH = 72;

export function twipsToPoints(twips: number): number {
  return twips / TWIPS_PER_POINT;
}

export function pointsToTwips(points: number): number {
  return Math.round(points * TWIPS_PER_POINT);
}

export function halfPointsToPoints(halfPoints: number): number {
  return halfPoints / HALF_POINTS_PER_POINT;
}

export function pointsToHalfPoints(points: number): number {
  return Math.round(points * HALF_POINTS_PER_POINT);
}

export function pixelsToPoints(pixels: number): number {
  return (pixels * POINTS_PER_INCH) / PIXELS_PER_INCH;
}

// The spec's own stated defaults for a document that declares no page geometry: "\paperwN Paper width in twips (default is 12,240)", "\paperhN ... (default is 15,840)", "\marglN Left margin in twips (default is 1800)", "\margrN ... (default is 1800)", "\margtN ... (default is 1440)", "\margbN ... (default is 1440)". US Letter with 1.25in side and 1in top/bottom margins.
export const DEFAULT_PAPER_WIDTH_TWIPS = 12_240;
export const DEFAULT_PAPER_HEIGHT_TWIPS = 15_840;
export const DEFAULT_MARGIN_LEFT_TWIPS = 1800;
export const DEFAULT_MARGIN_RIGHT_TWIPS = 1800;
export const DEFAULT_MARGIN_TOP_TWIPS = 1440;
export const DEFAULT_MARGIN_BOTTOM_TWIPS = 1440;

// "\fsN Font size in half-points (default is 24)" -- 12pt.
export const DEFAULT_FONT_SIZE_HALF_POINTS = 24;
