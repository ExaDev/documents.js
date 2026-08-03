import type { XmlElement } from 'ooxml.js';
import { attr } from 'ooxml.js';
import type { Box } from '../../model/geometry';
import { ptToEmu } from '../../model/units';
import { directChildElement, removeAttr, setAttr } from '../../xml/edit';
import { el } from '../../xml/fragment';
import type { DrawingParagraphInit } from './shape';
import { buildDrawingParagraph, ROTATION_UNITS_PER_DEGREE } from './shape';

export interface PptxTableInit {
  readonly rows: number;
  readonly columns: number;
  readonly columnWidthsPt?: readonly number[];
}

// Matches docx/odt's own DEFAULT_TABLE_WIDTH_TWIPS/DEFAULT_TABLE_WIDTH_PT convention (468pt, US Letter width minus 1in margins either side) -- the content width a new table defaults to when no explicit column widths are given.
const DEFAULT_TABLE_WIDTH_PT = 468;
// PowerPoint always writes a real measured row height; nothing in this writer's own callers (buildPptxPackage's appendShape) currently supplies one, so every row gets this single-line placeholder.
const DEFAULT_ROW_HEIGHT_PT = 20;

const TABLE_GRAPHIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table';

// A live view over a DrawingML table cell (a:tc) -- the ContentTable-cell-shaped counterpart to DocxTableCell/OdtTableCell (src/edit/docx/table.ts, src/edit/odt/table.ts), but for a table living inside a slide's own p:graphicFrame rather than a document body. Unlike docx's gridSpan-collapses-the-row model, and matching ODF's covered-table-cell model in spirit, a DrawingML table's own a:tr always carries exactly `columns` a:tc elements regardless of merges (ooxml.js's own readTable confirms this: every row is `childrenWithTag(tr, "a:tc").map(readTableCell)` with no gridSpan-based skipping) -- a merge is expressed purely via attributes on the covered cell's own a:tc (hMerge/vMerge, boolean "1"), never by omitting or replacing the element the way docx/ODF each do in their own way.
export class PptxTableCell {
  constructor(private readonly node: XmlElement) {}

  get colSpan(): number | undefined {
    const value = attr(this.node, 'gridSpan');
    return value === undefined ? undefined : Number(value);
  }

  set colSpan(value: number | undefined) {
    if (value === undefined) {
      removeAttr(this.node, 'gridSpan');
      return;
    }
    setAttr(this.node, 'gridSpan', String(value));
  }

  get rowSpan(): number | undefined {
    const value = attr(this.node, 'rowSpan');
    return value === undefined ? undefined : Number(value);
  }

  set rowSpan(value: number | undefined) {
    if (value === undefined) {
      removeAttr(this.node, 'rowSpan');
      return;
    }
    setAttr(this.node, 'rowSpan', String(value));
  }

  // Marks this cell as covered by a merge starting to its LEFT, in the same row (ECMA-376 a:tc/@hMerge).
  set horizontalMerge(value: boolean) {
    if (value) {
      setAttr(this.node, 'hMerge', '1');
    } else {
      removeAttr(this.node, 'hMerge');
    }
  }

  // Marks this cell as covered by a merge starting ABOVE it, in an earlier row (ECMA-376 a:tc/@vMerge). A cell covered by a merge that is both wider and taller than one cell carries both horizontalMerge and verticalMerge set, matching real PowerPoint output for the interior/trailing cells of a rectangular merge.
  set verticalMerge(value: boolean) {
    if (value) {
      setAttr(this.node, 'vMerge', '1');
    } else {
      removeAttr(this.node, 'vMerge');
    }
  }

  // Replaces this cell's own a:txBody paragraph content -- mirrors PptxShape.setParagraphs (shape.ts) exactly, since a:tc's own a:txBody is the identical CT_TextBody content model a p:sp's is.
  setParagraphs(paragraphs: readonly DrawingParagraphInit[]): void {
    const txBody = directChildElement(this.node, 'a:txBody');
    if (txBody === undefined) {
      return; // unreachable in practice -- buildTableCellElement always creates one.
    }
    const nonParagraphChildren = txBody.children.filter((c) => !(c.type === 'element' && c.tag === 'a:p'));
    txBody.children = [...nonParagraphChildren, ...paragraphs.map(buildDrawingParagraph)];
  }
}

export class PptxTableRow {
  constructor(private readonly node: XmlElement) {}

  cells(): PptxTableCell[] {
    const out: PptxTableCell[] = [];
    for (const child of this.node.children) {
      if (child.type === 'element' && child.tag === 'a:tc') {
        out.push(new PptxTableCell(child));
      }
    }
    return out;
  }
}

// A live view over a DrawingML table (a:tbl) living inside a slide's own p:graphicFrame -- built via PptxSlide.addTable (slide.ts), the pptx-side counterpart to a document-level DocxTable/OdtTable.
export class PptxTable {
  constructor(private readonly node: XmlElement) {}

  rows(): PptxTableRow[] {
    const out: PptxTableRow[] = [];
    for (const child of this.node.children) {
      if (child.type === 'element' && child.tag === 'a:tr') {
        out.push(new PptxTableRow(child));
      }
    }
    return out;
  }

  cell(rowIndex: number, columnIndex: number): PptxTableCell {
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
}

function buildTableCellElement(): XmlElement {
  return el('a:tc', {}, [el('a:txBody', {}, [el('a:bodyPr'), el('a:lstStyle'), el('a:p', {}, [el('a:endParaRPr')])]), el('a:tcPr')]);
}

function buildTblGrid(columns: number, columnWidthsPt?: readonly number[]): XmlElement {
  const defaultWidth = DEFAULT_TABLE_WIDTH_PT / columns;
  const cols: XmlElement[] = [];
  for (let i = 0; i < columns; i++) {
    const widthPt = columnWidthsPt?.[i] ?? defaultWidth;
    cols.push(el('a:gridCol', { w: String(ptToEmu(widthPt)) }));
  }
  return el('a:tblGrid', {}, cols);
}

export function buildDrawingTable(init: PptxTableInit): XmlElement {
  const rows: XmlElement[] = [];
  for (let r = 0; r < init.rows; r++) {
    const cells: XmlElement[] = [];
    for (let c = 0; c < init.columns; c++) {
      cells.push(buildTableCellElement());
    }
    rows.push(el('a:tr', { h: String(ptToEmu(DEFAULT_ROW_HEIGHT_PT)) }, cells));
  }
  return el('a:tbl', {}, [el('a:tblPr'), buildTblGrid(init.columns, init.columnWidthsPt), ...rows]);
}

// Builds the p:graphicFrame wrapping a DrawingML table -- a genuinely different shape kind from PptxShape's own p:sp/p:pic (its own frame lives on a direct p:xfrm child, not nested inside a p:spPr the way p:sp/p:pic's does; see ooxml.js's own readGraphicFrameShape), which is why table shapes get their own PptxTable/PptxTableCell view rather than being squeezed into PptxShape's existing frame/rotationDeg accessors. rotationDeg follows the identical a:xfrm/@rot convention PptxShape.rotationDeg already documents (see shape.ts).
export function buildTableGraphicFrame(frame: Box, tableElement: XmlElement, shapeId: number, rotationDeg: number | undefined): XmlElement {
  const xfrmAttrs: Record<string, string> = rotationDeg === undefined || rotationDeg === 0 ? {} : { rot: String(Math.round(rotationDeg * ROTATION_UNITS_PER_DEGREE)) };
  return el('p:graphicFrame', {}, [
    el('p:nvGraphicFramePr', {}, [el('p:cNvPr', { id: String(shapeId), name: `Table ${shapeId}` }), el('p:cNvGraphicFramePr'), el('p:nvPr')]),
    el('p:xfrm', xfrmAttrs, [
      el('a:off', { x: String(ptToEmu(frame.xPt)), y: String(ptToEmu(frame.yPt)) }),
      el('a:ext', { cx: String(ptToEmu(frame.widthPt)), cy: String(ptToEmu(frame.heightPt)) }),
    ]),
    el('a:graphic', {}, [el('a:graphicData', { uri: TABLE_GRAPHIC_URI }, [tableElement])]),
  ]);
}
