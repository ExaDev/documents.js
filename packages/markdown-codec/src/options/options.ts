// readMarkdown/writeMarkdown's own options types. Plain hand-written interfaces, not Zod schemas -- matching pdf-codec's own ReadPdfOptions/WritePdfOptions precedent (src/read.ts/src/write.ts in that package): an options bag is a same-process call argument, never serialised or round-tripped, so there is nothing here for a schema to validate that the TypeScript type doesn't already guarantee.
//
// This is now the single options shape src/lower/lower.ts's own lowerMarkdown/lowerParsedMarkdown accept directly (no separate LowerMarkdownOptions type any more) -- the same relationship src/emit/emit.ts's emitMarkdown already had with WriteMarkdownOptions from the start. Two fields below were retyped to match what src/lower actually threads through, once src/read.ts was wired up and the mismatch became visible: `images` is the real MarkdownImageResolver port (src/lower/image.ts), not a boolean dimension-resolution toggle -- native data: URI decoding is unconditional, so a boolean "resolve dimensions" switch was never a real feature; `rawHtml` is the same 'preserve' | 'drop' union src/lower/lower.ts's own LowerMarkdownOptions always used, not a boolean.

import type { Margins, PageSize } from 'document-schema.js';
import type { MarkdownDiagnosticSink } from '../diagnostics/diagnostics';
import type { MarkdownImageResolver } from '../lower/image';

export interface ReadMarkdownOptions {
  readonly sink?: MarkdownDiagnosticSink;
  readonly signal?: AbortSignal;
  // The page geometry src/lower's own ContentSection.page will be populated with -- markdown itself has no page concept, so this is only ever the caller's own declared target, never inferred from the source text (falls back to document-schema.js's own PAGE_SIZE_A4 and src/defaults's DEFAULT_MARGINS).
  readonly pageSize?: PageSize;
  readonly margins?: Margins;
  // Resolves a non-data: URI image's own bytes (a bare http(s):// URL, a relative path) -- a data:image/png|jpeg;base64,... URI decodes natively regardless of whether this is supplied. See src/lower/image.ts's own top-of-file note.
  readonly images?: MarkdownImageResolver;
  // Preserve raw block/inline HTML verbatim as MarkdownHtmlBlockNode/MarkdownRawHtmlNode text (the CommonMark-mandated default, 'preserve') rather than dropping it entirely ('drop'). There is no partial-HTML-parsing mode -- this is a preserve-verbatim/strip-entirely toggle, not a sanitisation option.
  readonly rawHtml?: 'preserve' | 'drop';
  // Parse a leading YAML front matter block (a line of exactly '---', a run of lines, a closing line of exactly '---' or '...') as document metadata rather than as CommonMark's own thematic-break-then-paragraph reading of the same bytes. Not part of CommonMark or GFM proper, but the de facto convention essentially every real-world markdown document with metadata uses.
  readonly frontMatter?: boolean;
  // GFM's table/extended-autolink/strikethrough/task-list extensions. Each defaults to true (this package targets CommonMark *and* GFM); src/conformance.test.ts switches all four off to measure CommonMark alone.
  readonly gfmTables?: boolean;
  readonly gfmAutolinks?: boolean;
  readonly gfmStrikethrough?: boolean;
  readonly gfmTaskLists?: boolean;
  // GitHub's footnote extension (`[^label]` markers with `[^label]: body` definitions). Defaults to true alongside the four toggles above; src/conformance.test.ts switches it off with them, since neither CommonMark nor the GFM spec document itself defines footnotes at all.
  readonly footnotes?: boolean;
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
