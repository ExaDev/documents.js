import type { Box, ContentPathPoint, Margins, PageSize } from 'document-schema.js';
import type { XmlElement } from '../../model/node';
import { attrValue } from '../../xml/query';
import { parseOdfLength } from './units';

// ODF-specific geometry PARSING: turning the unit-suffixed length strings two different kinds of real ODF elements carry into document-schema.js's own PageSize/Margins/Box shapes (never redeclared locally -- see color.ts's own note on this package's established rule). Both element shapes below were confirmed against real LibreOffice 26.2 output: a page-layout's own fo:page-width/height + fo:margin-* (style:page-layout-properties, a child of style:page-layout in styles.xml's office:automatic-styles, referenced by a style:master-page's style:page-layout-name) and a positioned drawing element's own svg:x/y/width/height (a draw:frame/draw:custom-shape/etc.'s direct attributes, e.g. a Writer image or text frame) -- see this module's own test suite for the exact fixtures.

// Parses a style:page-layout-properties element's fo:page-width/fo:page-height into a PageSize (points). Real LibreOffice output always sets both together; either being absent or unparseable is treated as "no page size to report" (undefined) rather than a partial PageSize with one dimension silently defaulted to zero, which would be actively wrong rather than merely incomplete.
export function parsePageSize(pageLayoutProperties: XmlElement): PageSize | undefined {
  const widthValue = attrValue(pageLayoutProperties, 'fo:page-width');
  const heightValue = attrValue(pageLayoutProperties, 'fo:page-height');
  if (widthValue === undefined || heightValue === undefined) {
    return undefined;
  }
  const widthPt = parseOdfLength(widthValue);
  const heightPt = parseOdfLength(heightValue);
  if (widthPt === undefined || heightPt === undefined) {
    return undefined;
  }
  return { widthPt, heightPt };
}

// Parses a style:page-layout-properties element's fo:margin-top/right/bottom/left into a Margins (points). All four are required together for the same reason parsePageSize requires both its dimensions together -- a Margins with one side silently defaulted to zero would misrepresent the page, not merely omit information.
export function parseMargins(pageLayoutProperties: XmlElement): Margins | undefined {
  const topValue = attrValue(pageLayoutProperties, 'fo:margin-top');
  const rightValue = attrValue(pageLayoutProperties, 'fo:margin-right');
  const bottomValue = attrValue(pageLayoutProperties, 'fo:margin-bottom');
  const leftValue = attrValue(pageLayoutProperties, 'fo:margin-left');
  if (topValue === undefined || rightValue === undefined || bottomValue === undefined || leftValue === undefined) {
    return undefined;
  }
  const topPt = parseOdfLength(topValue);
  const rightPt = parseOdfLength(rightValue);
  const bottomPt = parseOdfLength(bottomValue);
  const leftPt = parseOdfLength(leftValue);
  if (topPt === undefined || rightPt === undefined || bottomPt === undefined || leftPt === undefined) {
    return undefined;
  }
  return { topPt, rightPt, bottomPt, leftPt };
}

// Parses a positioned drawing element's own svg:x/svg:y/svg:width/svg:height (its top-left corner and size) into a Box (points) -- e.g. a real Writer image/text frame: `<draw:frame svg:x="..." svg:y="..." svg:width="..." svg:height="...">`. Unlike style:page-layout-properties (page-level: size and margins, no position of its own), any individually positioned drawing element carries all four of these directly on itself, with no separate margins concept.
export function parseBox(element: XmlElement): Box | undefined {
  const xValue = attrValue(element, 'svg:x');
  const yValue = attrValue(element, 'svg:y');
  const widthValue = attrValue(element, 'svg:width');
  const heightValue = attrValue(element, 'svg:height');
  if (xValue === undefined || yValue === undefined || widthValue === undefined || heightValue === undefined) {
    return undefined;
  }
  const xPt = parseOdfLength(xValue);
  const yPt = parseOdfLength(yValue);
  const widthPt = parseOdfLength(widthValue);
  const heightPt = parseOdfLength(heightValue);
  if (xPt === undefined || yPt === undefined || widthPt === undefined || heightPt === undefined) {
    return undefined;
  }
  return { xPt, yPt, widthPt, heightPt };
}

// draw:line is the one drawing shape that carries no svg:x/y/width/height box at all -- its geometry is a plain pair of endpoints, svg:x1/svg:y1/svg:x2/svg:y2 directly on the element (confirmed against real LibreOffice 26.2 .odg output; see typed/shared/path.ts's own top-of-file note on the verification method used for this same fixture). Unlike parseBox's four-required-together contract, each endpoint is read as its own pair -- there is no meaningful "partial line" fallback either way, so any one of the four being absent or unparseable is still, correctly, "no resolvable geometry" (undefined).
export function parseLinePoints(element: XmlElement): { from: ContentPathPoint; to: ContentPathPoint } | undefined {
  const x1Value = attrValue(element, 'svg:x1');
  const y1Value = attrValue(element, 'svg:y1');
  const x2Value = attrValue(element, 'svg:x2');
  const y2Value = attrValue(element, 'svg:y2');
  if (x1Value === undefined || y1Value === undefined || x2Value === undefined || y2Value === undefined) {
    return undefined;
  }
  const x1Pt = parseOdfLength(x1Value);
  const y1Pt = parseOdfLength(y1Value);
  const x2Pt = parseOdfLength(x2Value);
  const y2Pt = parseOdfLength(y2Value);
  if (x1Pt === undefined || y1Pt === undefined || x2Pt === undefined || y2Pt === undefined) {
    return undefined;
  }
  return { from: { xPt: x1Pt, yPt: y1Pt }, to: { xPt: x2Pt, yPt: y2Pt } };
}
