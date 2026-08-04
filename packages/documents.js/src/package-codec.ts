import type { Package } from 'ooxml.js';
import { decodePackage as decodeOdfPackage, encodePackage as encodeOdfPackage } from 'odf.js';
import { decodePackage as decodeOoxmlPackage, encodePackage as encodeOoxmlPackage } from 'ooxml.js';
import type { DocumentFormat } from './convert/port';

// The DocumentFormat members backed by a real OPC (zip + XML parts) container -- docx/pptx/xlsx all decode/encode through ooxml.js's own decodePackage/encodePackage, which is generic OPC handling with no xlsx-specific knowledge, so it works for xlsx bytes exactly as it does for docx/pptx (verified directly: a real xlsx produced by odsToXlsx round-trips through decodePackage/encodePackage with every part intact). This is a lower-level capability than the ContentDocument-level xlsx support this package deliberately omits (see the README's Architecture section on why there is no readXlsxContent/buildXlsxPackage re-export) -- raw package decode/encode has nothing to do with understanding xlsx's own content model.
const OOXML_PACKAGE_FORMATS: Readonly<Record<'docx' | 'pptx' | 'xlsx', true>> = {
  docx: true,
  pptx: true,
  xlsx: true,
};

// The DocumentFormat members backed by a real ODF (zip + XML parts) container -- odt/odp/ods/odg, plus odf (a standalone formula document, itself an ordinary ODF package) -- all decode/encode through odf.js's own decodePackage/encodePackage.
const ODF_PACKAGE_FORMATS: Readonly<Record<'odt' | 'odp' | 'ods' | 'odg' | 'odf', true>> = {
  odt: true,
  odp: true,
  ods: true,
  odg: true,
  odf: true,
};

function isOoxmlPackageFormat(format: DocumentFormat): format is keyof typeof OOXML_PACKAGE_FORMATS {
  return format in OOXML_PACKAGE_FORMATS;
}

function isOdfPackageFormat(format: DocumentFormat): format is keyof typeof ODF_PACKAGE_FORMATS {
  return format in ODF_PACKAGE_FORMATS;
}

// A recognised DocumentFormat that nonetheless has no raw-package concept at all (markdown is plain text, not a zip container; pdf is its own binary format, not OPC/ODF) -- a named class, matching this package's own convention for every other "recognised but unsupported" input (UnsupportedFontSourceFormatError, OdbUnsupportedFormatError, ...), so a caller can narrow on it with instanceof rather than string-matching a thrown Error's own message.
export class UnsupportedPackageFormatError extends Error {
  readonly format: DocumentFormat;

  constructor(format: DocumentFormat) {
    super(`'${format}' documents carry no raw package concept to decode/encode -- expected one of docx, pptx, xlsx, odt, odp, ods, odg, odf`);
    this.name = 'UnsupportedPackageFormatError';
    this.format = format;
  }
}

// Decodes a DocumentFormat's own raw bytes into its underlying Package (parts records -- the ooxml.js/odf.js container both packages independently define, confirmed structurally interchangeable by src/interop.test.ts, so one Package type genuinely covers both branches here). docx/pptx/xlsx decode through ooxml.js's own OPC decoder; odt/odp/ods/odg/odf through odf.js's. markdown and pdf have no raw-package concept at all and throw UnsupportedPackageFormatError.
export function decodeDocumentPackage(format: DocumentFormat, bytes: Uint8Array<ArrayBuffer>): Package {
  if (isOoxmlPackageFormat(format)) {
    return decodeOoxmlPackage(bytes);
  }
  if (isOdfPackageFormat(format)) {
    return decodeOdfPackage(bytes);
  }
  throw new UnsupportedPackageFormatError(format);
}

// The reverse of decodeDocumentPackage: encodes an already-decoded Package back into a DocumentFormat's own raw bytes, dispatched by the identical format classification.
export function encodeDocumentPackage(format: DocumentFormat, pkg: Package): Uint8Array<ArrayBuffer> {
  if (isOoxmlPackageFormat(format)) {
    return encodeOoxmlPackage(pkg);
  }
  if (isOdfPackageFormat(format)) {
    return encodeOdfPackage(pkg);
  }
  throw new UnsupportedPackageFormatError(format);
}
