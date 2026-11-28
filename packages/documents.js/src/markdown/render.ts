import type {
  ContentBlock,
  ContentDocument,
  ContentDrawPage,
  ContentParagraph,
  ContentSheet,
  ContentSlide,
  ContentTable,
  LayoutMetadata,
} from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { headingStyleId } from "markdown-codec";
import { formulaPlaceholderText } from "../model/formula";
import { sheetToTable } from "../model/sheet-table";
import type { BuildMarkdownTextOptions } from "./write";
import { buildMarkdownText } from "./write";

// documents.js has plenty of ways to get INTO a ContentDocument from any of its eight content formats, and one way out to real bytes per format via buildXPackage — but no way to get plain Markdown text out of an arbitrary ContentDocument, regardless of which of the five kinds it happens to be. buildMarkdownText (src/markdown/write.ts) already covers the one kind markdown-codec itself understands ('wordprocessing'); this module is what makes every OTHER kind reachable too, by flattening its own shape-specific structure (slides, sheets, drawing pages, a bare formula) into the same ContentBlock vocabulary markdown-codec's writeMarkdownContent already knows how to render, then delegating to buildMarkdownText.
//
// This is a best-effort DEGRADE, not a second writer: presentation/spreadsheet/drawing/formula content is reshaped into headings + paragraphs/tables using the one mapping that is actually defensible for each (a slide or drawing page becomes a heading-delimited section in document order; a sheet becomes a GFM table; a formula becomes its own plain-text stand-in, exactly like an embedded formula block already does in buildMarkdownText's own markdownBlock). Every one of those decisions is real information loss — slide/page boundaries, a sheet's own print geometry, a drawing's vector shapes, a slide's speaker notes — so every decision is reported through options.onDiagnostic rather than made silently. Diagnostics from the underlying writeMarkdownContent call itself (dropped table formatting, a flattened numId, ...) still flow through the ordinary WriteMarkdownOptions.sink this module inherits unchanged.

export type MarkdownRenderDiagnosticSeverity = "info" | "warning";

// One stable code per degrade decision this module can make, mirroring markdown-codec's own MarkdownDiagnosticCodes convention (a flat namespaced string, never a free-form message alone) so a caller can filter/aggregate on the code without parsing prose.
export const MarkdownRenderDiagnosticCodes = {
  PRESENTATION_SLIDE_AS_HEADING:
    "markdown-render/presentation-slide-as-heading",
  PRESENTATION_NOTES_DROPPED: "markdown-render/presentation-notes-dropped",
  SPREADSHEET_SHEET_AS_TABLE: "markdown-render/spreadsheet-sheet-as-table",
  SPREADSHEET_HIDDEN_CELLS_DROPPED:
    "markdown-render/spreadsheet-hidden-cells-dropped",
  SPREADSHEET_ANCHORED_CONTENT_DROPPED:
    "markdown-render/spreadsheet-anchored-content-dropped",
  DRAWING_PAGE_AS_HEADING: "markdown-render/drawing-page-as-heading",
  DRAWING_VECTORS_DROPPED: "markdown-render/drawing-vectors-dropped",
  FORMULA_AS_PLACEHOLDER: "markdown-render/formula-as-placeholder",
} as const;

export type MarkdownRenderDiagnosticCode =
  (typeof MarkdownRenderDiagnosticCodes)[keyof typeof MarkdownRenderDiagnosticCodes];

export interface MarkdownRenderDiagnostic {
  readonly code: MarkdownRenderDiagnosticCode;
  readonly severity: MarkdownRenderDiagnosticSeverity;
  readonly message: string;
}

export type MarkdownRenderDiagnosticSink = (
  diagnostic: MarkdownRenderDiagnostic,
) => void;

const NOOP_RENDER_DIAGNOSTIC_SINK: MarkdownRenderDiagnosticSink = () => {
  // Deliberately empty — the default when a caller supplies no onDiagnostic, mirroring markdown-codec's own NOOP_MARKDOWN_DIAGNOSTIC_SINK.
};

// pageNumbers (inherited from BuildMarkdownTextOptions) is meant for a wordprocessing document, whose pages it labels. Any other kind is flattened into one section with no page breaks before it is written, so it counts as a single page: one number labels the whole output, and more than one throws MarkdownPageNumberCountError.
export interface RenderMarkdownOptions extends BuildMarkdownTextOptions {
  // Called once per degrade decision this module makes while flattening a non-wordprocessing ContentDocument. Never called for a 'wordprocessing' document — there is nothing to degrade on that path, since it goes straight to writeMarkdownContent.
  readonly onDiagnostic?: MarkdownRenderDiagnosticSink;
}

// A synthesised A4/1in section, exactly like markdown-codec's own INVENTED_PAGE_GEOMETRY default (ReadMarkdownOptions.pageSize/margins falling back to PAGE_SIZE_A4/its own DEFAULT_MARGINS) — writeMarkdownContent never reads a section's pageSize/margins at all (markdown has no page-geometry construct), so these values are here purely to satisfy ContentSection's own schema shape, not because they affect the rendered text.
const SYNTHETIC_MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

function headingParagraph(level: number, text: string): ContentParagraph {
  return {
    kind: "paragraph",
    styleId: headingStyleId(level),
    runs: [{ text }],
  };
}

function textParagraph(text: string): ContentParagraph {
  return { kind: "paragraph", runs: [{ text }] };
}

function wrapAsWordprocessing(
  metadata: LayoutMetadata,
  blocks: readonly ContentBlock[],
): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata,
    sections: [
      {
        pageSize: PAGE_SIZE_A4,
        margins: SYNTHETIC_MARGINS,
        blocks: [...blocks],
      },
    ],
  };
}

// --- presentation: each slide becomes its own H2-headed section, in slide order. A slide's own shapes carry no inherent reading order beyond array position (the same assumption src/layout/slides.ts's direct-placement engine makes), so shapes render in that order with no attempt to infer which one is a "title" — there is no structural signal to tell a title placeholder from body text once ContentShape has flattened placeholder inheritance away. ---
function presentationBlocks(
  document: Extract<ContentDocument, { kind: "presentation" }>,
  sink: MarkdownRenderDiagnosticSink,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  document.slides.forEach((slide: ContentSlide, index: number) => {
    const slideNumber = index + 1;
    blocks.push(headingParagraph(2, `Slide ${String(slideNumber)}`));
    sink({
      severity: "info",
      code: MarkdownRenderDiagnosticCodes.PRESENTATION_SLIDE_AS_HEADING,
      message: `slide ${String(slideNumber)} of ${String(document.slides.length)} has no markdown section equivalent; its shapes are flattened in slide order under a level-2 "Slide ${String(slideNumber)}" heading`,
    });
    for (const shape of slide.shapes) {
      blocks.push(...shape.blocks);
    }
    if (slide.notes.trim().length > 0) {
      sink({
        severity: "info",
        code: MarkdownRenderDiagnosticCodes.PRESENTATION_NOTES_DROPPED,
        message: `slide ${String(slideNumber)}'s speaker notes have no markdown representation and were dropped`,
      });
    }
  });
  return blocks;
}

// --- drawing: each page becomes its own H2-headed section. Only shapes carry text (ContentBlock); vectors (rect/ellipse/line/path) have nothing CommonMark/GFM can represent at all, so they are dropped wholesale and reported once per page rather than once per vector — the decision made is "this page's vector geometry is unrepresentable", not "vector N specifically". ---
function drawingBlocks(
  document: Extract<ContentDocument, { kind: "drawing" }>,
  sink: MarkdownRenderDiagnosticSink,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  document.pages.forEach((page: ContentDrawPage, index: number) => {
    const pageNumber = index + 1;
    blocks.push(headingParagraph(2, `Page ${String(pageNumber)}`));
    sink({
      severity: "info",
      code: MarkdownRenderDiagnosticCodes.DRAWING_PAGE_AS_HEADING,
      message: `page ${String(pageNumber)} of ${String(document.pages.length)} has no markdown section equivalent; its text-carrying shapes are flattened in shape order under a level-2 "Page ${String(pageNumber)}" heading`,
    });
    for (const shape of page.shapes) {
      blocks.push(...shape.blocks);
    }
    if (page.vectors.length > 0) {
      sink({
        severity: "warning",
        code: MarkdownRenderDiagnosticCodes.DRAWING_VECTORS_DROPPED,
        message: `page ${String(pageNumber)} carries ${String(page.vectors.length)} vector primitive(s) (rect/ellipse/line/path) with no markdown representation; dropped`,
      });
    }
  });
  return blocks;
}

// --- spreadsheet: each sheet becomes its own H2-headed section plus (when it has any cells left after hidden rows/columns are excluded) one GFM table over the rows and columns that hold a visible cell (`sheetToTable`, src/model/sheet-table.ts). A sheet's own printSettings/formulas have no markdown equivalent and are silently out of scope — not degraded, since there was never a markdown construct they could have mapped to (the same "structural mismatch, not a bug" framing markdown-codec's own README gives colour/font/alignment). ---
function sheetTable(
  sheet: ContentSheet,
  sink: MarkdownRenderDiagnosticSink,
): ContentTable | undefined {
  const flattened = sheetToTable(sheet);
  if (flattened === undefined) {
    return undefined;
  }
  const { table, hiddenRowCount, hiddenColumnCount } = flattened;
  if (hiddenRowCount > 0 || hiddenColumnCount > 0) {
    sink({
      severity: "info",
      code: MarkdownRenderDiagnosticCodes.SPREADSHEET_HIDDEN_CELLS_DROPPED,
      message: `sheet "${sheet.name}" hides ${String(hiddenRowCount)} row(s) and ${String(hiddenColumnCount)} column(s); hidden rows/columns are excluded from the rendered table`,
    });
  }
  sink({
    severity: "info",
    code: MarkdownRenderDiagnosticCodes.SPREADSHEET_SHEET_AS_TABLE,
    message: `sheet "${sheet.name}" flattened to a ${String(table.rows.length)}x${String(table.columns.length)} GFM table; its first row is rendered as the table header (a GFM table always has one, and a spreadsheet has no header/body distinction of its own)`,
  });
  return table;
}

function spreadsheetBlocks(
  document: Extract<ContentDocument, { kind: "spreadsheet" }>,
  sink: MarkdownRenderDiagnosticSink,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const sheet of document.sheets) {
    blocks.push(headingParagraph(2, sheet.name));
    const table = sheetTable(sheet, sink);
    blocks.push(table ?? textParagraph("_(empty sheet)_"));

    const embeddedObjectCount = sheet.embeddedObjects?.length ?? 0;
    if (sheet.images.length > 0 || embeddedObjectCount > 0) {
      sink({
        severity: "warning",
        code: MarkdownRenderDiagnosticCodes.SPREADSHEET_ANCHORED_CONTENT_DROPPED,
        message: `sheet "${sheet.name}" carries ${String(sheet.images.length)} anchored image(s) and ${String(embeddedObjectCount)} embedded object(s) with no placement in a GFM table; dropped`,
      });
    }
  }
  return blocks;
}

// --- formula: a standalone .odf-style formula document has no page/section/slide structure at all — it IS one equation. It degrades to the identical plain-text stand-in buildMarkdownText's own markdownBlock already uses for a formula embedded inside a wordprocessing document (its own StarMath annotation, or the literal "[formula]" marker), so a formula reads the same way in markdown regardless of whether it arrived as a whole document or as one block inside a larger one. ---
function formulaBlocks(
  document: Extract<ContentDocument, { kind: "formula" }>,
  sink: MarkdownRenderDiagnosticSink,
): ContentBlock[] {
  sink({
    severity: "warning",
    code: MarkdownRenderDiagnosticCodes.FORMULA_AS_PLACEHOLDER,
    message:
      "a standalone formula document has no markdown math construct; rendered as its own plain-text stand-in",
  });
  return [textParagraph(formulaPlaceholderText(document.formula))];
}

function degradedBlocksFor(
  document: Exclude<ContentDocument, { kind: "wordprocessing" }>,
  sink: MarkdownRenderDiagnosticSink,
): ContentBlock[] {
  switch (document.kind) {
    case "presentation":
      return presentationBlocks(document, sink);
    case "spreadsheet":
      return spreadsheetBlocks(document, sink);
    case "drawing":
      return drawingBlocks(document, sink);
    case "formula":
      return formulaBlocks(document, sink);
  }
  return assertNeverDocumentKind(document);
}

// The one entry point this module exists to add: ContentDocument (any of its five kinds) -> Markdown text. A 'wordprocessing' document goes straight to buildMarkdownText/markdown-codec's writeMarkdownContent — markdown-codec already understands that shape natively, so there is nothing this module should do differently. Every other kind is flattened first (see the per-kind functions above) into a synthetic 'wordprocessing' document built from the real blocks it carries, then handed to the exact same buildMarkdownText call — so a flattened presentation/spreadsheet/drawing gets every ordinary wordprocessing-side behaviour (list rendering, table-cell formatting diagnostics, front matter, style options) for free, with zero duplicated emission logic.
export function renderContentDocumentToMarkdown(
  document: ContentDocument,
  options?: RenderMarkdownOptions,
): string {
  if (document.kind === "wordprocessing") {
    return buildMarkdownText(document, options);
  }
  const sink = options?.onDiagnostic ?? NOOP_RENDER_DIAGNOSTIC_SINK;
  const blocks = degradedBlocksFor(document, sink);
  return buildMarkdownText(
    wrapAsWordprocessing(document.metadata, blocks),
    options,
  );
}

// Reached only if the union behind `document.kind` ever gains a member the switch above does not match: every current member has a case there, so `document.kind` narrows to `never` at the call, and adding an uncovered member makes that narrowing fail and the call stop compiling. Exists so the switch's own exhaustiveness, proven by the type checker rather than by a catch-all default that would silently accept a genuinely new member, still gives consistent-return an explicit statement to see past the switch. Exported so a test can exercise the throw directly with a forced-invalid cast, since it is otherwise unreachable.
export function assertNeverDocumentKind(value: never): never {
  throw new Error(`documents.js: unhandled document ${JSON.stringify(value)}`);
}
