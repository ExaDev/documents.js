import type { Package, XmlElement } from 'odf.js';
import { findStyleElement, formatOdfLength, parseOdfLength } from 'odf.js';
import { attr } from 'ooxml.js';
import { directChildElement, removeAttr, setAttr } from '../../xml/edit';
import { el } from '../../xml/fragment';
import { ensureAutomaticStyles, nextStyleName } from '../odt/automatic-styles';
import {
  COLUMN_REPEAT_ATTR,
  COLUMN_TAG,
  HEADER_COLUMNS_TAG,
  HEADER_ROWS_TAG,
  ROW_REPEAT_ATTR,
  ROW_TAG,
  ensureColumnCoverage,
  isElementWithTag,
  replaceRun,
} from './address';

const VISIBILITY_ATTR = 'table:visibility';
const VISIBILITY_COLLAPSE = 'collapse';

// Discovered while composing xlsxToPdf/pdfToXlsx (src/convert/convert.ts): buildOdsPackage never wrote ContentSheetColumn.widthPt/ContentSheetRow.heightPt at all (see content.ts's own long-standing, already-documented gap), which was previously only a cosmetic loss -- a caller reopening the FINAL ods bytes in a real app got the app's own default column/row size instead of the source's. xlsxToPdf/pdfToXlsx compose xlsxToOds -> odsToPdf internally, though, so buildOdsPackage's output there is an INTERMEDIATE, immediately re-read by convertSpreadsheetToLayout (src/layout/sheets.ts) -- and its own resolveAxis treats an explicit-but-unstyled column/row (widthPt/heightPt 0, present precisely because address.ts's own cell-write individuation always creates a real table:table-column/table:table-row element) as a genuine "this column/row is zero-sized" reading that WINS over DEFAULT_COLUMN_WIDTH_PT/DEFAULT_ROW_HEIGHT_PT, not a missing entry the default would otherwise fill. Every column collapsing to width 0 and every row to height 0 puts every cell at the same physical (x, y) -- not a rounding loss but a total loss of the grid's own geometry, which is why this gap needed a real fix rather than another documented caveat: unlike buildOdsPackage's OTHER tracked write-gaps (images, embeddedObjects), this one turns into actual data corruption the moment its own output is fed back through a layout engine rather than only ever being a terminal deliverable.
//
// style:table-column-properties/style:table-row-properties can carry BOTH a size (style:column-width/style:row-height) and a manual page-break flag (fo:break-before="page", print-settings.ts's own manualBreaks writer) -- but a column/row is referenced by exactly ONE table:style-name, so naively minting a fresh, single-property style every time either write happens would silently clobber whichever property a PRIOR call already set (setting a manual break after a width was set would repoint the column at a break-only style, losing the width, and vice versa). applyColumnStyleProperties/applyRowStyleProperties below are the shared fix: each reads the column/row's CURRENT style (if any) for whichever property this call is NOT touching, merges it with the property this call IS touching, and mints one fresh style carrying the union -- preserving the same "always mint fresh, never mutate an existing entry" append-only convention print-settings.ts's own writeSheetPrintSettings and src/edit/odg/style.ts's own graphic-family writer already establish, just applied to the merged result rather than to a single property in isolation. Column/row HIDDEN state (writeColumnHidden/writeRowHidden below) needs none of this: table:visibility is a plain attribute directly on the column/row element, not a style property at all, so setting it never touches table:style-name or office:automatic-styles and can never collide with either of the above.

interface ColumnStyleProperties {
  readonly widthPt?: number;
  readonly manualBreak: boolean;
}

interface RowStyleProperties {
  readonly heightPt?: number;
  readonly manualBreak: boolean;
}

// Reads columnElement's CURRENT table:style-name -> style:style[family="table-column"] -> style:table-column-properties chain (mirroring odf.js's own private readColumnLayout in typed/ods/read.ts) so a fresh style minted for ONE property can carry the OTHER forward unchanged. Absent a style, or a style with no matching properties element, every field reads as "not set" -- exactly the state a column this editor has never touched is in.
function currentColumnStyleProperties(pkg: Package, columnElement: XmlElement): ColumnStyleProperties {
  const styleName = attr(columnElement, 'table:style-name');
  const styleElement = styleName === undefined ? undefined : findStyleElement(styleName, 'table-column', pkg);
  const properties = styleElement === undefined ? undefined : directChildElement(styleElement, 'style:table-column-properties');
  const widthValue = properties === undefined ? undefined : attr(properties, 'style:column-width');
  return {
    widthPt: widthValue === undefined ? undefined : parseOdfLength(widthValue),
    manualBreak: (properties === undefined ? undefined : attr(properties, 'fo:break-before')) === 'page',
  };
}

// The row counterpart to currentColumnStyleProperties above, for style:table-row-properties/style:row-height.
function currentRowStyleProperties(pkg: Package, rowElement: XmlElement): RowStyleProperties {
  const styleName = attr(rowElement, 'table:style-name');
  const styleElement = styleName === undefined ? undefined : findStyleElement(styleName, 'table-row', pkg);
  const properties = styleElement === undefined ? undefined : directChildElement(styleElement, 'style:table-row-properties');
  const heightValue = properties === undefined ? undefined : attr(properties, 'style:row-height');
  return {
    heightPt: heightValue === undefined ? undefined : parseOdfLength(heightValue),
    manualBreak: (properties === undefined ? undefined : attr(properties, 'fo:break-before')) === 'page',
  };
}

// Mints a fresh style:style[family="table-column"] carrying the MERGED result of columnElement's current properties and `changes`, then repoints columnElement's own table:style-name at it. `changes` fields left undefined fall back to whatever the column's current style already declares (never to a fabricated default), so a caller setting only one property never has to know or restate the other.
function applyColumnStyleProperties(pkg: Package, tableElement: XmlElement, index: number, changes: Partial<ColumnStyleProperties>): void {
  ensureColumnCoverage(tableElement, index + 1);
  const columnElement = replaceRun(tableElement.children, isElementWithTag(COLUMN_TAG), index, COLUMN_REPEAT_ATTR, () => el(COLUMN_TAG), HEADER_COLUMNS_TAG);
  const current = currentColumnStyleProperties(pkg, columnElement);
  const widthPt = changes.widthPt ?? current.widthPt;
  const manualBreak = changes.manualBreak ?? current.manualBreak;
  const automaticStyles = ensureAutomaticStyles(pkg);
  const styleName = nextStyleName(automaticStyles, 'style:style', 'OdsColumn');
  automaticStyles.children.push(
    el('style:style', { 'style:name': styleName, 'style:family': 'table-column' }, [
      el('style:table-column-properties', {
        ...(widthPt !== undefined ? { 'style:column-width': formatOdfLength(widthPt) } : {}),
        ...(manualBreak ? { 'fo:break-before': 'page' } : {}),
      }),
    ]),
  );
  setAttr(columnElement, 'table:style-name', styleName);
}

// The row counterpart to applyColumnStyleProperties above, for style:table-row-properties.
function applyRowStyleProperties(pkg: Package, tableElement: XmlElement, index: number, changes: Partial<RowStyleProperties>): void {
  const rowElement = replaceRun(tableElement.children, isElementWithTag(ROW_TAG), index, ROW_REPEAT_ATTR, () => el(ROW_TAG), HEADER_ROWS_TAG);
  const current = currentRowStyleProperties(pkg, rowElement);
  const heightPt = changes.heightPt ?? current.heightPt;
  const manualBreak = changes.manualBreak ?? current.manualBreak;
  const automaticStyles = ensureAutomaticStyles(pkg);
  const styleName = nextStyleName(automaticStyles, 'style:style', 'OdsRow');
  automaticStyles.children.push(
    el('style:style', { 'style:name': styleName, 'style:family': 'table-row' }, [
      el('style:table-row-properties', {
        ...(heightPt !== undefined ? { 'style:row-height': formatOdfLength(heightPt) } : {}),
        ...(manualBreak ? { 'fo:break-before': 'page' } : {}),
      }),
    ]),
  );
  setAttr(rowElement, 'table:style-name', styleName);
}

export function writeColumnWidth(pkg: Package, tableElement: XmlElement, index: number, widthPt: number): void {
  applyColumnStyleProperties(pkg, tableElement, index, { widthPt });
}

export function writeRowHeight(pkg: Package, tableElement: XmlElement, index: number, heightPt: number): void {
  applyRowStyleProperties(pkg, tableElement, index, { heightPt });
}

// Sets fo:break-before="page" on the column's own style, preserving any width already set -- the write-side counterpart to odf.js's own readColumnLayout manualBreak field, and the column half of print-settings.ts's own manualBreaks writer.
export function writeColumnManualBreak(pkg: Package, tableElement: XmlElement, index: number): void {
  applyColumnStyleProperties(pkg, tableElement, index, { manualBreak: true });
}

// The row counterpart to writeColumnManualBreak above.
export function writeRowManualBreak(pkg: Package, tableElement: XmlElement, index: number): void {
  applyRowStyleProperties(pkg, tableElement, index, { manualBreak: true });
}

// table:visibility is a plain attribute directly on the table:table-column/table:table-row element itself, not a style property -- odf.js's own read-side isHidden (typed/ods/read.ts) checks exactly this attribute for the literal value "collapse" ("filter" is ODF's third visibility state, for an AutoFilter-hidden row; this editor only ever writes hidden/visible, matching ContentSheetColumn/Row.hidden's own boolean shape). Individuates (or gap-fills) the column/row the same way writeColumnWidth/writeRowHeight do -- calling this before, after, or instead of setting a width/height is equally safe, and never collides with applyColumnStyleProperties above since visibility lives on the element itself, not inside its style.
export function writeColumnHidden(tableElement: XmlElement, index: number, hidden: boolean): void {
  ensureColumnCoverage(tableElement, index + 1);
  const columnElement = replaceRun(tableElement.children, isElementWithTag(COLUMN_TAG), index, COLUMN_REPEAT_ATTR, () => el(COLUMN_TAG), HEADER_COLUMNS_TAG);
  if (hidden) {
    setAttr(columnElement, VISIBILITY_ATTR, VISIBILITY_COLLAPSE);
  } else {
    removeAttr(columnElement, VISIBILITY_ATTR);
  }
}

// The row counterpart to writeColumnHidden above, mirroring it exactly for table:table-row.
export function writeRowHidden(tableElement: XmlElement, index: number, hidden: boolean): void {
  const rowElement = replaceRun(tableElement.children, isElementWithTag(ROW_TAG), index, ROW_REPEAT_ATTR, () => el(ROW_TAG), HEADER_ROWS_TAG);
  if (hidden) {
    setAttr(rowElement, VISIBILITY_ATTR, VISIBILITY_COLLAPSE);
  } else {
    removeAttr(rowElement, VISIBILITY_ATTR);
  }
}
