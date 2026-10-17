import type { WriteMarkdownOptions } from "markdown-codec";
import {
  HTML_PREFORMATTED_STYLE_ID,
  MarkdownUnsupportedDocumentKindError,
  writeMarkdownContent,
} from "markdown-codec";
import type {
  ContentBlock,
  ContentDocument,
  ContentTableCell,
} from "document-schema.js";
import { formulaOfBlock, formulaPlaceholderText } from "../model/formula";

// markdown-codec's own writeMarkdownContent parameter type is the SAME document-schema.js ContentDocument this package imports: markdown-codec bumped its own document-schema.js dependency to ^2.2.4 (matching this package's own ^2.2.4 direct dependency), and pnpm resolves both to the single installed copy (`pnpm why document-schema.js` shows exactly one). The version-skew this file used to reshape around (markdown-codec independently pinned at ^1.5.3, a pre-2.0.0 release with CONTENT_FORMAT_VERSION 1, TypeScript treating the two import("document-schema.js")-sourced types as nominally unrelated all the way down through ContentBlock -> ContentEmbeddedObjectBlock -> document) no longer exists, so there is no LegacyDocument mirror type and no field-by-field document rebuild needed any more — a real ContentDocument goes straight into writeMarkdownContent. (markdown-codec 4.0.0 renamed this flat writer to writeMarkdownContent and gave the bare writeMarkdown name to its tree-form DocumentTree counterpart; this package calls only the flat one.)
//
// What remains is a genuine semantic transformation writeMarkdownContent does not do on its own: markdown-codec's own emit path drops every embeddedObject block uniformly, regardless of what it nests (see that package's own src/write.ts -> emit/emit.ts, renderTopLevelBlock's `case "embeddedObject": return ""`). That is exactly right for a recovered drawing — a rect/ellipse/line/path carries no text to stand in for, and CommonMark/GFM has no vector construct anyway — but wrong for an embedded formula, whose own text this package still wants preserved rather than silently discarded. markdownBlock below is that one transformation (flatten a formula block to its own plain-text stand-in), plus passing construct markers through to markdown-codec's own bracket-resolving writer; every other block, a recovered drawing included, is passed through unchanged and left to writeMarkdownContent's own uniform embeddedObject handling to drop.
// A formula carrying a presentation LaTeX string is reconstructed as markdown MATH rather than flattened to plain text: markdown-codec's own math vocabulary (its issue #53) round-trips a $$ display block as a MathBlock-styled paragraph and an inline \( \) span as a run marked with the Cambria Math fontFamily, and its emit path regenerates both shapes from exactly those markers — so the formula's verbatim presentation string (rendering-authoritative, never re-derived from the semantic layer) goes back out as the same syntax it arrived in. Which of the two shapes is chosen by the formula's recorded provenance source: a span that arrived inline goes back inline (in a paragraph of its own — the block model never retained its position inside the source paragraph, the same position loss every inline-equation recovery in this package already has), everything else goes back as a display block. The marker strings are mirrored here as literals for the same reason src/markdown/math.ts mirrors its read-side pair: markdown-codec documents them as stable lower/emit conventions but does not re-export these two among its public style constants.
const MATH_BLOCK_STYLE_ID = "MathBlock";
const MATH_INLINE_FONT_MARKER = "Cambria Math";
const MATH_INLINE_SOURCE = "markdown:math-inline";

// The markdown spelling of a page break, and the second genuine semantic transformation markdownBlock performs (ExaDev/documents.js#584): markdown-codec's own writer drops a ContentPageBreak block entirely — correctly, by that package's own documented model, since its own read side can never produce one and markdown has no page construct to lose fidelity from. This package's conversions DO produce pageBreak blocks (every PDF-to-wordprocessing reconstruction inserts one per page boundary, and docx/odt explicit breaks read as them), and for the text-extraction consumers pdfToMarkdown exists for, the page boundary is exact, free information a markdown output should carry. An HTML comment is the marker shape because it is the one markdown spelling that carries metadata without claiming to be content: CommonMark defines it as an HTML block (markdown-codec's reader lowers it as an HTMLPreformatted paragraph carrying the literal text, so the marker survives a markdown round trip), and no renderer displays it.
//
// The read-side inverse lives in src/markdown/read.ts and turns this exact literal back into a pageBreak block, so the marker MEANS a page break rather than decorating one: markdownToPdf re-renders a real page boundary, and a pdfToMarkdown -> markdownToPdf round trip regenerates markers from real boundaries instead of accumulating the previous round's markers as visible literal text.
export const PAGE_BREAK_MARKER = "<!-- page break -->";

/**
 * The marker opening a page that `BuildMarkdownTextOptions.pageNumbers` labels: an HTML comment naming the page's number, `<!-- page 7 -->` for page 7, on a line of its own. A one-way annotation for readers of the text rather than a directive: unlike {@link PAGE_BREAK_MARKER} it states which page follows, not that a page ends, so reading markdown back drops it (src/markdown/read.ts) instead of turning it into content.
 * @param pageNumber - the number the page is labelled with, as the caller supplied it
 * @returns the marker text
 */
export function pageNumberMarker(pageNumber: number): string {
  return `<!-- page ${String(pageNumber)} -->`;
}

// The exact shape pageNumberMarker writes, for the read side to recognise and drop: the number is whatever the caller labelled the page with, so any run of digits matches.
export const PAGE_NUMBER_MARKER_PATTERN = /^<!-- page \d+ -->$/u;

/**
 * `BuildMarkdownTextOptions.pageNumbers` did not supply exactly one number per page of the document. Thrown rather than labelling a prefix or padding, since a label on the wrong page is worse than none.
 */
export class MarkdownPageNumberCountError extends Error {
  readonly pageCount: number;
  readonly pageNumberCount: number;

  constructor(pageCount: number, pageNumberCount: number) {
    super(
      `pageNumbers supplies ${String(pageNumberCount)} page numbers for a document of ${String(pageCount)} pages; it must supply exactly one per page`,
    );
    this.name = "MarkdownPageNumberCountError";
    this.pageCount = pageCount;
    this.pageNumberCount = pageNumberCount;
  }
}

export interface BuildMarkdownTextOptions extends WriteMarkdownOptions {
  /**
   * One number per page of the document, in page order, written as {@link pageNumberMarker} at the start of each page so a reader of the text can tell which page each part came from. A page starts at the beginning of the document, after every top-level page break, and at the start of every section after the first that does not continue its predecessor's page (`breakType` other than `continuous`). Omitted, no page is labelled. The pdf conversions supply it for a page-selected read (`pages`), with each page's original one-based page number, since there the position of a part no longer says which page it is.
   * @throws MarkdownPageNumberCountError when the count differs from the document's page count
   */
  readonly pageNumbers?: readonly number[];
}

function pageNumberParagraph(pageNumber: number): ContentBlock {
  return {
    kind: "paragraph",
    runs: [{ text: pageNumberMarker(pageNumber) }],
    styleId: HTML_PREFORMATTED_STYLE_ID,
  };
}

type WordprocessingSection = Extract<
  ContentDocument,
  { kind: "wordprocessing" }
>["sections"][number];

// Inserts pageNumberMarker at the start of every page, by the page-start rule BuildMarkdownTextOptions.pageNumbers states. Runs on the content before markdownBlock lowers page breaks, so a page break is still a pageBreak block here.
function labelPages(
  sections: readonly WordprocessingSection[],
  pageNumbers: readonly number[],
): WordprocessingSection[] {
  let pageCount = 0;
  // A page beyond the supplied numbers is counted but left unlabelled; the count check below then refuses the whole call, so no partially labelled text is ever returned.
  const label = (): ContentBlock[] => {
    const pageNumber = pageNumbers[pageCount];
    pageCount++;
    return pageNumber === undefined ? [] : [pageNumberParagraph(pageNumber)];
  };
  const labelled = sections.map((section, sectionIndex) => {
    const blocks: ContentBlock[] = [];
    if (sectionIndex === 0 || section.breakType !== "continuous") {
      blocks.push(...label());
    }
    for (const block of section.blocks) {
      blocks.push(block);
      if (block.kind === "pageBreak") {
        blocks.push(...label());
      }
    }
    return { ...section, blocks };
  });
  if (pageCount !== pageNumbers.length) {
    throw new MarkdownPageNumberCountError(pageCount, pageNumbers.length);
  }
  return labelled;
}

function formulaParagraph(
  formula: NonNullable<ReturnType<typeof formulaOfBlock>>,
): ContentBlock {
  const latex = formula.presentation?.latex;
  if (latex === undefined) {
    return {
      kind: "paragraph",
      runs: [{ text: formulaPlaceholderText(formula) }],
    };
  }
  if (formula.provenance?.source === MATH_INLINE_SOURCE) {
    return {
      kind: "paragraph",
      runs: [{ text: latex, fontFamily: MATH_INLINE_FONT_MARKER }],
    };
  }
  return {
    kind: "paragraph",
    runs: [{ text: latex }],
    styleId: MATH_BLOCK_STYLE_ID,
  };
}

function markdownBlock(block: ContentBlock): ContentBlock {
  // A construct marker passes through untouched: markdown-codec's own writer resolves marker pairs as balanced brackets and renders each construct it has a spelling for (a footnote definition, a blockquote division, a titled image's link wrapper), transparently for one it does not — which is also why a marker can reach here at all now, since markdown-codec's own read side emits division pairs for blockquotes and this package's editor round trips its own reads back out.
  // A pageBreak block becomes the marker paragraph — HTMLPreformatted so markdown-codec's emitter writes the text verbatim (a plain paragraph's runs would go through escapeMarkdownText, which backslash-escapes the '<', '!', '-', and '>' the marker is made of). This transform recurses (markdownTableCell below), so a pageBreak inside a ContentTableCell also becomes a marker — but there it is a one-way annotation for human readers of the markdown text, not an invertible directive: GFM cell content is inline-only, so the marker can never round-trip back as the block-scoped HTMLPreformatted paragraph the read side promotes (see src/markdown/read.ts).
  if (block.kind === "pageBreak") {
    return {
      kind: "paragraph",
      runs: [{ text: PAGE_BREAK_MARKER }],
      styleId: HTML_PREFORMATTED_STYLE_ID,
    };
  }
  // A table is recursive too — ContentTableCell.blocks is itself ContentBlock[], so a table cell could carry its own nested embeddedObject (or another nested table) needing the identical treatment as a top-level block.
  if (block.kind === "table") {
    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.map(markdownTableCell),
      })),
    };
  }
  if (block.kind === "embeddedObject") {
    // An embedded formula is FLATTENED to a paragraph carrying its own plain-text stand-in — its StarMath annotation, or the literal "[formula]" — rather than left to writeMarkdownContent's own default embeddedObject handling, which would silently drop it just like a drawing. Flattening is what actually gets the formula's own text into the markdown. CommonMark/GFM has no math construct to do better with, and this package writes no MathML into docx or odt either in the cases where it still falls back to text (buildDocxPackage/buildOdtPackage's own appendEmbeddedObject, which degrade the identical way when a formula carries no MathML nodes at all).
    const formula = formulaOfBlock(block);
    if (formula !== undefined) {
      return formulaParagraph(formula);
    }
    // A recovered drawing (or any other embeddedObject kind) is passed through unchanged — writeMarkdownContent's own uniform embeddedObject handling drops it regardless of what it nests, so there is nothing further to do here.
    return block;
  }
  // paragraph/image/pageBreak carry no nested ContentBlock of their own and pass through unchanged.
  return block;
}

function markdownTableCell(cell: ContentTableCell): ContentTableCell {
  return { ...cell, blocks: cell.blocks.map(markdownBlock) };
}

// ContentDocument (the wordprocessing variant) -> markdown text. A thin adapter over markdown-codec's own writeMarkdownContent, lives beside read.ts rather than under src/edit/markdown/ — src/edit/markdown/editor.ts's MarkdownEditor calls this function directly as its own toMarkdownText, rather than this module importing anything back from src/edit/. markdown does now have a live-view editor (MarkdownEditor), but unlike docx/pptx/odt/odp/ods/odg it holds a mutable in-memory ContentDocument rather than a real XmlElement tree inside a decoded Package — markdown has no such tree at all — so this function, not a method on some MarkdownBody, is still the whole write path.
//
// writeMarkdownContent throws MarkdownUnsupportedDocumentKindError on its own for a non-'wordprocessing' input — this adapter's own guard mirrors that exact check, now for a genuinely different reason than it used to: TypeScript needs `document` narrowed to the wordprocessing variant before this function can map over its own `sections` field at all (a presentation/spreadsheet/drawing/formula-kind ContentDocument has no `sections` field), not to work around any version-skew mismatch.
export function buildMarkdownText(
  document: ContentDocument,
  options?: BuildMarkdownTextOptions,
): string {
  if (document.kind !== "wordprocessing") {
    throw new MarkdownUnsupportedDocumentKindError(document.kind);
  }
  const pageNumbers = options?.pageNumbers;
  const labelled =
    pageNumbers === undefined
      ? document.sections
      : labelPages(document.sections, pageNumbers);
  const sections = labelled.map((section) => ({
    ...section,
    blocks: section.blocks.map(markdownBlock),
  }));
  return writeMarkdownContent({ ...document, sections }, options);
}
