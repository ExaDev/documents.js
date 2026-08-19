import type { Package } from 'ooxml.js';
import { decodePackage as decodeOdfPackage, encodePackage as encodeOdfPackage } from 'odf.js';
import { decodePackage as decodeOoxmlPackage, encodePackage as encodeOoxmlPackage } from 'ooxml.js';
import type { DocumentFormat } from './convert/port';

// The DocumentFormat members backed by a real OPC (zip + XML parts) container -- docx/pptx/xlsx all decode/encode through ooxml.js's own decodePackage/encodePackage, which is generic OPC handling with no xlsx-specific knowledge, so it works for xlsx bytes exactly as it does for docx/pptx (verified directly: a real xlsx produced by odsToXlsx round-trips through decodePackage/encodePackage with every part intact). This is a lower-level capability than the ContentDocument-level xlsx support this package re-exports at the src/index.ts boundary (readXlsxContent plus the flat builder under this package's own buildXlsxPackage name) -- raw package decode/encode has nothing to do with understanding xlsx's own content model.
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

// A recognised DocumentFormat that nonetheless has no raw-package concept at all (markdown, csv, and svg are plain text, not zip containers; pdf is its own binary format, not OPC/ODF) -- a named class, matching this package's own convention for every other "recognised but unsupported" input (UnsupportedFontSourceFormatError, OdbUnsupportedFormatError, ...), so a caller can narrow on it with instanceof rather than string-matching a thrown Error's own message.
export class UnsupportedPackageFormatError extends Error {
  readonly format: DocumentFormat;

  constructor(format: DocumentFormat) {
    super(`'${format}' documents carry no raw package concept to decode/encode -- expected one of docx, pptx, xlsx, odt, odp, ods, odg, odf`);
    this.name = 'UnsupportedPackageFormatError';
    this.format = format;
  }
}

// Decodes a DocumentFormat's own raw bytes into its underlying Package (parts records -- the ooxml.js/odf.js container both packages independently define, confirmed structurally interchangeable by src/interop.test.ts, so one Package type genuinely covers both branches here). docx/pptx/xlsx decode through ooxml.js's own OPC decoder; odt/odp/ods/odg/odf through odf.js's. markdown, csv, svg, and pdf have no raw-package concept at all and throw UnsupportedPackageFormatError.
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

// .odb (an ODF database front-end) is, at the raw-zip-container level, an ordinary ODF package -- decoded by the identical odf.js decodePackage function every odt/odp/ods/odg/odf branch above already calls. It is deliberately NOT folded into decodeDocumentPackage's own DocumentFormat-keyed dispatch, because 'odb' is not, and cannot be, a DocumentFormat member: DocumentFormatSchema (src/convert/port.ts) excludes it on purpose, since a database front end has no single natural conversion target (its tables, its saved queries, and its reports are three unrelated output shapes -- see the README's own .odb Architecture/Gotchas entries). That exclusion is a statement about .odb as a CONVERSION target, though, not about whether its bytes are a real ODF zip -- they are, and every readOdb*/odbTo* function in src/odb/ already takes a decoded Package as its own starting point (readOdbTables, readOdbInventory, readOdbForms, readOdbReports, readOdbReportContent). decodeOdbPackage exists so a caller reaching for "give me a Package from these .odb bytes" has an honestly-named entry point instead of either reaching for odf.js's decodePackage directly (bypassing this package's own package-codec surface) or misreading decodeDocumentPackage('odb', bytes) as something that would type-check (it wouldn't -- 'odb' is not a DocumentFormat).
//
// There is no encodeOdbPackage counterpart: nothing in this package's .odb support ever writes a NEW .odb file. Every .odb function (readOdbTables, odbToXlsx, odbToCsv, readOdbForms, readOdbReports, readOdbReportContent) reads an existing .odb's own embedded data and either returns it as structured data or converts it into a different format entirely (xlsx, CSV, a rendered ContentDocument) -- none of them round-trip back into .odb bytes, so there is no encode direction to provide.
export function decodeOdbPackage(bytes: Uint8Array<ArrayBuffer>): Package {
  return decodeOdfPackage(bytes);
}
