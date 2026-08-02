import type { Package, XmlElement } from 'odf.js';
import { formatOdfLength } from 'odf.js';
import { setAttr } from '../../xml/edit';
import { el } from '../../xml/fragment';
import { ensureAutomaticStyles, nextStyleName } from '../odt/automatic-styles';
import { COLUMN_REPEAT_ATTR, COLUMN_TAG, ROW_REPEAT_ATTR, ROW_TAG, ensureColumnCoverage, isElementWithTag, replaceRun } from './address';

// Discovered while composing xlsxToPdf/pdfToXlsx (src/convert/convert.ts): buildOdsPackage never wrote ContentSheetColumn.widthPt/ContentSheetRow.heightPt at all (see content.ts's own long-standing, already-documented gap), which was previously only a cosmetic loss -- a caller reopening the FINAL ods bytes in a real app got the app's own default column/row size instead of the source's. xlsxToPdf/pdfToXlsx compose xlsxToOds -> odsToPdf internally, though, so buildOdsPackage's output there is an INTERMEDIATE, immediately re-read by convertSpreadsheetToLayout (src/layout/sheets.ts) -- and its own resolveAxis treats an explicit-but-unstyled column/row (widthPt/heightPt 0, present precisely because address.ts's own cell-write individuation always creates a real table:table-column/table:table-row element) as a genuine "this column/row is zero-sized" reading that WINS over DEFAULT_COLUMN_WIDTH_PT/DEFAULT_ROW_HEIGHT_PT, not a missing entry the default would otherwise fill. Every column collapsing to width 0 and every row to height 0 puts every cell at the same physical (x, y) -- not a rounding loss but a total loss of the grid's own geometry, which is why this gap needed a real fix rather than another documented caveat: unlike buildOdsPackage's OTHER tracked write-gaps (images, embeddedObjects), this one turns into actual data corruption the moment its own output is fed back through a layout engine rather than only ever being a terminal deliverable.
//
// Mints a fresh, uniquely-named style:style[family="table-column"|"table-row"] in content.xml's own office:automatic-styles carrying style:table-column-properties/@style:column-width or style:table-row-properties/@style:row-height, then repoints the target table:table-column/table:table-row element's own table:style-name at it -- the same "always mint fresh, never mutate an existing entry" convention print-settings.ts's own writeSheetPrintSettings and src/edit/odg/style.ts's own graphic-family writer already establish, reusing ensureAutomaticStyles/nextStyleName (src/edit/odt/automatic-styles.ts) rather than a third reimplementation of either. Column/row HIDDEN state is a separate, still-unwritten gap (table:visibility, not a style property) -- content.ts's own module comment tracks that one distinctly.

export function writeColumnWidth(pkg: Package, tableElement: XmlElement, index: number, widthPt: number): void {
  ensureColumnCoverage(tableElement, index + 1);
  const columnElement = replaceRun(tableElement.children, isElementWithTag(COLUMN_TAG), index, COLUMN_REPEAT_ATTR, () => el(COLUMN_TAG));
  const automaticStyles = ensureAutomaticStyles(pkg);
  const styleName = nextStyleName(automaticStyles, 'style:style', 'OdsColumn');
  automaticStyles.children.push(el('style:style', { 'style:name': styleName, 'style:family': 'table-column' }, [el('style:table-column-properties', { 'style:column-width': formatOdfLength(widthPt) })]));
  setAttr(columnElement, 'table:style-name', styleName);
}

export function writeRowHeight(pkg: Package, tableElement: XmlElement, index: number, heightPt: number): void {
  const rowElement = replaceRun(tableElement.children, isElementWithTag(ROW_TAG), index, ROW_REPEAT_ATTR, () => el(ROW_TAG));
  const automaticStyles = ensureAutomaticStyles(pkg);
  const styleName = nextStyleName(automaticStyles, 'style:style', 'OdsRow');
  automaticStyles.children.push(el('style:style', { 'style:name': styleName, 'style:family': 'table-row' }, [el('style:table-row-properties', { 'style:row-height': formatOdfLength(heightPt) })]));
  setAttr(rowElement, 'table:style-name', styleName);
}
