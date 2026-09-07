// ContentTable -> a GFM table: rows[0] is always treated as the header row (GFM requires exactly one), each column's own alignment read from that header row's own cell.blocks[0].alignment (a ContentTable carries no column-level alignment field of its own -- src/lower/table.ts's own mapping choice was to carry it per-cell instead, so the write side reads it back from the same place). Absolute column widths (ContentTable.columnWidthsPt) have no GFM equivalent at all and are dropped without comment -- a GFM table was never able to carry them to begin with, so this is not a fidelity loss introduced by this package.
//
// A markdown table cell holds inline content only. Two degradations are real improvements over dropping, not the ceiling of what this package attempts: MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED fires when a cell carries more than one block, joined with a literal `<br>` -- raw inline HTML, universally rendered as a real line break by every GFM table renderer (GitHub/GitLab included), and already round-trips safely as quarantined residue on its own run (src/lower/inline.ts's rawHtml case) rather than corrupting anything on read-back. An `image`-kind block emits inline via emitImage, the identical degradation src/lower/inline.ts's own "nested image" case already gives an image inside emphasis/a link elsewhere in this package: it reads back as a run carrying the alt text as its own visible text with the image's data: URI riding as that run's hyperlink, not as a lost block -- MarkdownDiagnosticCodes.TABLE_CELL_IMAGE_DEGRADED reports this explicitly, distinct from FORMATTING_DROPPED's true silent loss. FORMATTING_DROPPED itself still fires for what pure GFM syntax genuinely cannot express at all -- a nested table or any other non-paragraph, non-image block, and colSpan/rowSpan/background on the cell itself (the cell still renders, just as an ordinary unmerged, unstyled one) -- a real ceiling of the GFM table grammar, not a narrowing this module chose.

import type {
  Alignment,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import type { MarkdownTableAlignment } from "../ast/ast";
import type { MarkdownDiagnosticSink } from "../diagnostics/diagnostics";
import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics";
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
  if (
    cell.colSpan !== undefined ||
    cell.rowSpan !== undefined ||
    cell.background !== undefined
  ) {
    context.sink({
      code: MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED,
      severity: "info",
      message:
        "a table cell's own colSpan/rowSpan/background has no GFM table equivalent; the cell renders as an ordinary unmerged, unstyled cell",
    });
  }
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
      context.sink({
        code: MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED,
        severity: "info",
        message: `a table cell containing a "${block.kind}" block has no GFM table equivalent; it is dropped entirely`,
      });
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
