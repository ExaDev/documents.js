// readMarkdown/writeMarkdown's own options types. Plain hand-written interfaces, not Zod schemas -- matching pdf-codec's own ReadPdfOptions/WritePdfOptions precedent (src/read.ts/src/write.ts in that package): an options bag is a same-process call argument, never serialised or round-tripped, so there is nothing here for a schema to validate that the TypeScript type doesn't already guarantee.
//
// GFM extension toggles (gfmTables/gfmAutolinks/gfmStrikethrough/gfmTaskLists) now have real implementations to gate -- src/block/block.ts's MarkdownParseOptions and src/lower/lower.ts's LowerMarkdownOptions each already carry them, branched on throughout src/block/src/inline/src/lower. They are not yet fields on ReadMarkdownOptions specifically because src/read.ts itself is not yet implemented; whichever of readMarkdown's own future options end up threading through to parseMarkdown is that task's own call to make, not a decision this file should pre-empt.

import type { Margins, PageSize } from 'document-schema.js';
import type { MarkdownDiagnosticSink } from '../diagnostics/diagnostics';

export interface ReadMarkdownOptions {
  readonly sink?: MarkdownDiagnosticSink;
  readonly signal?: AbortSignal;
  // The page geometry src/lower's own ContentSection.page will be populated with -- markdown itself has no page concept, so this is only ever the caller's own declared target, never inferred from the source text (falls back to document-schema.js's own PAGE_SIZE_A4 and src/defaults's DEFAULT_MARGINS).
  readonly pageSize?: PageSize;
  readonly margins?: Margins;
  // Resolve an inline/reference data: URI image's own pixel dimensions via src/image's readImageDimensions. Defaults to true (src/defaults) -- disabling this is an escape hatch for a caller that wants to skip the byte-level image header parsing entirely (e.g. a huge document with many embedded images and no need for their dimensions).
  readonly images?: boolean;
  // Preserve raw block/inline HTML verbatim as MarkdownHtmlBlockNode/MarkdownRawHtmlNode (the CommonMark-mandated default) rather than treating it as opaque text to strip. There is no partial-HTML-parsing mode -- this is a preserve-verbatim/strip-entirely toggle, not a sanitisation option.
  readonly rawHtml?: boolean;
  // Parse a leading YAML front matter block (a line of exactly '---', a run of lines, a closing line of exactly '---' or '...') as document metadata rather than as CommonMark's own thematic-break-then-paragraph reading of the same bytes. Not part of CommonMark or GFM proper, but the de facto convention essentially every real-world markdown document with metadata uses.
  readonly frontMatter?: boolean;
  // Throws MarkdownInputTooLargeError (src/diagnostics) rather than scanning input beyond this many bytes.
  readonly maxInputBytes?: number;
  // Throws MarkdownNestingLimitExceededError (src/diagnostics) rather than recursing past this many levels of block nesting (blockquote-in-list-in-blockquote, etc.).
  readonly maxBlockNesting?: number;
}

export type MarkdownHeadingStyle = 'atx' | 'setext';
export type MarkdownBulletListMarker = '-' | '*' | '+';
export type MarkdownOrderedListDelimiter = '.' | ')';
export type MarkdownEmphasisMarker = '_' | '*';
export type MarkdownCodeFenceChar = '`' | '~';
export type MarkdownThematicBreakChar = '-' | '_' | '*';
export type MarkdownLineEnding = 'lf' | 'crlf';

// writeMarkdown's own emit-side style choices -- which of several equally CommonMark/GFM-valid syntaxes to render with. Read separately from the shared sink/signal/images/frontMatter fields below since these have no read-side equivalent (a reader accepts whichever style the source document happens to use; a writer must pick one).
export interface WriteMarkdownStyleOptions {
  readonly headingStyle?: MarkdownHeadingStyle;
  readonly bulletListMarker?: MarkdownBulletListMarker;
  readonly orderedListDelimiter?: MarkdownOrderedListDelimiter;
  readonly emphasisMarker?: MarkdownEmphasisMarker;
  readonly codeFenceChar?: MarkdownCodeFenceChar;
  readonly thematicBreakChar?: MarkdownThematicBreakChar;
}

export interface WriteMarkdownOptions extends WriteMarkdownStyleOptions {
  readonly sink?: MarkdownDiagnosticSink;
  readonly signal?: AbortSignal;
  // Emit an embedded ContentImageBlock as a data: URI image (true, the default) or omit its bytes and emit only its altText (false) -- the write-side counterpart to ReadMarkdownOptions.images.
  readonly images?: boolean;
  readonly lineEnding?: MarkdownLineEnding;
  // Emit a leading YAML front matter block from ContentDocument.metadata -- the write-side counterpart to ReadMarkdownOptions.frontMatter.
  readonly frontMatter?: boolean;
}
