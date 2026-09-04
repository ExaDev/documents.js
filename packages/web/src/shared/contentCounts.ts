import type { ContentBlock, ContentDocument } from "documents.js";

// Recurses through table cells (which themselves contain blocks) so a table-heavy document's block count reflects the blocks inside cells, not just the table-as-one-block. Embedded objects are counted as a single block rather than recursing into their nested ContentDocument -- bounded depth, not unbounded.
function countBlocksDeep(blocks: readonly ContentBlock[]): number {
  let count = 0;
  for (const block of blocks) {
    count += 1;
    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          count += countBlocksDeep(cell.blocks);
        }
      }
    }
  }
  return count;
}

// A variant-appropriate one-line structural summary of a ContentDocument, for the content-backed structure panel -- the detailed tree (StructureTree) shows everything else. Each variant has a genuinely different shape (sections vs slides vs sheets vs pages vs formula), so forcing them all into one "blockKindCounts" table would be misleading for the variants that have no blocks at all (spreadsheets have cells, not blocks).
export function contentSummary(content: ContentDocument): readonly string[] {
  switch (content.kind) {
    case "wordprocessing": {
      const blocks = content.sections.reduce(
        (sum, section) => sum + countBlocksDeep(section.blocks),
        0,
      );
      return [
        `${content.sections.length} section${content.sections.length === 1 ? "" : "s"}`,
        `${blocks} block${blocks === 1 ? "" : "s"}`,
      ];
    }
    case "presentation": {
      const shapes = content.slides.reduce(
        (sum, slide) => sum + slide.shapes.length,
        0,
      );
      return [
        `${content.slides.length} slide${content.slides.length === 1 ? "" : "s"}`,
        `${shapes} shape${shapes === 1 ? "" : "s"}`,
      ];
    }
    case "spreadsheet": {
      const cells = content.sheets.reduce(
        (sum, sheet) => sum + sheet.cells.length,
        0,
      );
      return [
        `${content.sheets.length} sheet${content.sheets.length === 1 ? "" : "s"}`,
        `${cells} cell${cells === 1 ? "" : "s"}`,
      ];
    }
    case "drawing": {
      const shapes = content.pages.reduce(
        (sum, page) => sum + page.shapes.length,
        0,
      );
      const vectors = content.pages.reduce(
        (sum, page) => sum + page.vectors.length,
        0,
      );
      return [
        `${content.pages.length} page${content.pages.length === 1 ? "" : "s"}`,
        `${shapes} shape${shapes === 1 ? "" : "s"}`,
        `${vectors} vector${vectors === 1 ? "" : "s"}`,
      ];
    }
    case "formula":
      return ["formula"];
  }
}
