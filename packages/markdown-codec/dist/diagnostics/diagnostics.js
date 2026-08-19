//#region src/diagnostics/diagnostics.ts
const NOOP_MARKDOWN_DIAGNOSTIC_SINK = () => {};
const MarkdownDiagnosticCodes = {
	UNCLOSED_FENCE: "md/unclosed-fence",
	UNCLOSED_MATH_BLOCK: "md/unclosed-math-block",
	UNTERMINATED_HTML_BLOCK: "md/unterminated-html-block",
	TABLE_CELL_COUNT_MISMATCH: "md/table-cell-count-mismatch",
	DUPLICATE_LINK_REFERENCE: "md/duplicate-link-reference",
	DUPLICATE_FOOTNOTE_DEFINITION: "md/duplicate-footnote-definition",
	LIST_MARKER_TYPE_CONFLICT: "md/list-marker-type-conflict",
	INVENTED_PAGE_GEOMETRY: "md/invented-page-geometry",
	NESTED_EMPHASIS_FLATTENED: "md/nested-emphasis-flattened",
	LINK_TITLE_DROPPED: "md/link-title-dropped",
	CODE_BLOCK_INFO_STRING_DROPPED: "md/code-block-info-string-dropped",
	BLOCKQUOTE_NESTED_DEPTH: "md/blockquote-nested-depth",
	LIST_ITEM_BLOCK_UNLISTED: "md/list-item-block-unlisted",
	LIST_ITEM_MULTI_BLOCK_FLATTENED: "md/list-item-multi-block-flattened",
	IMAGE_UNRESOLVED: "md/image-unresolved",
	RAW_HTML_PRESERVED_AS_TEXT: "md/raw-html-preserved-as-text",
	RAW_HTML_DROPPED: "md/raw-html-dropped",
	MATH_BLOCK_PRESERVED_AS_TEXT: "md/math-block-preserved-as-text",
	MATH_INLINE_PRESERVED_AS_TEXT: "md/math-inline-preserved-as-text",
	FRONT_MATTER_KEY_UNMAPPED: "md/front-matter-key-unmapped",
	FOOTNOTE_REFERENCE_PRESERVED_AS_TEXT: "md/footnote-reference-preserved-as-text",
	FOOTNOTE_BODY_HEADING_FLATTENED: "md/footnote-body-heading-flattened",
	CONSTRUCT_UNREPRESENTED: "md/construct-unrepresented",
	PACKAGE_TABLE_DROPPED: "md/package-table-dropped",
	HEADING_LEVEL_CLAMPED: "md/heading-level-clamped",
	ADJACENT_LINKS_MERGED: "md/adjacent-links-merged",
	CODE_SPAN_AS_MONOSPACE_RUN: "md/code-span-as-monospace-run",
	PARAGRAPH_INDENT_DROPPED: "md/paragraph-indent-dropped",
	LIST_NUMID_FALLBACK: "md/list-numid-fallback",
	TABLE_CELL_FORMATTING_DROPPED: "md/table-cell-formatting-dropped",
	TABLE_CELL_MULTI_PARAGRAPH_JOINED: "md/table-cell-multi-paragraph-joined"
};
var MarkdownParseError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "MarkdownParseError";
		this.code = code;
	}
};
var MarkdownInvalidUtf8Error = class extends MarkdownParseError {
	constructor(message = "input is not valid UTF-8") {
		super("md/invalid-utf8", message);
		this.name = "MarkdownInvalidUtf8Error";
	}
};
var MarkdownInputTooLargeError = class extends MarkdownParseError {
	maxInputBytes;
	actualBytes;
	constructor(maxInputBytes, actualBytes) {
		super("md/input-too-large", `input is ${String(actualBytes)} bytes, exceeding the configured maximum of ${String(maxInputBytes)} bytes`);
		this.name = "MarkdownInputTooLargeError";
		this.maxInputBytes = maxInputBytes;
		this.actualBytes = actualBytes;
	}
};
var MarkdownNestingLimitExceededError = class extends MarkdownParseError {
	maxNesting;
	constructor(maxNesting) {
		super("md/nesting-limit-exceeded", `block nesting exceeds the configured limit of ${String(maxNesting)}`);
		this.name = "MarkdownNestingLimitExceededError";
		this.maxNesting = maxNesting;
	}
};
var MarkdownWriteError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "MarkdownWriteError";
		this.code = code;
	}
};
var MarkdownUnbalancedConstructMarkersError = class extends MarkdownWriteError {
	imbalanceKind;
	blockIndex;
	constructor(imbalanceKind, blockIndex) {
		super("md/unbalanced-construct-markers", `${imbalanceKind === "unmatchedEnd" ? "a constructEnd marker closes no open construct" : "a constructStart marker is never closed"} at block index ${String(blockIndex)}; a block list's construct boundary markers must pair as balanced brackets`);
		this.name = "MarkdownUnbalancedConstructMarkersError";
		this.imbalanceKind = imbalanceKind;
		this.blockIndex = blockIndex;
	}
};
var MarkdownUnsupportedDocumentKindError = class extends MarkdownWriteError {
	kind;
	constructor(kind) {
		super("md/write-side-not-wordprocessing", `writeMarkdown only supports a 'wordprocessing' ContentDocument, got '${kind}'`);
		this.name = "MarkdownUnsupportedDocumentKindError";
		this.kind = kind;
	}
};
var MarkdownPackageFlattenError = class extends MarkdownWriteError {
	constructor(cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		super("md/package-flatten-failed", `flattening the package for write failed: ${detail}`);
		this.name = "MarkdownPackageFlattenError";
	}
};
//#endregion
export { MarkdownDiagnosticCodes, MarkdownInputTooLargeError, MarkdownInvalidUtf8Error, MarkdownNestingLimitExceededError, MarkdownPackageFlattenError, MarkdownParseError, MarkdownUnbalancedConstructMarkersError, MarkdownUnsupportedDocumentKindError, MarkdownWriteError, NOOP_MARKDOWN_DIAGNOSTIC_SINK };
