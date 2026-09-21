import {
  tableCellColumnSpan,
  tableGridColumnCount,
  walkTableGrid,
} from "document-schema.js";
import {
  readOdpContent,
  readPptxContent,
  type ContentTable,
  type ContentTableCell,
  type PptxTable,
} from "documents.js";
import type { RichPresentationOpenDocument } from "./slide-family.js";
import { truncatePreview } from "./text.js";

// A slide table's own cell TEXT has no live-view getter at all on the pptx side (PptxTableCell exposes only colSpan/rowSpan/horizontalMerge/verticalMerge/setParagraphs -- see documents.js's own edit/pptx/table.ts doc comment: a merge is pure attribute-flipping on cells that already exist, never element removal/retagging), so display goes through the content pivot instead -- the same "a live accessor is display-unsafe, read through readXContent for display, mutate through the live editor for writes" convention screens/editors/ods/shared.ts's `resolveSheet` already established for OdsSheet.cell(). odp reuses OdtTable internally (see documents.js's own README: "OdpSlide.addTable ... reuses OdtTable/buildTable WHOLESALE for it"), which DOES carry a real `.text` getter per cell, but reading through the content pivot here anyway keeps this one function correct for both formats uniformly rather than special-casing odp.
export function resolveSlideTable(
  doc: RichPresentationOpenDocument,
  slideIndex: number,
  tableIndex: number,
): ContentTable | undefined {
  return readSlideTables(doc, slideIndex)[tableIndex];
}

// Every table on one slide, in the same document order PptxSlide.tables()/OdpSlide.tables() enumerate in, read through the content pivot. Empty for a slide index beyond the deck.
function readSlideTables(
  doc: RichPresentationOpenDocument,
  slideIndex: number,
): readonly ContentTable[] {
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
    return [];
  }
  // A table graphicFrame/draw:frame reads back as an ordinary ContentShape whose own blocks[0] is the ContentTable (see slide-detail.test.tsx's own DocumentProbe, which relies on this exact shape) -- there is no separate top-level "tables" array in ContentSlide, so every shape's blocks are searched for one.
  return slide.shapes.flatMap((shape) =>
    shape.blocks.filter(
      (block): block is ContentTable => block.kind === "table",
    ),
  );
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

/** One box of a slide table's displayed grid: a merged region's anchor, an unmerged cell, or the stretch of a merged region that continues down from an anchor in an earlier row. */
export interface SlideTableSegment {
  /** The grid row this box is drawn in. */
  readonly rowIndex: number;
  /** The first grid column this box occupies. */
  readonly columnIndex: number;
  /** How many grid columns this box occupies in its row. */
  readonly columnSpan: number;
  /** The anchor or unmerged cell to show text for; undefined for a continuation box, whose text belongs to the anchor above and is not repeated. */
  readonly cell: ContentTableCell | undefined;
}

/**
 * The boxes to draw for each row of a slide table. A ContentTable row is dense (one entry per grid column, a merged region's covered positions being real, block-less entries), so drawing every entry would show a merged region as several separate empty cells. Instead a region's anchor is drawn once at its full width, and the positions it covers to its right in the same row are absorbed into that box. Positions a region covers in later rows are drawn as continuation boxes, adjacent positions of one region sharing one box, so the region reads as one block spanning the rows it occupies. Grid columns stay addressable by index: a cursor on any covered position lies within the box that contains it.
 */
export function slideTableRowSegments(
  table: ContentTable,
): SlideTableSegment[][] {
  return walkTableGrid(table).map((positions, rowIndex) => {
    const segments: SlideTableSegment[] = [];
    let continuedFrom: { row: number; column: number } | undefined;
    for (const position of positions) {
      if (position.anchorRowIndex === undefined) {
        continuedFrom = undefined;
        segments.push({
          rowIndex,
          columnIndex: position.columnIndex,
          columnSpan: tableCellColumnSpan(position.cell),
          cell: position.cell,
        });
        continue;
      }
      if (position.anchorRowIndex === rowIndex) {
        continue;
      }
      const previous = segments[segments.length - 1];
      if (
        previous !== undefined &&
        continuedFrom?.row === position.anchorRowIndex &&
        continuedFrom.column === position.anchorColumnIndex
      ) {
        segments[segments.length - 1] = {
          ...previous,
          columnSpan: previous.columnSpan + 1,
        };
        continue;
      }
      continuedFrom = {
        row: position.anchorRowIndex,
        column: position.anchorColumnIndex,
      };
      segments.push({
        rowIndex,
        columnIndex: position.columnIndex,
        columnSpan: 1,
        cell: undefined,
      });
    }
    return segments;
  });
}

/**
 * The text drawn inside a box that is `width` terminal columns wide, borders excluded. An anchor or unmerged cell shows its own text, truncated to fit; a continuation box shows an up arrow, since the region's text is displayed once, at its anchor.
 */
export function segmentText(segment: SlideTableSegment, width: number): string {
  return segment.cell === undefined
    ? "↑"
    : truncatePreview(slideTableCellText(segment.cell), width);
}

/** Whether a grid position lies inside a box: on the box's own row and in one of the grid columns it occupies. A cursor on any position a merged region covers therefore selects the region's whole box. */
export function segmentContains(
  segment: SlideTableSegment,
  position: { readonly row: number; readonly column: number } | undefined,
): boolean {
  return (
    position?.row === segment.rowIndex &&
    position.column >= segment.columnIndex &&
    position.column < segment.columnIndex + segment.columnSpan
  );
}

export interface SlideTableSummary {
  readonly index: number;
  readonly rowCount: number;
  readonly columnCount: number;
}

function summarizePptxTable(
  table: PptxTable,
  index: number,
): SlideTableSummary {
  const rows = table.rows();
  return {
    index,
    rowCount: rows.length,
    // Every row of a DrawingML table carries exactly one a:tc per grid column (merged positions are flagged, never removed), so a live row's own cell count is the grid width.
    columnCount: rows[0]?.cells().length ?? 0,
  };
}

// The dimension summary a slide's own table list (slide-detail.tsx) renders. A pptx table's live row already has one entry per grid column, so it is read directly off the live PptxTable and spares a full readPptxContent walk on every keystroke of an unrelated screen (shape text editing, notes editing, ...) that also re-renders the same slide-detail screen. An odp table cannot be read that way: OdtTableRow.cells() lists only the real cells and omits the covered ones, so a merged row would report fewer columns than the grid has. The content pivot's dense ContentTable gives the grid width for it.
export function summarizeSlideTables(
  doc: RichPresentationOpenDocument,
  slideIndex: number,
): readonly SlideTableSummary[] {
  if (doc.format === "odp") {
    return readSlideTables(doc, slideIndex).map((table, index) => ({
      index,
      rowCount: table.rows.length,
      columnCount: tableGridColumnCount(table),
    }));
  }
  return (doc.editor.slides()[slideIndex]?.tables() ?? []).map((table, index) =>
    summarizePptxTable(table, index),
  );
}
