import { describe, expect, it } from "vitest";
import { POINTS_PER_INCH } from "../shared/units";
import {
  COLUMN_WIDTH_CHARS_DECIMAL_PLACES,
  columnWidthCharsToPt,
  DEFAULT_COLUMN_WIDTH_CHARS,
  DEFAULT_ROW_HEIGHT_PT,
  MAX_DIGIT_WIDTH_PX,
  PIXELS_PER_INCH,
  ptToColumnWidthChars,
} from "./units";

// A spread of plausible "characters"-unit column widths reused across several of the tests below wherever the exact same width recurs, so a bug affecting one width shows up consistently rather than through several different unlabelled numbers that happen to be equal.
const NARROW_WIDTH_CHARS = 10; // a plain round-number width, a distinct ordinary sample point with no further significance
const MEDIUM_WIDTH_CHARS = 15.32; // an arbitrary two-decimal-place width, distinct from DEFAULT_COLUMN_WIDTH_CHARS, chosen only to exercise a non-trivial fractional value
const WIDE_WIDTH_CHARS = 20; // a plain round-number width toward the wider end of a typical worksheet column
// The two real stored <col width> values from the ExaDev/documents.js#953 regression that, pre-fix, kept narrowing across a further write cycle instead of settling (12.76 -> 12.64 -> 12.5, and 44.14 -> 44.07 -> 43.93 respectively).
const FIRST_DRIFT_REGRESSION_WIDTH_CHARS = 12.76;
const SECOND_DRIFT_REGRESSION_WIDTH_CHARS = 44.14;

// Verifies columnWidthCharsToPt against the documented [MS-OI29500] pixel formula computed BY HAND for a handful of known width values, independent of columnWidthCharsToPt's own implementation — so a bug in the implementation (an off-by-one in Math.trunc, a swapped operand) would show up as a mismatch against this independently-computed expectation, not just as "whatever the function happens to return".

// Truncate(((256 * width + Truncate(128 / MDW)) / 256) * MDW), MDW = 7 — the exact formula this module's own units.ts cites from [MS-OI29500] Part 1 SS18.3.1.13 and corroborating independent references (ClosedXML's own Cell Dimensions wiki page, SheetJS's own column-properties documentation). Reimplemented independently here rather than importing units.ts's own COLUMN_WIDTH_FORMULA_SCALE/COLUMN_WIDTH_FORMULA_ROUNDING_NUMERATOR, since the whole point of this hand-computed expectation is that it shares no code path with the function under test.
function expectedPixels(width: number, mdw: number): number {
  // The formula's own scale factor: width is scaled up by this before the digit-width-allowance correction is added, then the whole numerator is scaled back down by the same factor before multiplying by mdw.
  const COLUMN_WIDTH_FORMULA_SCALE = 256;
  // The fixed correction term inside the spec formula's own Truncate(128 / MDW): half of COLUMN_WIDTH_FORMULA_SCALE, rounding the digit-width allowance to the nearest whole pixel rather than always truncating it down.
  const COLUMN_WIDTH_FORMULA_ROUNDING_NUMERATOR = 128;
  const digitWidthAllowance = Math.trunc(
    COLUMN_WIDTH_FORMULA_ROUNDING_NUMERATOR / mdw,
  );
  return Math.trunc(
    ((COLUMN_WIDTH_FORMULA_SCALE * width + digitWidthAllowance) /
      COLUMN_WIDTH_FORMULA_SCALE) *
      mdw,
  );
}

describe("columnWidthCharsToPt", () => {
  it("matches the hand-computed MS-OI29500 pixel formula for a handful of known widths, converted to points at 96px/inch -> 72pt/inch", () => {
    // Decimal places of agreement required between the hand-computed expected value and columnWidthCharsToPt's actual output: tight enough to catch a real algorithmic divergence, loose enough to tolerate ordinary floating-point error from the two independent computations of the same formula.
    const POINT_AGREEMENT_DIGITS = 9;
    for (const width of [
      DEFAULT_COLUMN_WIDTH_CHARS,
      NARROW_WIDTH_CHARS,
      MEDIUM_WIDTH_CHARS,
      WIDE_WIDTH_CHARS,
      0,
    ]) {
      const expectedPt =
        (expectedPixels(width, MAX_DIGIT_WIDTH_PX) / PIXELS_PER_INCH) *
        POINTS_PER_INCH;
      expect(columnWidthCharsToPt(width)).toBeCloseTo(
        expectedPt,
        POINT_AGREEMENT_DIGITS,
      );
    }
  });

  it("Excel's own well-known default column width (8.43 characters) resolves to a plausible, positive point width in the right ballpark for a single default-font column", () => {
    const pt = columnWidthCharsToPt(DEFAULT_COLUMN_WIDTH_CHARS);
    // 44.25pt (59px at MDW=7, per the exact formula re-verified in the test above) — the bounds below are a sanity check on ORDER OF MAGNITUDE, not a re-assertion of the exact formula.
    const SANITY_LOWER_BOUND_PT = 30;
    const SANITY_UPPER_BOUND_PT = 60;
    expect(pt).toBeGreaterThan(SANITY_LOWER_BOUND_PT);
    expect(pt).toBeLessThan(SANITY_UPPER_BOUND_PT);
  });

  it("a zero-character width truncates to zero pixels, not a negative or NaN value", () => {
    expect(columnWidthCharsToPt(0)).toBeGreaterThanOrEqual(0);
  });
});

describe("ptToColumnWidthChars: best-effort inverse of columnWidthCharsToPt", () => {
  it("round-trips a typical column width to within a fraction of one character, honestly not exactly (both formulas involve real, documented Math.trunc pixel-grid snapping)", () => {
    for (const originalWidth of [
      DEFAULT_COLUMN_WIDTH_CHARS,
      NARROW_WIDTH_CHARS,
      FIRST_DRIFT_REGRESSION_WIDTH_CHARS,
      MEDIUM_WIDTH_CHARS,
      WIDE_WIDTH_CHARS,
    ]) {
      const pt = columnWidthCharsToPt(originalWidth);
      const roundTripped = ptToColumnWidthChars(pt);
      expect(roundTripped).toBeCloseTo(originalWidth, 0);
    }
  });
});

// Regression coverage for ExaDev/documents.js#953: a naive round-to-nearest at write time could land the stored "characters" value BELOW columnWidthCharsToPt's own pixel-bucket lower edge, truncating the next read down by one pixel and drifting the width narrower on every further read/write cycle rather than settling. These assert the actual fixed-point property, not mere closeness: once a value has been through one write, a further read/write pair must reproduce byte-identical output, not merely a similar one. Every write below goes through `write`, which reproduces buildColsElement's own `ptToColumnWidthChars(...).toFixed(COLUMN_WIDTH_CHARS_DECIMAL_PLACES)` string-and-reparse step exactly — calling ptToColumnWidthChars bare would prove nothing here, since its own unrounded algebraic result is already an exact fixed point of the forward formula (it recovers, bit for bit, the same lowest-width-in-bucket value every time) and never exhibits the drift; the drift only appears once that result is quantized down to the two decimal places <col width> is actually stored at, which is what turning it into a string and back reproduces.
function write(widthPt: number): number {
  return Number(
    ptToColumnWidthChars(widthPt).toFixed(COLUMN_WIDTH_CHARS_DECIMAL_PLACES),
  );
}

describe("column width read/write converges to a fixed point rather than drifting", () => {
  it("read -> write -> read -> write produces byte-identical results for the second read/write pair as for the first", () => {
    // A spread of real stored <col width> values. Independently re-verified against the pre-fix rounding with this same write-side toFixed(2) step included: SPIRALS_NEGATIVE_WIDTH_CHARS spirals to a negative width (0.08 -> 0.07 -> -0.07), and the two drift-regression widths each keep narrowing across a further write cycle beyond their first (12.76 -> 12.64 -> 12.5; 44.14 -> 44.07 -> 43.93) before settling. The remaining values (1, ANOTHER_NARROW_WIDTH_CHARS, DEFAULT_COLUMN_WIDTH_CHARS, NARROW_WIDTH_CHARS, MEDIUM_WIDTH_CHARS, WIDE_WIDTH_CHARS, A_LARGE_ROUND_WIDTH_CHARS) already stabilize on their very first write even pre-fix, so they demonstrate no drift on their own — they stay in this list purely as ordinary boundary coverage for the fixed behaviour, not as further evidence of the bug.
    const SPIRALS_NEGATIVE_WIDTH_CHARS = 0.08;
    const ANOTHER_NARROW_WIDTH_CHARS = 5; // a second, distinct ordinary narrow-width sample point alongside NARROW_WIDTH_CHARS
    const A_LARGE_ROUND_WIDTH_CHARS = 100; // a plain round-number width toward the wide end of the boundary-coverage spread
    for (const storedWidth of [
      SPIRALS_NEGATIVE_WIDTH_CHARS,
      1,
      ANOTHER_NARROW_WIDTH_CHARS,
      DEFAULT_COLUMN_WIDTH_CHARS,
      NARROW_WIDTH_CHARS,
      FIRST_DRIFT_REGRESSION_WIDTH_CHARS,
      MEDIUM_WIDTH_CHARS,
      WIDE_WIDTH_CHARS,
      SECOND_DRIFT_REGRESSION_WIDTH_CHARS,
      A_LARGE_ROUND_WIDTH_CHARS,
    ]) {
      const firstReadPt = columnWidthCharsToPt(storedWidth);
      const firstWriteChars = write(firstReadPt);

      const secondReadPt = columnWidthCharsToPt(firstWriteChars);
      const secondWriteChars = write(secondReadPt);

      expect(secondReadPt).toBe(firstReadPt);
      expect(secondWriteChars).toBe(firstWriteChars);
    }
  });

  it("a value already produced by a write is a genuine fixed point: write(read(x)) === x", () => {
    // A spread of column widths already expressed in points (not "characters"), used to exercise write(...) as a genuine algebraic operation independent of columnWidthCharsToPt/ptToColumnWidthChars round-tripping through "characters" first: arbitrary points spanning zero up to a wide column.
    const ZERO_WIDTH_PT = 0;
    const A_SMALL_WIDTH_PT = 0.75;
    const A_NARROW_WIDTH_PT = 12;
    // Approximately DEFAULT_COLUMN_WIDTH_CHARS (8.43 characters) converted to points, per the columnWidthCharsToPt formula this module verifies elsewhere.
    const DEFAULT_COLUMN_WIDTH_APPROX_PT = 44.25;
    const A_WIDE_WIDTH_PT = 66.75;
    const A_WIDER_WIDTH_PT = 105;
    const A_VERY_WIDE_WIDTH_PT = 250.5;
    const SAMPLE_WIDTHS_PT = [
      ZERO_WIDTH_PT,
      A_SMALL_WIDTH_PT,
      A_NARROW_WIDTH_PT,
      DEFAULT_COLUMN_WIDTH_APPROX_PT,
      A_WIDE_WIDTH_PT,
      A_WIDER_WIDTH_PT,
      A_VERY_WIDE_WIDTH_PT,
    ];
    for (const widthPt of SAMPLE_WIDTHS_PT) {
      const chars = write(widthPt);
      const roundTripped = write(columnWidthCharsToPt(chars));
      expect(roundTripped).toBe(chars);
    }
  });

  it("never produces a negative characters value, even for a near-zero or explicitly zero-width column", () => {
    // Point widths right at, and just above, zero: the boundary this assertion actually protects.
    const ZERO_WIDTH_PT = 0;
    const JUST_ABOVE_ZERO_WIDTH_PT = 0.1;
    const SLIGHTLY_WIDER_NEAR_ZERO_WIDTH_PT = 0.3;
    const NEAR_ZERO_WIDTHS_PT = [
      ZERO_WIDTH_PT,
      JUST_ABOVE_ZERO_WIDTH_PT,
      SLIGHTLY_WIDER_NEAR_ZERO_WIDTH_PT,
    ];
    for (const widthPt of NEAR_ZERO_WIDTHS_PT) {
      expect(ptToColumnWidthChars(widthPt)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("DEFAULT_ROW_HEIGHT_PT", () => {
  it("is Excel's own documented Windows default (15pt) for 11pt Calibri", () => {
    // Stated independently of DEFAULT_ROW_HEIGHT_PT itself (never derived from it), so this assertion actually checks the production constant's value against Excel's documented default rather than comparing the constant to itself.
    const EXCEL_DOCUMENTED_DEFAULT_ROW_HEIGHT_PT = 15;
    expect(DEFAULT_ROW_HEIGHT_PT).toBe(EXCEL_DOCUMENTED_DEFAULT_ROW_HEIGHT_PT);
  });
});
