// The geometry units a BIFF8 worksheet records its grid and its page setup in, converted to the points document-schema.js's own ContentSheetRow/ContentSheetColumn/ContentSheetPrintSettings use.

/** Points per inch, and the pixel grid Excel's column-width formula is defined against (96 px/inch, its screen-rendering assumption). */
const POINTS_PER_INCH = 72;
const PIXELS_PER_INCH = 96;

/** A twip is a twentieth of a point; a Row record's miyRw is in twips ([MS-XLS] 2.4.221). */
const TWIPS_PER_POINT = 20;

/** The inch's own definition in millimetres, which is what turns [MS-XLS] 2.4.257's metric paper sizes into points. */
const MILLIMETRES_PER_INCH = 25.4;

/**
 * The "maximum digit width": the widest rendered width, in pixels, of the digits 0-9 in the workbook's Normal-style font, which is the unit a column width is expressed in multiples of.
 *
 * 7 is the Calibri-11-at-96dpi value every mainstream spreadsheet tool assumes by default, and the same constant ooxml.js's xlsx reader uses -- so a column of a given width reads back the same number of points whether it arrived as .xls or .xlsx. This package has no font-metrics engine and so cannot compute a workbook's actual digit width from whatever font its Normal style really uses: a workbook using a materially narrower or wider font reads column widths that are honestly approximate rather than exact.
 */
const MAX_DIGIT_WIDTH_PX = 7;

/** A Row record's height, in twips, as points. */
export function twipsToPoints(twips: number): number {
  return twips / TWIPS_PER_POINT;
}

/** A margin record's own Xnum ([MS-XLS] 2.4.151 and its three siblings), in inches, as points. */
export function inchesToPoints(inches: number): number {
  return inches * POINTS_PER_INCH;
}

/** The inverse, for writing a margin back out. Exact for every value inchesToPoints produces, since the conversion is a single multiplication by an integer. */
export function pointsToInches(points: number): number {
  return points / POINTS_PER_INCH;
}

/** A paper size [MS-XLS] 2.4.257's own code table states in millimetres, as points. */
export function millimetresToPoints(millimetres: number): number {
  return (millimetres / MILLIMETRES_PER_INCH) * POINTS_PER_INCH;
}

/**
 * A ColInfo record's coldx -- a width in 1/256ths of a character width ([MS-XLS] 2.4.53) -- as points.
 *
 * The pixel step reproduces Excel's own integer-pixel-grid truncation rather than smoothing it into a continuous formula, so a width read here matches the pixel count Excel itself would render, and matches what ooxml.js computes for the equivalent xlsx column.
 */
export function columnWidthToPoints(coldx: number): number {
  const chars = coldx / 256;
  const digitWidthAllowance = Math.trunc(128 / MAX_DIGIT_WIDTH_PX);
  const pixels = Math.trunc(
    ((256 * chars + digitWidthAllowance) / 256) * MAX_DIGIT_WIDTH_PX,
  );
  return (pixels / PIXELS_PER_INCH) * POINTS_PER_INCH;
}

/** A Row record's own height field ([MS-XLS] 2.4.221 miyRw), in twips, rounded to the nearest whole twip and clamped to the field's own documented range (2-8192). The inverse of twipsToPoints, and exact for it: twipsToPoints(pointsToTwips(pt)) === pt for any pt this function does not clamp, since twips-per-point is an integer. */
export function pointsToTwips(points: number): number {
  const MIN_ROW_HEIGHT_TWIPS = 2;
  const MAX_ROW_HEIGHT_TWIPS = 8192;
  const twips = Math.round(points * TWIPS_PER_POINT);
  return Math.min(Math.max(twips, MIN_ROW_HEIGHT_TWIPS), MAX_ROW_HEIGHT_TWIPS);
}

/**
 * The inverse of columnWidthToPoints: the smallest ColInfo coldx whose own forward pixel-quantized width is at least as wide as the given points. Because columnWidthToPoints truncates to a whole pixel, no coldx reproduces an arbitrary points value exactly; this picks the smallest coldx that rounds UP to (rather than under) the requested width, so a column written from a given widthPt and read back through columnWidthToPoints never comes back narrower than what was asked for -- the same "honestly approximate" contract columnWidthToPoints's own comment already documents for the read direction.
 *
 * Derived directly from columnWidthToPoints's own forward formula: pixels(coldx) = floor((coldx + digitWidthAllowance) * MAX_DIGIT_WIDTH_PX / 256). Solving for the smallest coldx with pixels(coldx) >= targetPixels gives coldx = ceil(targetPixels * 256 / MAX_DIGIT_WIDTH_PX) - digitWidthAllowance.
 */
export function pointsToColumnWidth(points: number): number {
  const digitWidthAllowance = Math.trunc(128 / MAX_DIGIT_WIDTH_PX);
  const targetPixels = Math.round((points / POINTS_PER_INCH) * PIXELS_PER_INCH);
  const coldx = Math.ceil(
    (targetPixels * 256) / MAX_DIGIT_WIDTH_PX - digitWidthAllowance,
  );
  return Math.max(coldx, 0);
}
