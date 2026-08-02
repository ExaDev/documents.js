//#region src/diagnostics/diagnostics.d.ts
type MarkdownDiagnosticSeverity = 'info' | 'warning';
interface MarkdownDiagnostic {
  readonly code: string;
  readonly severity: MarkdownDiagnosticSeverity;
  readonly message: string;
  readonly line?: number;
}
type MarkdownDiagnosticSink = (diagnostic: MarkdownDiagnostic) => void;
declare const NOOP_MARKDOWN_DIAGNOSTIC_SINK: MarkdownDiagnosticSink;
declare const MarkdownDiagnosticCodes: {
  readonly UNCLOSED_FENCE: "md/unclosed-fence";
  readonly UNTERMINATED_HTML_BLOCK: "md/unterminated-html-block";
  readonly TABLE_CELL_COUNT_MISMATCH: "md/table-cell-count-mismatch";
  readonly DUPLICATE_LINK_REFERENCE: "md/duplicate-link-reference";
  readonly LIST_MARKER_TYPE_CONFLICT: "md/list-marker-type-conflict";
  readonly INVENTED_PAGE_GEOMETRY: "md/invented-page-geometry";
  readonly NESTED_EMPHASIS_FLATTENED: "md/nested-emphasis-flattened";
  readonly LINK_TITLE_DROPPED: "md/link-title-dropped";
  readonly CODE_BLOCK_INFO_STRING_DROPPED: "md/code-block-info-string-dropped";
  readonly BLOCKQUOTE_NESTED_DEPTH: "md/blockquote-nested-depth";
  readonly LIST_ITEM_BLOCK_UNLISTED: "md/list-item-block-unlisted";
  readonly LIST_ITEM_MULTI_BLOCK_FLATTENED: "md/list-item-multi-block-flattened";
  readonly IMAGE_UNRESOLVED: "md/image-unresolved";
  readonly RAW_HTML_PRESERVED_AS_TEXT: "md/raw-html-preserved-as-text";
  readonly RAW_HTML_DROPPED: "md/raw-html-dropped";
  readonly FRONT_MATTER_KEY_UNMAPPED: "md/front-matter-key-unmapped";
  readonly HEADING_LEVEL_CLAMPED: "md/heading-level-clamped";
  readonly ADJACENT_LINKS_MERGED: "md/adjacent-links-merged";
  readonly CODE_SPAN_AS_MONOSPACE_RUN: "md/code-span-as-monospace-run";
  readonly PARAGRAPH_INDENT_DROPPED: "md/paragraph-indent-dropped";
  readonly LIST_NUMID_FALLBACK: "md/list-numid-fallback";
  readonly TABLE_CELL_FORMATTING_DROPPED: "md/table-cell-formatting-dropped";
  readonly TABLE_CELL_MULTI_PARAGRAPH_JOINED: "md/table-cell-multi-paragraph-joined";
};
declare class MarkdownParseError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}
declare class MarkdownInvalidUtf8Error extends MarkdownParseError {
  constructor(message?: string);
}
declare class MarkdownInputTooLargeError extends MarkdownParseError {
  readonly maxInputBytes: number;
  readonly actualBytes: number;
  constructor(maxInputBytes: number, actualBytes: number);
}
declare class MarkdownNestingLimitExceededError extends MarkdownParseError {
  readonly maxNesting: number;
  constructor(maxNesting: number);
}
declare class MarkdownWriteError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}
declare class MarkdownUnsupportedDocumentKindError extends MarkdownWriteError {
  readonly kind: string;
  constructor(kind: string);
}
//#endregion
export { MarkdownInputTooLargeError as a, MarkdownParseError as c, NOOP_MARKDOWN_DIAGNOSTIC_SINK as d, MarkdownDiagnosticSink as i, MarkdownUnsupportedDocumentKindError as l, MarkdownDiagnosticCodes as n, MarkdownInvalidUtf8Error as o, MarkdownDiagnosticSeverity as r, MarkdownNestingLimitExceededError as s, MarkdownDiagnostic as t, MarkdownWriteError as u };