import type {
  ContentEmbeddedObject,
  ContentSheetImage,
} from "document-schema.js";
import type { Package, XmlElement } from "odf.js";
import {
  base64ToBytes,
  findStyleElement,
  formatOdfLength,
  parseOdfLength,
} from "odf.js";
import { attr } from "ooxml.js";
import { addFormulaObject } from "../../odf-package/formula";
import { addImageMedia } from "../../odf-package/media";
import { directChildElement } from "../../xml/edit";
import { el } from "../../xml/fragment";
import {
  COLUMN_REPEAT_ATTR,
  COLUMN_TAG,
  HEADER_COLUMNS_TAG,
  HEADER_ROWS_TAG,
  ROW_REPEAT_ATTR,
  ROW_TAG,
  collectRunMembers,
  isElementWithTag,
  readRunRepeatCount,
} from "./address";

// A floating draw:frame in a spreadsheet (an image, or an embedded OLE sub-object) is a direct child of table:table's own table:shapes wrapper -- NOT of office:spreadsheet, and NOT anchored inline in any cell's own text:p the way a docx/odt drawing can be. Confirmed against the OASIS ODF 1.3 RelaxNG content model for table:table: table:shapes (when present) precedes every table:table-column/table:table-header-columns/table:table-row/table:table-header-rows group -- this editor never writes table:table-source/office:dde-source/table:scenario (the only elements that could precede table:shapes), so table:shapes is always tableElement's own first child. svg:x/svg:y/svg:width/svg:height inside are absolute, relative to the table's own top-left origin -- the same convention src/edit/odp/shape.ts's buildImageFrame already uses for a slide, just resolved here from a ContentSheetImage's own anchorRow/anchorColumn/offsetXPt/offsetYPt rather than accepted as an already-absolute Box, since that is the shape document-schema.js's ContentSheetImage models a spreadsheet anchor with (a Box has no ROW/COLUMN concept at all).
const SHAPES_TAG = "table:shapes";

// LibreOffice Calc's own default new-column-width/new-row-height, matching src/layout/sheets.ts's own DEFAULT_COLUMN_WIDTH_PT/DEFAULT_ROW_HEIGHT_PT exactly (duplicated here rather than imported: src/layout/* is a strictly outward/upward dependency from src/edit/*, per this package's own layered-architecture convention -- see the README's own dependency-direction note -- so a layout-engine constant is mirrored locally, the same choice print-settings.ts's own DEFAULT_MARGIN_PT already makes for scaffold.ts's identical value). Used only for a column/row index beyond every table:table-column/table:table-row this sheet has declared -- real Calc falls back to its own default width/height for exactly that case too.
const DEFAULT_COLUMN_WIDTH_PT = 64;
const DEFAULT_ROW_HEIGHT_PT = 15;

function ensureTableShapes(tableElement: XmlElement): XmlElement {
  const existing = tableElement.children.find(
    (child): child is XmlElement =>
      child.type === "element" && child.tag === SHAPES_TAG,
  );
  if (existing !== undefined) {
    return existing;
  }
  const shapes = el(SHAPES_TAG);
  tableElement.children.unshift(shapes);
  return shapes;
}

function isHiddenElement(node: XmlElement): boolean {
  return attr(node, "table:visibility") === "collapse";
}

// Reads a table:table-column element's own resolved width -- mirroring odf.js's own private readColumnLayout (typed/ods/read.ts) exactly: 0 for a column that carries a table:style-name but no style:column-width (or none at all), never a fabricated default. A hidden column (table:visibility="collapse") always contributes 0 regardless of its own declared width, matching how a real spreadsheet application visually collapses a hidden column's own space when positioning anything anchored past it.
function resolvedColumnWidthPt(
  pkg: Package,
  columnElement: XmlElement,
): number {
  if (isHiddenElement(columnElement)) {
    return 0;
  }
  const styleName = attr(columnElement, "table:style-name");
  const styleElement =
    styleName === undefined
      ? undefined
      : findStyleElement(styleName, "table-column", pkg);
  const properties =
    styleElement === undefined
      ? undefined
      : directChildElement(styleElement, "style:table-column-properties");
  const widthValue =
    properties === undefined
      ? undefined
      : attr(properties, "style:column-width");
  return widthValue === undefined ? 0 : (parseOdfLength(widthValue) ?? 0);
}

// The row counterpart to resolvedColumnWidthPt above, for style:table-row-properties/style:row-height.
function resolvedRowHeightPt(pkg: Package, rowElement: XmlElement): number {
  if (isHiddenElement(rowElement)) {
    return 0;
  }
  const styleName = attr(rowElement, "table:style-name");
  const styleElement =
    styleName === undefined
      ? undefined
      : findStyleElement(styleName, "table-row", pkg);
  const properties =
    styleElement === undefined
      ? undefined
      : directChildElement(styleElement, "style:table-row-properties");
  const heightValue =
    properties === undefined ? undefined : attr(properties, "style:row-height");
  return heightValue === undefined ? 0 : (parseOdfLength(heightValue) ?? 0);
}

// Sums the resolved width of every declared column strictly before `anchorColumn` (header-wrapper-aware, so a repeatColumns-wrapped column still counts), falling back to DEFAULT_COLUMN_WIDTH_PT per position once the walk runs past every column this sheet has declared -- the absolute x-origin a ContentSheetImage/embeddedObject's own anchorColumn + offsetXPt is resolved against.
function cumulativeColumnOffsetPt(
  pkg: Package,
  tableElement: XmlElement,
  anchorColumn: number,
): number {
  let cursor = 0;
  let offsetPt = 0;
  for (const member of collectRunMembers(
    tableElement.children,
    isElementWithTag(COLUMN_TAG),
    HEADER_COLUMNS_TAG,
  )) {
    if (cursor >= anchorColumn) {
      break;
    }
    const count = readRunRepeatCount(member.node, COLUMN_REPEAT_ATTR);
    const overlap = Math.min(count, anchorColumn - cursor);
    offsetPt += overlap * resolvedColumnWidthPt(pkg, member.node);
    cursor += count;
  }
  if (cursor < anchorColumn) {
    offsetPt += (anchorColumn - cursor) * DEFAULT_COLUMN_WIDTH_PT;
  }
  return offsetPt;
}

// The row counterpart to cumulativeColumnOffsetPt above.
function cumulativeRowOffsetPt(
  pkg: Package,
  tableElement: XmlElement,
  anchorRow: number,
): number {
  let cursor = 0;
  let offsetPt = 0;
  for (const member of collectRunMembers(
    tableElement.children,
    isElementWithTag(ROW_TAG),
    HEADER_ROWS_TAG,
  )) {
    if (cursor >= anchorRow) {
      break;
    }
    const count = readRunRepeatCount(member.node, ROW_REPEAT_ATTR);
    const overlap = Math.min(count, anchorRow - cursor);
    offsetPt += overlap * resolvedRowHeightPt(pkg, member.node);
    cursor += count;
  }
  if (cursor < anchorRow) {
    offsetPt += (anchorRow - cursor) * DEFAULT_ROW_HEIGHT_PT;
  }
  return offsetPt;
}

function buildAbsoluteFrame(
  xPt: number,
  yPt: number,
  widthPt: number,
  heightPt: number,
  content: XmlElement,
): XmlElement {
  return el(
    "draw:frame",
    {
      "svg:x": formatOdfLength(xPt),
      "svg:y": formatOdfLength(yPt),
      "svg:width": formatOdfLength(widthPt),
      "svg:height": formatOdfLength(heightPt),
    },
    [content],
  );
}

// Adds a raster image to `tableElement`, anchored at (image.anchorRow, image.anchorColumn) plus (image.offsetXPt, image.offsetYPt) -- resolving that anchor to an absolute svg:x/svg:y via cumulativeColumnOffsetPt/cumulativeRowOffsetPt above, since a spreadsheet's own floating draw:frame has no cell-relative anchoring attribute of its own the way an OOXML worksheet's xdr:twoCellAnchor does (see this file's own top-of-file note). Reuses addImageMedia (src/odf-package/media.ts) for the binary part + manifest entry, exactly as src/edit/odp/image.ts's insertImageFrameMedia does for a slide.
export function insertSheetImage(
  pkg: Package,
  tableElement: XmlElement,
  image: ContentSheetImage,
): void {
  const { partPath } = addImageMedia(
    pkg,
    base64ToBytes(image.base64),
    image.format,
  );
  const xPt =
    cumulativeColumnOffsetPt(pkg, tableElement, image.anchorColumn) +
    image.offsetXPt;
  const yPt =
    cumulativeRowOffsetPt(pkg, tableElement, image.anchorRow) + image.offsetYPt;
  const imageElement = el("draw:image", { "xlink:href": partPath });
  const frame = buildAbsoluteFrame(
    xPt,
    yPt,
    image.widthPt,
    image.heightPt,
    imageElement,
  );
  ensureTableShapes(tableElement).children.push(frame);
}

// Adds a real embedded ODF formula sub-object to `tableElement`, at object.frame's own already-absolute position (unlike ContentSheetImage, ContentEmbeddedObject.frame is a Box -- see document-schema.js's own ContentEmbeddedObjectSchema -- so no anchor resolution is needed here). Reuses addFormulaObject (src/odf-package/formula.ts) exactly as src/edit/odt/formula.ts's insertFormulaFrameMedia does for an odt paragraph. Every OTHER objectKind (wordprocessing/presentation/spreadsheet/drawing) is a genuine, tracked, bounded gap, mirroring buildOdtPackage's own identical narrowing for a 'drawing' embeddedObject block (src/edit/odt/content.ts): embedding a full nested sub-package for one of those would mean writing that document's own package as an OLE sub-object, and no writer for that exists anywhere in this codebase yet -- silently degrading it to a text stand-in would be noise rather than information, so it is written as nothing at all, exactly like buildOdtPackage's own 'drawing' case.
export function insertSheetEmbeddedObject(
  pkg: Package,
  tableElement: XmlElement,
  object: ContentEmbeddedObject,
): void {
  if (object.document.kind !== "formula") {
    return;
  }
  const { href } = addFormulaObject(pkg, object.document.formula);
  const objectElement = el("draw:object", { "xlink:href": href });
  const frame = buildAbsoluteFrame(
    object.frame.xPt,
    object.frame.yPt,
    object.frame.widthPt,
    object.frame.heightPt,
    objectElement,
  );
  ensureTableShapes(tableElement).children.push(frame);
}
