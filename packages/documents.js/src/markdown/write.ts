import type { WriteMarkdownOptions } from 'markdown-codec';
import { MarkdownUnsupportedDocumentKindError, writeMarkdownContent } from 'markdown-codec';
import type { ContentBlock, ContentConstructEnd, ContentConstructStart, ContentDocument, ContentTableCell } from 'document-schema.js';
import { formulaOfBlock, formulaPlaceholderText } from '../model/formula';

// A construct marker (document-schema.js 4.2.0's constructStart/constructEnd -- a docx SDT, an ODF field, a tracked-change span, a bookmark, a hyperlink region, a division) has no CommonMark/GFM spelling of its own, and unlike an embedded formula it has no plain-text stand-in either: a division's column count and a tracked-change's author carry nothing a reader could usefully render as text. markdown-codec's own writer (renderTopLevelBlock in that package's emit/emit.ts) has no arm for either marker kind and falls through to `undefined`, which its caller then dereferences with `.length`, crashing with an undebuggable TypeError three stack frames past this package's own code. buildMarkdownText refuses loudly and by name instead, before a marker ever reaches writeMarkdownContent -- the same "no silent approximation" contract this package's other markdown gaps keep (see MarkdownDiagnosticCodes), just with no degraded rendering to fall back to.
export class MarkdownConstructUnsupportedError extends Error {
  readonly descriptorKind: ContentConstructStart['descriptor']['kind'] | undefined;

  constructor(block: ContentConstructStart | ContentConstructEnd) {
    super(
      block.kind === 'constructStart'
        ? `buildMarkdownText: a construct marker (descriptor kind '${block.descriptor.kind}') has no CommonMark/GFM representation -- markdown-codec's own writer has no arm for the constructStart/constructEnd block kinds`
        : `buildMarkdownText: a construct marker has no CommonMark/GFM representation -- markdown-codec's own writer has no arm for the constructStart/constructEnd block kinds`,
    );
    this.name = 'MarkdownConstructUnsupportedError';
    this.descriptorKind = block.kind === 'constructStart' ? block.descriptor.kind : undefined;
  }
}

// markdown-codec's own writeMarkdownContent parameter type is the SAME document-schema.js ContentDocument this package imports: markdown-codec bumped its own document-schema.js dependency to ^2.2.4 (matching this package's own ^2.2.4 direct dependency), and pnpm resolves both to the single installed copy (`pnpm why document-schema.js` shows exactly one). The version-skew this file used to reshape around (markdown-codec independently pinned at ^1.5.3, a pre-2.0.0 release with CONTENT_FORMAT_VERSION 1, TypeScript treating the two import("document-schema.js")-sourced types as nominally unrelated all the way down through ContentBlock -> ContentEmbeddedObjectBlock -> document) no longer exists, so there is no LegacyDocument mirror type and no field-by-field document rebuild needed any more -- a real ContentDocument goes straight into writeMarkdownContent. (markdown-codec 4.0.0 renamed this flat writer to writeMarkdownContent and gave the bare writeMarkdown name to its tree-form DocumentPackage counterpart; this package calls only the flat one.)
//
// What remains is a genuine semantic transformation writeMarkdownContent does not do on its own: markdown-codec's own emit path drops every embeddedObject block uniformly, regardless of what it nests (see that package's own src/write.ts -> emit/emit.ts, renderTopLevelBlock's `case "embeddedObject": return ""`). That is exactly right for a recovered drawing -- a rect/ellipse/line/path carries no text to stand in for, and CommonMark/GFM has no vector construct anyway -- but wrong for an embedded formula, whose own text this package still wants preserved rather than silently discarded. markdownBlock below is that one transformation (flatten a formula block to its own plain-text stand-in), plus the construct-marker refusal above; every other block, a recovered drawing included, is passed through unchanged and left to writeMarkdownContent's own uniform embeddedObject handling to drop.
// A formula carrying a presentation LaTeX string is reconstructed as markdown MATH rather than flattened to plain text: markdown-codec's own math vocabulary (its issue #53) round-trips a $$ display block as a MathBlock-styled paragraph and an inline \( \) span as a run marked with the Cambria Math fontFamily, and its emit path regenerates both shapes from exactly those markers -- so the formula's verbatim presentation string (rendering-authoritative, never re-derived from the semantic layer) goes back out as the same syntax it arrived in. Which of the two shapes is chosen by the formula's recorded provenance source: a span that arrived inline goes back inline (in a paragraph of its own -- the block model never retained its position inside the source paragraph, the same position loss every inline-equation recovery in this package already has), everything else goes back as a display block. The marker strings are mirrored here as literals for the same reason src/markdown/math.ts mirrors its read-side pair: markdown-codec documents them as stable lower/emit conventions but does not re-export these two among its public style constants.
const MATH_BLOCK_STYLE_ID = 'MathBlock';
const MATH_INLINE_FONT_MARKER = 'Cambria Math';
const MATH_INLINE_SOURCE = 'markdown:math-inline';

function formulaParagraph(formula: NonNullable<ReturnType<typeof formulaOfBlock>>): ContentBlock {
  const latex = formula.presentation?.latex;
  if (latex === undefined) {
    return { kind: 'paragraph', runs: [{ text: formulaPlaceholderText(formula) }] };
  }
  if (formula.provenance?.source === MATH_INLINE_SOURCE) {
    return { kind: 'paragraph', runs: [{ text: latex, fontFamily: MATH_INLINE_FONT_MARKER }] };
  }
  return { kind: 'paragraph', runs: [{ text: latex }], styleId: MATH_BLOCK_STYLE_ID };
}

function markdownBlock(block: ContentBlock): ContentBlock {
  // A construct marker sits inline in the same flat block array a real reader/writer round trip would produce (flattenPackage writes constructStart/constructEnd back around the region a construct group promoted from) -- see this module's own MarkdownConstructUnsupportedError comment for why it cannot pass through to writeMarkdownContent.
  if (block.kind === 'constructStart' || block.kind === 'constructEnd') {
    throw new MarkdownConstructUnsupportedError(block);
  }
  // A table is recursive too -- ContentTableCell.blocks is itself ContentBlock[], so a table cell could carry its own nested embeddedObject (or another nested table) needing the identical treatment as a top-level block.
  if (block.kind === 'table') {
    return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map(markdownTableCell) })) };
  }
  if (block.kind === 'embeddedObject') {
    // An embedded formula is FLATTENED to a paragraph carrying its own plain-text stand-in -- its StarMath annotation, or the literal "[formula]" -- rather than left to writeMarkdownContent's own default embeddedObject handling, which would silently drop it just like a drawing. Flattening is what actually gets the formula's own text into the markdown. CommonMark/GFM has no math construct to do better with, and this package writes no MathML into docx or odt either in the cases where it still falls back to text (buildDocxPackage/buildOdtPackage's own appendEmbeddedObject, which degrade the identical way when a formula carries no MathML nodes at all).
    const formula = formulaOfBlock(block);
    if (formula !== undefined) {
      return formulaParagraph(formula);
    }
    // A recovered drawing (or any other embeddedObject kind) is passed through unchanged -- writeMarkdownContent's own uniform embeddedObject handling drops it regardless of what it nests, so there is nothing further to do here.
    return block;
  }
  // paragraph/image/pageBreak carry no nested ContentBlock of their own and pass through unchanged.
  return block;
}

function markdownTableCell(cell: ContentTableCell): ContentTableCell {
  return { ...cell, blocks: cell.blocks.map(markdownBlock) };
}

// ContentDocument (the wordprocessing variant) -> markdown text. A thin adapter over markdown-codec's own writeMarkdownContent, lives beside read.ts rather than under src/edit/markdown/ -- src/edit/markdown/editor.ts's MarkdownEditor calls this function directly as its own toMarkdownText, rather than this module importing anything back from src/edit/. markdown does now have a live-view editor (MarkdownEditor), but unlike docx/pptx/odt/odp/ods/odg it holds a mutable in-memory ContentDocument rather than a real XmlElement tree inside a decoded Package -- markdown has no such tree at all -- so this function, not a method on some MarkdownBody, is still the whole write path.
//
// writeMarkdownContent throws MarkdownUnsupportedDocumentKindError on its own for a non-'wordprocessing' input -- this adapter's own guard mirrors that exact check, now for a genuinely different reason than it used to: TypeScript needs `document` narrowed to the wordprocessing variant before this function can map over its own `sections` field at all (a presentation/spreadsheet/drawing/formula-kind ContentDocument has no `sections` field), not to work around any version-skew mismatch.
export function buildMarkdownText(document: ContentDocument, options?: WriteMarkdownOptions): string {
  if (document.kind !== 'wordprocessing') {
    throw new MarkdownUnsupportedDocumentKindError(document.kind);
  }
  const sections = document.sections.map((section) => ({ ...section, blocks: section.blocks.map(markdownBlock) }));
  return writeMarkdownContent({ ...document, sections }, options);
}
