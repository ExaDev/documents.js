import type { Color, ContentTable, ContentTableCell, ContentTableRow } from 'document-schema.js';
import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag } from '../../xml/query';
import { parseOdfLength } from './units';
import { parseOdfColor } from './color';
import { findStyleElement } from './cascade';
import { readOdfParagraph } from './paragraph';

// Reads a table:table element into document-content-model's ContentTable -- the same table:table/table:table-row/table:table-cell/table:covered-table-cell markup ODF uses identically across odt/ods/odp (verified against real LibreOffice output: a presentation's own draw:frame-wrapped table uses the exact grammar below, including table:number-columns-spanned/table:covered-table-cell for merged cells), so this module is written to be reusable by a future odt/ods reader rather than living inside typed/draw/shapes.ts, even though odp is this module's only caller today.
//
// Column widths and row heights are dimensional/decorative properties (style:table-column-properties/@style:column-width, style:table-row-properties/@style:row-height) that styles/properties.ts deliberately does not model (see its own top-of-file note: this package's StyleProperties covers only paragraph/run-level text-document formatting) -- so this module resolves them directly via cascade.ts's findStyleElement, a single-level (family, name) lookup with no parent-chain walk, matching how real ODF table-column/table-row/table-cell automatic styles are standalone with no style:parent-style-name chain of their own in practice.

function readRepeatCount(element: XmlElement, attrName: string): number {
  const raw = attrValue(element, attrName);
  if (raw === undefined) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

// A column with no resolvable width (no table:style-name, no matching style, or a style with no style:table-column-properties/@style:column-width) defaults to 0pt, mirroring ooxml.js's own readTable (`emuToPt(Number(attr(col, 'w') ?? '0'))`) -- an established, deliberate sibling-reader convention, not a fallback invented here.
function resolveColumnWidthPt(columnElement: XmlElement, pkg: Package): number {
  const styleName = attrValue(columnElement, 'table:style-name');
  const styleElement = styleName === undefined ? undefined : findStyleElement(styleName, 'table-column', pkg);
  const props = styleElement === undefined ? undefined : childrenWithTag(styleElement, 'style:table-column-properties')[0];
  const widthValue = props === undefined ? undefined : attrValue(props, 'style:column-width');
  return widthValue === undefined ? 0 : (parseOdfLength(widthValue) ?? 0);
}

// Unlike column width, ContentTableRow.heightPt is optional -- an unresolvable row height is genuinely "no height specified" (the layout engine measures content instead), not zero, mirroring ooxml.js's own readTable row-height treatment.
function resolveRowHeightPt(rowElement: XmlElement, pkg: Package): number | undefined {
  const styleName = attrValue(rowElement, 'table:style-name');
  const styleElement = styleName === undefined ? undefined : findStyleElement(styleName, 'table-row', pkg);
  const props = styleElement === undefined ? undefined : childrenWithTag(styleElement, 'style:table-row-properties')[0];
  const heightValue = props === undefined ? undefined : attrValue(props, 'style:row-height');
  return heightValue === undefined ? undefined : parseOdfLength(heightValue);
}

// style:table-cell-properties/@fo:background-color is the standard, portable OASIS attribute for a cell's own fill, and the one this reader resolves. Real LibreOffice-generated PRESENTATION tables specifically favour their own loext:graphic-properties/@draw:fill-color extension instead when SAVING (confirmed via a controlled round trip: a cell written with the standard fo:background-color came back re-serialized under loext: on the very next LibreOffice save) -- a private, unstable vendor namespace this package deliberately does not chase (this package's own convention is OASIS-spec-grounded; see this repository's README on "ground truth over memory"). A cell whose only fill information lives in that loext: extension reads with no background here: a real, verified, narrow gap, not a silently guessed one.
function readTableCellBackground(cellElement: XmlElement, pkg: Package): Color | undefined {
  const styleName = attrValue(cellElement, 'table:style-name');
  const styleElement = styleName === undefined ? undefined : findStyleElement(styleName, 'table-cell', pkg);
  const props = styleElement === undefined ? undefined : childrenWithTag(styleElement, 'style:table-cell-properties')[0];
  const value = props === undefined ? undefined : attrValue(props, 'fo:background-color');
  return value === undefined ? undefined : parseOdfColor(value);
}

function readTableCell(cellElement: XmlElement, pkg: Package): ContentTableCell {
  const blocks = childrenWithTag(cellElement, 'text:p').map((p) => readOdfParagraph(p, pkg));
  const colSpanRaw = attrValue(cellElement, 'table:number-columns-spanned');
  const rowSpanRaw = attrValue(cellElement, 'table:number-rows-spanned');
  return {
    blocks,
    colSpan: colSpanRaw === undefined ? undefined : Number.parseInt(colSpanRaw, 10),
    rowSpan: rowSpanRaw === undefined ? undefined : Number.parseInt(rowSpanRaw, 10),
    background: readTableCellBackground(cellElement, pkg),
  };
}

function readTableRow(rowElement: XmlElement, pkg: Package): ContentTableRow {
  const cells: ContentTableCell[] = [];
  for (const child of rowElement.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (child.tag === 'table:covered-table-cell') {
      // A merged-away continuation cell -- the anchor cell's own colSpan/rowSpan already communicates the merge; ContentTableCell has no "covered by a preceding span" concept of its own, mirroring ooxml.js's own readTableCell treatment of hMerge/vMerge continuation cells.
      const repeat = readRepeatCount(child, 'table:number-columns-repeated');
      for (let i = 0; i < repeat; i++) {
        cells.push({ blocks: [] });
      }
    } else if (child.tag === 'table:table-cell') {
      const cell = readTableCell(child, pkg);
      const repeat = readRepeatCount(child, 'table:number-columns-repeated');
      for (let i = 0; i < repeat; i++) {
        cells.push(cell);
      }
    }
  }
  return { cells, heightPt: resolveRowHeightPt(rowElement, pkg) };
}

export function readOdfTable(tableElement: XmlElement, pkg: Package): ContentTable {
  const columnWidthsPt: number[] = [];
  for (const column of childrenWithTag(tableElement, 'table:table-column')) {
    const widthPt = resolveColumnWidthPt(column, pkg);
    const repeat = readRepeatCount(column, 'table:number-columns-repeated');
    for (let i = 0; i < repeat; i++) {
      columnWidthsPt.push(widthPt);
    }
  }

  const rows: ContentTableRow[] = [];
  for (const rowElement of childrenWithTag(tableElement, 'table:table-row')) {
    const row = readTableRow(rowElement, pkg);
    const repeat = readRepeatCount(rowElement, 'table:number-rows-repeated');
    for (let i = 0; i < repeat; i++) {
      rows.push(row);
    }
  }

  return { kind: 'table', rows, columnWidthsPt };
}
