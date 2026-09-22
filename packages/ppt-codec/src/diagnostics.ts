// The write-side diagnostic sink, matching the shape markdown-codec's, pdf-codec's, epub-codec's and rtf-codec's own diagnostic channels already use in this family: a writer that silently drops a block a caller cared about is indistinguishable from one that never saw it, so every drop this writer makes deliberately names itself through a code below. The read side keeps its own established tiers instead — PptFormatError for malformed bytes, PptEncryptedError for a file that is deliberately unreadable without a key, and per-construct degradation that keeps the shape's geometry (an unresolvable blip reference reads as a picture with no image) — none of which needs a sink to be visible.
//
// No Zod schema wraps PptDiagnostic, matching MarkdownDiagnostic's, PdfDiagnostic's, EpubDiagnostic's and RtfDiagnostic's own precedent: a diagnostic is produced exclusively by this package's own pipeline, is consumed by a caller-supplied sink rather than round-tripped through JSON, and validating our own output would validate nothing a caller couldn't already see from the TypeScript type itself.

export type PptDiagnosticSeverity = "info" | "warning";

export interface PptDiagnostic {
  // A stable, namespaced code (e.g. 'ppt/block-dropped') — callers branch on this, not on `message`, which is free text for humans. See PptDiagnosticCodes below for the codes this package names.
  readonly code: string;
  readonly severity: PptDiagnosticSeverity;
  readonly message: string;
}

export type PptDiagnosticSink = (diagnostic: PptDiagnostic) => void;

// Deliberately prefixed (the same discipline rtf-codec's NOOP_RTF_DIAGNOSTIC_SINK states for itself): documents.js composes several of these packages' no-op sinks into the same modules, and an unprefixed name here would collide on import.
export const NOOP_PPT_DIAGNOSTIC_SINK: PptDiagnosticSink = () => {
  /* discards every diagnostic — the deliberate default for a caller that doesn't want them */
};

export const PptDiagnosticCodes = {
  // Write side: an image block this writer cannot carry as a blip — a format MSOBLIPTYPE has no decodable token for here (svg, gif), or a second image on a shape whose one pib reference the first already consumed.
  IMAGE_DROPPED: "ppt/image-dropped",
  // Write side: a block kind with no [MS-PPT] spelling this writer produces (a page break, a construct marker, and every further kind the README's write-scope section names). The message names the kind and where it sat.
  BLOCK_DROPPED: "ppt/block-dropped",
  // Write side: a table cell's colSpan or rowSpan, which the binary format's tables cannot state at all — a PowerPoint 97-2003 table is a strict grid of shapes with no merge records (PowerPoint itself gained merged cells only in the 2010 XML format), so the cell's text is kept, sized to its single grid position, and the span is reported rather than silently narrowed.
  TABLE_SPAN_DROPPED: "ppt/table-span-dropped",
  // Write side: a table that breaks the grid rule (ContentTableCell in document-schema.js) — rows of differing lengths, content or a span on a position a merged region covers, or a region running past the grid or into another. Reported rather than thrown because this writer states no merge at all: every entry of every row is written at its own grid position with its own text, so nothing a covered position held is lost, only the merged region the producer meant is not what the format can show.
  TABLE_GRID_FAULT: "ppt/table-grid-fault",
  // Write side: a row's own isHeader (document-schema.js's ContentTableRow), which this format cannot state at all — a PowerPoint 97-2003 table is a strict grid of anchored shapes with no row record of any kind, let alone one naming a row as a header, so the row's text is written exactly as any other row's and the flag is reported rather than silently dropped.
  TABLE_HEADER_ROW_DROPPED: "ppt/table-header-row-dropped",
  // Write side: a column's own isHeader (document-schema.js's ContentTableColumn), the column-axis mirror of TABLE_HEADER_ROW_DROPPED immediately above. The identical grid of anchored shapes has no per-column record either, so the column's cells are written exactly as any other column's and the flag is reported rather than silently dropped.
  TABLE_HEADER_COLUMN_DROPPED: "ppt/table-header-column-dropped",
} as const;
