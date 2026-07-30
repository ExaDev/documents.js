import { describe, expect, it } from 'vitest';
import { AlignmentSchema, LayoutFontSchema } from './style';

describe('style', () => {
  it('LayoutFontSchema accepts a valid font ref', () => {
    expect(LayoutFontSchema.parse({ family: 'Helvetica', weight: 'bold', style: 'italic' })).toEqual({
      family: 'Helvetica',
      weight: 'bold',
      style: 'italic',
    });
  });

  it('LayoutFontSchema rejects an invalid weight', () => {
    expect(() => LayoutFontSchema.parse({ family: 'Helvetica', weight: 'heavy', style: 'normal' })).toThrow();
  });

  it('AlignmentSchema accepts the four OOXML alignment values', () => {
    for (const value of ['left', 'center', 'right', 'justify']) {
      expect(AlignmentSchema.parse(value)).toBe(value);
    }
  });
});
