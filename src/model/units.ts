// Named unit constants and conversions between OOXML's measurement units and PDF points (1/72 inch), the single unit LayoutDocument (src/model/layout.ts) uses throughout.

export const POINTS_PER_INCH = 72;
export const EMU_PER_INCH = 914_400;
export const TWIPS_PER_INCH = 1440;

// EMU (English Metric Units): DrawingML's unit for shape/image geometry (a:ext, a:off, wp:extent).
export const EMU_PER_POINT = EMU_PER_INCH / POINTS_PER_INCH;

// Twips (twentieths of a point): WordprocessingML's unit for page size, margins, indentation, and spacing.
export const TWIPS_PER_POINT = TWIPS_PER_INCH / POINTS_PER_INCH;

// Half-points: WordprocessingML's unit for font size (w:sz) and border widths.
export const HALF_POINTS_PER_POINT = 2;

// w:spacing/@w:line is expressed in 240ths of a line when @w:lineRule="auto"; 240 (not 100) is the unit ECMA-376 defines for this attribute, so a lineVal of 240 means exactly single spacing.
export const LINE_UNITS_PER_LINE = 240;

export function emuToPt(emu: number): number {
  return emu / EMU_PER_POINT;
}

export function ptToEmu(pt: number): number {
  return Math.round(pt * EMU_PER_POINT);
}

export function twipsToPt(twips: number): number {
  return twips / TWIPS_PER_POINT;
}

export function ptToTwips(pt: number): number {
  return Math.round(pt * TWIPS_PER_POINT);
}

export function halfPointsToPt(halfPoints: number): number {
  return halfPoints / HALF_POINTS_PER_POINT;
}

export function ptToHalfPoints(pt: number): number {
  return Math.round(pt * HALF_POINTS_PER_POINT);
}

// The single-line-spacing multiplier implied by a w:spacing/@w:line value under @w:lineRule="auto".
export function lineUnitsToMultiplier(lineUnits: number): number {
  return lineUnits / LINE_UNITS_PER_LINE;
}
