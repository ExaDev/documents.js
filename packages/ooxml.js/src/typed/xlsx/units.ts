import { POINTS_PER_INCH } from "../shared/units";

// SpreadsheetML-specific unit conversions: xlsx's own "character width" column-width unit, and the pixel grid it (and row heights, expressed directly in points) are built on. Ported from nowhere -- these are genuinely new to this package, xlsx being the first OOXML format ooxml.js reads geometry from that isn't already in EMU/twips/half-points.

// The pixel grid xlsx's own column-width formula is defined against: 96 pixels per inch, the same assumption Word/Excel's own screen-rendering model uses (and distinct from a print DPI, which xlsx's <pageSetup horizontalDpi>/<verticalDpi> record separately and this module does not touch).
export const PIXELS_PER_INCH = 96;

// The "Maximum Digit Width" (MDW): the widest rendered width, in pixels, of the digits 0-9 in the workbook's own default/Normal-style font. Excel's column-width attribute is defined in units of "characters of this width", per [MS-OI29500] Part 1 SS18.3.1.13 (col, Column Width & Formatting): "the width attribute [is] the number of characters times the maximum digit width of the numbers 0, 1, ..., 9 as rendered in the normal style's font, plus 2 pixels of margin padding on each side, plus 1 pixel padding for the gridlines." That same spec page gives Calibri 11pt (Excel's own current default font) an MDW of 7 pixels at 96 DPI ("each digit is the same width for this font"). This package has no font-metrics engine (the same boundary already documented for PDF's standard-14 substitution) and therefore cannot compute a workbook's *actual* MDW from whatever font its Normal style really uses -- MDW=7 is used unconditionally as the Calibri-11-at-96dpi convention every mainstream xlsx tool (SheetJS, ClosedXML, openpyxl-adjacent tooling) assumes by default. A workbook whose Normal style uses a narrower or wider font than Calibri 11 will read/write column widths that are honestly approximate, not exact -- the same fidelity caveat this package already documents for standard-14 font substitution.
export const MAX_DIGIT_WIDTH_PX = 7;

// Excel's own documented default row height for an unmodified worksheet using 11pt Calibri on Windows (the platform this package's own conventions otherwise target, e.g. docx's own PAGE_SIZE_LETTER default) -- 15pt, corresponding to roughly 20px at 96 DPI for one line of 11pt Calibri. (macOS Excel's own default is a different value, 12.75pt, reflecting a different line-height calculation on that platform; this constant follows the same "pick the one authoritative default, document the platform this package targets" approach already used elsewhere, e.g. docx's own DEFAULT_MARGIN_PT.)
export const DEFAULT_ROW_HEIGHT_PT = 15;

// Excel's own default column width for a column no <col> element covers, in the same "characters of the default font" unit <col width> uses -- the width a fresh worksheet's columns render at (8.43 characters of Calibri 11, the 64-pixel default column). A drawing anchor placed against undeclared columns resolves through this, exactly as a renderer with no explicit width would.
export const DEFAULT_COLUMN_WIDTH_CHARS = 8.43;

// The decimal precision <col width="..."> is written at, matching Excel's own convention for this attribute. ptToColumnWidthChars rounds to exactly this many places itself (see below), so build.ts's own .toFixed call on its result is pure string formatting of an already-rounded number, never a second, independent rounding step that could disagree with the first.
export const COLUMN_WIDTH_CHARS_DECIMAL_PLACES = 2;

// Converts a stored <col width="..."> value (in "characters of the workbook's default font") to points. Two steps: (1) the pixel formula documented and attributed above, confirmed against both the official [MS-OI29500] specification page (which gives the reverse pixels-from-width relationship in the identical MDW terms) and multiple independent real-world tool references (the ClosedXML wiki's own "Cell Dimensions" page, SheetJS's own column-properties documentation) that all state it identically: pixels = Truncate(((256 * width + Truncate(128 / MDW)) / 256) * MDW); (2) the standard 96px/inch -> 72pt/inch conversion. Both truncations are real, integer-pixel-grid truncations Excel itself performs when rendering -- reproduced here exactly (via Math.trunc) rather than smoothed into a continuous formula, since a caller round-tripping the exact same width value through this function should see the exact same pixel count Excel itself would render.
export function columnWidthCharsToPt(width: number): number {
  const digitWidthAllowance = Math.trunc(128 / MAX_DIGIT_WIDTH_PX);
  const pixels = Math.trunc(
    ((256 * width + digitWidthAllowance) / 256) * MAX_DIGIT_WIDTH_PX,
  );
  return (pixels / PIXELS_PER_INCH) * POINTS_PER_INCH;
}

// The write-side inverse of columnWidthCharsToPt above: given a desired column width in points, produces the "characters" value to store in <col width="...">. It is the correct algebraic inverse of the forward formula's own pixel computation up to that formula's unavoidable truncation loss (multiple stored "width" values truncate to the same pixel count, so this can only recover ONE representative of that pixel's whole bucket, never the caller's original decimal digits) -- solving pixels = Truncate(((256*width + K)/256) * MDW) for width (dropping the outer truncation) gives width = pixels/MDW - K/256, where K = Truncate(128/MDW), and that quotient is exactly the LOWEST width value the forward formula truncates to this pixel count. Rounding that lowest value to COLUMN_WIDTH_CHARS_DECIMAL_PLACES places -- the precision it is actually written at -- has to round UP, never to the nearest value: rounding down, even by one hundredth, can land below the bucket's own lower edge and make the forward formula truncate the stored value down to the PREVIOUS pixel count, which is exactly what used to make a width keep drifting narrower on every further read/write cycle rather than settling. Rounding up instead always stays inside the same bucket, because a bucket spans a full 1/MDW (~0.143) characters, far wider than the <=0.01-character nudge rounding up ever adds -- so for any characters value that itself came from a previous call to this function, feeding its resulting points value straight back in reproduces that exact same characters value again: write(read(x)) === x, the fixed point this format needs to actually reach rather than approach asymptotically.
export function ptToColumnWidthChars(widthPt: number): number {
  const pixels = (widthPt / POINTS_PER_INCH) * PIXELS_PER_INCH;
  const digitWidthAllowance = Math.trunc(128 / MAX_DIGIT_WIDTH_PX);
  const exact = pixels / MAX_DIGIT_WIDTH_PX - digitWidthAllowance / 256;
  const scale = 10 ** COLUMN_WIDTH_CHARS_DECIMAL_PLACES;
  return Math.ceil(exact * scale) / scale;
}
