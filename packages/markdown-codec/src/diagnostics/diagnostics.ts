// The read-side diagnostic sink, matching pdf-codec's own three-tier PdfDiagnosticSink policy exactly (see that package's src/diagnostics.ts): throw for input this package cannot meaningfully process at all; recover-with-diagnostic for markdown that is spec-legal but almost certainly a typo, where guessing the author's intent and continuing is more useful than failing; degrade-with-diagnostic for an individual construct this package's own ContentDocument mapping cannot represent, while the rest of the document still reads. A hand-written parser this size cannot match a mature implementation's robustness against adversarial input, so every situation must be assigned to one of these three tiers explicitly rather than picked ad hoc at the call site that first encounters it.
//
// No Zod schema wraps MarkdownDiagnostic, matching PdfDiagnostic's own precedent: a diagnostic is produced exclusively by this package's own read pipeline, is consumed by a caller-supplied sink rather than round-tripped through JSON, and validating our own output would validate nothing a caller couldn't already see from the TypeScript type itself.

export type MarkdownDiagnosticSeverity = 'info' | 'warning';

export interface MarkdownDiagnostic {
  // A stable, namespaced code (e.g. 'md/unclosed-fence', 'md/code-span-as-monospace-run') -- callers are expected to branch on this, not on `message`, which is free text for humans. See MarkdownDiagnosticCodes below for the codes this layer already names.
  readonly code: string;
  readonly severity: MarkdownDiagnosticSeverity;
  readonly message: string;
  // 1-based source line the diagnostic applies to, when the read pipeline stage producing it has one to hand (every scan/block-level diagnostic does; a lowering-stage degrade diagnostic may not, if the gap is document-wide rather than tied to one construct).
  readonly line?: number;
}

// Recover/degrade-tier issues are reported through a sink rather than thrown, so a single unclosed fence or unsupported construct degrades that one element rather than aborting the whole document. A no-op sink is a legitimate choice for a caller that doesn't want diagnostics.
export type MarkdownDiagnosticSink = (diagnostic: MarkdownDiagnostic) => void;

// Deliberately prefixed (NOT the bare "NOOP_DIAGNOSTIC_SINK" pdf-codec's own src/diagnostics.ts already uses) -- documents.js will import both this package's and pdf-codec's own no-op sink into the same modules once it composes markdown alongside docx/pptx/odt/pdf conversions, and an unprefixed name here would collide on import.
export const NOOP_MARKDOWN_DIAGNOSTIC_SINK: MarkdownDiagnosticSink = () => {
  /* discards every diagnostic -- the deliberate default for a caller that doesn't want them */
};

// Recover tier: markdown that parses under CommonMark/GFM's own grammar without error, but that a real author almost certainly did not intend -- worth flagging, not worth failing over. Non-exhaustive: further recover-tier codes will be added as src/block/src/inline gain more of the constructs each covers.
//
// Degrade tier: an individual construct src/lower's ContentDocument mapping (or src/emit's inverse) cannot represent faithfully, named per the mapping table in the repository's own task history -- see src/lower/ and src/emit/'s own top-of-file comments for the read/write side each code belongs to. Every one of these is reachable from real markdown/ContentDocument input; src/lower.test.ts and src/emit.test.ts each exercise the codes their own stage produces, and src/diagnostics/diagnostics.test.ts asserts the whole MarkdownDiagnosticCodes table has no dead entry.
export const MarkdownDiagnosticCodes = {
  UNCLOSED_FENCE: 'md/unclosed-fence',
  UNTERMINATED_HTML_BLOCK: 'md/unterminated-html-block',
  TABLE_CELL_COUNT_MISMATCH: 'md/table-cell-count-mismatch',
  DUPLICATE_LINK_REFERENCE: 'md/duplicate-link-reference',
  LIST_MARKER_TYPE_CONFLICT: 'md/list-marker-type-conflict',
  // src/lower (read side: markdown -> ContentDocument)
  INVENTED_PAGE_GEOMETRY: 'md/invented-page-geometry',
  NESTED_EMPHASIS_FLATTENED: 'md/nested-emphasis-flattened',
  LINK_TITLE_DROPPED: 'md/link-title-dropped',
  CODE_BLOCK_INFO_STRING_DROPPED: 'md/code-block-info-string-dropped',
  BLOCKQUOTE_NESTED_DEPTH: 'md/blockquote-nested-depth',
  LIST_ITEM_BLOCK_UNLISTED: 'md/list-item-block-unlisted',
  LIST_ITEM_MULTI_BLOCK_FLATTENED: 'md/list-item-multi-block-flattened',
  IMAGE_UNRESOLVED: 'md/image-unresolved',
  RAW_HTML_PRESERVED_AS_TEXT: 'md/raw-html-preserved-as-text',
  RAW_HTML_DROPPED: 'md/raw-html-dropped',
  FRONT_MATTER_KEY_UNMAPPED: 'md/front-matter-key-unmapped',
  // src/emit (write side: ContentDocument -> markdown)
  HEADING_LEVEL_CLAMPED: 'md/heading-level-clamped',
  ADJACENT_LINKS_MERGED: 'md/adjacent-links-merged',
  CODE_SPAN_AS_MONOSPACE_RUN: 'md/code-span-as-monospace-run',
  PARAGRAPH_INDENT_DROPPED: 'md/paragraph-indent-dropped',
  LIST_NUMID_FALLBACK: 'md/list-numid-fallback',
  TABLE_CELL_FORMATTING_DROPPED: 'md/table-cell-formatting-dropped',
  TABLE_CELL_MULTI_PARAGRAPH_JOINED: 'md/table-cell-multi-paragraph-joined',
} as const;

// The throw tier: input this package cannot meaningfully process at all, regardless of what a diagnostic sink could report about it. Carries the same `code` vocabulary as MarkdownDiagnostic so a caller can distinguish failure reasons programmatically, not just by message text.
export class MarkdownParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MarkdownParseError';
    this.code = code;
  }
}

// The input bytes do not decode as valid UTF-8 -- thrown before any scanning begins, since there is no meaningful line/column position to attribute a recover-tier diagnostic to.
export class MarkdownInvalidUtf8Error extends MarkdownParseError {
  constructor(message = 'input is not valid UTF-8') {
    super('md/invalid-utf8', message);
    this.name = 'MarkdownInvalidUtf8Error';
  }
}

// ReadMarkdownOptions.maxInputBytes exceeded -- a resource-limit guard, not a content problem, so it throws rather than degrading.
export class MarkdownInputTooLargeError extends MarkdownParseError {
  readonly maxInputBytes: number;
  readonly actualBytes: number;

  constructor(maxInputBytes: number, actualBytes: number) {
    super('md/input-too-large', `input is ${String(actualBytes)} bytes, exceeding the configured maximum of ${String(maxInputBytes)} bytes`);
    this.name = 'MarkdownInputTooLargeError';
    this.maxInputBytes = maxInputBytes;
    this.actualBytes = actualBytes;
  }
}

// ReadMarkdownOptions.maxBlockNesting exceeded (default DEFAULT_MAX_BLOCK_NESTING, src/defaults) -- guards the block-structure algorithm's own open-block stack against pathological/adversarial input (thousands of nested blockquotes or list items), the same class of guard cmark's own reference implementation applies.
export class MarkdownNestingLimitExceededError extends MarkdownParseError {
  readonly maxNesting: number;

  constructor(maxNesting: number) {
    super('md/nesting-limit-exceeded', `block nesting exceeds the configured limit of ${String(maxNesting)}`);
    this.name = 'MarkdownNestingLimitExceededError';
    this.maxNesting = maxNesting;
  }
}

// The write-side counterpart to MarkdownParseError -- input this package's writeMarkdown cannot meaningfully render at all, regardless of what a diagnostic sink could report about it. Carries the same `code` vocabulary convention.
export class MarkdownWriteError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MarkdownWriteError';
    this.code = code;
  }
}

// Thrown by writeMarkdown when handed a ContentDocument whose kind is not 'wordprocessing' -- markdown has no presentation/spreadsheet/drawing equivalent to render, matching ooxml.js's buildXlsxPackage's own "throw outright for the wrong document kind" convention (see documents.js's src/ooxml/xlsx precedent) rather than accepting a value a caller would need to pre-check themselves. Extends MarkdownWriteError, not MarkdownParseError -- this is a write-time failure (writeMarkdown's own entry point), never reachable from readMarkdown at all.
export class MarkdownUnsupportedDocumentKindError extends MarkdownWriteError {
  readonly kind: string;

  constructor(kind: string) {
    super('md/write-side-not-wordprocessing', `writeMarkdown only supports a 'wordprocessing' ContentDocument, got '${kind}'`);
    this.name = 'MarkdownUnsupportedDocumentKindError';
    this.kind = kind;
  }
}
