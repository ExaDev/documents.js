// The write side of this package's public surface, mirroring src/read.ts's two encodings: writeMarkdown accepts the tree-form DocumentPackage (the primary entry point), writeMarkdownContent accepts the flat ContentDocument src/emit actually renders. See src/read.ts's own top-of-file comment for the naming convention (ooxml.js's readXlsx/readXlsxContent pair) and the full-ContentDocument-vs-bare-shape reconciliation decision both sides of this pair follow.
//
// The tree side is flattenPackage then the flat writer: flattening materialises every style ref away into direct properties, which is exactly what src/emit needs -- it reads a paragraph's own properties and this package's own styleId vocabulary (src/shared/style-constants.ts), and has no notion of a package-level styles table to resolve against. flattenPackage is document-schema.js's own stated inverse of the assemblePackage src/read.ts's readMarkdown calls, so writeMarkdown(readMarkdown(text).documentPackage) renders exactly what writeMarkdownContent(readMarkdownContent(text).document) does.
//
// writeMarkdownContent is a thin wrapper over src/emit/emit.ts's emitMarkdown, mirroring ooxml.js's buildXlsxPackage(document: ContentDocument) signature rather than odf.js's bare-shape build*Package equivalents -- emitMarkdown already accepts WriteMarkdownOptions directly (src/options/options.ts), so there is no options-shape reconciliation needed on this side the way src/read.ts needed for src/lower/lower.ts's own options. Throws MarkdownUnsupportedDocumentKindError (src/diagnostics/diagnostics.ts) for a non-'wordprocessing' ContentDocument -- emitMarkdown's own responsibility, not reimplemented here.
//
// writeMarkdown checks the package's own `kind` itself, ahead of flattening, rather than letting a non-'wordprocessing' package reach emitMarkdown's own check by way of flattenPackage preserving `kind`: flattenPackage has kind-specific validation of its own (a 'formula' package's single-ContentFormula-node constraint, a 'spreadsheet' sheet group's own "no style ref" constraint) that can throw a bare Error before ever reaching that check, for a package this function was never going to accept anyway. Checking first means every non-'wordprocessing' package reaches the identical, correctly-typed MarkdownUnsupportedDocumentKindError, regardless of what else is wrong with it.
//
// flattenPackage's own envelope (document-schema.js's dist/flatten.js) carries forward only `metadata` and, when present, `symbolTable` -- a DocumentPackage's `definitions`/`layers`/`attachments`/`destinations`/`pages` tables have no flat-ContentDocument home to land in and are silently absent from its return value. This matters here specifically because the tree form exists for interop with packages ooxml.js/odf.js/documents.js produce, which DO populate those tables (a docx footnote/comment table, page geometry) -- reportDroppedPackageTables below turns that structural gap into a MarkdownDiagnosticCodes.PACKAGE_TABLE_DROPPED diagnostic per non-empty table, matching this package's own "every mapping gap reports through the sink as a stable code" contract, rather than leaving it silent the way a bare pass-through to flattenPackage would.
//
// The remaining way flattenPackage can throw for a 'wordprocessing' package -- a heading/list group carrying a style ref with no top-level styles table to resolve it against -- is not something writeMarkdown can rule out with a cheap up-front check the way the kind mismatch above is, so it is caught and rewrapped as MarkdownPackageFlattenError instead: a bare Error from a dependency is not part of this package's own MarkdownWriteError hierarchy, and a caller catching that hierarchy around this entry point should not need to know flattenPackage's own exception type to catch it.

import { flattenPackage, type ContentDocument, type DocumentPackage } from 'document-schema.js';
import { MarkdownDiagnosticCodes, MarkdownPackageFlattenError, MarkdownUnsupportedDocumentKindError, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from './diagnostics/diagnostics';
import type { MarkdownDiagnosticSink } from './diagnostics/diagnostics';
import { emitMarkdown } from './emit/emit';
import type { WriteMarkdownOptions } from './options/options';

// Reports one PACKAGE_TABLE_DROPPED diagnostic per non-empty package-level table flattenPackage's own envelope does not carry into the ContentDocument it returns. Named individually (rather than one diagnostic for "some table was dropped") so a caller's sink can tell which table's data it needs to have captured before calling writeMarkdown, the same granularity every other degrade-tier code in this package already gives.
function reportDroppedPackageTables(documentPackage: DocumentPackage, sink: MarkdownDiagnosticSink): void {
  const tables: readonly (readonly [name: string, present: boolean])[] = [
    ['definitions', documentPackage.definitions !== undefined && Object.keys(documentPackage.definitions).length > 0],
    ['layers', documentPackage.layers !== undefined && Object.keys(documentPackage.layers).length > 0],
    ['attachments', documentPackage.attachments !== undefined && Object.keys(documentPackage.attachments).length > 0],
    ['destinations', documentPackage.destinations !== undefined && Object.keys(documentPackage.destinations).length > 0],
    ['pages', documentPackage.pages !== undefined && documentPackage.pages.length > 0],
  ];
  for (const [name, present] of tables) {
    if (!present) continue;
    sink({
      code: MarkdownDiagnosticCodes.PACKAGE_TABLE_DROPPED,
      severity: 'info',
      message: `the package's own "${name}" table has no markdown representation; flattenPackage's envelope carries forward only metadata and symbolTable, so "${name}" is dropped rather than rendered`,
    });
  }
}

// The tree-form DocumentPackage -> markdown source text. The abort check is here as well as in writeMarkdownContent because flattening is real work done before that delegated check would run, and an already-aborted call should not perform it.
export function writeMarkdown(documentPackage: DocumentPackage, options: WriteMarkdownOptions = {}): string {
  options.signal?.throwIfAborted();
  if (documentPackage.kind !== 'wordprocessing') throw new MarkdownUnsupportedDocumentKindError(documentPackage.kind);

  reportDroppedPackageTables(documentPackage, options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK);

  let flattened: ContentDocument;
  try {
    flattened = flattenPackage(documentPackage);
  } catch (error) {
    throw new MarkdownPackageFlattenError(error);
  }
  return writeMarkdownContent(flattened, options);
}

// The flat ContentDocument -> markdown source text, without the tree transform. The level documents.js's own conversion pipeline writes at, and the one to use when a caller already holds flat content rather than a package.
export function writeMarkdownContent(document: ContentDocument, options: WriteMarkdownOptions = {}): string {
  options.signal?.throwIfAborted();
  return emitMarkdown(document, options);
}
