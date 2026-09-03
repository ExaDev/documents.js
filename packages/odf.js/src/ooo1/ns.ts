import type { Package } from "../model/package";
import { rootElement } from "../xml/query";

// The OpenOffice.org 1.x / StarOffice 6-7 XML vocabulary's own namespace URIs, keyed by the same conventional prefix ODF later kept. This is the pre-OASIS ancestor of ODF: OASIS based ODF 1.0 directly on "OpenOffice.org XML File Format 1.0", so the two vocabularies share most of their element and attribute names but none of their namespace URIs for anything OpenOffice.org itself minted.
//
// Every URI below was read out of a genuine OpenOffice.org 1.x document's own root-element xmlns declarations -- .sxw files written by OpenOffice.org 1.1/1.9, a .sxc, a .sxi written by OpenOffice.org 1.1.0, and a .sxd -- and cross-checked against LibreOffice's own OOo-namespace token table (xmloff/source/core/xmltoken.cxx, the XML_N_*_OOO entries) and the namespace map its OOo-to-OASIS transformer registers (xmloff/source/transform/OOo2Oasis.cxx). Two traps, both of which a plain reading of the prefix names would get wrong:
// - `presentation:` is ".../2000/presentation", NOT ".../2001/presentation" -- OpenOffice.org's own retained DTD (xmloff/dtd/nmspace.mod) declares the 2001 form, but no real document uses it and LibreOffice's namespace table does not contain it at all. `config:` and `manifest:` genuinely are the 2001 ones.
// - `fo:` and `svg:` are the REAL W3C XSL-FO and SVG namespaces here. It is ODF, not OpenOffice.org XML, that mints its own "xsl-fo-compatible"/"svg-compatible" URIs -- so these two are the pair most likely to be assumed identical between the formats when they are not (see ../ns.ts's own note on the OASIS side of the same pair).
export const OOO1_NAMESPACES = Object.freeze({
  office: "http://openoffice.org/2000/office",
  style: "http://openoffice.org/2000/style",
  text: "http://openoffice.org/2000/text",
  table: "http://openoffice.org/2000/table",
  // TRAP, exactly as on the OASIS side: the drawing namespace is ".../drawing", not ".../draw".
  draw: "http://openoffice.org/2000/drawing",
  meta: "http://openoffice.org/2000/meta",
  // TRAP, exactly as on the OASIS side: number/date/time format elements live under ".../datastyle", not ".../number".
  number: "http://openoffice.org/2000/datastyle",
  chart: "http://openoffice.org/2000/chart",
  dr3d: "http://openoffice.org/2000/dr3d",
  form: "http://openoffice.org/2000/form",
  script: "http://openoffice.org/2000/script",
  presentation: "http://openoffice.org/2000/presentation",
  config: "http://openoffice.org/2001/config",
  manifest: "http://openoffice.org/2001/manifest",
  // The real W3C XSL-FO and SVG namespaces, not ODF's own "-compatible" mintings.
  fo: "http://www.w3.org/1999/XSL/Format",
  svg: "http://www.w3.org/2000/svg",
  // Reused as-is by both formats.
  xlink: "http://www.w3.org/1999/xlink",
  dc: "http://purl.org/dc/elements/1.1/",
  math: "http://www.w3.org/1998/Math/MathML",
}) satisfies Readonly<Record<string, string>>;

export type Ooo1NamespacePrefix = keyof typeof OOO1_NAMESPACES;

// Whether a prefix names a namespace this vocabulary has at all -- e.g. "smil"/"anim"/"xforms"/"db"/"rpt", ODF namespaces with no OpenOffice.org 1.x predecessor, are not. Used by the writer direction (../transform.ts's transformToOoo1Package) to decide whether a declared ODF namespace has an OpenOffice.org 1.x URI to rewrite to, or must be left exactly as it is -- the reverse of isOdfNamespacePrefix's own role in the read direction.
export function isOoo1NamespacePrefix(
  prefix: string,
): prefix is Ooo1NamespacePrefix {
  return Object.hasOwn(OOO1_NAMESPACES, prefix);
}

// The subset of the table above that OpenOffice.org itself minted -- i.e. the URIs whose mere presence identifies a document as OpenOffice.org 1.x rather than ODF. The W3C/Dublin Core entries are deliberately excluded: an ODF document declares xlink:/dc:/math: identically, so seeing one proves nothing.
const OOO1_ONLY_NAMESPACE_URIS: ReadonlySet<string> = new Set(
  Object.values(OOO1_NAMESPACES).filter((uri) =>
    uri.startsWith("http://openoffice.org/"),
  ),
);

// MIME media types for every OpenOffice.org 1.x / StarOffice 6-7 file extension, verified against LibreOffice's own filter registry (the MediaType/Extensions properties of its writer_StarOffice_XML_Writer, calc_StarOffice_XML_Calc, impress_StarOffice_XML_Impress, draw_StarOffice_XML_Draw and template/global siblings) and against a real .sxw's and .sxi's own META-INF/manifest.xml root entry. Unlike ODF, an OpenOffice.org 1.x package carries NO "mimetype" part at all -- the manifest's "/" entry is the only place the document's own type is recorded.
export const OOO1_MEDIA_TYPES = Object.freeze({
  sxw: "application/vnd.sun.xml.writer",
  stw: "application/vnd.sun.xml.writer.template",
  sxg: "application/vnd.sun.xml.writer.global",
  sxc: "application/vnd.sun.xml.calc",
  stc: "application/vnd.sun.xml.calc.template",
  sxi: "application/vnd.sun.xml.impress",
  sti: "application/vnd.sun.xml.impress.template",
  sxd: "application/vnd.sun.xml.draw",
  std: "application/vnd.sun.xml.draw.template",
  sxm: "application/vnd.sun.xml.math",
}) satisfies Readonly<Record<string, string>>;

export type Ooo1Extension = keyof typeof OOO1_MEDIA_TYPES;

function isOoo1Extension(extension: string): extension is Ooo1Extension {
  return Object.hasOwn(OOO1_MEDIA_TYPES, extension);
}

// Resolves a file extension (no leading dot, case-insensitive) to its OpenOffice.org 1.x media type, or undefined if the extension is not one of them.
export function ooo1MediaTypeForExtension(
  extension: string,
): string | undefined {
  const lower = extension.toLowerCase();
  return isOoo1Extension(lower) ? OOO1_MEDIA_TYPES[lower] : undefined;
}

// Each OpenOffice.org 1.x media type and the OASIS media type its format became. Kept as an explicit table rather than derived by string surgery on the type names: the mapping is not mechanical (writer -> text, calc -> spreadsheet, impress -> presentation, draw -> GRAPHICS, writer.global -> text-master), and .sxm's successor is "formula", not "math".
const ODF_MEDIA_TYPE_BY_OOO1_MEDIA_TYPE: ReadonlyMap<string, string> = new Map([
  [OOO1_MEDIA_TYPES.sxw, "application/vnd.oasis.opendocument.text"],
  [OOO1_MEDIA_TYPES.stw, "application/vnd.oasis.opendocument.text-template"],
  [OOO1_MEDIA_TYPES.sxg, "application/vnd.oasis.opendocument.text-master"],
  [OOO1_MEDIA_TYPES.sxc, "application/vnd.oasis.opendocument.spreadsheet"],
  [
    OOO1_MEDIA_TYPES.stc,
    "application/vnd.oasis.opendocument.spreadsheet-template",
  ],
  [OOO1_MEDIA_TYPES.sxi, "application/vnd.oasis.opendocument.presentation"],
  [
    OOO1_MEDIA_TYPES.sti,
    "application/vnd.oasis.opendocument.presentation-template",
  ],
  [OOO1_MEDIA_TYPES.sxd, "application/vnd.oasis.opendocument.graphics"],
  [
    OOO1_MEDIA_TYPES.std,
    "application/vnd.oasis.opendocument.graphics-template",
  ],
  [OOO1_MEDIA_TYPES.sxm, "application/vnd.oasis.opendocument.formula"],
]);

// The OASIS media type an OpenOffice.org 1.x media type became, or undefined for anything that is not one (including a media type that is already OASIS).
export function odfMediaTypeForOoo1MediaType(
  mediaType: string,
): string | undefined {
  return ODF_MEDIA_TYPE_BY_OOO1_MEDIA_TYPE.get(mediaType);
}

// The reverse lookup, built once from the same table rather than duplicated: the OpenOffice.org 1.x media type an OASIS ODF media type came from, or undefined for an ODF media type this format family never had (.odb, for instance, postdates OpenOffice.org 1.x entirely and has no OOo1 predecessor at all). Every entry in ODF_MEDIA_TYPE_BY_OOO1_MEDIA_TYPE has a distinct value, so this inversion is unambiguous.
const OOO1_MEDIA_TYPE_BY_ODF_MEDIA_TYPE: ReadonlyMap<string, string> = new Map(
  [...ODF_MEDIA_TYPE_BY_OOO1_MEDIA_TYPE.entries()].map(
    ([ooo1MediaType, odfMediaType]) => [odfMediaType, ooo1MediaType] as const,
  ),
);

// The OpenOffice.org 1.x media type an OASIS ODF media type became a successor to, or undefined when the ODF media type has no OpenOffice.org 1.x predecessor in this table (a format ODF introduced after OpenOffice.org 1.x, or a media type this format family never covered at all). Used by the OOo1x writer (../write.ts) to pick a package's own OOo1 media type from the ODF media type the ODF writer it wraps (writeOdt and its future ods/odp/odg siblings) already stamped.
export function ooo1MediaTypeForOdfMediaType(
  mediaType: string,
): string | undefined {
  return OOO1_MEDIA_TYPE_BY_ODF_MEDIA_TYPE.get(mediaType);
}

// Whether a package is an OpenOffice.org 1.x one rather than an ODF one, decided by the namespace URIs its own parts declare -- never by a file extension or a manifest media type, both of which a caller may not have and a renamed file will lie about. Any XML part whose root element declares an xmlns binding to one of the openoffice.org-minted URIs is proof: ODF declares none of them, and OpenOffice.org 1.x declares several on every part's root (content.xml, styles.xml, meta.xml, settings.xml and META-INF/manifest.xml all carry their own).
export function isOoo1Package(pkg: Package): boolean {
  for (const part of Object.values(pkg.parts)) {
    if (part.kind !== "xml") {
      continue;
    }
    const root = rootElement(part.nodes);
    if (root === undefined) {
      continue;
    }
    for (const attribute of root.attributes) {
      if (
        (attribute.name === "xmlns" || attribute.name.startsWith("xmlns:")) &&
        OOO1_ONLY_NAMESPACE_URIS.has(attribute.value)
      ) {
        return true;
      }
    }
  }
  return false;
}
