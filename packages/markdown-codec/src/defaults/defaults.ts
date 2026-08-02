// This package's own default option values -- named constants, never magic literals inlined at each call site (see the repository's own root CLAUDE.md convention on magic numbers).
//
// There is no local DEFAULT_PAGE_SIZE constant here: markdown has no page concept of its own, and document-schema.js's own PAGE_SIZE_A4 is already the exact default ReadMarkdownOptions.pageSize falls back to -- re-exporting it unchanged under a new local name here would be a pointless alias (see eslint-rules/no-pointless-reassignment.ts); a future consumer (src/lower, once it exists) imports PAGE_SIZE_A4 from document-schema.js directly.

import type { Margins } from 'document-schema.js';
import type {
  MarkdownBulletListMarker,
  MarkdownCodeFenceChar,
  MarkdownEmphasisMarker,
  MarkdownHeadingStyle,
  MarkdownLineEnding,
  MarkdownOrderedListDelimiter,
} from '../options/options';

// The fallback ReadMarkdownOptions.margins populates ContentSection.page with when a caller supplies neither pageSize nor margins -- 1 inch, in points, on every side. 1 inch = 72pt is the standard PostScript/PDF conversion this family already uses throughout (documents.js's units.ts, pdf-codec's own AFM metrics).
const POINTS_PER_INCH = 72;
export const DEFAULT_MARGINS: Margins = { topPt: POINTS_PER_INCH, rightPt: POINTS_PER_INCH, bottomPt: POINTS_PER_INCH, leftPt: POINTS_PER_INCH };

// Matches cmark's own reference-implementation nesting cap: a guard against pathological/adversarial input (thousands of nested blockquotes or list items) causing unbounded recursion in the block-structure algorithm's open-block stack, not a limit any well-formed real-world document approaches.
export const DEFAULT_MAX_BLOCK_NESTING = 250;

// Resolve embedded image dimensions by default (ReadMarkdownOptions.images) -- the common case; a caller with a large document and no need for image dimensions can opt out.
export const DEFAULT_RESOLVE_IMAGES = true;

// Preserve raw HTML verbatim by default (ReadMarkdownOptions.rawHtml), matching CommonMark's own "HTML blocks/inline HTML are recognised and passed through" default behaviour rather than stripping it.
export const DEFAULT_PRESERVE_RAW_HTML = true;

// Front matter parsing is opt-in, not on by default (ReadMarkdownOptions.frontMatter/WriteMarkdownOptions.frontMatter) -- it is not part of CommonMark or GFM proper, so a caller that wants it asks for it explicitly rather than this package silently reinterpreting a leading '---' thematic break as metadata.
export const DEFAULT_FRONT_MATTER = false;

export const DEFAULT_HEADING_STYLE: MarkdownHeadingStyle = 'atx';
export const DEFAULT_BULLET_LIST_MARKER: MarkdownBulletListMarker = '-';
export const DEFAULT_ORDERED_LIST_DELIMITER: MarkdownOrderedListDelimiter = '.';
export const DEFAULT_EMPHASIS_MARKER: MarkdownEmphasisMarker = '_';
export const DEFAULT_CODE_FENCE_CHAR: MarkdownCodeFenceChar = '`';
export const DEFAULT_LINE_ENDING: MarkdownLineEnding = 'lf';
