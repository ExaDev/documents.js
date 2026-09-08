// ContentTable -> a GFM table: rows[0] is always treated as the header row (GFM requires exactly one), each column's own alignment read from that header row's own cell.blocks[0].alignment (a ContentTable carries no column-level alignment field of its own -- src/lower/table.ts's own mapping choice was to carry it per-cell instead, so the write side reads it back from the same place). Absolute column widths (ContentTable.columnWidthsPt) have no GFM equivalent at all and are dropped without comment -- a GFM table was never able to carry them to begin with, so this is not a fidelity loss introduced by this package.
//
// A markdown table cell holds inline content only. Two degradations are real improvements over dropping, not the ceiling of what this package attempts: MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED fires when a cell carries more than one block, joined with a literal `<br>` -- raw inline HTML, universally rendered as a real line break by every GFM table renderer (GitHub/GitLab included), and already round-trips safely as quarantined residue on its own run (src/lower/inline.ts's rawHtml case) rather than corrupting anything on read-back. An `image`-kind block emits inline via emitImage, the identical degradation src/lower/inline.ts's own "nested image" case already gives an image inside emphasis/a link elsewhere in this package: it reads back as a run carrying the alt text as its own visible text with the image's data: URI riding as that run's hyperlink, not as a lost block -- MarkdownDiagnosticCodes.TABLE_CELL_IMAGE_DEGRADED reports this explicitly, distinct from FORMATTING_DROPPED's true silent loss.
//
// A cell's own colSpan/rowSpan/background, or a non-paragraph/non-image block inside it (a nested table, say), have no representation in THIS plain pipe-syntax writer at all -- but tableNeedsHtmlFallback (src/emit/html-table.ts) is checked before any of this module's own rendering runs, so a table containing any such cell never reaches this file's own renderCellText in the first place; it renders through that module's HTML-table fallback instead (MarkdownDiagnosticCodes.TABLE_HTML_FALLBACK), which DOES represent all three losslessly. By the time renderCellText below runs, tableNeedsHtmlFallback has already established that every cell in the whole table holds only paragraph/image blocks and no colSpan/rowSpan/background -- ExaDev/documents.js#1089.

import type {
  Alignment,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import type { MarkdownTableAlignment } from "../ast/ast";
import type { MarkdownDiagnosticSink } from "../diagnostics/diagnostics";
import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics";
import { emitHtmlTable, tableNeedsHtmlFallback } from "./html-table";
import { emitImage } from "./image";
import type { InlineEmitContext } from "./inline";
import { emitRunsSingleLine } from "./inline";

export interface TableEmitContext extends InlineEmitContext {
  readonly sink: MarkdownDiagnosticSink;
  readonly embedImages: boolean;
}

function toMarkdownAlignment(
  alignment: Alignment | undefined,
): MarkdownTableAlignment {
  return alignment === undefined || alignment === "justify"
    ? "none"
    : alignment;
}

function delimiterCell(alignment: MarkdownTableAlignment): string {
  switch (alignment) {
    case "left":
      return ":---";
    case "right":
      return "---:";
    case "center":
      return ":---:";
    case "none":
      return "---";
  }
}

// The write-side inverse of src/block/table.ts's own splitTableRow scanning: that reader treats `\|` as an escaped pipe ANYWHERE in a row's raw source text -- deliberately not code-span aware, per its own top-of-file note, since GFM's own spec example escapes a pipe inside a code span too. A rendered cell's own text can contain a pipe two different ways: already backslash-escaped by ordinary text escaping (escapeMarkdownText, src/emit/inline.ts, which escapes '|' as ASCII punctuation), or entirely unescaped inside a code span's own literal (renderCodeSpan never escapes its content at all). This scans the same way the reader does -- an already-escaped `\|` pair is left untouched, a bare `|` gets escaped -- so it never double-escapes the first case while still fixing the second.
function escapeUnescapedPipes(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "\\" && index + 1 < text.length) {
      out += char + text.charAt(index + 1);
      index += 2;
      continue;
    }
    if (char === "|") {
      out += "\\|";
      index += 1;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function renderCellText(
  cell: ContentTableCell,
  context: TableEmitContext,
): string {
  if (cell.blocks.length > 1) {
    context.sink({
      code: MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED,
      severity: "info",
      message: `a table cell with ${String(cell.blocks.length)} blocks has no multi-paragraph equivalent in a GFM table cell; their own rendered text is joined with a literal <br> line break`,
    });
  }
  const parts: string[] = [];
  for (const block of cell.blocks) {
    if (block.kind === "image") {
      context.sink({
        code: MarkdownDiagnosticCodes.TABLE_CELL_IMAGE_DEGRADED,
        severity: "info",
        message:
          "a table cell's own image block has no GFM table equivalent; it emits inline instead, degrading on read-back to a run carrying the alt text with the image's data as that run's hyperlink",
      });
      parts.push(emitImage(block, context.embedImages));
      continue;
    }
    if (block.kind !== "paragraph") {
      // Unreachable for real input: emitTable only reaches this plain pipe-syntax renderer when tableNeedsHtmlFallback(table) is false, which requires every cell's own blocks, across the WHOLE table, to be "paragraph" or "image" only (see that function, src/emit/html-table.ts). Kept as a real narrowing rather than an assertion so this loop still type-checks against ContentBlock's full union.
      continue;
    }
    const text = emitRunsSingleLine(block.runs, context, block.constructs);
    if (text.length > 0) {
      parts.push(text);
    }
  }
  return escapeUnescapedPipes(parts.join("<br>"));
}

export function emitTable(
  table: ContentTable,
  context: TableEmitContext,
): string {
  if (tableNeedsHtmlFallback(table)) {
    context.sink({
      code: MarkdownDiagnosticCodes.TABLE_HTML_FALLBACK,
      severity: "info",
      message:
        "a cell in this table needs colSpan/rowSpan/background, or holds a block a GFM table cell cannot represent at all (most commonly a nested table); GFM's own table extension holds inline content only (github.github.com/gfm, \"Tables (extension)\"), so no single cell can carry an HTML sub-block inside an otherwise pipe-syntax table -- the whole table is rendered as a raw HTML <table> block instead (CommonMark spec 0.31.2, HTML blocks condition 6, https://spec.commonmark.org/0.31.2/#html-blocks), which src/html/html-table.ts's own reader recognises back into an equal ContentTable",
    });
    return emitHtmlTable(table, context);
  }
  const [header, ...body] = table.rows;
  if (header === undefined) {
    return "";
  }
  const alignments = header.cells.map((cell) =>
    toMarkdownAlignment(
      cell.blocks[0]?.kind === "paragraph"
        ? cell.blocks[0].alignment
        : undefined,
    ),
  );
  const headerLine = `| ${header.cells.map((cell) => renderCellText(cell, context)).join(" | ")} |`;
  const delimiterLine = `| ${alignments.map((alignment) => delimiterCell(alignment)).join(" | ")} |`;
  const bodyLines = body.map(
    (row) =>
      `| ${row.cells.map((cell) => renderCellText(cell, context)).join(" | ")} |`,
  );
  return [headerLine, delimiterLine, ...bodyLines].join("\n");
}
