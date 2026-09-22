import {
  tableCellColumnSpan,
  tableCellRowSpan,
  tableGridColumnCount,
  walkTableGrid,
} from "document-schema.js";
import type {
  ContentBlock,
  ContentParagraph as ContentParagraphNode,
  ContentTable as ContentTableNode,
  ContentTableCell as ContentTableCellNode,
  ContentTableRow as ContentTableRowNode,
} from "document-schema.js";
import type { TableGridRows } from "../table-grid";
import { resolvePivotTableGrid } from "../table-grid";
import type { ParagraphInit } from "./paragraph";
import { buildParagraph, DocParagraph } from "./paragraph";

// 468pt (6.5in), matching OdtTable's own DEFAULT_TABLE_WIDTH_PT (src/edit/odt/table.ts) and markdown's table.ts: the content width a new table defaults to when no explicit widths are given. Unlike markdown (whose own writer never reads the column widths at all), doc-codec's writer genuinely consumes the table-wide column grid these widths define, since each physical cell's boundaries are computed from it, so this default is real input to the written rgdxaCenter, not just schema validity.
const DEFAULT_TABLE_WIDTH_PT = 468;

export interface TableInit {
  readonly rows: number;
  readonly columns: number;
}

// A live view over one entry of a ContentTableRow's dense `cells` array (ContentTableCell's grid rule): the entry at index n is the cell at grid column n, so a merged region is its anchor plus a block-less entry at every other position it covers, and a row always has one entry per grid column. Reading a merged table therefore yields covered entries too, and DocTable.mergeCells is how a merge is built without breaking that rule. The colSpan and rowSpan setters state the anchor's own span only; they neither create nor clear the covered entries, which mergeCells does.
export class DocTableCell {
  private readonly node: ContentTableCellNode;

  constructor(node: ContentTableCellNode) {
    this.node = node;
  }

  paragraphs(): DocParagraph[] {
    return this.node.blocks
      .filter(
        (block): block is ContentParagraphNode => block.kind === "paragraph",
      )
      .map((block) => new DocParagraph(this.node.blocks, block));
  }

  appendParagraph(init?: ParagraphInit): DocParagraph {
    const paragraph = buildParagraph(init);
    this.node.blocks.push(paragraph);
    return new DocParagraph(this.node.blocks, paragraph);
  }

  // Newline-joined across this cell's own paragraphs, matching MarkdownTableCell.text/OdtTableCell.text's own convention. Unlike markdown (whose writer space-joins a multi-paragraph cell back down to one line), a multi-paragraph doc cell round-trips as multiple paragraphs — the getter reports both what the cell holds and what the writer will keep.
  get text(): string {
    return this.paragraphs()
      .map((p) => p.text)
      .join("\n");
  }

  // Clears this cell's existing blocks and replaces them with a single paragraph carrying a single run — the same clear-and-replace convention MarkdownTableCell.text's own setter uses.
  set text(value: string) {
    this.node.blocks = [buildParagraph({ text: value })];
  }

  get colSpan(): number | undefined {
    return this.node.colSpan;
  }

  set colSpan(value: number | undefined) {
    if (value === undefined) {
      delete this.node.colSpan;
    } else {
      this.node.colSpan = value;
    }
  }

  get rowSpan(): number | undefined {
    return this.node.rowSpan;
  }

  set rowSpan(value: number | undefined) {
    if (value === undefined) {
      delete this.node.rowSpan;
    } else {
      this.node.rowSpan = value;
    }
  }
}

export class DocTableRow {
  private readonly node: ContentTableRowNode;

  constructor(node: ContentTableRowNode) {
    this.node = node;
  }

  // One view per grid column, covered positions included: the row is dense, so the index is the grid column outright.
  cells(): DocTableCell[] {
    return this.node.cells.map((cell) => new DocTableCell(cell));
  }
}

function buildCell(): ContentTableCellNode {
  return { blocks: [buildParagraph()] };
}

function buildRow(columnCount: number): ContentTableRowNode {
  const cells: ContentTableCellNode[] = [];
  for (let i = 0; i < columnCount; i++) {
    cells.push(buildCell());
  }
  return { cells };
}

// A live view over a ContentTable object living inside a section's own blocks array, mirroring MarkdownTable over the identical node shape — see markdown's table.ts for the live-view rationale over a plain ContentDocument with no XmlElement tree.
//
// One genuine doc-specific limit worth stating here: a table nested INSIDE a table cell is the one table-shaped construct writeDocContent refuses outright (doc-codec's table/write.ts writes depth 1 only, throwing rather than flattening — see its README's Tables section), so while nothing stops a caller reaching a nested table through this class's own paragraphs, toBytes() on a document carrying one will name it rather than approximate it.
export class DocTable {
  private readonly container: ContentBlock[];
  private readonly node: ContentTableNode;
  private removed = false;

  constructor(container: ContentBlock[], node: ContentTableNode) {
    this.container = container;
    this.node = node;
  }

  private live(): ContentTableNode {
    if (this.removed) {
      throw new Error(
        "this DocTable has been removed from its section and can no longer be used",
      );
    }
    return this.node;
  }

  rows(): DocTableRow[] {
    return this.live().rows.map((row) => new DocTableRow(row));
  }

  // The grid's own view of the table: gridRows()[r][c] is the position at grid row r and grid column c. This table's rows are already dense, so it is the same positions rows()[r].cells() lists, resolved so that a position a merged region covers yields the region's anchor cell, with isAnchor false.
  gridRows(): TableGridRows<DocTableCell> {
    return this.grid().rows;
  }

  // The table's width in grid columns: the larger of the declared column count and the widest row.
  gridColumnCount(): number {
    return this.grid().columnCount;
  }

  private grid() {
    return resolvePivotTableGrid(this.live(), (cell) => new DocTableCell(cell));
  }

  // Appends a row with the same column count as this table's own columns, since the table-wide column grid those widths define is what doc-codec's writer derives every physical cell's boundaries from, so the grid and the row cell counts must stay in agreement exactly as they are kept here.
  appendRow(): DocTableRow {
    const node = this.live();
    const row = buildRow(node.columns.length);
    node.rows.push(row);
    return new DocTableRow(row);
  }

  // Merges the rowSpan x colSpan rectangle anchored at (startRow, startColumn). The anchor keeps its own content and takes the span; every other position in the rectangle stays in its row as a real entry (the grid rule keeps rows dense) and has its blocks discarded, since a covered entry holds no content of its own. Discarding is unconditional, matching OdtTable.mergeCells and OdsSheet.mergeCells. Only positions that are unmerged today can be merged: a rectangle touching an existing merged region, as anchor or as covered position, throws rather than producing regions whose footprints overlap.
  mergeCells(
    startRow: number,
    startColumn: number,
    rowSpan: number,
    colSpan: number,
  ): DocTableCell {
    if (
      !Number.isInteger(rowSpan) ||
      rowSpan < 1 ||
      !Number.isInteger(colSpan) ||
      colSpan < 1
    ) {
      throw new Error(
        `mergeCells: rowSpan and colSpan must be positive integers, got rowSpan=${rowSpan}, colSpan=${colSpan}`,
      );
    }
    const node = this.live();
    const grid = walkTableGrid(node);
    const anchorPosition = grid[startRow]?.[startColumn];
    if (anchorPosition === undefined) {
      throw new Error(
        `mergeCells: row ${startRow}, column ${startColumn} does not exist in this table`,
      );
    }
    if (startRow + rowSpan > grid.length) {
      throw new Error(
        `mergeCells: rowSpan ${rowSpan} starting at row ${startRow} exceeds this table's own ${grid.length} rows`,
      );
    }
    const columnCount = tableGridColumnCount(node);
    if (startColumn + colSpan > columnCount) {
      throw new Error(
        `mergeCells: colSpan ${colSpan} starting at column ${startColumn} exceeds this table's own ${columnCount} columns`,
      );
    }
    const covered: ContentTableCellNode[] = [];
    for (let rowIndex = startRow; rowIndex < startRow + rowSpan; rowIndex++) {
      for (
        let columnIndex = startColumn;
        columnIndex < startColumn + colSpan;
        columnIndex++
      ) {
        const position = grid[rowIndex]?.[columnIndex];
        if (position === undefined) {
          throw new Error(
            `mergeCells: column ${columnIndex} does not exist in row ${rowIndex}`,
          );
        }
        if (
          position.anchorRowIndex !== undefined ||
          tableCellColumnSpan(position.cell) !== 1 ||
          tableCellRowSpan(position.cell) !== 1
        ) {
          throw new Error(
            `mergeCells: row ${rowIndex}, column ${columnIndex} already belongs to a merged region`,
          );
        }
        if (rowIndex !== startRow || columnIndex !== startColumn) {
          covered.push(position.cell);
        }
      }
    }
    const anchorCell = new DocTableCell(anchorPosition.cell);
    if (colSpan > 1) {
      anchorCell.colSpan = colSpan;
    }
    if (rowSpan > 1) {
      anchorCell.rowSpan = rowSpan;
    }
    for (const cell of covered) {
      cell.blocks = [];
    }
    return anchorCell;
  }

  remove(): void {
    const node = this.live();
    const index = this.container.indexOf(node);
    if (index !== -1) {
      this.container.splice(index, 1);
    }
    this.removed = true;
  }
}

// Builds a fresh ContentTable from scratch (not a live view), with an even column split of the default content width — the identical defaulting MarkdownTable.buildTable applies, except here the widths are genuine writer input rather than schema ballast.
export function buildTable(init: TableInit): ContentTableNode {
  const columns = Array.from({ length: init.columns }, () => ({
    widthPt: DEFAULT_TABLE_WIDTH_PT / init.columns,
  }));
  const rows: ContentTableRowNode[] = [];
  for (let r = 0; r < init.rows; r++) {
    rows.push(buildRow(init.columns));
  }
  return { kind: "table", rows, columns };
}
