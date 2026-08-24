import {
  readOdpContent,
  readPptxContent,
  type ContentTable,
  type ContentTableCell,
  type OdtTable,
  type PptxTable,
} from "documents.js";
import type { PresentationOpenDocument } from "./slide-family.js";

// A slide table's own cell TEXT has no live-view getter at all on the pptx side (PptxTableCell exposes only colSpan/rowSpan/horizontalMerge/verticalMerge/setParagraphs -- see documents.js's own edit/pptx/table.ts doc comment: a merge is pure attribute-flipping on cells that already exist, never element removal/retagging), so display goes through the content pivot instead -- the same "a live accessor is display-unsafe, read through readXContent for display, mutate through the live editor for writes" convention screens/editors/ods/shared.ts's `resolveSheet` already established for OdsSheet.cell(). odp reuses OdtTable internally (see documents.js's own README: "OdpSlide.addTable ... reuses OdtTable/buildTable WHOLESALE for it"), which DOES carry a real `.text` getter per cell, but reading through the content pivot here anyway keeps this one function correct for both formats uniformly rather than special-casing odp.
export function resolveSlideTable(
  doc: PresentationOpenDocument,
  slideIndex: number,
  tableIndex: number,
): ContentTable | undefined {
  const content =
    doc.format === "odp"
      ? readOdpContent(doc.editor.toPackage())
      : readPptxContent(doc.editor.toPackage());
  if (content.kind !== "presentation") {
    throw new Error(
      "readPptxContent/readOdpContent always resolve a presentation package to the presentation ContentDocument variant.",
    );
  }
  const slide = content.slides[slideIndex];
  if (slide === undefined) {
    return undefined;
  }
  // A table graphicFrame/draw:frame reads back as an ordinary ContentShape whose own blocks[0] is the ContentTable (see slide-detail.test.tsx's own DocumentProbe, which relies on this exact shape) -- there is no separate top-level "tables" array in ContentSlide, so every shape's blocks are searched for one, in the same document order PptxSlide.tables()/OdpSlide.tables() themselves enumerate in.
  return slide.shapes.flatMap((shape) =>
    shape.blocks.filter(
      (block): block is ContentTable => block.kind === "table",
    ),
  )[tableIndex];
}

// Concatenates a cell's own paragraph blocks' run text, newline-joined between paragraphs -- the ContentTableCell-shaped equivalent of DocxTableCell.text/OdtTableCell.text (both `paragraphs().map((p) => p.text).join('\n')`), since ContentTableCell itself carries only `blocks`, never a flattened `.text` of its own.
export function slideTableCellText(cell: ContentTableCell): string {
  return cell.blocks
    .filter(
      (
        block,
      ): block is Extract<
        (typeof cell.blocks)[number],
        { readonly kind: "paragraph" }
      > => block.kind === "paragraph",
    )
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
    .join("\n");
}

export interface SlideTableSummary {
  readonly index: number;
  readonly rowCount: number;
  readonly columnCount: number;
}

function summarizeGridTable(
  table: PptxTable | OdtTable,
  index: number,
): SlideTableSummary {
  const rows = table.rows();
  return {
    index,
    rowCount: rows.length,
    columnCount: rows[0]?.cells().length ?? 0,
  };
}

// The live-editor-side dimension summary a slide's own table list (slide-detail.tsx) renders -- deliberately NOT going through the content pivot the way resolveSlideTable above does, since row/column counts are cheap to read directly off the live PptxTable/OdpTableShape.table and doing so avoids a full readPptxContent/readOdpContent walk on every keystroke of an unrelated screen (shape text editing, notes editing, ...) that also re-renders this same slide-detail screen.
export function summarizeSlideTables(
  doc: PresentationOpenDocument,
  slideIndex: number,
): readonly SlideTableSummary[] {
  if (doc.format === "odp") {
    return (doc.editor.slides()[slideIndex]?.tables() ?? []).map(
      (entry, index) => summarizeGridTable(entry.table, index),
    );
  }
  return (doc.editor.slides()[slideIndex]?.tables() ?? []).map((table, index) =>
    summarizeGridTable(table, index),
  );
}
