// readMarkdown: markdown source text -> ContentDocument.
//
// RECONCILIATION DECISION (recorded here per the scaffolding task that created this file): readMarkdown/writeMarkdown operate on document-schema.js's full ContentDocument directly (kind/formatVersion/metadata/sections), not a bare {metadata, sections} shape wrapped by a documents.js-side adapter.
//
// Reasoning, from the two precedents this family's own sibling packages already established for exactly this fork:
//
// - odf.js's readOdt/readOdp/readOds/readOdg (consumed by documents.js's src/odf/*/read.ts thin adapters) each return a bare {metadata, sections|slides|sheets|pages} shape. documents.js's own src/odf/odt/read.ts wraps that bare shape into the ContentDocument envelope itself (adding kind/formatVersion) before handing it to the shared layout engine.
// - ooxml.js's readXlsxContent (src/typed/xlsx/content.ts) is the newer, and more recently reasoned-about, sibling precedent -- and it deliberately does NOT follow readOds's bare-shape convention. Its own top-of-file comment states the reasoning explicitly: "Unlike readOds, this returns a full ContentDocument envelope directly (kind/formatVersion/metadata/sheets) rather than a bare {metadata, sheets} shape -- readXlsxContent and typed/xlsx/build.ts's buildXlsxPackage are designed as a matched read/write pair around ContentDocument specifically, so a caller can round-trip readXlsxContent(buildXlsxPackage(x)) without an extra wrapping/unwrapping step, and documents.js's own future ods<->xlsx bridge ... can treat this reader's own output as an already-correctly-shaped pivot value." buildXlsxPackage's own entry point (src/typed/xlsx/build.ts) mirrors this: it accepts a full ContentDocument and throws outright if `document.kind !== 'spreadsheet'`, rather than accepting a bare {metadata, sheets} value a caller would need to wrap first.
//
// readXlsxContent/buildXlsxPackage is the more recent design decision in this ecosystem and the one built specifically to solve the "does a bridge-style reader need its own wrapping step" problem markdown-codec faces here -- markdown-codec has no PDF-pivot layout stage of its own (there is no "markdown page layout" concept the way docx/pptx/odt/odp have one), so it is structurally closer to the xlsx<->ods PDF-bypassing bridge case than to the odt/odp/ods/odg PDF-pivot case odf.js's bare-shape convention was built for. Following readXlsxContent's own shape means a future documents.js-side markdownToDocx/docxToMarkdown-style bridge (or any other caller composing readMarkdown directly with a ContentDocument-consuming builder) never needs an extra wrap/unwrap step either -- readMarkdown(writeMarkdown(x)) round-trips through the identical envelope shape with nothing lost or added in between.
//
// Wiring: readMarkdown is a thin wrapper over src/lower/lower.ts's lowerMarkdown (front matter extraction, block parsing, and lowering, already composed there over raw text) -- the pipeline src/lower/lower.ts's own top-of-file table documents in full: src/scan (tokenize) -> src/block (block structure) -> src/inline (inline content, deferred per block) -> src/lower (AST -> ContentDocument), with src/html and src/image consulted by src/block/src/inline respectively. What this module itself adds: collecting every diagnostic lowerMarkdown reports into the returned `diagnostics` array (in addition to forwarding each one to a caller-supplied sink, exactly like it would see them calling lowerMarkdown directly), and a single AbortSignal check up front -- the parser is synchronous and single-pass, so there is no natural mid-parse checkpoint to check again later, matching this package's own "identity, clock, and observability are first-class ports" convention without overclaiming incremental cancellation it cannot actually provide.

import type { ContentDocument } from 'document-schema.js';
import type { MarkdownDiagnostic } from './diagnostics/diagnostics';
import { lowerMarkdown } from './lower/lower';
import type { ReadMarkdownOptions } from './options/options';

export interface ReadMarkdownResult {
  readonly document: ContentDocument;
  readonly diagnostics: readonly MarkdownDiagnostic[];
}

export function readMarkdown(text: string, options: ReadMarkdownOptions = {}): ReadMarkdownResult {
  options.signal?.throwIfAborted();

  const diagnostics: MarkdownDiagnostic[] = [];
  const callerSink = options.sink;
  const document = lowerMarkdown(text, {
    ...options,
    sink: (diagnostic) => {
      diagnostics.push(diagnostic);
      callerSink?.(diagnostic);
    },
  });

  return { document, diagnostics };
}
