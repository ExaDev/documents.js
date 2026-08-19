// Named unit constants and conversions between OOXML's measurement units and points (1/72 inch), the unit ContentSection/ContentShape/ContentParagraph use throughout. Ported verbatim from documents.js's src/model/units.ts -- pure OOXML unit maths with zero PDF knowledge.

export const POINTS_PER_INCH = 72;
export const EMU_PER_INCH = 914_400;
export const TWIPS_PER_INCH = 1440;

// EMU (English Metric Units): DrawingML's unit for shape/image geometry (a:ext, a:off, wp:extent).
export const EMU_PER_POINT = EMU_PER_INCH / POINTS_PER_INCH;

// Twips (twentieths of a point): WordprocessingML's unit for page size, margins, indentation, and spacing.
export const TWIPS_PER_POINT = TWIPS_PER_INCH / POINTS_PER_INCH;

// Half-points: WordprocessingML's unit for run font size (w:rPr/w:sz, w:pPr/w:rPr/w:sz).
export const HALF_POINTS_PER_POINT = 2;

// Eighths of a point (ST_EighthPointMeasure): WordprocessingML's own unit for border widths (w:tcBorders/w:top|left|bottom|right/@w:sz, w:pBdr, ...) -- a different, easily-conflated unit from the half-point w:sz above (a border's own @w:sz uses a completely different scale from a run's font-size @w:sz, despite sharing an attribute name), so this package keeps a distinct conversion pair for it rather than reusing halfPointsToPt.
export const EIGHTH_POINTS_PER_POINT = 8;

// Hundredths of a point: DrawingML's own unit for run font size (a:rPr/@sz, a:defRPr/@sz) -- a different scale from WordprocessingML's half-point w:sz, easy to conflate since both are "OOXML font size units".
export const DRAWINGML_FONT_SIZE_HUNDREDTHS_PER_POINT = 100;

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

export function eighthPointsToPt(eighthPoints: number): number {
  return eighthPoints / EIGHTH_POINTS_PER_POINT;
}

export function ptToEighthPoints(pt: number): number {
  return Math.round(pt * EIGHTH_POINTS_PER_POINT);
}

export function drawingMlFontSizeToPt(hundredths: number): number {
  return hundredths / DRAWINGML_FONT_SIZE_HUNDREDTHS_PER_POINT;
}

export function ptToDrawingMlFontSize(pt: number): number {
  return Math.round(pt * DRAWINGML_FONT_SIZE_HUNDREDTHS_PER_POINT);
}

// The single-line-spacing multiplier implied by a w:spacing/@w:line value under @w:lineRule="auto".
export function lineUnitsToMultiplier(lineUnits: number): number {
  return lineUnits / LINE_UNITS_PER_LINE;
}
