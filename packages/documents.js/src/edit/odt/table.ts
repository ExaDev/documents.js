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

  // This row's own true grid-column list -- BOTH real table:table-cell and placeholder table:covered-table-cell children, in document order. ODF's grid model guarantees exactly one child element (of either tag) per grid position in every row, which is why walking both tags (rather than cells()' own real-cell-only filter) gives a startColumnIndex that is correct even for a row a prior vertical merge already covered.
  private gridCells(): XmlElement[] {
    const out: XmlElement[] = [];
    for (const child of this.node.children) {
      if (child.type === 'element' && (child.tag === 'table:table-cell' || child.tag === 'table:covered-table-cell')) {
        out.push(child);
      }
    }
    return out;
  }

  // Merges colSpan grid columns of THIS row into one cell: the anchor at startColumnIndex gets table:number-columns-spanned (via OdtTableCell.colSpan), and every OTHER covered position is RETAGGED in place to table:covered-table-cell -- exactly OdsSheet.mergeCells' own technique (src/edit/ods/sheet.ts: `element.tag = ...; element.attributes = []; element.children = [];`), never removed and reinserted, since ODF's grid model requires one child element per grid position regardless of merge state. Consumed cells' own content is discarded silently and unconditionally -- no check, no guard -- matching that same precedent exactly: documented, intentional behaviour, not a silent trap.
  mergeCellsHorizontally(startColumnIndex: number, colSpan: number): OdtTableCell {
    if (!Number.isInteger(colSpan) || colSpan < 1) {
      throw new Error(`mergeCellsHorizontally: colSpan must be a positive integer, got ${colSpan}`);
    }
    const gridCells = this.gridCells();
    const anchorElement = gridCells[startColumnIndex];
    if (anchorElement === undefined) {
      throw new Error(`mergeCellsHorizontally: column ${startColumnIndex} does not exist in this row`);
    }
    if (anchorElement.tag === 'table:covered-table-cell') {
      throw new Error(
        `mergeCellsHorizontally: column ${startColumnIndex} is already covered by another merge -- address that merge's own anchor cell instead`,
      );
    }
    if (startColumnIndex + colSpan > gridCells.length) {
      throw new Error(
        `mergeCellsHorizontally: colSpan ${colSpan} starting at column ${startColumnIndex} exceeds this row's own ${gridCells.length} grid columns`,
      );
    }
    for (let i = 1; i < colSpan; i++) {
      const consumedElement = gridCells[startColumnIndex + i];
      if (consumedElement !== undefined) {
        consumedElement.tag = 'table:covered-table-cell';
        consumedElement.attributes = [];
        consumedElement.children = [];
      }
    }
    const anchor = new OdtTableCell(anchorElement, this.pkg);
    anchor.colSpan = colSpan;
    return anchor;
  }

  // Marks the grid position at columnIndex as covered by a merge anchored elsewhere (typically a different row, in a vertical merge's own covered rows) -- the single-position primitive OdtTable.mergeCells uses to stamp every covered position in a rowSpan x colSpan rectangle below the anchor row. Retags in place, exactly like mergeCellsHorizontally's own consumed-cell handling above.
  markCellCovered(columnIndex: number): void {
    const gridCells = this.gridCells();
    const element = gridCells[columnIndex];
    if (element === undefined) {
      throw new Error(`markCellCovered: column ${columnIndex} does not exist in this row`);
    }
    element.tag = 'table:covered-table-cell';
    element.attributes = [];
    element.children = [];
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

  // Merges the rowSpan x colSpan rectangle anchored at (startRow, startColumn): calls OdtTableRow.mergeCellsHorizontally on the anchor row (which sets the anchor's own colSpan), sets rowSpan on that same anchor cell when rowSpan > 1, then calls markCellCovered for every column the rectangle covers on every row below the anchor -- unlike docx, ODF's grid model means only the FIRST row of a vertical merge needs a real horizontal merge; every row below it just needs its own covered positions stamped, since table:number-rows-spanned on the anchor already says how many rows the merge covers.
  mergeCells(startRow: number, startColumn: number, rowSpan: number, colSpan: number): OdtTableCell {
    if (!Number.isInteger(rowSpan) || rowSpan < 1 || !Number.isInteger(colSpan) || colSpan < 1) {
      throw new Error(`mergeCells: rowSpan and colSpan must be positive integers, got rowSpan=${rowSpan}, colSpan=${colSpan}`);
    }
    const rows = this.rows();
    const anchorRow = rows[startRow];
    if (anchorRow === undefined) {
      throw new Error(`mergeCells: row ${startRow} does not exist in this table`);
    }
    const anchor = anchorRow.mergeCellsHorizontally(startColumn, colSpan);
    if (rowSpan > 1) {
      anchor.rowSpan = rowSpan;
      for (let r = 1; r < rowSpan; r++) {
        const coveredRow = rows[startRow + r];
        if (coveredRow === undefined) {
          throw new Error(`mergeCells: rowSpan ${rowSpan} starting at row ${startRow} exceeds this table's own ${rows.length} rows`);
        }
        for (let c = 0; c < colSpan; c++) {
          coveredRow.markCellCovered(startColumn + c);
        }
      }
    }
    return anchor;
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
