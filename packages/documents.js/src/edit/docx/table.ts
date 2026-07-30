import type { XmlElement, XmlNode } from 'ooxml.js';
import { removeChild } from '../../xml/edit';
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

export class DocxTableCell {
  constructor(private readonly node: XmlElement) {}

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
