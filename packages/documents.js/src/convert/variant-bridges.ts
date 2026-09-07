import type {
  ContentBlock,
  ContentDocument,
  ContentDrawPage,
  ContentSection,
  ContentShape,
  ContentSheet,
  ContentSheetCell,
  ContentSlide,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";

import { SLIDE_SIZE_WIDESCREEN, PAGE_SIZE_A4 } from "document-schema.js";

// Cross-variant content bridges: transforms between ContentDocument variants that do NOT share a common shape (wordprocessing ↔ presentation, wordprocessing ↔ spreadsheet, drawing ↔ presentation), so pairs like docx↔pptx, odt↔xlsx, or odg↔odp can bypass PDF entirely through the content pivot. Unlike the same-variant bridges (odt↔docx, odp↔pptx, ods↔xlsx), which are a direct read→build copy because both sides share one ContentDocument variant, these are genuine semantic TRANSFORMS — a flow document has no slide boundaries, a deck has no flow — so each direction is an approximation, documented per direction below. The wordprocessing ↔ spreadsheet pair named above went unimplemented from this module's very first commit until spreadsheetToWordprocessing landed (ExaDev/documents.js#1043) -- the reverse direction stays unimplemented: a markdown/docx table has no cell types, formulas, or geometry of its own to recover, so wordprocessing → spreadsheet is a separate question with no honest answer here.

type WordprocessingContentDocument = Extract<
  ContentDocument,
  { kind: "wordprocessing" }
>;
type PresentationContentDocument = Extract<
  ContentDocument,
  { kind: "presentation" }
>;
type DrawingContentDocument = Extract<ContentDocument, { kind: "drawing" }>;
type SpreadsheetContentDocument = Extract<
  ContentDocument,
  { kind: "spreadsheet" }
>;

// Default text-box insets matching PowerPoint's own documented body-placeholder defaults (91440 EMU = 0.125in ≈ 9pt sides; 45720 EMU = 0.0625in ≈ 4.5pt top/bottom — the same values readOdpContent's own createOdp example uses).
const DEFAULT_INSET_LEFT_PT = 9.14;
const DEFAULT_INSET_TOP_PT = 4.57;
const DEFAULT_INSET_RIGHT_PT = 9.14;
const DEFAULT_INSET_BOTTOM_PT = 4.57;

// Heuristic: does this block start a new slide? A heading paragraph (styleId starting with 'Heading') or a page break does. Everything else accumulates into the current slide.
function startsNewSlide(block: ContentBlock): boolean {
  if (block.kind === "pageBreak") {
    return true;
  }
  if (
    block.kind === "paragraph" &&
    block.styleId?.startsWith("Heading") === true
  ) {
    return true;
  }
  return false;
}

// wordprocessing → presentation: splits a flow document's blocks into slides at heading or page-break boundaries. Each slide gets one full-width text-box shape holding that slide's own accumulated blocks. A document with no headings produces a single slide carrying everything -- a crude approximation, not a faithful deck, but the blocks themselves (paragraphs, tables, images, list membership, run styling) survive intact. Slide size is taken from the first section's page size (or widescreen 16:9 if the document has no sections).
export function wordprocessingToPresentation(
  doc: WordprocessingContentDocument,
): PresentationContentDocument {
  const allBlocks: ContentBlock[] = doc.sections.flatMap(
    (section) => section.blocks,
  );
  const slideSize = doc.sections[0]?.pageSize ?? SLIDE_SIZE_WIDESCREEN;

  // Split into slide-groups at heading/page-break boundaries.
  const slideGroups: ContentBlock[][] = [];
  let current: ContentBlock[] = [];
  for (const block of allBlocks) {
    if (startsNewSlide(block) && current.length > 0) {
      slideGroups.push(current);
      current = [];
    }
    if (block.kind !== "pageBreak") {
      current.push(block);
    }
  }
  if (current.length > 0 || slideGroups.length === 0) {
    slideGroups.push(current);
  }

  const slides: ContentSlide[] = slideGroups.map((blocks) => {
    const shape: ContentShape = {
      frame: {
        xPt: 0,
        yPt: 0,
        widthPt: slideSize.widthPt,
        heightPt: slideSize.heightPt,
      },
      insetLeftPt: DEFAULT_INSET_LEFT_PT,
      insetTopPt: DEFAULT_INSET_TOP_PT,
      insetRightPt: DEFAULT_INSET_RIGHT_PT,
      insetBottomPt: DEFAULT_INSET_BOTTOM_PT,
      blocks,
    };
    return { size: slideSize, shapes: [shape], notes: "" };
  });

  return { kind: "presentation", metadata: doc.metadata, slides };
}

// presentation → wordprocessing: concatenates every slide's shapes' blocks into one flow document (one section, A4 page). A deck has no flow structure, so slide boundaries are lost -- the blocks themselves (paragraphs, tables, images) survive intact, just concatenated. Each slide's content becomes a contiguous run of paragraphs in the resulting section.
export function presentationToWordprocessing(
  doc: PresentationContentDocument,
): WordprocessingContentDocument {
  const allBlocks: ContentBlock[] = doc.slides.flatMap((slide) =>
    slide.shapes.flatMap((shape) => shape.blocks),
  );
  const section: ContentSection = {
    pageSize: PAGE_SIZE_A4,
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks: allBlocks,
  };
  return {
    kind: "wordprocessing",
    metadata: doc.metadata,
    sections: [section],
  };
}

// drawing → presentation: each draw page becomes a slide carrying the identical ContentShape array (ContentShape is the exact same type in both ContentDrawPage.shapes and ContentSlide.shapes -- the layout engines already share the convertShape function verbatim, so the shapes need zero per-shape adaptation). A slide is a strict subset of a draw page for shapes, so every text box, image, and table on the page survives intact at its own frame. What is lost: a draw page's vector primitives (rect/ellipse/line/path) have no slot on a ContentSlide at all, so vectors are silently dropped on this hop -- the same class of lossiness as wordprocessingToPresentation's own heading-boundary heuristic (a target-variant construct with no source counterpart), not an approximation of the vectors themselves. Slide size is the draw page's own size, carried through unchanged.
export function drawingToPresentation(
  doc: DrawingContentDocument,
): PresentationContentDocument {
  const slides: ContentSlide[] = doc.pages.map((page) => ({
    size: page.size,
    shapes: page.shapes,
    notes: "",
  }));
  return { kind: "presentation", metadata: doc.metadata, slides };
}

// presentation → drawing: each slide becomes a draw page carrying the identical ContentShape array, plus an empty vectors array (a slide carries no vector primitives, so there is nothing to populate it with). This direction is clean -- a slide is a strict subset of a draw page (size + shapes), so nothing the source carries is lost on the shapes axis. What is lost: a slide's speaker notes have no field on a ContentDrawPage, so notes are dropped on this hop, the same target-variant-has-no-counterpart class as the reverse direction's vector loss.
export function presentationToDrawing(
  doc: PresentationContentDocument,
): DrawingContentDocument {
  const pages: ContentDrawPage[] = doc.slides.map((slide) => ({
    size: slide.size,
    shapes: slide.shapes,
    vectors: [],
  }));
  return { kind: "drawing", metadata: doc.metadata, pages };
}

// A single spreadsheet cell, wrapped as a one-run table-cell paragraph. Absent (a position no ContentSheetCell occupies) becomes an empty paragraph, exactly as an unfilled spreadsheet cell renders as blank in any spreadsheet application -- not a placeholder marker, since there is nothing noteworthy about an empty cell.
function spreadsheetCellToTableCell(
  cell: ContentSheetCell | undefined,
): ContentTableCell {
  if (cell === undefined) {
    return { blocks: [{ kind: "paragraph", runs: [{ text: "" }] }] };
  }
  return {
    blocks: [
      {
        kind: "paragraph",
        runs: cell.runs ?? [{ text: cell.displayText }],
        alignment: cell.alignment,
      },
    ],
  };
}

// One sheet's cells, addressed by row/column, flattened into a dense grid table -- hidden rows and hidden columns are excluded entirely (the same convention markdown/render.ts's own sheetToTable uses for its GFM output), since a wordprocessing table has no per-row/per-column visibility flag of its own to carry them forward on. A sheet with no visible cells at all (every cell hidden, or a genuinely empty sheet) produces no table -- an empty ContentTable with zero rows has nothing meaningful to render, so the caller falls back to a plain placeholder paragraph instead.
function sheetToTableBlock(sheet: ContentSheet): ContentBlock | undefined {
  const hiddenRows = new Set(
    sheet.rows.filter((row) => row.hidden === true).map((row) => row.index),
  );
  const hiddenColumns = new Set(
    sheet.columns
      .filter((column) => column.hidden === true)
      .map((column) => column.index),
  );

  const cellByPosition = new Map<string, ContentSheetCell>();
  let maxRow = -1;
  let maxColumn = -1;
  for (const cell of sheet.cells) {
    if (hiddenRows.has(cell.row) || hiddenColumns.has(cell.column)) {
      continue;
    }
    cellByPosition.set(`${String(cell.row)}:${String(cell.column)}`, cell);
    maxRow = Math.max(maxRow, cell.row);
    maxColumn = Math.max(maxColumn, cell.column);
  }
  if (cellByPosition.size === 0) {
    return undefined;
  }

  const visibleRows: number[] = [];
  for (let row = 0; row <= maxRow; row += 1) {
    if (!hiddenRows.has(row)) {
      visibleRows.push(row);
    }
  }
  const visibleColumns: number[] = [];
  for (let column = 0; column <= maxColumn; column += 1) {
    if (!hiddenColumns.has(column)) {
      visibleColumns.push(column);
    }
  }

  const columnWidthByIndex = new Map(
    sheet.columns.map((column) => [column.index, column.widthPt] as const),
  );
  const columnWidthsPt = visibleColumns.map(
    (column) => columnWidthByIndex.get(column) ?? 72,
  );
  const rows: ContentTableRow[] = visibleRows.map((row) => ({
    cells: visibleColumns.map((column) =>
      spreadsheetCellToTableCell(
        cellByPosition.get(`${String(row)}:${String(column)}`),
      ),
    ),
  }));

  return { kind: "table", rows, columnWidthsPt };
}

// spreadsheet → wordprocessing: each sheet becomes its own H2-headed section flow, plus (when it has any visible cells) one table -- a sheet's own formulas, print settings, comments, and anchored images/embedded objects have no wordprocessing counterpart and are silently out of scope, the same "structural mismatch, not a bug" framing this file's other three directions already use for their own dropped fields. headingLevel (not a producer-specific styleId) marks each sheet-name heading, so every wordprocessing-family builder recognises it as a heading on its own terms. All sheets land in a single A4 section, matching presentationToWordprocessing's own one-section convention for a source variant with no wordprocessing section boundary of its own.
export function spreadsheetToWordprocessing(
  doc: SpreadsheetContentDocument,
): WordprocessingContentDocument {
  const blocks: ContentBlock[] = [];
  for (const sheet of doc.sheets) {
    blocks.push({
      kind: "paragraph",
      headingLevel: 2,
      runs: [{ text: sheet.name }],
    });
    const table = sheetToTableBlock(sheet);
    blocks.push(
      table ?? { kind: "paragraph", runs: [{ text: "(empty sheet)" }] },
    );
  }
  const section: ContentSection = {
    pageSize: PAGE_SIZE_A4,
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks,
  };
  return {
    kind: "wordprocessing",
    metadata: doc.metadata,
    sections: [section],
  };
}
