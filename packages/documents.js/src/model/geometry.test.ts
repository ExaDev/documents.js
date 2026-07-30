import { describe, expect, it } from 'vitest';
import { type Box, flipY, PAGE_SIZE_A4, PAGE_SIZE_LETTER, SLIDE_SIZE_STANDARD, SLIDE_SIZE_WIDESCREEN } from './geometry';

describe('geometry', () => {
  it('flipY is its own exact inverse', () => {
    const containerHeightPt = 540;
    const box: Box = { xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 };
    expect(flipY(flipY(box, containerHeightPt), containerHeightPt)).toEqual(box);
  });

  it('flipY maps a box flush with the top edge to one flush with the bottom edge', () => {
    const containerHeightPt = 540;
    const box: Box = { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 };
    expect(flipY(box, containerHeightPt)).toEqual({ xPt: 0, yPt: 490, widthPt: 100, heightPt: 50 });
  });

  it('standard page and slide sizes are positive', () => {
    for (const size of [PAGE_SIZE_LETTER, PAGE_SIZE_A4, SLIDE_SIZE_WIDESCREEN, SLIDE_SIZE_STANDARD]) {
      expect(size.widthPt).toBeGreaterThan(0);
      expect(size.heightPt).toBeGreaterThan(0);
    }
  });
});
