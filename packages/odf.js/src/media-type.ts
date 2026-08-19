// MIME media types for every OpenDocument file extension, per the OASIS ODF specification's own media-type table and the IANA media types registry (application/vnd.oasis.opendocument.*). Cross-checked against real "mimetype" parts extracted from LibreOffice's own bundled template packages, and against IANA's registry pages directly, not pattern-matched from the extension names -- in particular .odb, which is "application/vnd.oasis.opendocument.base" (NOT "...database": IANA's registry lists "application/vnd.oasis.opendocument.database" as a deprecated alias for this type), and has no template variant.
export const ODF_MEDIA_TYPES = Object.freeze({
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
}) satisfies Readonly<Record<string, string>>;

export type OdfExtension = keyof typeof ODF_MEDIA_TYPES;

function isOdfExtension(extension: string): extension is OdfExtension {
  return Object.hasOwn(ODF_MEDIA_TYPES, extension);
}

// Resolves a part's file extension (no leading dot, case-insensitive) to its ODF media type, or undefined if the extension is not a recognised ODF extension.
export function mediaTypeForExtension(extension: string): string | undefined {
  const lower = extension.toLowerCase();
  return isOdfExtension(lower) ? ODF_MEDIA_TYPES[lower] : undefined;
}
