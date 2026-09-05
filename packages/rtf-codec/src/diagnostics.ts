// The read/write diagnostic sink, matching markdown-codec's and pdf-codec's own three-tier policy exactly (see markdown-codec's src/diagnostics/diagnostics.ts and pdf-codec's src/diagnostics.ts): throw for input this package cannot meaningfully process at all; recover-with-diagnostic for RTF that is spec-legal but almost certainly not what the producer meant, where continuing is more useful than failing; degrade-with-diagnostic for an individual construct this package's own ContentDocument mapping cannot represent, while the rest of the document still reads.
//
// RTF makes that third tier load-bearing in a way the XML formats do not. The specification's own reader conventions require an unknown control word to be ignored and an unknown `{\*` destination to be skipped whole (RTF 1.9.1, "Conventions of an RTF Reader"), so "I did not understand this" is the format's normal, specified operating mode rather than an error condition -- but a reader that silently drops a construct a caller cared about is indistinguishable from one that never saw it. Every drop this package makes deliberately therefore names itself through a code below.
//
// No Zod schema wraps RtfDiagnostic, matching MarkdownDiagnostic's and PdfDiagnostic's own precedent: a diagnostic is produced exclusively by this package's own pipeline, is consumed by a caller-supplied sink rather than round-tripped through JSON, and validating our own output would validate nothing a caller couldn't already see from the TypeScript type.

export type RtfDiagnosticSeverity = "info" | "warning";

export interface RtfDiagnostic {
  // A stable, namespaced code (e.g. 'rtf/unknown-destination-skipped') -- callers branch on this, not on `message`, which is free text for humans. See RtfDiagnosticCodes below for the codes this package names.
  readonly code: string;
  readonly severity: RtfDiagnosticSeverity;
  readonly message: string;
  // Where in the token stream the fault was noticed: a 0-based index into the tokens src/tokenize.ts produced, when the stage reporting it has one to hand. A token index rather than a byte offset because that is what the reader actually holds -- the tokenizer emits text in runs and does not carry each token's own input position, so a byte offset here would have to be invented. A write-side diagnostic has no input position at all and omits it.
  readonly tokenIndex?: number;
}

export type RtfDiagnosticSink = (diagnostic: RtfDiagnostic) => void;

// Deliberately prefixed (not the bare NOOP_DIAGNOSTIC_SINK pdf-codec uses, nor markdown-codec's NOOP_MARKDOWN_DIAGNOSTIC_SINK) -- documents.js will import several of these packages' no-op sinks into the same modules once it composes RTF alongside the existing formats, and an unprefixed name here would collide on import.
export const NOOP_RTF_DIAGNOSTIC_SINK: RtfDiagnosticSink = () => {
  /* discards every diagnostic -- the deliberate default for a caller that doesn't want them */
};

export const RtfDiagnosticCodes = {
  // Read side, recover tier: the input is malformed in a way the spec's own robustness advice ("RTF readers should be robust enough to handle some minor variations") says to survive rather than reject.
  UNBALANCED_GROUP: "rtf/unbalanced-group",
  // Read side, degrade tier: a construct read correctly at the token level whose meaning this package's ContentDocument mapping does not carry.
  UNKNOWN_DESTINATION_SKIPPED: "rtf/unknown-destination-skipped",
  CONTENT_DESTINATION_SKIPPED: "rtf/content-destination-skipped",
  UNSUPPORTED_CODEPAGE: "rtf/unsupported-codepage",
  UNSUPPORTED_PICTURE_FORMAT: "rtf/unsupported-picture-format",
  PICTURE_SIZE_UNSTATED: "rtf/picture-size-unstated",
  EMBEDDED_OBJECT_UNREADABLE: "rtf/embedded-object-unreadable",
  TABLE_ROW_WITHOUT_DEFINITION: "rtf/table-row-without-definition",
  TABLE_COLUMN_WIDTH_INVALID: "rtf/table-column-width-invalid",
  NESTED_TABLE_FLATTENED: "rtf/nested-table-flattened",
  SECTION_BREAK_UNREPRESENTED: "rtf/section-break-unrepresented",
  BOOKMARK_UNPAIRED: "rtf/bookmark-unpaired",
  // Write side: a ContentDocument fact RTF's own vocabulary cannot state, or that this writer does not yet state.
  CONSTRUCT_UNREPRESENTED: "rtf/construct-unrepresented",
  PACKAGE_TABLE_DROPPED: "rtf/package-table-dropped",
} as const;

// The throw tier: input this package cannot meaningfully process at all, regardless of what a diagnostic sink could report about it. Carries the same `code` vocabulary as RtfDiagnostic so a caller can distinguish failure reasons programmatically, not just by message text.
export class RtfParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RtfParseError";
    this.code = code;
  }
}

// The input does not begin with an RTF header. Checked before any parsing, since every later stage's behaviour is defined relative to the `{\rtfN` the spec's own <File> production requires.
export class RtfNotAnRtfDocumentError extends RtfParseError {
  constructor(message = "input does not begin with '{\\rtf'") {
    super("rtf/not-an-rtf-document", message);
    this.name = "RtfNotAnRtfDocumentError";
  }
}

// ReadRtfOptions.maxInputBytes exceeded -- a resource-limit guard, not a content problem, so it throws rather than degrading.
export class RtfInputTooLargeError extends RtfParseError {
  readonly byteLength: number;
  readonly maxInputBytes: number;

  constructor(byteLength: number, maxInputBytes: number) {
    super(
      "rtf/input-too-large",
      `input is ${String(byteLength)} bytes, over the ${String(maxInputBytes)}-byte limit`,
    );
    this.name = "RtfInputTooLargeError";
    this.byteLength = byteLength;
    this.maxInputBytes = maxInputBytes;
  }
}

// ReadRtfOptions.maxGroupDepth exceeded. RTF group nesting is unbounded in the grammar, and a hand-written reader recursing on it is a stack-overflow target on adversarial input, so the depth is bounded explicitly rather than left to the runtime's own stack.
export class RtfNestingLimitExceededError extends RtfParseError {
  readonly maxGroupDepth: number;

  constructor(maxGroupDepth: number) {
    super(
      "rtf/nesting-limit-exceeded",
      `group nesting exceeded the ${String(maxGroupDepth)}-level limit`,
    );
    this.name = "RtfNestingLimitExceededError";
    this.maxGroupDepth = maxGroupDepth;
  }
}

// The write tier's own error: a ContentDocument this writer cannot express as RTF at all, as distinct from one construct inside it that degrades. RTF is a wordprocessing format, so a presentation/spreadsheet/drawing/formula document has no RTF spelling to produce.
export class RtfWriteError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RtfWriteError";
    this.code = code;
  }
}

export class RtfUnsupportedDocumentKindError extends RtfWriteError {
  readonly documentKind: string;

  constructor(documentKind: string) {
    super(
      "rtf/unsupported-document-kind",
      `RTF is a wordprocessing format; a '${documentKind}' ContentDocument has no RTF representation`,
    );
    this.name = "RtfUnsupportedDocumentKindError";
    this.documentKind = documentKind;
  }
}
