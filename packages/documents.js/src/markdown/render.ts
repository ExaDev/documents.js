import type {
  ContentBlock,
  ContentDocument,
  ContentDrawPage,
  ContentParagraph,
  ContentRun,
  ContentSheet,
  ContentSheetCell,
  ContentSlide,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
  LayoutMetadata,
} from 'document-schema.js';
import{ PAGE_SIZE_A4 } from 'document-schema.js';
import type { WriteMarkdownOptions } from 'markdown-codec';
import { headingStyleId } from 'markdown-codec';
import { formulaPlaceholderText } from '../model/formula';
import { buildMarkdownText } from './write';

// documents.js has plenty of ways to get INTO a ContentDocument from any of its eight content formats, and one way out to real bytes per format via buildXPackage -- but no way to get plain Markdown text out of an arbitrary ContentDocument, regardless of which of the five kinds it happens to be. buildMarkdownText (src/markdown/write.ts) already covers the one kind markdown-codec itself understands ('wordprocessing'); this module is what makes every OTHER kind reachable too, by flattening its own shape-specific structure (slides, sheets, drawing pages, a bare formula) into the same ContentBlock vocabulary writeMarkdown already knows how to render, then delegating to it.
//
// This is a best-effort DEGRADE, not a second writer: presentation/spreadsheet/drawing/formula content is reshaped into headings + paragraphs/tables using the one mapping that is actually defensible for each (a slide or drawing page becomes a heading-delimited section in document order; a sheet becomes a GFM table; a formula becomes its own plain-text stand-in, exactly like an embedded formula block already does in buildMarkdownText's own markdownBlock). Every one of those decisions is real information loss -- slide/page boundaries, a sheet's own print geometry, a drawing's vector shapes, a slide's speaker notes -- so every decision is reported through options.onDiagnostic rather than made silently. Diagnostics from the underlying writeMarkdown call itself (dropped table formatting, a flattened numId, ...) still flow through the ordinary WriteMarkdownOptions.sink this module inherits unchanged.

export type MarkdownRenderDiagnosticSeverity = 'info' | 'warning';

// One stable code per degrade decision this module can make, mirroring markdown-codec's own MarkdownDiagnosticCodes convention (a flat namespaced string, never a free-form message alone) so a caller can filter/aggregate on the code without parsing prose.
export const MarkdownRenderDiagnosticCodes = {
  PRESENTATION_SLIDE_AS_HEADING: 'markdown-render/presentation-slide-as-heading',
  PRESENTATION_NOTES_DROPPED: 'markdown-render/presentation-notes-dropped',
  SPREADSHEET_SHEET_AS_TABLE: 'markdown-render/spreadsheet-sheet-as-table',
  SPREADSHEET_HIDDEN_CELLS_DROPPED: 'markdown-render/spreadsheet-hidden-cells-dropped',
  SPREADSHEET_ANCHORED_CONTENT_DROPPED: 'markdown-render/spreadsheet-anchored-content-dropped',
  DRAWING_PAGE_AS_HEADING: 'markdown-render/drawing-page-as-heading',
  DRAWING_VECTORS_DROPPED: 'markdown-render/drawing-vectors-dropped',
  FORMULA_AS_PLACEHOLDER: 'markdown-render/formula-as-placeholder',
} as const;

export type MarkdownRenderDiagnosticCode = (typeof MarkdownRenderDiagnosticCodes)[keyof typeof MarkdownRenderDiagnosticCodes];

export interface MarkdownRenderDiagnostic {
  readonly code: MarkdownRenderDiagnosticCode;
  readonly severity: MarkdownRenderDiagnosticSeverity;
  readonly message: string;
}

export type MarkdownRenderDiagnosticSink = (diagnostic: MarkdownRenderDiagnostic) => void;

const NOOP_RENDER_DIAGNOSTIC_SINK: MarkdownRenderDiagnosticSink = () => {
  // Deliberately empty -- the default when a caller supplies no onDiagnostic, mirroring markdown-codec's own NOOP_MARKDOWN_DIAGNOSTIC_SINK.
};

export interface RenderMarkdownOptions extends WriteMarkdownOptions {
  // Called once per degrade decision this module makes while flattening a non-wordprocessing ContentDocument. Never called for a 'wordprocessing' document -- there is nothing to degrade on that path, since it goes straight to writeMarkdown.
  readonly onDiagnostic?: MarkdownRenderDiagnosticSink;
}

// A synthesised A4/1in section, exactly like markdown-codec's own INVENTED_PAGE_GEOMETRY default (ReadMarkdownOptions.pageSize/margins falling back to PAGE_SIZE_A4/its own DEFAULT_MARGINS) -- writeMarkdown never reads a section's pageSize/margins at all (markdown has no page-geometry construct), so these values are here purely to satisfy ContentSection's own schema shape, not because they affect the rendered text.
const SYNTHETIC_MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

// A column with no width of its own (a spreadsheet cell reader that never individuated it) falls back to this -- again cosmetic: no markdown table renderer reads ContentTable.columnWidthsPt.
const DEFAULT_COLUMN_WIDTH_PT = 72;

function headingParagraph(level: number, text: string): ContentParagraph {
  return { kind: 'paragraph', styleId: headingStyleId(level), runs: [{ text }] };
}

function textParagraph(text: string): ContentParagraph {
  return { kind: 'paragraph', runs: [{ text }] };
}

function wrapAsWordprocessing(metadata: LayoutMetadata, blocks: readonly ContentBlock[]): ContentDocument {
  return {
    kind: 'wordprocessing',
    metadata,
    sections: [{ pageSize: PAGE_SIZE_A4, margins: SYNTHETIC_MARGINS, blocks: [...blocks] }],
  };
}

// --- presentation: each slide becomes its own H2-headed section, in slide order. A slide's own shapes carry no inherent reading order beyond array position (the same assumption src/layout/slides.ts's direct-placement engine makes), so shapes render in that order with no attempt to infer which one is a "title" -- there is no structural signal to tell a title placeholder from body text once ContentShape has flattened placeholder inheritance away. ---
function presentationBlocks(document: Extract<ContentDocument, { kind: 'presentation' }>, sink: MarkdownRenderDiagnosticSink): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  document.slides.forEach((slide: ContentSlide, index: number) => {
    const slideNumber = index + 1;
    blocks.push(headingParagraph(2, `Slide ${String(slideNumber)}`));
    sink({
      severity: 'info',
      code: MarkdownRenderDiagnosticCodes.PRESENTATION_SLIDE_AS_HEADING,
      message: `slide ${String(slideNumber)} of ${String(document.slides.length)} has no markdown section equivalent; its shapes are flattened in slide order under a level-2 "Slide ${String(slideNumber)}" heading`,
    });
    for (const shape of slide.shapes) {
      blocks.push(...shape.blocks);
    }
    if (slide.notes.trim().length > 0) {
      sink({
        severity: 'info',
        code: MarkdownRenderDiagnosticCodes.PRESENTATION_NOTES_DROPPED,
        message: `slide ${String(slideNumber)}'s speaker notes have no markdown representation and were dropped`,
      });
    }
  });
  return blocks;
}

// --- drawing: each page becomes its own H2-headed section. Only shapes carry text (ContentBlock); vectors (rect/ellipse/line/path) have nothing CommonMark/GFM can represent at all, so they are dropped wholesale and reported once per page rather than once per vector -- the decision made is "this page's vector geometry is unrepresentable", not "vector N specifically". ---
function drawingBlocks(document: Extract<ContentDocument, { kind: 'drawing' }>, sink: MarkdownRenderDiagnosticSink): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  document.pages.forEach((page: ContentDrawPage, index: number) => {
    const pageNumber = index + 1;
    blocks.push(headingParagraph(2, `Page ${String(pageNumber)}`));
    sink({
      severity: 'info',
      code: MarkdownRenderDiagnosticCodes.DRAWING_PAGE_AS_HEADING,
      message: `page ${String(pageNumber)} of ${String(document.pages.length)} has no markdown section equivalent; its text-carrying shapes are flattened in shape order under a level-2 "Page ${String(pageNumber)}" heading`,
    });
    for (const shape of page.shapes) {
      blocks.push(...shape.blocks);
    }
    if (page.vectors.length > 0) {
      sink({
        severity: 'warning',
        code: MarkdownRenderDiagnosticCodes.DRAWING_VECTORS_DROPPED,
        message: `page ${String(pageNumber)} carries ${String(page.vectors.length)} vector primitive(s) (rect/ellipse/line/path) with no markdown representation; dropped`,
      });
    }
  });
  return blocks;
}

// --- spreadsheet: each sheet becomes its own H2-headed section plus (when it has any cells left after hidden rows/columns are excluded) one GFM table. A sheet's own printSettings/formulas have no markdown equivalent and are silently out of scope -- not degraded, since there was never a markdown construct they could have mapped to (the same "structural mismatch, not a bug" framing markdown-codec's own README gives colour/font/alignment). ---
function spreadsheetCellToTableCell(cell: ContentSheetCell | undefined): ContentTableCell {
  if (cell === undefined) {
    return { blocks: [textParagraph('')] };
  }
  const runs: ContentRun[] = cell.runs ?? [{ text: cell.displayText }];
  return { blocks: [{ kind: 'paragraph', runs, alignment: cell.alignment }] };
}

function sheetToTable(sheet: ContentSheet, sink: MarkdownRenderDiagnosticSink): ContentTable | undefined {
  const hiddenRows = new Set(sheet.rows.filter((row) => row.hidden === true).map((row) => row.index));
  const hiddenColumns = new Set(sheet.columns.filter((column) => column.hidden === true).map((column) => column.index));

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

  if (hiddenRows.size > 0 || hiddenColumns.size > 0) {
    sink({
      severity: 'info',
      code: MarkdownRenderDiagnosticCodes.SPREADSHEET_HIDDEN_CELLS_DROPPED,
      message: `sheet "${sheet.name}" hides ${String(hiddenRows.size)} row(s) and ${String(hiddenColumns.size)} column(s); hidden rows/columns are excluded from the rendered table`,
    });
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

  const columnWidthByIndex = new Map(sheet.columns.map((column) => [column.index, column.widthPt] as const));
  const columnWidthsPt = visibleColumns.map((column) => columnWidthByIndex.get(column) ?? DEFAULT_COLUMN_WIDTH_PT);
  const rows: ContentTableRow[] = visibleRows.map((row) => ({
    cells: visibleColumns.map((column) => spreadsheetCellToTableCell(cellByPosition.get(`${String(row)}:${String(column)}`))),
  }));

  sink({
    severity: 'info',
    code: MarkdownRenderDiagnosticCodes.SPREADSHEET_SHEET_AS_TABLE,
    message: `sheet "${sheet.name}" flattened to a ${String(rows.length)}x${String(columnWidthsPt.length)} GFM table; its first row is rendered as the table header (a GFM table always has one, and a spreadsheet has no header/body distinction of its own)`,
  });

  return { kind: 'table', rows, columnWidthsPt };
}

function spreadsheetBlocks(document: Extract<ContentDocument, { kind: 'spreadsheet' }>, sink: MarkdownRenderDiagnosticSink): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const sheet of document.sheets) {
    blocks.push(headingParagraph(2, sheet.name));
    const table = sheetToTable(sheet, sink);
    blocks.push(table ?? textParagraph('_(empty sheet)_'));

    const embeddedObjectCount = sheet.embeddedObjects?.length ?? 0;
    if (sheet.images.length > 0 || embeddedObjectCount > 0) {
      sink({
        severity: 'warning',
        code: MarkdownRenderDiagnosticCodes.SPREADSHEET_ANCHORED_CONTENT_DROPPED,
        message: `sheet "${sheet.name}" carries ${String(sheet.images.length)} anchored image(s) and ${String(embeddedObjectCount)} embedded object(s) with no placement in a GFM table; dropped`,
      });
    }
  }
  return blocks;
}

// --- formula: a standalone .odf-style formula document has no page/section/slide structure at all -- it IS one equation. It degrades to the identical plain-text stand-in buildMarkdownText's own markdownBlock already uses for a formula embedded inside a wordprocessing document (its own StarMath annotation, or the literal "[formula]" marker), so a formula reads the same way in markdown regardless of whether it arrived as a whole document or as one block inside a larger one. ---
function formulaBlocks(document: Extract<ContentDocument, { kind: 'formula' }>, sink: MarkdownRenderDiagnosticSink): ContentBlock[] {
  sink({
    severity: 'warning',
    code: MarkdownRenderDiagnosticCodes.FORMULA_AS_PLACEHOLDER,
    message: 'a standalone formula document has no markdown math construct; rendered as its own plain-text stand-in',
  });
  return [textParagraph(formulaPlaceholderText(document.formula))];
}

function degradedBlocksFor(document: Exclude<ContentDocument, { kind: 'wordprocessing' }>, sink: MarkdownRenderDiagnosticSink): ContentBlock[] {
  switch (document.kind) {
    case 'presentation':
      return presentationBlocks(document, sink);
    case 'spreadsheet':
      return spreadsheetBlocks(document, sink);
    case 'drawing':
      return drawingBlocks(document, sink);
    case 'formula':
      return formulaBlocks(document, sink);
  }
}

// The one entry point this module exists to add: ContentDocument (any of its five kinds) -> Markdown text. A 'wordprocessing' document goes straight to buildMarkdownText/writeMarkdown -- markdown-codec already understands that shape natively, so there is nothing this module should do differently. Every other kind is flattened first (see the per-kind functions above) into a synthetic 'wordprocessing' document built from the real blocks it carries, then handed to the exact same buildMarkdownText call -- so a flattened presentation/spreadsheet/drawing gets every ordinary wordprocessing-side behaviour (list rendering, table-cell formatting diagnostics, front matter, style options) for free, with zero duplicated emission logic.
export function renderContentDocumentToMarkdown(document: ContentDocument, options?: RenderMarkdownOptions): string {
  if (document.kind === 'wordprocessing') {
    return buildMarkdownText(document, options);
  }
  const sink = options?.onDiagnostic ?? NOOP_RENDER_DIAGNOSTIC_SINK;
  const blocks = degradedBlocksFor(document, sink);
  return buildMarkdownText(wrapAsWordprocessing(document.metadata, blocks), options);
}
