// A GFM table -> ContentTable: evenly-distributed column widths across the section's own content width, and a delimiter row's own per-column alignment carried onto each cell's ContentParagraph.alignment. A cell's own header-ness is NOT also encoded as literal bold ContentRun styling -- it is already fully recoverable from position alone (rows[0] is always the header row, per src/emit/table.ts's own top-of-file note), and GFM's `<th>` rendering bold is a browser default-stylesheet convention, not something the markdown source itself ever spells out with `**`; forcing bold here would round-trip a plain `| Header |` cell back out as `| **Header** |` once written and reparsed, a real fidelity regression rather than a faithful mapping. A markdown table cell holds inline content only (MarkdownTableCellNode.children, src/ast/ast.ts) -- there is no nested table, no colSpan/rowSpan, no cell background, and never more than one paragraph's worth of content, so none of ContentTableCell's own colSpan/rowSpan/background fields are ever set here; those only become relevant on the WRITE side, when a ContentTable arriving from some OTHER format's own richer table model has to be flattened down to fit GFM's table grammar -- see src/emit/table.ts's own top-of-file note and MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED/TABLE_CELL_MULTI_PARAGRAPH_JOINED.

import type { Alignment, ContentTable, ContentTableCell, ContentTableRow } from 'document-schema.js';
import type { MarkdownTableAlignment, MarkdownTableCellNode, MarkdownTableNode } from '../ast/ast';
import type { InlineLowerContext } from './inline';
import { lowerInlineNodes } from './inline';

const MIN_COLUMN_COUNT = 1;

function toParagraphAlignment(alignment: MarkdownTableAlignment): Alignment | undefined {
  return alignment === 'none' ? undefined : alignment;
}

function lowerTableCell(cell: MarkdownTableCellNode, alignment: MarkdownTableAlignment | undefined, context: InlineLowerContext): ContentTableCell {
  const runs = lowerInlineNodes(cell.children, context);
  const paragraphAlignment = toParagraphAlignment(alignment ?? 'none');
  return {
    blocks: [
      {
        kind: 'paragraph',
        runs,
        ...(paragraphAlignment === undefined ? {} : { alignment: paragraphAlignment }),
      },
    ],
  };
}

export function lowerTable(node: MarkdownTableNode, contentWidthPt: number, context: InlineLowerContext): ContentTable {
  const columnCount = Math.max(MIN_COLUMN_COUNT, node.alignments.length);
  const columnWidthsPt = Array.from({ length: columnCount }, () => contentWidthPt / columnCount);

  const rows: ContentTableRow[] = node.children.map((row) => ({
    cells: row.children.map((cell, index) => lowerTableCell(cell, node.alignments[index], context)),
  }));

  return { kind: 'table', rows, columnWidthsPt };
}
