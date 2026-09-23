// The documents.js docx write-side diagnostic sink (ExaDev/documents.js#1398). buildDocxPackage (this file's own content.ts) had no general diagnostic channel before this file existed — only onMathDiagnostic, a channel dedicated to MathML->OMML formula translation — so a construct this writer could not carry into WordprocessingML, such as a table column's own isHeader (document-schema.js's ContentTableColumn), was simply left out of the written document with nothing telling a caller it happened. This mirrors the shape edit/pptx/diagnostics.ts's own PptxWriteDiagnostic uses (ExaDev/documents.js#1389, #1403), and the identical DocxWriteDiagnostic pattern ooxml.js's own typed/docx/diagnostics.ts now applies for its own, separate docx write path (buildDocxPackageFromContent).
//
// Distinct from OmmlDiagnostic (src/omml/shared.ts, threaded through BuildDocxPackageOptions.onMathDiagnostic): that channel reports a MathML to OMML translation degrade, a concern shared verbatim with buildPptxPackage's own identical formula writer, while this one is this write path's own general degrade channel for a construct WordprocessingML has no spelling for at all.

export type DocxWriteDiagnosticSeverity = "info" | "warning";

// One stable code per degrade decision buildDocxPackage's own write path can make, mirroring PptxWriteDiagnosticCodes' identical convention (edit/pptx/diagnostics.ts): a flat namespaced string a caller can branch or filter on, never free-form message text alone.
export const DocxWriteDiagnosticCodes = {
  // A table column's own isHeader (document-schema.js's ContentTableColumn). WordprocessingML's w:tblGrid has no element for a column repeating at the left of each printed page at all — unlike a row's own isHeader, which w:trPr/w:tblHeader states directly, there is no column-axis counterpart anywhere in the table grid vocabulary (ExaDev/documents.js#1381, #1398). The column's own cells are written exactly like any other column; only the flag itself is dropped.
  TABLE_HEADER_COLUMN_DROPPED: "docx-write/table-header-column-dropped",
} as const;

export type DocxWriteDiagnosticCode =
  (typeof DocxWriteDiagnosticCodes)[keyof typeof DocxWriteDiagnosticCodes];

export interface DocxWriteDiagnostic {
  readonly code: DocxWriteDiagnosticCode;
  readonly severity: DocxWriteDiagnosticSeverity;
  readonly message: string;
}

// context mirrors BuildDocxPackageOptions.onMathDiagnostic's own shape exactly: sourcePath is the table block's own path back into the source ContentDocument, when it carries one (ContentTable.sourcePath), so a caller can name which table each diagnostic came from. ContentTableColumn itself carries no sourcePath of its own (document-schema.js), so the table's is the finest-grained location this sink can report; the message names the column index within it.
export type DocxWriteDiagnosticSink = (
  diagnostic: DocxWriteDiagnostic,
  context: { readonly sourcePath?: string },
) => void;

// Deliberately empty: the default when a caller supplies no onDiagnostic, matching NOOP_PPTX_WRITE_DIAGNOSTIC_SINK's own precedent (edit/pptx/diagnostics.ts).
export const NOOP_DOCX_WRITE_DIAGNOSTIC_SINK: DocxWriteDiagnosticSink = () => {
  /* discards every diagnostic; the deliberate default for a caller that doesn't want them */
};
