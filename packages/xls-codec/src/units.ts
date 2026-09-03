// The two geometry units a BIFF8 worksheet records its grid in, converted to the points document-schema.js's own ContentSheetRow/ContentSheetColumn use.

/** Points per inch, and the pixel grid Excel's column-width formula is defined against (96 px/inch, its screen-rendering assumption). */
const POINTS_PER_INCH = 72;
const PIXELS_PER_INCH = 96;

/** A twip is a twentieth of a point; a Row record's miyRw is in twips ([MS-XLS] 2.4.221). */
const TWIPS_PER_POINT = 20;

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
