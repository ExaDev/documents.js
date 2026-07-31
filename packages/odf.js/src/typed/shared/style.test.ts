import { describe, expect, it } from 'vitest';
import { AlignmentSchema, type Alignment } from './style';

// style.ts is a deliberate one-line re-export (see its own top-of-file note); this test exists to prove the re-export actually resolves to document-content-model's real schema/type, not to exercise any ODF-specific logic -- there is none in this file.

describe('style.ts re-export', () => {
  it('re-exports a working AlignmentSchema that accepts every ODF fo:text-align value', () => {
    for (const value of ['left', 'center', 'right', 'justify']) {
      expect(AlignmentSchema.safeParse(value).success).toBe(true);
    }
  });

  it('rejects a value outside the four-way alignment enum', () => {
    expect(AlignmentSchema.safeParse('start').success).toBe(false);
  });

  it('re-exports a usable Alignment type', () => {
    const alignment: Alignment = 'center';
    expect(AlignmentSchema.parse(alignment)).toBe('center');
  });
});
