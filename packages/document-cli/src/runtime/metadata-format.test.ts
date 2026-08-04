import type { LayoutMetadata } from 'documents.js';
import { describe, expect, it } from 'vitest';
import { formatMetadataLines, formatMetadataValue, presentMetadataEntries } from './metadata-format';

describe('formatMetadataValue', () => {
  it('returns a plain string value verbatim', () => {
    expect(formatMetadataValue('My Title')).toBe('My Title');
  });

  it('joins a keywords array with a comma and space', () => {
    expect(formatMetadataValue(['alpha', 'beta', 'gamma'])).toBe('alpha, beta, gamma');
  });
});

describe('presentMetadataEntries', () => {
  it('returns an empty array for a document with no metadata fields set', () => {
    expect(presentMetadataEntries({})).toStrictEqual([]);
  });

  it("returns only the fields actually present, in the fixed METADATA_KEYS order regardless of the object's own key order", () => {
    const metadata: LayoutMetadata = { modifiedIso: '2024-01-02T00:00:00Z', title: 'A Title', author: 'An Author' };
    expect(presentMetadataEntries(metadata)).toStrictEqual([
      ['title', 'A Title'],
      ['author', 'An Author'],
      ['modifiedIso', '2024-01-02T00:00:00Z'],
    ]);
  });
});

describe('formatMetadataLines', () => {
  it('returns an empty array for a document with no metadata fields set', () => {
    expect(formatMetadataLines({})).toStrictEqual([]);
  });

  it('renders every present field as a "key: value" line', () => {
    const metadata: LayoutMetadata = { title: 'A Title', keywords: ['one', 'two'] };
    expect(formatMetadataLines(metadata)).toStrictEqual(['title: A Title', 'keywords: one, two']);
  });
});
