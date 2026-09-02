import { decodePackage as decodeOdfPackage } from "odf.js";
import { decodePackage as decodeOoxmlPackage } from "ooxml.js";
import type { ProvidedFont } from "document-schema.js";
import type { FontSourcePackage } from "../fonts/registry";
import { extractSourceFonts } from "../fonts/registry";
import type { DocumentFormat } from "./port";

// Lives beside convert.ts's own DocumentFormat-dispatching functions (buildDocumentBytes, odbReportToPdf, ...) rather than in src/fonts/registry.ts alongside extractSourceFonts/FontSourcePackage: this package's own dependency-direction convention (see the README's Architecture section) states that `fonts` imports no local module at all, so it can sit beside `layout` rather than under it -- importing DocumentFormat from src/convert/port.ts here would break that invariant for no real gain, since `convert` already legitimately depends on `fonts` in the other direction.

// The subset of DocumentFormat that can declare a source-embedded font face at all: docx/pptx via OOXML's own fontTable.xml/embeddedFontLst, odt/odp/ods/odg via ODF's own office:font-face-decls. xlsx has no OOXML font-embedding vocabulary of its own; pdf/markdown/csv/svg/epub carry no source-package concept to embed a font declaration in (svg and epub are both real zip/text formats, but neither's own grammar has a font-declaration construct -- epub-codec has no font-embedding concept at all, unlike OOXML/ODF); a standalone .odf formula document embeds only the STIX Two Math font pdf-codec itself carries, never a caller-resolvable face; .odb has no font concept at all (and is not a DocumentFormat member regardless).
const FONT_SOURCE_FORMATS: Readonly<
  Record<"docx" | "pptx" | "odt" | "odp" | "ods" | "odg", true>
> = {
  docx: true,
  pptx: true,
  odt: true,
  odp: true,
  ods: true,
  odg: true,
};

function isFontSourceFormat(
  format: DocumentFormat,
): format is keyof typeof FONT_SOURCE_FORMATS {
  return format in FONT_SOURCE_FORMATS;
}

// A recognised DocumentFormat that nonetheless has no source-embedded-font concept at all (xlsx, pdf, markdown, csv, svg, odf) -- a named class, matching this package's own convention for every other "recognised but unsupported" input across the .odb/odm surface (OdbTableNotSpecifiedError, OdbUnsupportedFormatError, ...), so a caller can narrow on it with instanceof rather than string-matching a thrown Error's own message.
export class UnsupportedFontSourceFormatError extends Error {
  readonly format: DocumentFormat;

  constructor(format: DocumentFormat) {
    super(
      `'${format}' documents carry no source-embedded font faces to extract -- expected one of docx, pptx, odt, odp, ods, odg`,
    );
    this.name = "UnsupportedFontSourceFormatError";
    this.format = format;
  }
}

// Dispatches raw document bytes to extractSourceFonts (src/fonts/registry.ts) by DocumentFormat, so a caller holding a format + bytes -- rather than an already-decoded Package -- does not have to know which codec (ooxml.js's decodePackage or odf.js's) or which FontSourcePackage discriminant applies. docx/pptx decode via ooxml.js's own decodePackage; odt/odp/ods/odg via odf.js's, aliased to keep the two apart at this one call site that needs both, matching createDocumentFontRegistry's own callers elsewhere in this package (e.g. src/convert/convert.ts's docxToPdf/odtToPdf).
export function extractSourceFontsForFormat(
  format: DocumentFormat,
  bytes: Uint8Array<ArrayBuffer>,
): readonly ProvidedFont[] {
  if (!isFontSourceFormat(format)) {
    throw new UnsupportedFontSourceFormatError(format);
  }
  const source: FontSourcePackage =
    format === "docx" || format === "pptx"
      ? { kind: format, package: decodeOoxmlPackage(bytes) }
      : { kind: "odf", package: decodeOdfPackage(bytes) };
  return extractSourceFonts(source);
}
