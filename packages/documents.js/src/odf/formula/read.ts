import type { ContentDocument, ContentFormula } from "document-schema.js";
import type { Package } from "odf.js";
import { readOdfFormulaContent as readOdfFormulaFlat } from "odf.js";

// Reads a standalone .odf package's own formula content as a real 'formula'-kind ContentDocument -- a thin adapter over odf.js's own readOdfFormulaContent (that name since odf.js 5.0.0; before it it was the bare readOdfFormulaDocument, and 5.0.0 gives the bare readOdfFormula name to the tree-form DocumentTree counterpart), exactly the pattern this package's other src/odf/{odt,odp,ods,odg}/read.ts modules already follow (readOdtContent over odf.js's readOdtContent, readOdpContent over odf.js's readOdpContent, ...), and now genuinely the same SHAPE as them too rather than a side-channel value of its own: document-schema.js 2.0.0's ContentDocument union has a 'formula' variant carrying exactly `{ mathml, starMath }`, so a standalone formula document IS a ContentDocument, and odf.js already builds that envelope itself. The source document's own metadata comes through with it, the same way every other X-to-PDF conversion in this package carries its source metadata into writePdf's own Info dict. The import is aliased only because this module's own export is itself named readOdfFormulaContent.
export function readOdfFormulaContent(pkg: Package): ContentDocument {
  return readOdfFormulaFlat(pkg);
}

// Reads an embedded formula sub-object's own content directly out of the OUTER package's flat pkg.parts record. odf.js's own Package.parts is keyed by full zip path (e.g. "Object 1/content.xml"), so a sub-object's own parts already live right there under a "<subPackagePath>/" prefix -- no separate unzip/decode step is needed, just a synthetic Package whose own 'content.xml'/'meta.xml' point at the outer package's already-decoded parts for that prefix. Returns undefined when there is no content.xml at that path, or when odf.js's own reader throws (no MathML root found there) -- both mean "this draw:object reference isn't a formula (or isn't resolvable)", not a hard failure: draw:object also embeds spreadsheets, charts, and other OLE-style objects this package makes no attempt to detect here, and that "no math root" check is exactly the signal that distinguishes them. Returns the bare ContentFormula rather than the whole document envelope, dropping the sub-object's own metadata: a sub-object's own title/author is not meaningful at the embedding document's own level, and nothing ever reads it. The synthetic package deliberately carries content.xml alone for that same reason -- handing odf.js a meta.xml whose contents are discarded a line later would only widen what a malformed sub-object could throw on.
export function readOdfEmbeddedFormula(
  outerPkg: Package,
  subPackagePath: string,
): ContentFormula | undefined {
  const contentPart = outerPkg.parts[`${subPackagePath}/content.xml`];
  if (contentPart?.kind !== "xml") {
    return undefined;
  }
  const subPkg: Package = { parts: { "content.xml": contentPart } };
  try {
    const document = readOdfFormulaFlat(subPkg);
    // readOdfFormulaContent's declared return type is the full ContentDocument union even though it always produces the formula variant -- narrowed rather than asserted, matching every other readXContent guard in this package.
    return document.kind === "formula" ? document.formula : undefined;
  } catch {
    return undefined;
  }
}
