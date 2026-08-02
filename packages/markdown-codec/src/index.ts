// Public barrel. May contain only re-export statements (enforced by local/no-side-effects-in-index, eslint.config.ts) -- nothing here can have a side effect at import time.
//
// src/html/render.ts (the CommonMark-HTML conformance oracle) and src/ast/* (this package's own internal AST) are deliberately NOT re-exported here -- both are pipeline-internal: readMarkdown/writeMarkdown convert between markdown text and document-schema.js's ContentDocument, never HTML or a raw AST, and exposing either would invite a caller to reach for the wrong thing rather than genuinely offering two competing outputs.

export type { ReadMarkdownResult } from './read';
export { readMarkdown } from './read';
export { writeMarkdown } from './write';
export { markdownCodec, MarkdownBytesSchema } from './codec';

export type { MarkdownDiagnostic, MarkdownDiagnosticSeverity, MarkdownDiagnosticSink } from './diagnostics/diagnostics';
export {
  MarkdownDiagnosticCodes,
  MarkdownInputTooLargeError,
  MarkdownInvalidUtf8Error,
  MarkdownNestingLimitExceededError,
  MarkdownParseError,
  MarkdownUnsupportedDocumentKindError,
  MarkdownWriteError,
  NOOP_MARKDOWN_DIAGNOSTIC_SINK,
} from './diagnostics/diagnostics';

export type {
  MarkdownBulletListMarker,
  MarkdownCodeFenceChar,
  MarkdownEmphasisMarker,
  MarkdownHeadingStyle,
  MarkdownLineEnding,
  MarkdownOrderedListDelimiter,
  MarkdownThematicBreakChar,
  ReadMarkdownOptions,
  WriteMarkdownOptions,
  WriteMarkdownStyleOptions,
} from './options/options';

export type { MarkdownImageResolveContext, MarkdownImageResolver, MarkdownResolvedImageBytes } from './lower/image';
