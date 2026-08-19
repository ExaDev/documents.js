// The write side of this package's public surface, mirroring src/read.ts's two encodings: writeMarkdown accepts the tree-form DocumentPackage (the primary entry point), writeMarkdownContent accepts the flat ContentDocument src/emit actually renders. See src/read.ts's own top-of-file comment for the naming convention (ooxml.js's readXlsx/readXlsxContent pair) and the full-ContentDocument-vs-bare-shape reconciliation decision both sides of this pair follow.
//
// The tree side is flattenPackage then the flat writer: flattening materialises every style ref away into direct properties, which is exactly what src/emit needs -- it reads a paragraph's own properties and this package's own styleId vocabulary (src/shared/style-constants.ts), and has no notion of a package-level styles table to resolve against. flattenPackage is document-schema.js's own stated inverse of the assemblePackage src/read.ts's readMarkdown calls, so writeMarkdown(readMarkdown(text).documentPackage) renders exactly what writeMarkdownContent(readMarkdownContent(text).document) does.
//
// writeMarkdownContent is a thin wrapper over src/emit/emit.ts's emitMarkdown, mirroring ooxml.js's buildXlsxPackage(document: ContentDocument) signature rather than odf.js's bare-shape build*Package equivalents -- emitMarkdown already accepts WriteMarkdownOptions directly (src/options/options.ts), so there is no options-shape reconciliation needed on this side the way src/read.ts needed for src/lower/lower.ts's own options. Throws MarkdownUnsupportedDocumentKindError (src/diagnostics/diagnostics.ts) for a non-'wordprocessing' ContentDocument -- emitMarkdown's own responsibility, not reimplemented here. A non-'wordprocessing' DocumentPackage reaches that same throw through writeMarkdown, since flattening a package preserves its kind.

import { flattenPackage, type ContentDocument, type DocumentPackage } from 'document-schema.js';
import { emitMarkdown } from './emit/emit';
import type { WriteMarkdownOptions } from './options/options';

// The tree-form DocumentPackage -> markdown source text. The abort check is here as well as in writeMarkdownContent because flattening is real work done before that delegated check would run, and an already-aborted call should not perform it.
export function writeMarkdown(documentPackage: DocumentPackage, options: WriteMarkdownOptions = {}): string {
  options.signal?.throwIfAborted();
  return writeMarkdownContent(flattenPackage(documentPackage), options);
}

// The flat ContentDocument -> markdown source text, without the tree transform. The level documents.js's own conversion pipeline writes at, and the one to use when a caller already holds flat content rather than a package.
export function writeMarkdownContent(document: ContentDocument, options: WriteMarkdownOptions = {}): string {
  options.signal?.throwIfAborted();
  return emitMarkdown(document, options);
}
