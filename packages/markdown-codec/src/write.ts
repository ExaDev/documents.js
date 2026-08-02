// writeMarkdown: ContentDocument -> markdown source text. The build-side counterpart to src/read.ts's readMarkdown -- see that file's own top-of-file comment for the full-ContentDocument-vs-bare-shape reconciliation decision both sides of this pair follow.
//
// A thin wrapper over src/emit/emit.ts's emitMarkdown, mirroring ooxml.js's buildXlsxPackage(document: ContentDocument) signature rather than odf.js's bare-shape build*Package equivalents -- emitMarkdown already accepts WriteMarkdownOptions directly (src/options/options.ts), so there is no options-shape reconciliation needed on this side the way src/read.ts needed for src/lower/lower.ts's own options. Throws MarkdownUnsupportedDocumentKindError (src/diagnostics/diagnostics.ts) for a non-'wordprocessing' ContentDocument -- emitMarkdown's own responsibility, not reimplemented here.

import type { ContentDocument } from 'document-schema.js';
import { emitMarkdown } from './emit/emit';
import type { WriteMarkdownOptions } from './options/options';

export function writeMarkdown(document: ContentDocument, options: WriteMarkdownOptions = {}): string {
  options.signal?.throwIfAborted();
  return emitMarkdown(document, options);
}
