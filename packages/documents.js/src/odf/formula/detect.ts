import type { Package, XmlElement, XmlNode } from 'odf.js';
import { attrValue, childrenWithTag, readDrawFrame } from 'odf.js';
import type { ContentFormula } from 'document-schema.js';
import type { Box } from '../../model/geometry';
import { readOdfEmbeddedFormula } from './read';

export interface DetectedFormulaFrame {
  readonly frameElement: XmlElement;
  readonly formula: ContentFormula;
  readonly frame: Box;
}

// A draw:object's own xlink:href, pointing at an embedded sub-object, is written by real ODF producers as a package-relative path into the SAME container -- either "./ObjectN" or, per the ODF 1.2 schema's own XLink profile for an internal same-document reference, "#./ObjectN" (a fragment-prefixed form). Both strip down to the same bare "ObjectN" directory name, which is exactly the prefix odf.js's own Package.parts keys embedded-object parts under (e.g. "Object 1/content.xml").
function subPackagePathFromHref(href: string): string {
  return href.replace(/^#?\.\//, '');
}

// Scans `containerChildren` (e.g. office:text's own children for an odt body, or draw:page's own children for an odp slide) for a top-level draw:frame whose sole content is a draw:object referencing an embedded formula sub-package -- resolving each one's own geometry (via odf.js's own exported readDrawFrame, the identical function walkDrawShapes itself uses, so this module never reimplements resolveOdfShapeGeometry/composeOdfGroupTransform) and formula content (via readOdfEmbeddedFormula). Returns them in document order. A draw:frame whose own draw:object doesn't resolve to a formula (any other embedded-object kind draw:object also covers -- a spreadsheet, a chart, ...), or whose own geometry can't be resolved, is silently omitted -- not every draw:frame is a formula, and this function's only job is finding the ones that are.
export function detectEmbeddedFormulaFrames(containerChildren: readonly XmlNode[], pkg: Package): readonly DetectedFormulaFrame[] {
  const out: DetectedFormulaFrame[] = [];
  for (const child of containerChildren) {
    if (child.type !== 'element' || child.tag !== 'draw:frame') {
      continue;
    }
    const objectElement = childrenWithTag(child, 'draw:object')[0];
    if (objectElement === undefined) {
      continue;
    }
    const href = attrValue(objectElement, 'xlink:href');
    if (href === undefined) {
      continue;
    }
    const formula = readOdfEmbeddedFormula(pkg, subPackagePathFromHref(href));
    if (formula === undefined) {
      continue;
    }
    const shape = readDrawFrame(child, [], pkg);
    if (shape === undefined) {
      continue;
    }
    out.push({ frameElement: child, formula, frame: shape.frame });
  }
  return out;
}
