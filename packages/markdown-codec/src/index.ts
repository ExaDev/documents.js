// Public barrel. May contain only re-export statements (enforced by local/no-side-effects-in-index, eslint.config.ts) -- nothing here can have a side effect at import time.
//
// src/html/render.ts (the CommonMark-HTML conformance oracle) and src/ast/* (this package's own internal AST) are deliberately NOT re-exported here -- both are pipeline-internal: readMarkdown/writeMarkdown convert between markdown text and document-schema.js's own document encodings, never HTML or a raw AST, and exposing either would invite a caller to reach for the wrong thing rather than genuinely offering two competing outputs.

// The primary read/write pair, over document-schema.js's tree-form DocumentPackage -- what a caller reaching for "read a markdown file" or "write one" should use. The *Content pair below is the same conversion one level down, over the flat ContentDocument the lower/emit pipeline itself builds; see src/read.ts's own top-of-file comment for why both exist and which to reach for.
export type { ReadMarkdownResult } from './read';
export { readMarkdown } from './read';
export { writeMarkdown } from './write';
export { markdownCodec } from './codec';

export type { ReadMarkdownContentResult } from './read';
export { readMarkdownContent } from './read';
export { writeMarkdownContent } from './write';
export { markdownContentCodec, MarkdownBytesSchema } from './codec';

export type { MarkdownDiagnostic, MarkdownDiagnosticSeverity, MarkdownDiagnosticSink } from './diagnostics/diagnostics';
export {
  MarkdownDiagnosticCodes,
  MarkdownInputTooLargeError,
  MarkdownInvalidUtf8Error,
  MarkdownNestingLimitExceededError,
  MarkdownParseError,
  MarkdownUnbalancedConstructMarkersError,
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

// src/shared/style-constants.ts and src/shared/list-id.ts hold this package's own internal styleId/numId string vocabulary that src/lower and src/emit agree on -- re-exported here so a sibling package (documents.js) can build and parse the identical strings when constructing its own editor over a ContentDocument, without duplicating this package's grammar.
export type { ListNumIdInfo, ListNumIdMintOptions, NumIdMintState } from './shared/list-id';
export { createNumIdMintState, mintedListType, mintListNumId, parseListNumId } from './shared/list-id';
export {
  CODE_BLOCK_STYLE_ID,
  FOOTNOTE_REFERENCE_FONT_MARKER,
  headingStyleId,
  HORIZONTAL_RULE_STYLE_ID,
  HTML_PREFORMATTED_STYLE_ID,
  MAX_HEADING_STYLE_LEVEL,
  MONOSPACE_FONT_FAMILY,
  parseHeadingStyleId,
  QUOTE_INDENT_PT,
  QUOTE_STYLE_ID,
} from './shared/style-constants';
