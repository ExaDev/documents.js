import type { LayoutMetadata } from 'document-schema.js';
import type { Package } from 'odf.js';
import { readOdfFormula } from 'odf.js';
import type { EmbeddedFormula } from '../../model/formula';

export interface StandaloneFormulaContent extends EmbeddedFormula {
  readonly metadata: LayoutMetadata;
}

// Reads a standalone .odf package's own formula content directly -- the thin adapter over odf.js's own readOdfFormula this package's other src/odf/{odt,odp,ods,odg}/read.ts modules already establish the pattern for (readOdtContent over readOdt, readOdpContent over readOdp, ...). Unlike those, this one's own return shape does NOT feed convertWordprocessingToLayout or any other existing layout engine: a standalone formula has no ContentDocument-shaped structure of its own to build (see src/model/formula.ts's own comment on why ContentEmbeddedObject.document can't carry raw MathML) -- src/convert/convert.ts's odfToPdf lays this out directly via src/mathml's layoutFormula. Keeps `metadata` (unlike the embedded-sub-object case below, EmbeddedFormula's own shape): a standalone document's own title/author/etc. genuinely belongs on the PDF this produces, the same way every other X-to-PDF conversion in this package carries its source document's metadata through to writePdf's own Info dict.
export function readOdfFormulaContent(pkg: Package): StandaloneFormulaContent {
  const formula = readOdfFormula(pkg);
  return { mathml: formula.mathml, starMath: formula.starMath, metadata: formula.metadata };
}

// Reads an embedded formula sub-object's own content directly out of the OUTER package's flat pkg.parts record. odf.js's own Package.parts is keyed by full zip path (e.g. "Object 1/content.xml"), so a sub-object's own parts already live right there under a "<subPackagePath>/" prefix -- no separate unzip/decode step is needed, just a synthetic Package whose own 'content.xml'/'meta.xml' point at the outer package's already-decoded parts for that prefix. Returns undefined when there is no content.xml at that path, or when readOdfFormula itself throws (no MathML root found there) -- both mean "this draw:object reference isn't a formula (or isn't resolvable)", not a hard failure: draw:object also embeds spreadsheets, charts, and other OLE-style objects this package makes no attempt to detect here, and readOdfFormula's own "no math root" check is exactly the signal that distinguishes them. Drops the sub-object's own metadata (a sub-object's own title/author is not meaningful at the embedding document's own level -- unlike the standalone case above, nothing here ever reads it).
export function readOdfEmbeddedFormula(outerPkg: Package, subPackagePath: string): EmbeddedFormula | undefined {
  const contentPart = outerPkg.parts[`${subPackagePath}/content.xml`];
  if (contentPart?.kind !== 'xml') {
    return undefined;
  }
  const metaPart = outerPkg.parts[`${subPackagePath}/meta.xml`];
  const subPkg: Package = { parts: metaPart?.kind === 'xml' ? { 'content.xml': contentPart, 'meta.xml': metaPart } : { 'content.xml': contentPart } };
  try {
    const formula = readOdfFormula(subPkg);
    return { mathml: formula.mathml, starMath: formula.starMath };
  } catch {
    return undefined;
  }
}
