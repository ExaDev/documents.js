import { describe, expect, it } from 'vitest';
import { columnWidthCharsToPt, DEFAULT_ROW_HEIGHT_PT, MAX_DIGIT_WIDTH_PX, ptToColumnWidthChars } from './units';

// Verifies columnWidthCharsToPt against the documented [MS-OI29500] pixel formula computed BY HAND for a handful of known width values, independent of columnWidthCharsToPt's own implementation -- so a bug in the implementation (an off-by-one in Math.trunc, a swapped operand) would show up as a mismatch against this independently-computed expectation, not just as "whatever the function happens to return".

// Truncate(((256 * width + Truncate(128 / MDW)) / 256) * MDW), MDW = 7 -- the exact formula this module's own units.ts cites from [MS-OI29500] Part 1 SS18.3.1.13 and corroborating independent references (ClosedXML's own Cell Dimensions wiki page, SheetJS's own column-properties documentation).
function expectedPixels(width: number, mdw: number): number {
  const digitWidthAllowance = Math.trunc(128 / mdw);
  return Math.trunc(((256 * width + digitWidthAllowance) / 256) * mdw);
}

describe('columnWidthCharsToPt', () => {
  it('matches the hand-computed MS-OI29500 pixel formula for a handful of known widths, converted to points at 96px/inch -> 72pt/inch', () => {
    for (const width of [8.43, 10, 15.32, 20, 0]) {
      const expectedPt = (expectedPixels(width, MAX_DIGIT_WIDTH_PX) / 96) * 72;
      expect(columnWidthCharsToPt(width)).toBeCloseTo(expectedPt, 9);
    }
  });

  it("Excel's own well-known default column width (8.43 characters) resolves to a plausible, positive point width in the right ballpark for a single default-font column", () => {
    const pt = columnWidthCharsToPt(8.43);
    // 44.25pt (59px at MDW=7, per the exact formula re-verified in the test above) -- a sanity bound on ORDER OF MAGNITUDE, not a re-assertion of the exact formula.
    expect(pt).toBeGreaterThan(30);
    expect(pt).toBeLessThan(60);
  });

  it('a zero-character width truncates to zero pixels, not a negative or NaN value', () => {
    expect(columnWidthCharsToPt(0)).toBeGreaterThanOrEqual(0);
  });
});

describe('ptToColumnWidthChars: best-effort inverse of columnWidthCharsToPt', () => {
  it('round-trips a typical column width to within a fraction of one character, honestly not exactly (both formulas involve real, documented Math.trunc pixel-grid snapping)', () => {
    for (const originalWidth of [8.43, 10, 12.76, 15.32, 20]) {
      const pt = columnWidthCharsToPt(originalWidth);
      const roundTripped = ptToColumnWidthChars(pt);
      expect(roundTripped).toBeCloseTo(originalWidth, 0);
    }
  });
});

describe('DEFAULT_ROW_HEIGHT_PT', () => {
  it("is Excel's own documented Windows default (15pt) for 11pt Calibri", () => {
    expect(DEFAULT_ROW_HEIGHT_PT).toBe(15);
  });
});
