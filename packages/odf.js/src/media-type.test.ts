import { describe, expect, it } from 'vitest';
import { ODF_MEDIA_TYPES, mediaTypeForExtension } from './media-type';

// Verified against the OASIS ODF specification's own media-type table, LibreOffice's own real "mimetype" part output, and IANA's media types registry (see media-type.ts's top-of-file comment).
describe('ODF_MEDIA_TYPES', () => {
  it('maps every one of the 13 ODF extensions to its exact registered media type', () => {
    expect(ODF_MEDIA_TYPES).toEqual({
      odt: 'application/vnd.oasis.opendocument.text',
      ott: 'application/vnd.oasis.opendocument.text-template',
      ods: 'application/vnd.oasis.opendocument.spreadsheet',
      ots: 'application/vnd.oasis.opendocument.spreadsheet-template',
      odp: 'application/vnd.oasis.opendocument.presentation',
      otp: 'application/vnd.oasis.opendocument.presentation-template',
      odg: 'application/vnd.oasis.opendocument.graphics',
      otg: 'application/vnd.oasis.opendocument.graphics-template',
      odf: 'application/vnd.oasis.opendocument.formula',
      otf: 'application/vnd.oasis.opendocument.formula-template',
      odm: 'application/vnd.oasis.opendocument.text-master',
      otm: 'application/vnd.oasis.opendocument.text-master-template',
      odb: 'application/vnd.oasis.opendocument.base',
    });
  });

  it('.odb is "base", not the deprecated "database" alias, and has no template variant', () => {
    expect(ODF_MEDIA_TYPES.odb).toBe('application/vnd.oasis.opendocument.base');
    expect(Object.keys(ODF_MEDIA_TYPES)).not.toContain('otb');
    expect(Object.values(ODF_MEDIA_TYPES)).not.toContain('application/vnd.oasis.opendocument.database');
  });
});

describe('mediaTypeForExtension', () => {
  it('resolves a known extension', () => {
    expect(mediaTypeForExtension('odt')).toBe('application/vnd.oasis.opendocument.text');
  });

  it('is case-insensitive', () => {
    expect(mediaTypeForExtension('ODT')).toBe('application/vnd.oasis.opendocument.text');
    expect(mediaTypeForExtension('Ods')).toBe('application/vnd.oasis.opendocument.spreadsheet');
  });

  it('returns undefined for an extension outside the ODF family (e.g. a media file extension)', () => {
    expect(mediaTypeForExtension('png')).toBeUndefined();
    expect(mediaTypeForExtension('xml')).toBeUndefined();
    expect(mediaTypeForExtension('')).toBeUndefined();
  });
});
