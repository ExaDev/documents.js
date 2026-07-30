import { describe, expect, it } from 'vitest';
import { createStandardFontMeasurer } from './measure';

const HELVETICA_REGULAR = { family: 'Arial', weight: 'normal', style: 'normal' } as const;
const CALIBRI_REGULAR = { family: 'Calibri', weight: 'normal', style: 'normal' } as const;

describe('createStandardFontMeasurer', () => {
  it('widthOfTextAtSize scales linearly with size', () => {
    const measurer = createStandardFontMeasurer();
    const at12 = measurer.widthOfTextAtSize('AA', HELVETICA_REGULAR, 12);
    const at24 = measurer.widthOfTextAtSize('AA', HELVETICA_REGULAR, 24);
    expect(at24).toBeCloseTo(at12 * 2, 6);
  });

  it('matches the known Helvetica "A" width at size 1000 (667 units)', () => {
    const measurer = createStandardFontMeasurer();
    expect(measurer.widthOfTextAtSize('A', HELVETICA_REGULAR, 1000)).toBeCloseTo(667, 6);
  });

  it('applies the default Calibri width correction, making it measurably narrower than Helvetica', () => {
    const measurer = createStandardFontMeasurer();
    const helveticaWidth = measurer.widthOfTextAtSize('Hello World', HELVETICA_REGULAR, 12);
    const calibriWidth = measurer.widthOfTextAtSize('Hello World', CALIBRI_REGULAR, 12);
    expect(calibriWidth).toBeLessThan(helveticaWidth);
    expect(calibriWidth / helveticaWidth).toBeCloseTo(0.92, 5);
  });

  it('a custom correction table overrides the default', () => {
    const measurer = createStandardFontMeasurer({ widthCorrectionByFamily: { calibri: 1 } });
    const helveticaWidth = measurer.widthOfTextAtSize('Hello', HELVETICA_REGULAR, 12);
    const calibriWidth = measurer.widthOfTextAtSize('Hello', CALIBRI_REGULAR, 12);
    expect(calibriWidth).toBeCloseTo(helveticaWidth, 6);
  });

  it('horizontalScaleFor matches the width correction actually applied by widthOfTextAtSize', () => {
    const measurer = createStandardFontMeasurer();
    const scale = measurer.horizontalScaleFor(CALIBRI_REGULAR);
    const uncorrectedWidth =
      measurer.widthOfTextAtSize('Hello World', CALIBRI_REGULAR, 12) / scale;
    const helveticaWidth = measurer.widthOfTextAtSize('Hello World', HELVETICA_REGULAR, 12);
    expect(uncorrectedWidth).toBeCloseTo(helveticaWidth, 6);
  });

  it('lineHeightAtSize/ascenderAtSize/descenderAtSize scale with size and match known Helvetica ratios', () => {
    const measurer = createStandardFontMeasurer();
    expect(measurer.lineHeightAtSize(HELVETICA_REGULAR, 100)).toBeCloseTo(115, 6); // 1.150 em
    expect(measurer.ascenderAtSize(HELVETICA_REGULAR, 1000)).toBeCloseTo(718, 6);
    expect(measurer.descenderAtSize(HELVETICA_REGULAR, 1000)).toBeCloseTo(-207, 6);
  });

  it('underlineAtSize returns metrics scaled from the AFM UnderlinePosition/UnderlineThickness', () => {
    const measurer = createStandardFontMeasurer();
    const underline = measurer.underlineAtSize(HELVETICA_REGULAR, 1000);
    expect(underline.offsetPt).toBeCloseTo(-100, 6);
    expect(underline.thicknessPt).toBeCloseTo(50, 6);
  });

  it('an unknown family defaults to no correction (scale 1.0)', () => {
    const measurer = createStandardFontMeasurer();
    expect(measurer.horizontalScaleFor({ family: 'SomeUnknownFont', weight: 'normal', style: 'normal' })).toBe(1);
  });
});
