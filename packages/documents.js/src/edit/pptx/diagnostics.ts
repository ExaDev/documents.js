// The pptx write-side diagnostic sink (ExaDev/documents.js#1389). buildPptxPackage had no diagnostic channel at all before this file existed, so a construct this writer could not carry into DrawingML, such as a table row's own isHeader (document-schema.js's ContentTableRow, ExaDev/documents.js#1390), was simply left out of the written slide with nothing telling a caller it happened. This mirrors the shape markdown-codec's, pdf-codec's, epub-codec's, rtf-codec's and ppt-codec's own write-side diagnostic channels already use in this family, and the identical MarkdownRenderDiagnostic* pattern documents.js's own src/markdown/render.ts already applies for its own degrade decisions: a stable namespaced code, a severity, a free-text message, and a caller-supplied sink that defaults to discarding everything.
//
// Distinct from OmmlDiagnosticSink (src/ooxml/pptx/formula.ts, threaded through BuildPptxPackageOptions.onMathDiagnostic): that channel reports a MathML to OMML translation degrade, a concern shared verbatim with buildDocxPackage's own identical formula writer, while this one is pptx's own write path reporting a construct DrawingML itself has no spelling for at all.

export type PptxWriteDiagnosticSeverity = "info" | "warning";

// One stable code per degrade decision buildPptxPackage's own write path can make, mirroring MarkdownRenderDiagnosticCodes' identical convention (src/markdown/render.ts): a flat namespaced string a caller can branch or filter on, never free-form message text alone.
export const PptxWriteDiagnosticCodes = {
  // A table row's own isHeader (document-schema.js's ContentTableRow). DrawingML has no per-row header marker at all: a:tblPr's firstRow/bandRow select which rows the table STYLE bands, not which row repeats as a page header, and can only ever name the first row, so mapping onto them would state visual emphasis in place of page repetition and narrow "any row" to "row 0 or nothing" (ExaDev/documents.js#1377, #1390). The row's own content is written exactly like any other row; only the flag itself is dropped.
  TABLE_HEADER_ROW_DROPPED: "pptx-write/table-header-row-dropped",
  // A column's own isHeader (document-schema.js's ContentTableColumn), the column-axis mirror of TABLE_HEADER_ROW_DROPPED immediately above (ExaDev/documents.js#1381). DrawingML's a:tblGrid has no header-column concept at all, unlike ODF's table:table-header-columns: a:tblPr's firstCol/bandCol select which column the table STYLE bands, not which column repeats at the left of each printed page, and firstCol can only ever name the first column. The column's own cells are written exactly like any other column's; only the flag itself is dropped.
  TABLE_HEADER_COLUMN_DROPPED: "pptx-write/table-header-column-dropped",
} as const;

export type PptxWriteDiagnosticCode =
  (typeof PptxWriteDiagnosticCodes)[keyof typeof PptxWriteDiagnosticCodes];

export interface PptxWriteDiagnostic {
  readonly code: PptxWriteDiagnosticCode;
  readonly severity: PptxWriteDiagnosticSeverity;
  readonly message: string;
}

// context mirrors OmmlDiagnosticSink's own shape exactly (src/ooxml/pptx/formula.ts): sourcePath is the table block's own path back into the source ContentDocument, when it carries one (ContentTable.sourcePath), so a caller can name which table each diagnostic came from. ContentTableRow itself carries no sourcePath of its own (document-schema.js), so the table's is the finest-grained location this sink can report; the message names the row index within it.
export type PptxWriteDiagnosticSink = (
  diagnostic: PptxWriteDiagnostic,
  context: { readonly sourcePath?: string },
) => void;

// Deliberately empty: the default when a caller supplies no onDiagnostic, matching NOOP_MARKDOWN_DIAGNOSTIC_SINK's/NOOP_PPT_DIAGNOSTIC_SINK's own precedent in this family.
export const NOOP_PPTX_WRITE_DIAGNOSTIC_SINK: PptxWriteDiagnosticSink = () => {
  /* discards every diagnostic; the deliberate default for a caller that doesn't want them */
};
