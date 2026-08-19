import type { ContentFormula } from 'document-schema.js';
import type { Package, XmlElement, XmlNode } from 'odf.js';
import { encodeXmlText } from '../xml/entities';
import { el, txt } from '../xml/fragment';
import { syncOdfManifest } from './manifest';

// Writes a real ODF embedded formula SUB-DOCUMENT into a package -- the write-side inverse of src/odf/formula/read.ts's readOdfEmbeddedFormula, and the piece that lets buildOdtPackage put an actual formula into an odt instead of a plain-text stand-in. An embedded ODF object is not a different markup vocabulary inside the host content.xml the way OOXML's own OMML is: it is a whole nested document, stored under its own directory prefix in the SAME zip ("Object 1/content.xml"), with its own manifest:file-entry, referenced from the host by a draw:frame/draw:object whose xlink:href names that directory. That is exactly the shape odf.js's own reader expects to find (readOdfEmbeddedFormula builds a synthetic Package from the outer package's parts under that prefix, then hands it to odf.js's readOdfFormulaContent), so this writes precisely it.
//
// This lives in src/odf-package/ alongside media.ts rather than in src/edit/odt/, for the same reason media.ts does: inserting a part and keeping the manifest in step is package-level mechanics, format-neutral over WHERE the referencing draw:frame ends up (an odt paragraph today; an odp slide or an odg page needs nothing new here). The draw:frame fragment itself is the caller's, mirroring how addImageMedia leaves the draw:frame/draw:image fragment to its own callers.

// LibreOffice's own naming convention for an embedded object directory, confirmed against the real-world "./Object 1" hrefs src/odf/formula/detect.ts's own subPackagePathFromHref already normalises on the read side.
const OBJECT_PREFIX = 'Object ';
const CONTENT_PART = 'content.xml';

// The math namespace, declared BOTH as the "math:" prefix and as the default namespace on the math:math element itself. Both matter: a formula's own MathML tree arrives here exactly as some reader produced it, which may be prefixed ("math:mfrac", what real LibreOffice writes) or bare ("mfrac", what src/omml/read.ts produces when recovering an OOXML equation), and only declaring both bindings puts either form in the MathML namespace where it belongs.
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const ODF_VERSION = '1.3';

// odf.js's readOdfFormulaMathMl recognises a StarMath annotation by an encoding attribute STARTING with "StarMath" (see its own findStarMathAnnotation); "StarMath 5.0" is the exact value LibreOffice itself writes.
const STARMATH_ENCODING = 'StarMath 5.0';

export interface AddedOdfFormula {
  // The sub-document's own directory name, e.g. "Object 1" -- what a draw:object's xlink:href references (as "./Object 1", the fragment-free form LibreOffice writes).
  readonly objectName: string;
  readonly href: string;
  readonly partPath: string;
}

// One past the highest "Object N" directory already present, so a second formula in the same document never collides with the first -- mirroring src/odf-package/media.ts's own nextPictureIndex exactly, including its tolerance of a gap left by an earlier object that is no longer there.
function nextObjectIndex(pkg: Package): number {
  const pattern = /^Object (\d+)\//;
  let max = 0;
  for (const path of Object.keys(pkg.parts)) {
    const match = pattern.exec(path);
    const digits = match?.[1];
    if (digits === undefined) {
      continue;
    }
    const index = Number.parseInt(digits, 10);
    if (index > max) {
      max = index;
    }
  }
  return max + 1;
}

// A formula's own MathML nodes are document-schema.js MathMlNode values, structurally identical to odf.js's XmlNode (see src/mathml/nodes.ts's own module comment on that correspondence) -- so they are written straight through as the sub-document's own content, with no translation and no re-serialisation. This is what makes the write side genuinely lossless: whatever tree readOdfFormulaContent produced comes back out byte-identical, and a tree src/omml/read.ts recovered from an OOXML equation is written exactly as recovered.
function buildFormulaContentXml(formula: ContentFormula): XmlElement {
  const mathChildren: XmlNode[] = [...formula.mathml];
  if (formula.starMath !== undefined) {
    mathChildren.push(el('math:annotation', { encoding: STARMATH_ENCODING }, [txt(encodeXmlText(formula.starMath))]));
  }
  return el('office:document-content', { 'xmlns:office': OFFICE_NS, 'xmlns:math': MATHML_NS, 'office:version': ODF_VERSION }, [
    el('office:body', {}, [el('office:math', {}, [el('math:math', { xmlns: MATHML_NS, 'xmlns:math': MATHML_NS }, mathChildren)])]),
  ]);
}

// Atomically inserts a formula sub-document part and re-syncs META-INF/manifest.xml so the new "Object N/" directory carries the real ODF formula media type rather than an empty one (see manifest.ts's syncOdfManifest). Returns the href a draw:object should reference it by.
export function addFormulaObject(pkg: Package, formula: ContentFormula): AddedOdfFormula {
  const objectName = `${OBJECT_PREFIX}${nextObjectIndex(pkg)}`;
  const partPath = `${objectName}/${CONTENT_PART}`;
  pkg.parts[partPath] = {
    kind: 'xml',
    nodes: [{ type: 'declaration', attributes: [{ name: 'version', value: '1.0' }, { name: 'encoding', value: 'UTF-8' }] }, buildFormulaContentXml(formula)],
  };
  syncOdfManifest(pkg);
  return { objectName, href: `./${objectName}`, partPath };
}
