// ContentTable -> a raw HTML <table> block: the write-side half of the HTML-table fallback (ExaDev/documents.js#1089), src/html/html-table.ts's own exact structural inverse. GFM's own pipe-table syntax has no grammar for a cell's colSpan/rowSpan/background, or for a block inside a cell that isn't a paragraph or an image (most commonly a nested table) -- github.github.com/gfm, "Tables (extension)", states a cell holds inline content only, so no single cell of an otherwise-pipe-syntax table can ever carry an HTML sub-block: the moment ANY cell in a table needs one of these, tableNeedsHtmlFallback below says so and src/emit/table.ts's own emitTable renders the WHOLE table through this module instead of the plain `| a | b |` writer. A raw HTML `<table>` block is legal CommonMark regardless (spec 0.31.2, "HTML blocks" start condition 6 names `table` directly -- https://spec.commonmark.org/0.31.2/#html-blocks).
//
// Raw HTML block content is never reprocessed as markdown (src/html/html.ts's own top comment), so every cell's own inline formatting here is written as real HTML tags -- <strong>/<em>/<del>/<code>/<a href> -- rather than the markdown syntax src/emit/inline.ts spells for a plain GFM table cell; writing markdown punctuation inside this block would render as its own literal characters in a browser, not as formatting. This is a deliberately closed, symmetric vocabulary matching exactly what that plain writer already supports (bold/italic/strike/hyperlink/Courier-New-as-code-span) -- nothing wider, nothing narrower.
//
// A cell's own nested-block content is bounded to two shapes, matching the issue's own text ("a nested block (e.g. a nested table or multi-paragraph content)"): several paragraph/image blocks join with a literal <br> exactly as the plain GFM writer already joins multi-paragraph cells (MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED), or -- when a cell's ENTIRE content is one nested table and nothing else -- that table recurses through this same module, unconditionally rendered as HTML regardless of whether ITS OWN cells would otherwise fit plain GFM syntax, since a table nested inside another table's cell can never itself be pipe-syntax (there is no block position for it to occupy there at all). Any other block kind, or a nested table mixed with sibling content in the same cell, has no representation this bounded recogniser attempts and is dropped with MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED, exactly as it always was before this fallback existed.

import type {
  ContentBlock,
  ContentCellFill,
  ContentRun,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import { colorToRgbHex } from "document-schema.js";
import type { MarkdownDiagnosticSink } from "../diagnostics/diagnostics";
import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics";
import { MONOSPACE_FONT_FAMILY } from "../shared/style-constants";
import type { TableEmitContext } from "./table";

function escapeHtmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(text: string): string {
  return escapeHtmlText(text).replaceAll('"', "&quot;");
}

// Whether a block has no representation in the HTML-table fallback either -- everything except a paragraph, an image, or (handled separately, see emitCellHtml) a lone nested table.
function blockNeedsHtmlFallback(block: ContentBlock): boolean {
  return block.kind !== "paragraph" && block.kind !== "image";
}

// Whether ANY cell anywhere in `table` needs colSpan/rowSpan/background, or holds a block a plain GFM cell cannot represent at all -- the single trigger src/emit/table.ts's own emitTable checks before choosing between the plain pipe writer and this module.
export function tableNeedsHtmlFallback(table: ContentTable): boolean {
  return table.rows.some((row) =>
    row.cells.some(
      (cell) =>
        cell.colSpan !== undefined ||
        cell.rowSpan !== undefined ||
        cell.background !== undefined ||
        cell.blocks.some(blockNeedsHtmlFallback),
    ),
  );
}

function emitRunHtml(run: ContentRun): string {
  let text = escapeHtmlText(run.text);
  if (run.fontFamily === MONOSPACE_FONT_FAMILY) {
    text = `<code>${text}</code>`;
  }
  if (run.strike === true) {
    text = `<del>${text}</del>`;
  }
  if (run.italic === true) {
    text = `<em>${text}</em>`;
  }
  if (run.bold === true) {
    text = `<strong>${text}</strong>`;
  }
  if (run.hyperlink !== undefined) {
    text = `<a href="${escapeHtmlAttribute(run.hyperlink)}">${text}</a>`;
  }
  return text;
}

function emitHtmlImage(
  block: Extract<ContentBlock, { kind: "image" }>,
  embedImages: boolean,
): string {
  const alt = escapeHtmlAttribute(block.altText ?? "");
  if (!embedImages) {
    return `<img alt="${alt}">`;
  }
  return `<img src="data:image/${block.format};base64,${block.base64}" alt="${alt}">`;
}

function backgroundStyleAttr(
  fill: ContentCellFill,
  sink: MarkdownDiagnosticSink,
): string | undefined {
  if (fill.kind === "solid") {
    return `background-color:#${colorToRgbHex(fill.color)}`;
  }
  sink({
    code: MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED,
    severity: "info",
    message:
      "a table cell's own pattern background fill has no CSS equivalent this package's bounded HTML-table writer attempts (only a solid fill maps onto a plain background-color); the cell still renders as an ordinary unstyled cell",
  });
  return undefined;
}

// A plain GFM table's own alignment marker is a property of the whole COLUMN (the delimiter row), which src/lower/table.ts's own lowerTable stamps identically onto every cell in that column and src/emit/table.ts's own plain writer reads back only from the header row -- the two stay consistent because a GFM-sourced ContentTable never disagrees within a column to begin with. Once a table is already going through this module for some OTHER reason (colSpan/rowSpan/background/a nested block), losing every cell's own alignment as a side effect would be a real, silent regression against what the plain writer already preserves -- so this reads each cell's OWN alignment independently, a strictly richer fidelity plain GFM's single-marker-per-column grammar could never express anyway.
function textAlignStyleAttr(cell: ContentTableCell): string | undefined {
  const first = cell.blocks[0];
  if (first?.kind !== "paragraph" || first.alignment === undefined) {
    return undefined;
  }
  return `text-align:${first.alignment}`;
}

function emitCellHtml(
  cell: ContentTableCell,
  context: TableEmitContext,
): string {
  const soleBlock = cell.blocks.length === 1 ? cell.blocks[0] : undefined;
  if (soleBlock?.kind === "table") {
    return emitHtmlTable(soleBlock, context);
  }
  if (cell.blocks.length > 1) {
    context.sink({
      code: MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED,
      severity: "info",
      message: `a table cell with ${String(cell.blocks.length)} blocks has no multi-block equivalent in an HTML table cell either; their own rendered content is joined with a literal <br> line break`,
    });
  }
  const parts: string[] = [];
  for (const block of cell.blocks) {
    if (block.kind === "paragraph") {
      parts.push(block.runs.map(emitRunHtml).join(""));
      continue;
    }
    if (block.kind === "image") {
      parts.push(emitHtmlImage(block, context.embedImages));
      continue;
    }
    if (block.kind === "table") {
      context.sink({
        code: MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED,
        severity: "info",
        message:
          "a nested table mixed with other content in the same cell has no HTML representation this package attempts (a cell's own nested table must be its entire content); it is dropped, the cell's other content still renders",
      });
      continue;
    }
    context.sink({
      code: MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED,
      severity: "info",
      message: `a table cell containing a "${block.kind}" block has no HTML-table equivalent this package attempts; it is dropped entirely`,
    });
  }
  return parts.join("<br>");
}

function emitCellTag(
  cell: ContentTableCell,
  isHeader: boolean,
  context: TableEmitContext,
): string {
  const tag = isHeader ? "th" : "td";
  const attrs: string[] = [];
  if (cell.colSpan !== undefined) {
    attrs.push(`colspan="${String(cell.colSpan)}"`);
  }
  if (cell.rowSpan !== undefined) {
    attrs.push(`rowspan="${String(cell.rowSpan)}"`);
  }
  const styleParts: string[] = [];
  if (cell.background !== undefined) {
    const style = backgroundStyleAttr(cell.background, context.sink);
    if (style !== undefined) {
      styleParts.push(style);
    }
  }
  const textAlign = textAlignStyleAttr(cell);
  if (textAlign !== undefined) {
    styleParts.push(textAlign);
  }
  if (styleParts.length > 0) {
    attrs.push(`style="${escapeHtmlAttribute(styleParts.join(";"))}"`);
  }
  const attrText = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  return `<${tag}${attrText}>${emitCellHtml(cell, context)}</${tag}>`;
}

// Renders `table` as a raw HTML block, unconditionally -- the caller (src/emit/table.ts's emitTable for a top-level table, or emitCellHtml above for a cell whose entire content is one nested table) is what decides WHETHER to reach for this at all; this function itself never re-checks tableNeedsHtmlFallback, since a nested table has no plain-pipe alternative in the first place regardless of its own cells' own needs.
export function emitHtmlTable(
  table: ContentTable,
  context: TableEmitContext,
): string {
  const [header, ...body] = table.rows;
  const lines: string[] = ["<table>"];
  if (header !== undefined) {
    lines.push(
      `<tr>${header.cells.map((cell) => emitCellTag(cell, true, context)).join("")}</tr>`,
    );
  }
  for (const row of body) {
    lines.push(
      `<tr>${row.cells.map((cell) => emitCellTag(cell, false, context)).join("")}</tr>`,
    );
  }
  lines.push("</table>");
  return lines.join("\n");
}
