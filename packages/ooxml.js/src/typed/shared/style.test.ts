import { describe, expect, it } from 'vitest';
import { AlignmentSchema } from './style';

// Ported from documents.js's src/model/style.test.ts, minus the LayoutFontSchema tests -- LayoutFont itself was not ported (see style.ts's own comment).
describe('style', () => {
  it('AlignmentSchema accepts the four OOXML alignment values', () => {
    for (const value of ['left', 'center', 'right', 'justify']) {
      expect(AlignmentSchema.parse(value)).toBe(value);
    }
  });
});
