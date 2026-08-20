import { describe, expect, it } from 'vitest';
import { SourceFormatSchema, SourceResidueSchema } from './source';

// The quarantined residue channel's own shape (ExaDev/documents.js#718, channel 2 of the original ExaDev/document-schema.js#22): one `source: { format, xml }` value, validated as opaque text and never semantically interpreted by this package. These tests pin the three facts that make it a quarantine rather than a loose bag: the format vocabulary is closed (every member names a real reader that exists in this workspace today), the object is closed (strict -- a smuggled third key fails rather than strips), and nothing about the xml string is checked beyond it being text.

describe('SourceFormatSchema', () => {
  it('accepts every format a workspace reader produces today', () => {
    for (const format of ['docx', 'pptx', 'xlsx', 'odt', 'ods', 'odp', 'odg', 'odm', 'odb', 'odf', 'markdown', 'pdf']) {
      expect(SourceFormatSchema.safeParse(format).success).toBe(true);
    }
  });

  it('rejects an unknown format -- the vocabulary is closed, not a free string', () => {
    expect(SourceFormatSchema.safeParse('ooxml').success).toBe(false);
    expect(SourceFormatSchema.safeParse('').success).toBe(false);
    expect(SourceFormatSchema.safeParse(7).success).toBe(false);
  });
});

describe('SourceResidueSchema', () => {
  it('validates a residue value as exactly { format, xml }', () => {
    expect(SourceResidueSchema.safeParse({ format: 'docx', xml: '<w:docPartObj/>' }).success).toBe(true);
  });

  it('is strict -- a third key fails parse rather than being stripped', () => {
    expect(SourceResidueSchema.safeParse({ format: 'docx', xml: '<w:x/>', semantics: true }).success).toBe(false);
  });

  it('requires both halves', () => {
    expect(SourceResidueSchema.safeParse({ format: 'docx' }).success).toBe(false);
    expect(SourceResidueSchema.safeParse({ xml: '<w:x/>' }).success).toBe(false);
  });

  it('treats the xml as opaque text -- any string validates, and only a string does', () => {
    expect(SourceResidueSchema.safeParse({ format: 'markdown', xml: '<div class="raw html">&amp;</div>' }).success).toBe(true);
    expect(SourceResidueSchema.safeParse({ format: 'markdown', xml: '' }).success).toBe(true);
    expect(SourceResidueSchema.safeParse({ format: 'pdf', xml: 42 }).success).toBe(false);
  });
});
