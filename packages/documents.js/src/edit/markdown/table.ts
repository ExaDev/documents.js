import type {
  ContentBlock,
  ContentParagraph as ContentParagraphNode,
  ContentTable as ContentTableNode,
  ContentTableCell as ContentTableCellNode,
  ContentTableRow as ContentTableRowNode,
} from "document-schema.js";
import type { ParagraphInit } from "./paragraph";
import { buildParagraph, MarkdownParagraph } from "./paragraph";

// 468pt (6.5in) -- matches OdtTable's own DEFAULT_TABLE_WIDTH_PT (src/edit/odt/table.ts): the content width a new table defaults to when no explicit widths are given. columnWidthsPt is a required ContentTable field but is never actually read by markdown-codec's own dist/emit/table.js emitTable -- a GFM table has no column-width concept at all, only a column count (derived from the header row's own cell count) -- so this is carried purely for schema validity, the same "markdown cannot express this, but the shared pivot still needs a value" accommodation ContentParagraph's own unused fields get elsewhere in this editor.
const DEFAULT_TABLE_WIDTH_PT = 468;

export interface TableInit {
  readonly rows: number;
  readonly columns: number;
}

// Text-only cells: paragraphs()/appendParagraph()/get-set text, deliberately with no colSpan/rowSpan/per-column-alignment setter of their own. This matches this editor's own real ceiling, not merely markdown's -- markdown-codec's own dist/emit/table.js renderCellText already reports TABLE_CELL_FORMATTING_DROPPED for any cell colSpan/rowSpan/background it finds (a GFM table cell has no merge or fill concept at all) and TABLE_CELL_MULTI_PARAGRAPH_JOINED for more than one block (a GFM cell is exactly one line), so exposing those setters here would only build content markdown-codec's own writer immediately discards or flattens.
export class MarkdownTableCell {
  private readonly node: ContentTableCellNode;

  constructor(node: ContentTableCellNode) {
    this.node = node;
  }

  paragraphs(): MarkdownParagraph[] {
    return this.node.blocks
      .filter(
        (block): block is ContentParagraphNode => block.kind === "paragraph",
      )
      .map((block) => new MarkdownParagraph(this.node.blocks, block));
  }

  appendParagraph(init?: ParagraphInit): MarkdownParagraph {
    const paragraph = buildParagraph(init);
    this.node.blocks.push(paragraph);
    return new MarkdownParagraph(this.node.blocks, paragraph);
  }

  // Newline-joined across this cell's own paragraphs, matching OdtTableCell.text/OdpShape.text's own convention -- markdown-codec's own writer then space-joins them back down to the single line a GFM cell allows (see TABLE_CELL_MULTI_PARAGRAPH_JOINED above), but the getter here reports what the cell actually holds, not what the writer will collapse it to.
  get text(): string {
    return this.paragraphs()
      .map((p) => p.text)
      .join("\n");
  }

  // Clears this cell's existing blocks and replaces them with a single paragraph carrying a single run -- the same clear-and-replace convention OdpShape.text's own setter uses (src/edit/odp/shape.ts).
  set text(value: string) {
    this.node.blocks = [buildParagraph({ text: value })];
  }
}

export class MarkdownTableRow {
  private readonly node: ContentTableRowNode;

  constructor(node: ContentTableRowNode) {
    this.node = node;
  }

  cells(): MarkdownTableCell[] {
    return this.node.cells.map((cell) => new MarkdownTableCell(cell));
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

// A live view over a ContentTable object living inside a body's own blocks array -- see odt's table.ts (OdtTable) for the same live-view rationale, adapted for a format with no XmlElement tree (see paragraph.ts's own top-of-file note on why holding the plain object directly stays live).
export class MarkdownTable {
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
        "this MarkdownTable has been removed from its body and can no longer be used",
      );
    }
    return this.node;
  }

  rows(): MarkdownTableRow[] {
    return this.live().rows.map((row) => new MarkdownTableRow(row));
  }

  // Appends a row with the same column count as this table's own columnWidthsPt. rows()[0] is always treated as the GFM header row on write (markdown-codec's own dist/emit/table.js emitTable destructures `const [header, ...body] = table.rows`, deriving the delimiter row's per-column alignment from the header row alone and never re-emitting it as a body row) -- appendRow does not distinguish header from body itself, so the FIRST row appended (or the first row TableInit built) is the one that becomes the header on write.
  appendRow(): MarkdownTableRow {
    const node = this.live();
    const row = buildRow(node.columnWidthsPt.length);
    node.rows.push(row);
    return new MarkdownTableRow(row);
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

// Builds a fresh ContentTable from scratch (not a live view). rows[0] is always the GFM header row on write -- see MarkdownTable.appendRow's own note.
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
