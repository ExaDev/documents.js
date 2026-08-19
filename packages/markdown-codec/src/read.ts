// The read side of this package's public surface, in both of the two encodings document-schema.js states for one document: readMarkdown produces the tree-form DocumentPackage (the primary entry point), readMarkdownContent produces the flat ContentDocument the whole lower pipeline actually builds.
//
// Why two: document-schema.js owns both encodings and the structural transform between them (decompose/assemblePackage in that direction, flattenPackage back), and its own barrel names assemblePackage "the one helper a construction site calls". A codec IS a construction site -- it is where a document first comes into existence from bytes -- so the tree is what this package hands a caller by default, and the flat form is what the pipeline internally produces on the way there. Naming follows ooxml.js's readXlsx/readXlsxContent pair: the unsuffixed name is the one a caller should reach for, the `Content` suffix names the flat constituent underneath it.
//
// Which composition the tree side uses: assemblePackage, not bare decompose. decompose alone returns only the children array (PackageChildren), leaving the envelope splice and the styles-minting pass to the caller; assemblePackage is decompose + envelope + factorStyles in one, and is what documents.js's own conversion sites call for every onDocument payload. There is no `pages` argument here because markdown has no layout stage at all -- no page geometry is ever rendered, matching the layoutless bridge conversions in documents.js that likewise call assemblePackage with content only.
//
// RECONCILIATION DECISION (recorded here per the scaffolding task that created this file): readMarkdownContent/writeMarkdownContent operate on document-schema.js's full ContentDocument directly (kind/metadata/sections), not a bare {metadata, sections} shape wrapped by a documents.js-side adapter. The envelope this decision was recorded against carried a formatVersion field per arm; document-schema.js 4.0.0 retired it, and the full-envelope-vs-bare-shape fork the decision documents is unchanged by that.
//
// Reasoning, from the two precedents this family's own sibling packages already established for exactly this fork:
//
// - odf.js's readOdt/readOdp/readOds/readOdg (consumed by documents.js's src/odf/*/read.ts thin adapters) each return a bare {metadata, sections|slides|sheets|pages} shape. documents.js's own src/odf/odt/read.ts wraps that bare shape into the ContentDocument envelope itself (adding kind/formatVersion) before handing it to the shared layout engine.
// - ooxml.js's readXlsxContent (src/typed/xlsx/content.ts) is the newer, and more recently reasoned-about, sibling precedent -- and it deliberately does NOT follow readOds's bare-shape convention. Its own top-of-file comment states the reasoning explicitly: "Unlike readOds, this returns a full ContentDocument envelope directly (kind/formatVersion/metadata/sheets) rather than a bare {metadata, sheets} shape -- readXlsxContent and typed/xlsx/build.ts's buildXlsxPackage are designed as a matched read/write pair around ContentDocument specifically, so a caller can round-trip readXlsxContent(buildXlsxPackage(x)) without an extra wrapping/unwrapping step, and documents.js's own future ods<->xlsx bridge ... can treat this reader's own output as an already-correctly-shaped pivot value." buildXlsxPackage's own entry point (src/typed/xlsx/build.ts) mirrors this: it accepts a full ContentDocument and throws outright if `document.kind !== 'spreadsheet'`, rather than accepting a bare {metadata, sheets} value a caller would need to wrap first.
//
// readXlsxContent/buildXlsxPackage is the more recent design decision in this ecosystem and the one built specifically to solve the "does a bridge-style reader need its own wrapping step" problem markdown-codec faces here -- markdown-codec has no PDF-pivot layout stage of its own (there is no "markdown page layout" concept the way docx/pptx/odt/odp have one), so it is structurally closer to the xlsx<->ods PDF-bypassing bridge case than to the odt/odp/ods/odg PDF-pivot case odf.js's bare-shape convention was built for. Following readXlsxContent's own shape means a caller composing readMarkdownContent directly with a ContentDocument-consuming builder never needs an extra wrap/unwrap step either -- readMarkdownContent(writeMarkdownContent(x)) round-trips through the identical envelope shape with nothing lost or added in between.
//
// Wiring: readMarkdownContent is a thin wrapper over src/lower/lower.ts's lowerMarkdown (front matter extraction, block parsing, and lowering, already composed there over raw text) -- the pipeline src/lower/lower.ts's own top-of-file table documents in full: src/scan (tokenize) -> src/block (block structure) -> src/inline (inline content, deferred per block) -> src/lower (AST -> ContentDocument), with src/html and src/image consulted by src/block/src/inline respectively. What this module itself adds: collecting every diagnostic lowerMarkdown reports into the returned `diagnostics` array (in addition to forwarding each one to a caller-supplied sink, exactly like it would see them calling lowerMarkdown directly), and a single AbortSignal check up front -- the parser is synchronous and single-pass, so there is no natural mid-parse checkpoint to check again later, matching this package's own "identity, clock, and observability are first-class ports" convention without overclaiming incremental cancellation it cannot actually provide.

import { assemblePackage, type ContentDocument, type DocumentPackage } from 'document-schema.js';
import type { MarkdownDiagnostic } from './diagnostics/diagnostics';
import { lowerMarkdown } from './lower/lower';
import type { ReadMarkdownOptions } from './options/options';

// The field is `documentPackage` rather than the bare noun `package`: `package` is a reserved word in strict mode, so `const { package } = readMarkdown(src)` -- the idiom every caller reaches for first -- is a syntax error, and the only spellings that work are an alias or a property access. A name whose obvious use is illegal is the wrong name.
export interface ReadMarkdownResult {
  readonly documentPackage: DocumentPackage;
  readonly diagnostics: readonly MarkdownDiagnostic[];
}

export interface ReadMarkdownContentResult {
  readonly document: ContentDocument;
  readonly diagnostics: readonly MarkdownDiagnostic[];
}

// Markdown source text -> the tree-form DocumentPackage. The diagnostics are the identical set readMarkdownContent collects -- the tree transform reports none of its own, since decomposition and minting are pure structure over content the lower pipeline has already finished producing.
export function readMarkdown(text: string, options: ReadMarkdownOptions = {}): ReadMarkdownResult {
  const { document, diagnostics } = readMarkdownContent(text, options);
  return { documentPackage: assemblePackage(document), diagnostics };
}

// Markdown source text -> the flat ContentDocument, without the tree transform. The form documents.js's own conversion pipeline consumes, and the level to work at when composing a package boundary by hand (decompose/flattenPackage rather than assemblePackage) or feeding a ContentDocument-consuming builder directly.
export function readMarkdownContent(text: string, options: ReadMarkdownOptions = {}): ReadMarkdownContentResult {
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
