import type { WriteMarkdownOptions } from 'markdown-codec';
import { MarkdownUnsupportedDocumentKindError, writeMarkdown } from 'markdown-codec';
import type { ContentBlock, ContentDocument } from 'document-schema.js';

// markdown-codec's own writeMarkdown parameter type is ALSO a document-schema.js ContentDocument -- but, like readMarkdown's own return type (see read.ts's matching top-of-file note), from markdown-codec's independently-pinned, still-pre-2.0.0 document-schema.js dependency (^1.5.3), not this package's own 2.0.0. TypeScript treats the two import("document-schema.js")-sourced types as nominally unrelated, recursively, through ContentBlock -> ContentEmbeddedObjectBlock -> document -- there is no genuine schema-validation shortcut available here the way read.ts's read-direction adapter has (ContentDocumentSchema.parse): markdown-codec does not export its own ContentDocument schema standalone, only bundled inside its unrelated bytes<->ContentDocument markdownCodec (which has no room for this function's own WriteMarkdownOptions parameter). toLegacyWordprocessingDocument below is the real reshape instead of a cast: it walks every block (recursing into a formula's own embeddedObject placeholder document -- see src/odf/formula/placeholder.ts's buildFormulaPlaceholderBlock, a real docx/odt document with an embedded formula genuinely produces one of these, so this is a reachable path, not a hypothetical one) and rebuilds the legacy-shaped value field by field.
type LegacyDocument = Parameters<typeof writeMarkdown>[0];
type LegacyWordprocessingDocument = Extract<LegacyDocument, { kind: 'wordprocessing' }>;
type LegacyBlock = LegacyWordprocessingDocument['sections'][number]['blocks'][number];

// A nested embeddedObject.document could in principle be any ContentDocument kind (document-schema.js's own ContentEmbeddedObjectSchema doesn't restrict it to wordprocessing), but this package's own readers only ever populate one: a formula's own placeholder document, always wordprocessing-kind, always a single paragraph (buildFormulaPlaceholderBlock, src/odf/formula/placeholder.ts). Handling that one real case fully and throwing a clear, named error for the four others (rather than also reshaping presentation/spreadsheet/drawing's own further, unrelated version-skew -- ContentSheetPrintSettings.scale -> scalePercent, ContentCellValue's new 'dateTime' kind the legacy schema has no member for at all, ContentSheetColumn.widthPt going optional -- for a shape this package has no code path to ever actually produce) is the deliberate, honest scope here: a genuinely unsupported nested kind fails loudly with a precise error, never silently, rather than pretending to convert it.
function toLegacyEmbeddedDocument(document: ContentDocument): LegacyDocument {
  if (document.kind !== 'wordprocessing') {
    throw new MarkdownUnsupportedDocumentKindError(document.kind);
  }
  return toLegacyWordprocessingDocument(document);
}

function toLegacyBlock(block: ContentBlock): LegacyBlock {
  // A table is recursive too -- ContentTableCell.blocks is itself ContentBlock[], so a table cell could carry its own nested embeddedObject (or another nested table) needing the identical conversion, not just the top-level embeddedObject case below.
  if (block.kind === 'table') {
    return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, blocks: cell.blocks.map(toLegacyBlock) })) })) };
  }
  if (block.kind === 'embeddedObject') {
    return { ...block, document: toLegacyEmbeddedDocument(block.document) };
  }
  // paragraph/image/pageBreak carry no nested ContentBlock/ContentDocument of their own, and are otherwise structurally identical between the two schema versions -- passed through unchanged.
  return block;
}

function toLegacyWordprocessingDocument(document: Extract<ContentDocument, { kind: 'wordprocessing' }>): LegacyWordprocessingDocument {
  return {
    kind: 'wordprocessing',
    formatVersion: 1,
    metadata: document.metadata,
    sections: document.sections.map((section) => ({ ...section, blocks: section.blocks.map(toLegacyBlock) })),
  };
}

// ContentDocument (the wordprocessing variant) -> markdown text. A thin adapter over markdown-codec's own writeMarkdown, lives beside read.ts rather than under src/edit/ -- there is no live-view editor for markdown the way docx/pptx/odt/odp/ods/odg each have one (src/edit/*): every one of those editors wraps a real, mutable XmlElement tree inside a decoded Package, and markdown has no such tree at all, so there is nothing for a live view to hold a reference into.
//
// writeMarkdown throws MarkdownUnsupportedDocumentKindError on its own for a non-'wordprocessing' input -- this adapter's own guard below mirrors that exact check (and error) rather than duplicating a second, less specific one, for both the real top-level kind and the fifth, 'formula' kind specifically: 'formula' postdates markdown-codec's own pinned document-schema.js entirely, so there is no legacy-shaped value -- real or approximate -- to reshape it into at all.
export function buildMarkdownText(document: ContentDocument, options?: WriteMarkdownOptions): string {
  if (document.kind !== 'wordprocessing') {
    throw new MarkdownUnsupportedDocumentKindError(document.kind);
  }
  return writeMarkdown(toLegacyWordprocessingDocument(document), options);
}
