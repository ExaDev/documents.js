import type {
  ContentBlock,
  ContentParagraph as ContentParagraphNode,
  ContentTable as ContentTableNode,
  ContentTableCell as ContentTableCellNode,
  ContentTableRow as ContentTableRowNode,
} from "document-schema.js";
import type { ParagraphInit } from "./paragraph";
import { buildParagraph, DocParagraph } from "./paragraph";

// 468pt (6.5in) -- matches OdtTable's own DEFAULT_TABLE_WIDTH_PT (src/edit/odt/table.ts) and markdown's table.ts: the content width a new table defaults to when no explicit widths are given. Unlike markdown (whose own writer never reads columnWidthsPt at all), doc-codec's writer genuinely consumes the table-wide column grid these widths define -- each physical cell's boundaries are computed from it -- so this default is real input to the written rgdxaCenter, not just schema validity.
const DEFAULT_TABLE_WIDTH_PT = 468;

export interface TableInit {
  readonly rows: number;
  readonly columns: number;
}

// Cells carry colSpan/rowSpan setters, unlike markdown's own text-only MarkdownTableCell: doc-codec's writer encodes both merge directions for real (a horizontal merge as the row's own narrower physical-cell layout, a vertical merge as tracked continuation cells -- see doc-codec's table/write.ts top comment) and its reader reads both back, so a merge set through this editor genuinely round-trips.
export class DocTableCell {
  private readonly container: ContentTableCellNode[];
  private readonly node: ContentTableCellNode;
  private removed = false;

  constructor(container: ContentTableCellNode[], node: ContentTableCellNode) {
    this.container = container;
    this.node = node;
  }

  private live(): ContentTableCellNode {
    if (this.removed) {
      throw new Error(
        "this DocTableCell has been removed from its row and can no longer be used",
      );
    }
    return this.node;
  }

  // Removing a cell is how a horizontal merge is BUILT in this model: the shared pivot states a merge as the anchor cell's own colSpan covering grid positions the row no longer carries cells for (a covered position exists as a cell only for a VERTICAL continuation, as a bare {blocks: []} -- see doc-codec's table/write.ts top comment), so widening an anchor's colSpan past a live neighbour without removing that neighbour leaves the row claiming more columns than the grid has, which writeDocContent refuses outright. remove() is that removal.
  remove(): void {
    const index = this.container.indexOf(this.node);
    if (index !== -1) {
      this.container.splice(index, 1);
    }
    this.removed = true;
  }

  paragraphs(): DocParagraph[] {
    return this.live()
      .blocks.filter(
        (block): block is ContentParagraphNode => block.kind === "paragraph",
      )
      .map((block) => new DocParagraph(this.live().blocks, block));
  }

  appendParagraph(init?: ParagraphInit): DocParagraph {
    const paragraph = buildParagraph(init);
    this.live().blocks.push(paragraph);
    return new DocParagraph(this.live().blocks, paragraph);
  }

  // Newline-joined across this cell's own paragraphs, matching MarkdownTableCell.text/OdtTableCell.text's own convention. Unlike markdown (whose writer space-joins a multi-paragraph cell back down to one line), a multi-paragraph doc cell round-trips as multiple paragraphs -- the getter reports both what the cell holds and what the writer will keep.
  get text(): string {
    return this.paragraphs()
      .map((p) => p.text)
      .join("\n");
  }

  // Clears this cell's existing blocks and replaces them with a single paragraph carrying a single run -- the same clear-and-replace convention MarkdownTableCell.text's own setter uses.
  set text(value: string) {
    this.live().blocks = [buildParagraph({ text: value })];
  }

  get colSpan(): number | undefined {
    return this.live().colSpan;
  }

  set colSpan(value: number | undefined) {
    if (value === undefined) {
      delete this.live().colSpan;
    } else {
      this.live().colSpan = value;
    }
  }

  get rowSpan(): number | undefined {
    return this.live().rowSpan;
  }

  set rowSpan(value: number | undefined) {
    if (value === undefined) {
      delete this.live().rowSpan;
    } else {
      this.live().rowSpan = value;
    }
  }
}

export class DocTableRow {
  private readonly node: ContentTableRowNode;

  constructor(node: ContentTableRowNode) {
    this.node = node;
  }

  cells(): DocTableCell[] {
    return this.node.cells.map(
      (cell) => new DocTableCell(this.node.cells, cell),
    );
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

// A live view over a ContentTable object living inside a section's own blocks array, mirroring MarkdownTable over the identical node shape -- see markdown's table.ts for the live-view rationale over a plain ContentDocument with no XmlElement tree.
//
// One genuine doc-specific limit worth stating here: a table nested INSIDE a table cell is the one table-shaped construct writeDocContent refuses outright (doc-codec's table/write.ts writes depth 1 only, throwing rather than flattening -- see its README's Tables section), so while nothing stops a caller reaching a nested table through this class's own paragraphs, toBytes() on a document carrying one will name it rather than approximate it.
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

  // Appends a row with the same column count as this table's own columnWidthsPt -- the table-wide column grid those widths define is what doc-codec's writer derives every physical cell's boundaries from, so the grid and the row cell counts must stay in agreement exactly as they are kept here.
  appendRow(): DocTableRow {
    const node = this.live();
    const row = buildRow(node.columnWidthsPt.length);
    node.rows.push(row);
    return new DocTableRow(row);
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

// Builds a fresh ContentTable from scratch (not a live view), with an even column split of the default content width -- the identical defaulting MarkdownTable.buildTable applies, except here the widths are genuine writer input rather than schema ballast.
export function buildTable(init: TableInit): ContentTableNode {
  const columnWidthsPt = Array.from(
    { length: init.columns },
    () => DEFAULT_TABLE_WIDTH_PT / init.columns,
  );
  const rows: ContentTableRowNode[] = [];
  for (let r = 0; r < init.rows; r++) {
    rows.push(buildRow(init.columns));
  }
  return { kind: "table", rows, columnWidthsPt };
}
