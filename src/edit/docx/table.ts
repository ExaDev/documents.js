import type { XmlElement, XmlNode } from 'ooxml.js';
import { attr } from 'ooxml.js';
import { directChildElement, insertInSchemaOrder, removeChild } from '../../xml/edit';
import { el } from '../../xml/fragment';
import type { ParagraphInit } from './paragraph';
import { buildParagraph, DocxParagraph } from './paragraph';

export interface TableInit {
  readonly rows: number;
  readonly columns: number;
  readonly columnWidthsTwips?: readonly number[];
}

// 12240 (US Letter page width, twips) - 2 x 1440 (1in margins), matching createEmptyDocxPackage's default section -- the content width a new table defaults to when no explicit widths are given.
const DEFAULT_TABLE_WIDTH_TWIPS = 9360;

// ECMA-376 CT_TcPrBase's own child element sequence, narrowed to the two elements this codebase ever writes -- w:gridSpan must precede w:vMerge when both are present on a merge-start cell.
const TC_PR_CHILD_ORDER = ['w:gridSpan', 'w:vMerge'];

export type DocxVerticalMerge = 'restart' | 'continue';

export class DocxTableCell {
  constructor(private readonly node: XmlElement) {}

  // w:tcPr must be the FIRST child of w:tc, before any w:p/w:tbl block content (ECMA-376 CT_Tc) -- unlike TC_PR_CHILD_ORDER's own internal ordering, this is a plain unshift since w:tcPr has no ordered sibling of its own kind to insert relative to.
  private tcPrElement(create: true): XmlElement;
  private tcPrElement(create: false): XmlElement | undefined;
  private tcPrElement(create: boolean): XmlElement | undefined {
    const existing = directChildElement(this.node, 'w:tcPr');
    if (existing !== undefined || !create) {
      return existing;
    }
    const created = el('w:tcPr');
    this.node.children.unshift(created);
    return created;
  }

  get colSpan(): number | undefined {
    const tcPr = this.tcPrElement(false);
    const gridSpan = tcPr === undefined ? undefined : directChildElement(tcPr, 'w:gridSpan');
    const val = gridSpan === undefined ? undefined : attr(gridSpan, 'w:val');
    return val === undefined ? undefined : Number(val);
  }

  // Merges N grid columns into this one cell (ECMA-376 w:tcPr/w:gridSpan) -- the write-side inverse of ooxml.js's own readTable, whose ContentTableCell.colSpan this mirrors. A caller building a merged table writes this on the SPAN'S OWN starting cell only; there is no separate DOM element for the columns it covers, since docx (unlike ODF) simply omits a w:tc for each consumed column rather than writing an explicit placeholder for it.
  set colSpan(value: number | undefined) {
    if (value === undefined) {
      const tcPr = this.tcPrElement(false);
      if (tcPr !== undefined) {
        tcPr.children = tcPr.children.filter((c) => !(c.type === 'element' && c.tag === 'w:gridSpan'));
      }
      return;
    }
    const tcPr = this.tcPrElement(true);
    tcPr.children = tcPr.children.filter((c) => !(c.type === 'element' && c.tag === 'w:gridSpan'));
    insertInSchemaOrder(tcPr, el('w:gridSpan', { 'w:val': String(value) }), TC_PR_CHILD_ORDER);
  }

  get verticalMerge(): DocxVerticalMerge | undefined {
    const tcPr = this.tcPrElement(false);
    const vMerge = tcPr === undefined ? undefined : directChildElement(tcPr, 'w:vMerge');
    if (vMerge === undefined) {
      return undefined;
    }
    return attr(vMerge, 'w:val') === 'restart' ? 'restart' : 'continue';
  }

  // Marks this cell as the start ('restart') or a covered continuation ('continue') of a vertical merge (ECMA-376 w:tcPr/w:vMerge) -- unlike colSpan, a vertically-merged region DOES need one real w:tc per covered row (Word's own reader has nowhere else to hang that row's own row-height/content), so a caller building a merged table writes 'restart' on the top cell and 'continue' on the corresponding cell in every row it covers.
  set verticalMerge(value: DocxVerticalMerge | undefined) {
    if (value === undefined) {
      const tcPr = this.tcPrElement(false);
      if (tcPr !== undefined) {
        tcPr.children = tcPr.children.filter((c) => !(c.type === 'element' && c.tag === 'w:vMerge'));
      }
      return;
    }
    const tcPr = this.tcPrElement(true);
    tcPr.children = tcPr.children.filter((c) => !(c.type === 'element' && c.tag === 'w:vMerge'));
    insertInSchemaOrder(tcPr, value === 'restart' ? el('w:vMerge', { 'w:val': 'restart' }) : el('w:vMerge'), TC_PR_CHILD_ORDER);
  }

  paragraphs(): DocxParagraph[] {
    const out: DocxParagraph[] = [];
    for (const child of this.node.children) {
      if (child.type === 'element' && child.tag === 'w:p') {
        out.push(new DocxParagraph(this.node.children, child));
      }
    }
    return out;
  }

  appendParagraph(init?: ParagraphInit): DocxParagraph {
    const paragraphElement = buildParagraph(init);
    this.node.children.push(paragraphElement);
    return new DocxParagraph(this.node.children, paragraphElement);
  }

  get text(): string {
    return this.paragraphs()
      .map((p) => p.text)
      .join('\n');
  }
}

export class DocxTableRow {
  constructor(private readonly node: XmlElement) {}

  cells(): DocxTableCell[] {
    const out: DocxTableCell[] = [];
    for (const child of this.node.children) {
      if (child.type === 'element' && child.tag === 'w:tc') {
        out.push(new DocxTableCell(child));
      }
    }
    return out;
  }
}

function buildCell(): XmlElement {
  return el('w:tc', {}, [buildParagraph()]);
}

export class DocxTable {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement) {
    this.container = container;
    this.node = node;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error('this DocxTable has been removed and can no longer be used');
    }
    return this.node;
  }

  rows(): DocxTableRow[] {
    const out: DocxTableRow[] = [];
    for (const child of this.live().children) {
      if (child.type === 'element' && child.tag === 'w:tr') {
        out.push(new DocxTableRow(child));
      }
    }
    return out;
  }

  cell(rowIndex: number, columnIndex: number): DocxTableCell {
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

  appendRow(columnCount: number): DocxTableRow {
    const node = this.live();
    const cells: XmlElement[] = [];
    for (let i = 0; i < columnCount; i++) {
      cells.push(buildCell());
    }
    const row = el('w:tr', {}, cells);
    node.children.push(row);
    return new DocxTableRow(row);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

function buildTblGrid(columns: number, columnWidthsTwips?: readonly number[]): XmlElement {
  const defaultWidth = Math.floor(DEFAULT_TABLE_WIDTH_TWIPS / columns);
  const cols: XmlElement[] = [];
  for (let i = 0; i < columns; i++) {
    const width = columnWidthsTwips?.[i] ?? defaultWidth;
    cols.push(el('w:gridCol', { 'w:w': String(width) }));
  }
  return el('w:tblGrid', {}, cols);
}

export function buildTable(init: TableInit): XmlElement {
  const rows: XmlElement[] = [];
  for (let r = 0; r < init.rows; r++) {
    const cells: XmlElement[] = [];
    for (let c = 0; c < init.columns; c++) {
      cells.push(buildCell());
    }
    rows.push(el('w:tr', {}, cells));
  }
  return el('w:tbl', {}, [buildTblGrid(init.columns, init.columnWidthsTwips), ...rows]);
}
