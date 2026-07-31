import type { Package, XmlElement, XmlNode } from 'odf.js';
import { formatOdfLength } from 'odf.js';
import { attr } from 'ooxml.js';
import { removeChild } from '../../xml/edit';
import { el } from '../../xml/fragment';
import { ensureAutomaticStyles, nextStyleName } from './automatic-styles';
import type { ParagraphInit } from './paragraph';
import { buildParagraph, OdtParagraph } from './paragraph';

export interface TableInit {
  readonly rows: number;
  readonly columns: number;
  readonly columnWidthsPt?: readonly number[];
}

// 468pt (6.5in) -- US Letter page width (612pt) minus 1in margins either side (2 x 72pt), matching createEmptyOdtPackage's own default page-layout (scaffold.ts) and docx's identical DEFAULT_TABLE_WIDTH_TWIPS (src/edit/docx/table.ts, in twips: 9360 / 20 = 468pt) -- the content width a new table defaults to when no explicit widths are given.
const DEFAULT_TABLE_WIDTH_PT = 468;

const TABLE_COLUMN_STYLE_PREFIX = 'OdtCol';

// odf.js's StyleRegistry cannot express a table column's width at all -- StylePropertiesSchema (src/styles/properties.ts) has no columnWidthPt field, so style:table-column-properties/@style:column-width (the only place ODF records it) is entirely outside what StyleRegistry.intern can produce. This is therefore hand-rolled, mirroring StyleRegistry.intern's own append-only, fingerprint-deduplicated contract by hand: reuse an existing table-column style if one with the exact same formatted width is already present, otherwise mint a fresh name (via automatic-styles.ts's nextStyleName) and append a new entry -- never mutate or remove an existing one.
function internTableColumnWidth(pkg: Package, widthPt: number): string {
  const automaticStyles = ensureAutomaticStyles(pkg);
  const formatted = formatOdfLength(widthPt, 'pt');
  for (const child of automaticStyles.children) {
    if (child.type !== 'element' || child.tag !== 'style:style' || attr(child, 'style:family') !== 'table-column') {
      continue;
    }
    const props = child.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'style:table-column-properties');
    if (props !== undefined && attr(props, 'style:column-width') === formatted) {
      const existingName = attr(child, 'style:name');
      if (existingName !== undefined) {
        return existingName;
      }
    }
  }
  const name = nextStyleName(automaticStyles, 'style:style', TABLE_COLUMN_STYLE_PREFIX);
  automaticStyles.children.push(
    el('style:style', { 'style:name': name, 'style:family': 'table-column' }, [
      el('style:table-column-properties', { 'style:column-width': formatted }),
    ]),
  );
  return name;
}

export class OdtTableCell {
  private readonly node: XmlElement;
  private readonly pkg: Package;

  constructor(node: XmlElement, pkg: Package) {
    this.node = node;
    this.pkg = pkg;
  }

  paragraphs(): OdtParagraph[] {
    const out: OdtParagraph[] = [];
    for (const child of this.node.children) {
      if (child.type === 'element' && child.tag === 'text:p') {
        out.push(new OdtParagraph(this.node.children, child, this.pkg));
      }
    }
    return out;
  }

  appendParagraph(init?: ParagraphInit): OdtParagraph {
    const paragraphElement = buildParagraph(this.pkg, init);
    this.node.children.push(paragraphElement);
    return new OdtParagraph(this.node.children, paragraphElement, this.pkg);
  }

  get text(): string {
    return this.paragraphs()
      .map((p) => p.text)
      .join('\n');
  }
}

export class OdtTableRow {
  private readonly node: XmlElement;
  private readonly pkg: Package;

  constructor(node: XmlElement, pkg: Package) {
    this.node = node;
    this.pkg = pkg;
  }

  cells(): OdtTableCell[] {
    const out: OdtTableCell[] = [];
    for (const child of this.node.children) {
      if (child.type === 'element' && child.tag === 'table:table-cell') {
        out.push(new OdtTableCell(child, this.pkg));
      }
    }
    return out;
  }
}

function buildCell(pkg: Package): XmlElement {
  return el('table:table-cell', {}, [buildParagraph(pkg)]);
}

function buildRow(pkg: Package, columnCount: number): XmlElement {
  const cells: XmlElement[] = [];
  for (let i = 0; i < columnCount; i++) {
    cells.push(buildCell(pkg));
  }
  return el('table:table-row', {}, cells);
}

export class OdtTable {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly pkg: Package;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, pkg: Package) {
    this.container = container;
    this.node = node;
    this.pkg = pkg;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error('this OdtTable has been removed and can no longer be used');
    }
    return this.node;
  }

  rows(): OdtTableRow[] {
    const out: OdtTableRow[] = [];
    for (const child of this.live().children) {
      if (child.type === 'element' && child.tag === 'table:table-row') {
        out.push(new OdtTableRow(child, this.pkg));
      }
    }
    return out;
  }

  cell(rowIndex: number, columnIndex: number): OdtTableCell {
    const row = this.rows()[rowIndex];
    if (row === undefined) {
      throw new Error(`row ${rowIndex} does not exist in this table`);
    }
    const cell = row.cells()[columnIndex];
    if (cell === undefined) {
      throw new Error(`column ${columnIndex} does not exist in row ${rowIndex}`);
    }
    return cell;
  }

  appendRow(columnCount: number): OdtTableRow {
    const node = this.live();
    const row = buildRow(this.pkg, columnCount);
    node.children.push(row);
    return new OdtTableRow(row, this.pkg);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

export function buildTable(pkg: Package, init: TableInit): XmlElement {
  const defaultWidth = DEFAULT_TABLE_WIDTH_PT / init.columns;
  const columns: XmlElement[] = [];
  for (let i = 0; i < init.columns; i++) {
    const widthPt = init.columnWidthsPt?.[i] ?? defaultWidth;
    columns.push(el('table:table-column', { 'table:style-name': internTableColumnWidth(pkg, widthPt) }));
  }
  const rows: XmlElement[] = [];
  for (let r = 0; r < init.rows; r++) {
    rows.push(buildRow(pkg, init.columns));
  }
  return el('table:table', {}, [...columns, ...rows]);
}
