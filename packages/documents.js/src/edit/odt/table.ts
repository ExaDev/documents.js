import type { Package, XmlElement, XmlNode } from 'odf.js';
import { formatOdfLength } from 'odf.js';
import { attr } from 'ooxml.js';
import { removeAttr, removeChild, setAttr } from '../../xml/edit';
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

  get colSpan(): number | undefined {
    const raw = attr(this.node, 'table:number-columns-spanned');
    return raw === undefined ? undefined : Number(raw);
  }

  // Marks this cell as the top-left of an N-column merge (ODF's own table:number-columns-spanned) -- the write-side inverse of odf.js's own readTableCell, whose ContentTableCell.colSpan this mirrors. Unlike docx's gridSpan, ODF still needs one real element per covered grid column even for a horizontal merge -- OdtTableRow.appendCoveredCell writes those, this setter only marks the merge's own starting cell.
  set colSpan(value: number | undefined) {
    if (value === undefined) {
      removeAttr(this.node, 'table:number-columns-spanned');
      return;
    }
    setAttr(this.node, 'table:number-columns-spanned', String(value));
  }

  get rowSpan(): number | undefined {
    const raw = attr(this.node, 'table:number-rows-spanned');
    return raw === undefined ? undefined : Number(raw);
  }

  // Marks this cell as the top of an N-row merge (ODF's own table:number-rows-spanned) -- the write-side inverse of odf.js's own readTableCell, whose ContentTableCell.rowSpan this mirrors. The rows below still need a real table:covered-table-cell element at the same grid column (OdtTableRow.appendCoveredCell) -- ODF has no attribute-only way to express "this cell continues one above it" the way docx's w:vMerge does.
  set rowSpan(value: number | undefined) {
    if (value === undefined) {
      removeAttr(this.node, 'table:number-rows-spanned');
      return;
    }
    setAttr(this.node, 'table:number-rows-spanned', String(value));
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

  // Appends one ordinary table:table-cell to this row, for a caller (buildOdtPackage's own appendTable) building a row's cells one at a time rather than all at once via OdtTable.appendRow -- needed so a merged table's covered grid positions can be interleaved with real cells in document order.
  appendCell(): OdtTableCell {
    const cellElement = buildCell(this.pkg);
    this.node.children.push(cellElement);
    return new OdtTableCell(cellElement, this.pkg);
  }

  // Appends a table:covered-table-cell -- ODF's own placeholder for a grid position consumed by a horizontal (table:number-columns-spanned) or vertical (table:number-rows-spanned) merge starting elsewhere. Carries no content at all, matching odf.js's own readTableRow, which reads one back as a bare `{ blocks: [] }` regardless of what (if anything) real-world producers ever put inside one.
  appendCoveredCell(): void {
    this.node.children.push(el('table:covered-table-cell'));
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

  // Appends an empty table:table-row with no cells yet, for a caller (buildOdtPackage's own appendTable) that needs to build a merged table's cells one at a time via OdtTableRow.appendCell/appendCoveredCell rather than the uniform-grid shape appendRow(columnCount) always produces.
  appendEmptyRow(): OdtTableRow {
    const node = this.live();
    const row = el('table:table-row');
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
