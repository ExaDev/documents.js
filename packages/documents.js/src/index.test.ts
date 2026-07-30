import { describe, expect, it } from 'vitest';
import { decodePackage, encodePackage } from './index';

describe('index (placeholder re-exports)', () => {
  it('re-exports ooxml.js decodePackage/encodePackage', () => {
    expect(typeof decodePackage).toBe('function');
    expect(typeof encodePackage).toBe('function');
  });
});
