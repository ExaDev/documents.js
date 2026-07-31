import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER, SLIDE_SIZE_STANDARD, SLIDE_SIZE_WIDESCREEN } from './geometry';

// Ported from documents.js's src/model/geometry.test.ts, minus the flipY tests -- flipY itself was not ported (see geometry.ts's own comment).
describe('geometry', () => {
  it('standard page and slide sizes are positive', () => {
    for (const size of [PAGE_SIZE_LETTER, PAGE_SIZE_A4, SLIDE_SIZE_WIDESCREEN, SLIDE_SIZE_STANDARD]) {
      expect(size.widthPt).toBeGreaterThan(0);
      expect(size.heightPt).toBeGreaterThan(0);
    }
  });
});
