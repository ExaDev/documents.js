import { describe, expect, it } from 'vitest';
import { formatToExtension, inferFormatFromExtension, isDocumentFormat } from './format';

describe('isDocumentFormat', () => {
  it('accepts every recognised format string', () => {
    for (const format of ['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'odg', 'odf', 'pdf']) {
      expect(isDocumentFormat(format)).toBe(true);
    }
  });

  it('rejects an unrecognised format string', () => {
    expect(isDocumentFormat('odm')).toBe(false);
    expect(isDocumentFormat('odb')).toBe(false);
    expect(isDocumentFormat('')).toBe(false);
  });
});

describe('inferFormatFromExtension', () => {
  it('infers a format from a plain filename', () => {
    expect(inferFormatFromExtension('report.docx')).toBe('docx');
  });

  it('infers a format from a path with multiple directory segments', () => {
    expect(inferFormatFromExtension('a/b/report.pdf')).toBe('pdf');
  });

  it('is case-insensitive on the extension', () => {
    expect(inferFormatFromExtension('REPORT.DOCX')).toBe('docx');
  });

  it('returns undefined for the stdin/stdout marker', () => {
    expect(inferFormatFromExtension('-')).toBeUndefined();
  });

  it('returns undefined for a path with no extension', () => {
    expect(inferFormatFromExtension('README')).toBeUndefined();
  });

  it('returns undefined for a dotfile with no further extension', () => {
    expect(inferFormatFromExtension('.gitignore')).toBeUndefined();
  });

  it('returns undefined for an unrecognised extension', () => {
    expect(inferFormatFromExtension('archive.zip')).toBeUndefined();
  });

  it('returns undefined for the .odm and .odb extensions this module deliberately does not classify', () => {
    expect(inferFormatFromExtension('book.odm')).toBeUndefined();
    expect(inferFormatFromExtension('database.odb')).toBeUndefined();
  });
});

describe('formatToExtension', () => {
  it('round-trips every recognised format back to its own extension', () => {
    for (const format of ['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'odg', 'odf', 'pdf'] as const) {
      expect(formatToExtension(format)).toBe(format);
    }
  });
});
