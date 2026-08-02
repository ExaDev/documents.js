// OASIS OpenDocument Format (ODF) XML namespace URIs, keyed by their conventional prefix.
//
// Every ODF namespace URI is pinned at ":1.0" (or a fixed, version-independent suffix -- see the "-compatible" entries below) regardless of the document's actual ODF version. The format version travels via a separate `office:version`/`manifest:version` attribute on individual elements, never via the namespace URI itself -- an ODF 1.0, 1.2, and 1.3 document all use the exact same `office:` namespace URI.
//
// Every value below was verified directly against real manifest.xml/content.xml/styles.xml/ settings.xml/meta.xml parts extracted from LibreOffice's own bundled template packages (/Applications/LibreOffice.app/Contents/Resources/template/**) and cross-checked against the OASIS ODF specification text -- not pattern-matched from the prefix names. Three of these are easy to get wrong by guessing:
export const ODF_NAMESPACES = Object.freeze({
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  // TRAP: the drawing namespace is "...drawing:1.0", NOT "...draw:1.0" -- pattern-matching the "draw:" prefix itself onto the URI gives the wrong string.
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  // TRAP: OASIS mints its own "xsl-fo-compatible" URI for `fo:` rather than reusing the real W3C XSL-FO namespace a reader might expect.
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  // TRAP: same pattern as `fo:` -- OASIS's own "svg-compatible" URI, not the real W3C SVG namespace.
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  // Real W3C namespace, reused as-is -- unlike fo:/svg:/smil:, ODF does not mint its own xlink-compatible URI.
  xlink: 'http://www.w3.org/1999/xlink',
  // Real W3C Dublin Core namespace, reused as-is.
  dc: 'http://purl.org/dc/elements/1.1/',
  meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
  // TRAP: number/date/time format elements live under "...datastyle:1.0", NOT "...number:1.0" -- again, do not pattern-match the prefix onto the URI.
  number: 'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0',
  chart: 'urn:oasis:names:tc:opendocument:xmlns:chart:1.0',
  dr3d: 'urn:oasis:names:tc:opendocument:xmlns:dr3d:1.0',
  // Real W3C MathML namespace, reused as-is.
  math: 'http://www.w3.org/1998/Math/MathML',
  form: 'urn:oasis:names:tc:opendocument:xmlns:form:1.0',
  script: 'urn:oasis:names:tc:opendocument:xmlns:script:1.0',
  config: 'urn:oasis:names:tc:opendocument:xmlns:config:1.0',
  presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  // TRAP: same "-compatible" pattern as `fo:`/`svg:` -- OASIS's own URI, not the real W3C SMIL namespace.
  smil: 'urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0',
  anim: 'urn:oasis:names:tc:opendocument:xmlns:animation:1.0',
  // Real W3C namespaces, reused as-is.
  xforms: 'http://www.w3.org/2002/xforms',
  xsd: 'http://www.w3.org/2001/XMLSchema',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  // Confirmed against the real OASIS ODF 1.3 RelaxNG schema (docs.oasis-open.org/office/OpenDocument/v1.3/csprd02/schemas/OpenDocument-schema-v1.3.rng), not pattern-matched -- follows the same "...:<name>:1.0" convention as chart:/form:/presentation:, unlike the fo:/svg:/smil: "-compatible" traps above.
  db: 'urn:oasis:names:tc:opendocument:xmlns:database:1.0',
  // TRAP: this is NOT an OASIS-minted "urn:oasis:names:tc:opendocument:xmlns:report:1.0"-shaped URI like every db:/chart:/form: entry above -- rpt: (OpenOffice.org Report Builder, the Pentaho-derived report-definition vocabulary LibreOffice still bundles as its embedded report designer) predates its own OASIS standardisation and keeps its original openoffice.org-hosted namespace unchanged. Confirmed directly from the real Java class-file constant pool strings inside LibreOffice's own bundled `reportbuilder.jar` (`/Applications/LibreOffice.app/Contents/Resources/java/reportbuilder.jar`), not pattern-matched or guessed from the prefix name.
  rpt: 'http://openoffice.org/2005/report',
}) satisfies Readonly<Record<string, string>>;

export type OdfNamespacePrefix = keyof typeof ODF_NAMESPACES;

// Builds the `xmlns:<prefix>="<uri>"` attribute set for a root element that declares the given prefixes, in the order given -- e.g. `xmlnsAttributes(['office', 'text'])` for a minimal content.xml root. Used both by manifest.ts (which declares only `manifest:`) and by any caller hand-constructing a content.xml/styles.xml/meta.xml/settings.xml root.
export function xmlnsAttributes(prefixes: readonly OdfNamespacePrefix[]): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const prefix of prefixes) {
    attrs[`xmlns:${prefix}`] = ODF_NAMESPACES[prefix];
  }
  return attrs;
}
